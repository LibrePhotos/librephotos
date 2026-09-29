//! `api.metadata.reader.get_metadata(path, tags, try_sidecar=True)` through
//! a one-shot ExifTool process. Kept in one function so the integrator can
//! swap it for the `lp-exif` pool once that exists.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{Context, bail};
use serde_json::Value;
use tokio::io::AsyncWriteExt;

/// `get_sidecar_files_in_priority_order` + `_get_existing_metadata_files_reversed`.
fn files_by_reverse_priority(media_file: &str) -> Vec<String> {
    let path = Path::new(media_file);
    let base = match path.extension() {
        Some(_) => path.with_extension("").display().to_string(),
        None => media_file.to_string(),
    };
    let mut files: Vec<String> = [
        format!("{base}.xmp"),
        format!("{base}.XMP"),
        format!("{media_file}.xmp"),
        format!("{media_file}.XMP"),
    ]
    .into_iter()
    .filter(|f| Path::new(f).exists())
    .collect();
    files.push(media_file.to_string());
    files.reverse();
    files
}

fn split_tag(tag: &str) -> (String, String) {
    match tag.rsplit_once(':') {
        Some((g, n)) => (g.to_lowercase(), n.to_lowercase()),
        None => (String::new(), tag.to_lowercase()),
    }
}

fn group_matches(requested: &str, returned: &str) -> bool {
    requested.is_empty()
        || returned.is_empty()
        || requested == returned
        || requested.starts_with(&format!("{returned}-"))
}

fn name_matches(requested: &str, returned: &str) -> bool {
    match requested.strip_suffix('*') {
        Some(prefix) if requested.ends_with("-*") => returned.starts_with(prefix),
        _ => requested == returned,
    }
}

/// One exiftool run with `args` (one per line of an argfile, so paths are
/// passed as UTF-8). The exit status is not checked: exiftool reports a
/// failed write on stdout, as PyExifTool leaves it.
async fn run_exiftool(exiftool: &Path, args: &[&str]) -> anyhow::Result<Vec<u8>> {
    let mut argfile = String::new();
    for a in args {
        argfile.push_str(a);
        argfile.push('\n');
    }
    let mut child = tokio::process::Command::new(PathBuf::from(exiftool))
        .args(["-charset", "filename=utf8", "-@", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("starting {}", exiftool.display()))?;
    let mut stdin = child.stdin.take().context("exiftool stdin")?;
    stdin.write_all(argfile.as_bytes()).await?;
    drop(stdin);
    Ok(child.wait_with_output().await?.stdout)
}

/// `api.metadata.writer.read_orientation`: the file's own EXIF Orientation
/// (1 when absent), `None` when it cannot be read.
pub async fn read_orientation(exiftool: &Path, media_file: &str) -> Option<i64> {
    let out = run_exiftool(
        exiftool,
        &["-j", "-G", "-n", "-EXIF:Orientation", media_file],
    )
    .await
    .ok()?;
    let per_file: Vec<serde_json::Map<String, Value>> = serde_json::from_slice(&out).ok()?;
    let first = per_file.into_iter().next()?;
    match first.into_iter().find(|(k, _)| k != "SourceFile") {
        None | Some((_, Value::Null)) => Some(1),
        Some((_, Value::Number(n))) => n.as_i64(),
        Some(_) => None,
    }
}

/// `api.metadata.writer.write_metadata(media_file, {tag: value}, use_sidecar)`.
pub async fn write_tag(
    exiftool: &Path,
    media_file: &str,
    tag: &str,
    value: i64,
    use_sidecar: bool,
) -> anyhow::Result<()> {
    let target = if use_sidecar {
        let path = Path::new(media_file);
        match path.extension() {
            Some(_) => format!("{}.xmp", path.with_extension("").display()),
            None => format!("{media_file}.xmp"),
        }
    } else {
        media_file.to_string()
    };
    let assignment = format!("-{tag}={value}");
    run_exiftool(
        exiftool,
        &["-G", "-n", &assignment, "-overwrite_original", &target],
    )
    .await?;
    Ok(())
}

/// One value per tag (None when absent); a later file wins, as in the exif
/// sidecar's `highest_priority_values`.
pub async fn get_metadata(
    exiftool: &Path,
    media_file: &str,
    tags: &[String],
) -> anyhow::Result<Vec<Option<Value>>> {
    let mut values: Vec<Option<Value>> = vec![None; tags.len()];
    if tags.is_empty() {
        return Ok(values);
    }
    let files = files_by_reverse_priority(media_file);
    let mut args = String::from("-j\n-G\n-n\n");
    for t in tags {
        args.push('-');
        args.push_str(t);
        args.push('\n');
    }
    for f in &files {
        args.push_str(f);
        args.push('\n');
    }
    let mut child = tokio::process::Command::new(PathBuf::from(exiftool))
        .args(["-charset", "filename=utf8", "-@", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("starting {}", exiftool.display()))?;
    let mut stdin = child.stdin.take().context("exiftool stdin")?;
    stdin.write_all(args.as_bytes()).await?;
    drop(stdin);
    let out = child.wait_with_output().await?;
    if out.stdout.iter().all(u8::is_ascii_whitespace) {
        bail!(
            "exiftool read nothing from {media_file}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    let per_file: Vec<serde_json::Map<String, Value>> = serde_json::from_slice(&out.stdout)
        .with_context(|| format!("exiftool output for {media_file}"))?;
    if per_file.len() != files.len() {
        bail!(
            "exiftool answered for {} of {} files",
            per_file.len(),
            files.len()
        );
    }
    for data in per_file {
        for (i, tag) in tags.iter().enumerate() {
            let (group, name) = split_tag(tag);
            let found = data.iter().find(|(key, _)| {
                if key.as_str() == "SourceFile" {
                    return false;
                }
                let (kg, kn) = split_tag(key);
                name_matches(&name, &kn) && group_matches(&group, &kg)
            });
            if let Some((_, v)) = found
                && !v.is_null()
            {
                values[i] = Some(v.clone());
            }
        }
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_matching() {
        assert!(group_matches("xmp-dc", "xmp"));
        assert!(group_matches("exif", "exif"));
        assert!(!group_matches("exif", "xmp"));
        assert!(name_matches("description-*", "description-de"));
        assert!(name_matches("datetimeoriginal", "datetimeoriginal"));
    }

    #[test]
    fn media_file_is_lowest_priority() {
        let files = files_by_reverse_priority("C:/nowhere/x.jpg");
        assert_eq!(files, vec!["C:/nowhere/x.jpg".to_string()]);
    }
}

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

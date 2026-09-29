//! The two metadata reads the tasks need (face regions, GPS), with the exif
//! sidecar's semantics (`service/exif/main.py`): every existing XMP sidecar
//! and the media file, later files overriding earlier ones.
//!
//! [`get_tags`] runs a one-shot `exiftool` until `lp_exif` offers reads;
//! swapping its body for the pool call is the whole migration. No ExifTool
//! installed reads as "no metadata".

use std::path::Path;
use std::process::Stdio;

use serde_json::Value;
use tokio::io::AsyncWriteExt;

#[derive(Debug, thiserror::Error)]
#[error("exif service could not read the metadata of {file}: {message}")]
pub struct MetadataError {
    pub file: String,
    pub message: String,
}

/// `get_sidecar_files_in_priority_order`.
fn sidecar_candidates(media: &str) -> [String; 4] {
    let stem = match (media.rfind('.'), media.rfind(['/', '\\'])) {
        (Some(dot), Some(sep)) if dot > sep + 1 => &media[..dot],
        (Some(dot), None) if dot > 0 => &media[..dot],
        _ => media,
    };
    [
        format!("{stem}.xmp"),
        format!("{stem}.XMP"),
        format!("{media}.xmp"),
        format!("{media}.XMP"),
    ]
}

/// Existing metadata files, lowest priority first.
pub fn files_by_reverse_priority(media: &str) -> Vec<String> {
    let mut files: Vec<String> = sidecar_candidates(media)
        .into_iter()
        .filter(|f| Path::new(f).exists())
        .collect();
    files.push(media.to_string());
    files.reverse();
    files
}

fn split_tag(tag: &str) -> (String, String) {
    match tag.rfind(':') {
        Some(i) => (tag[..i].to_lowercase(), tag[i + 1..].to_lowercase()),
        None => (String::new(), tag.to_lowercase()),
    }
}

fn group_matches(requested: &str, returned: &str) -> bool {
    requested.is_empty()
        || returned.is_empty()
        || requested == returned
        || requested.starts_with(&format!("{returned}-"))
}

/// `get_metadata(media, tags, try_sidecar=True, struct=...)`: one value per
/// tag (`None` when absent). `Ok(None)` when ExifTool is not installed.
pub async fn get_tags(
    exiftool: &Path,
    media: &str,
    tags: &[&str],
    structured: bool,
) -> Result<Option<Vec<Option<Value>>>, MetadataError> {
    let files = files_by_reverse_priority(media);
    let err = |message: String| MetadataError {
        file: media.to_string(),
        message,
    };
    let Some(mut per_file) = run(exiftool, &files, tags, structured).await.map_err(err)? else {
        return Ok(None);
    };
    if per_file.len() != files.len() {
        per_file = Vec::new();
        for f in &files {
            if let Some(mut v) = run(exiftool, std::slice::from_ref(f), tags, structured)
                .await
                .map_err(err)?
                && !v.is_empty()
            {
                per_file.push(v.remove(0));
            }
        }
    }
    let mut values: Vec<Option<Value>> = vec![None; tags.len()];
    for data in per_file {
        let Value::Object(map) = data else { continue };
        for (i, tag) in tags.iter().enumerate() {
            let (group, name) = split_tag(tag);
            let found = map.iter().find(|(key, _)| {
                if key.as_str() == "SourceFile" {
                    return false;
                }
                let (kg, kn) = split_tag(key);
                kn == name && group_matches(&group, &kg)
            });
            if let Some((_, v)) = found
                && !v.is_null()
            {
                values[i] = Some(v.clone());
            }
        }
    }
    Ok(Some(values))
}

async fn run(
    exiftool: &Path,
    files: &[String],
    tags: &[&str],
    structured: bool,
) -> Result<Option<Vec<Value>>, String> {
    let mut child = match tokio::process::Command::new(exiftool)
        .args(["-charset", "filename=utf8", "-@", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            tracing::debug!(exiftool = %exiftool.display(), "exiftool not found");
            return Ok(None);
        }
        Err(e) => return Err(e.to_string()),
    };
    // pyexiftool's common args: `-struct` alone for structured reads (no
    // -G/-n: text values), else `-G -n`.
    let mut args = if structured {
        String::from("-j\n-struct\n")
    } else {
        String::from("-j\n-G\n-n\n")
    };
    for t in tags {
        args.push('-');
        args.push_str(t);
        args.push('\n');
    }
    for f in files {
        args.push_str(f);
        args.push('\n');
    }
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(args.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if out.stdout.iter().all(u8::is_ascii_whitespace) {
        return Ok(Some(Vec::new()));
    }
    serde_json::from_slice::<Vec<Value>>(&out.stdout)
        .map(Some)
        .map_err(|e| format!("unreadable exiftool output: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_order() {
        let c = sidecar_candidates(r"C:\p\IMG_1.JPG");
        assert_eq!(c[0], r"C:\p\IMG_1.xmp");
        assert_eq!(c[3], r"C:\p\IMG_1.JPG.XMP");
    }

    #[test]
    fn tag_attribution() {
        assert!(group_matches("xmp-dc", "xmp"));
        assert!(group_matches("composite", ""));
        assert!(!group_matches("exif", "xmp"));
        assert_eq!(
            split_tag("Composite:GPSLatitude"),
            ("composite".into(), "gpslatitude".into())
        );
    }
}

//! Batched tag reads for burst detection: what `api.metadata.reader.get_metadata`
//! returns (ExifTool `-G -n`, XMP sidecars override the file), for many
//! files per ExifTool run.
//!
//! This spawns ExifTool itself because `lp_exif::ExifPool` has no read API
//! yet; [`read_tags`] is the one call to swap for the pool.

use lp_proc::NoWindow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use futures::StreamExt;
use serde_json::Value;

const CHUNK: usize = 500;

/// `get_sidecar_files_in_priority_order`, highest priority first.
fn sidecars(media: &str) -> Vec<String> {
    let base = Path::new(media).with_extension("").display().to_string();
    let base = if Path::new(media).extension().is_some() {
        base
    } else {
        media.to_string()
    };
    vec![
        format!("{base}.xmp"),
        format!("{base}.XMP"),
        format!("{media}.xmp"),
        format!("{media}.XMP"),
    ]
}

pub use lp_exif::is_safe_tag;

fn split_tag(tag: &str) -> (String, String) {
    let (g, n) = tag.rsplit_once(':').unwrap_or(("", tag));
    (g.to_lowercase(), n.to_lowercase())
}

/// The exif sidecar's `_attribute`: requested `Group:Name` against the keys
/// ExifTool answered with.
fn attribute(data: &serde_json::Map<String, Value>, tags: &[String]) -> Vec<Option<Value>> {
    tags.iter()
        .map(|tag| {
            if !is_safe_tag(tag) {
                return None;
            }
            let (group, name) = split_tag(tag);
            data.iter()
                .filter(|(k, _)| k.as_str() != "SourceFile")
                .find(|(k, _)| {
                    let (kg, kn) = split_tag(k);
                    let name_ok = match name.strip_suffix("-*") {
                        Some(prefix) => kn.starts_with(&format!("{prefix}-")),
                        None => kn == name,
                    };
                    let group_ok = group.is_empty()
                        || kg.is_empty()
                        || group == kg
                        || group.starts_with(&format!("{kg}-"));
                    name_ok && group_ok
                })
                .map(|(_, v)| v.clone())
                .filter(|v| !v.is_null())
        })
        .collect()
}

fn key(path: &str) -> String {
    let s = path.replace('\\', "/");
    if cfg!(windows) { s.to_lowercase() } else { s }
}

async fn run_chunk(exiftool: &Path, files: &[String], tags: &[String]) -> HashMap<String, Value> {
    let mut args = String::from("-j\n-G\n-n\n-charset\nfilename=utf8\n");
    for t in tags {
        args.push('-');
        args.push_str(t);
        args.push('\n');
    }
    for f in files {
        args.push_str(f);
        args.push('\n');
    }
    let Ok(argfile) = tempfile::NamedTempFile::new() else {
        return HashMap::new();
    };
    if std::fs::write(argfile.path(), args).is_err() {
        return HashMap::new();
    }
    let out = tokio::process::Command::new(exiftool)
        .no_window()
        .arg("-@")
        .arg(argfile.path())
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .await;
    let Ok(out) = out else {
        return HashMap::new();
    };
    let parsed: Vec<Value> = serde_json::from_slice(&out.stdout).unwrap_or_default();
    parsed
        .into_iter()
        .filter_map(|v| {
            let src = v.get("SourceFile")?.as_str()?.to_string();
            Some((key(&src), v))
        })
        .collect()
}

/// Values of `tags` for every media file (None for a missing tag), the XMP
/// sidecars' values winning over the file's. A file ExifTool cannot read
/// yields no values at all, like Django's caught `MetadataReadError`.
pub async fn read_tags(
    exiftool: &Path,
    media: &[String],
    tags: &[String],
    concurrency: usize,
) -> HashMap<String, Vec<Option<Value>>> {
    let safe: Vec<String> = tags.iter().filter(|t| is_safe_tag(t)).cloned().collect();
    if safe.is_empty() || media.is_empty() {
        return HashMap::new();
    }
    let mut sources: Vec<String> = Vec::with_capacity(media.len());
    let mut plan: Vec<(String, Vec<String>)> = Vec::with_capacity(media.len());
    // One argfile line per path: a line break in a file name would be an
    // option of its own.
    for m in media.iter().filter(|m| !m.contains(['\n', '\r'])) {
        let mut files = vec![m.clone()];
        let existing: Vec<String> = sidecars(m)
            .into_iter()
            .filter(|s| Path::new(s).exists())
            .collect();
        files.extend(existing.into_iter().rev());
        sources.extend(files.iter().cloned());
        plan.push((m.clone(), files));
    }
    sources.sort();
    sources.dedup();
    let exiftool: PathBuf = exiftool.to_path_buf();
    let mut answers: HashMap<String, Value> = HashMap::new();
    let chunks: Vec<Vec<String>> = sources.chunks(CHUNK).map(|c| c.to_vec()).collect();
    let mut pending = futures::stream::iter(chunks.into_iter().map(|c| {
        let exiftool = exiftool.clone();
        let tags = safe.clone();
        async move { run_chunk(&exiftool, &c, &tags).await }
    }))
    .buffer_unordered(concurrency.max(1));
    while let Some(part) = pending.next().await {
        answers.extend(part);
    }
    plan.into_iter()
        .filter_map(|(media, files)| {
            let main = answers.get(&key(&media))?;
            let mut values = attribute(main.as_object()?, tags);
            for f in &files[1..] {
                if let Some(data) = answers.get(&key(f)).and_then(Value::as_object) {
                    for (slot, v) in values.iter_mut().zip(attribute(data, tags)) {
                        if v.is_some() {
                            *slot = v;
                        }
                    }
                }
            }
            Some((media, values))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn attributes_by_group_and_name() {
        let data = json!({"SourceFile": "a.jpg", "MakerNotes:BurstMode": 1, "EXIF:Model": "X"});
        let tags = vec![
            "MakerNotes:BurstMode".to_string(),
            "EXIF:Model".into(),
            "XMP:Title".into(),
        ];
        assert_eq!(
            attribute(data.as_object().unwrap(), &tags),
            vec![Some(json!(1)), Some(json!("X")), None]
        );
    }

    #[test]
    fn only_plain_tag_names_reach_exiftool() {
        for ok in [
            "MakerNotes:BurstMode",
            "XMP-dc:Description-*",
            "EXIF:Model#",
            "Model",
        ] {
            assert!(is_safe_tag(ok), "{ok}");
        }
        for bad in [
            "",
            "FileName=../../x.jpg",
            "all=",
            "EXIF:Model\n-if\nsystem('x')",
            "-execute",
            "EXIF:Model -o",
            "@",
        ] {
            assert!(!is_safe_tag(bad), "{bad:?}");
        }
        let data = json!({"SourceFile": "a.jpg", "EXIF:Model": "X"});
        assert_eq!(
            attribute(data.as_object().unwrap(), &["EXIF:Model=Y".to_string()]),
            vec![None]
        );
    }

    #[test]
    fn sidecar_names() {
        assert_eq!(
            sidecars("d/a.jpg")[0],
            Path::new("d/a").display().to_string() + ".xmp"
        );
        assert_eq!(sidecars("d/a.jpg")[2], "d/a.jpg.xmp");
    }
}

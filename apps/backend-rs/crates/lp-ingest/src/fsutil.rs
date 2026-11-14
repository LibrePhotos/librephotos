//! Walking, grouping and file typing: `api/directory_watcher/utils.py`,
//! `file_grouping.py`, `api/models/file.py` and `api/mime.py`.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

pub use lp_exif::splitext;

pub const IMAGE: i32 = 1;
pub const VIDEO: i32 = 2;
pub const METADATA_FILE: i32 = 3;
pub const RAW_FILE: i32 = 4;

/// `FILE_TYPE_PRIORITY` (lower wins main_file).
pub fn type_priority(t: i32) -> i32 {
    match t {
        IMAGE => 1,
        VIDEO => 2,
        RAW_FILE => 3,
        METADATA_FILE => 4,
        5 => 5,
        _ => 999,
    }
}

const RAW_FORMATS: &[&str] = &[
    ".RWZ", ".CR2", ".NRW", ".EIP", ".RAF", ".ERF", ".RW2", ".NEF", ".ARW", ".K25", ".DNG", ".SRF",
    ".DCR", ".RAW", ".CRW", ".BAY", ".3FR", ".CS1", ".MEF", ".ORF", ".ARI", ".SR2", ".KDC", ".MOS",
    ".MFW", ".FFF", ".CR3", ".SRW", ".RWL", ".J6I", ".KC2", ".X3F", ".MRW", ".IIQ", ".PEF", ".CXI",
    ".MDC",
];

pub fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn ext_upper(path: &str) -> String {
    splitext(path).1.to_uppercase()
}

pub fn is_raw(path: &str) -> bool {
    let e = ext_upper(path);
    RAW_FORMATS.contains(&e.as_str())
}

pub fn is_metadata(path: &str) -> bool {
    ext_upper(path) == ".XMP"
}

/// `api.mime._is_mpeg_ts`: 188-byte TS packets, or 192-byte M2TS ones.
fn is_mpeg_ts(head: &[u8]) -> bool {
    head.len() >= 192 * 3
        && ([0usize, 188, 376].iter().all(|&i| head[i] == 0x47)
            || [4usize, 196, 388].iter().all(|&i| head[i] == 0x47))
}

/// `sniffed_mime_type`: magic bytes only (`filetype` reads 8 KiB), else
/// the MPEG-TS check, else None.
pub fn sniffed_mime(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut head = vec![0u8; 8192];
    let mut n = 0;
    while n < head.len() {
        match f.read(&mut head[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(_) => return None,
        }
    }
    head.truncate(n);
    if let Some(t) = infer::get(&head) {
        return Some(t.mime_type().to_string());
    }
    if is_mpeg_ts(&head) {
        return Some("video/mp2t".into());
    }
    None
}

/// `mime_type`: sniffed, else by extension, else octet-stream.
pub fn mime_type(path: &Path) -> String {
    sniffed_mime(path)
        .or_else(|| mime_guess::from_path(path).first().map(|m| m.to_string()))
        .unwrap_or_else(|| "application/octet-stream".into())
}

pub fn is_video(path: &Path) -> bool {
    sniffed_mime(path).is_some_and(|m| m.contains("video"))
}

/// `IMAGE_EXTENSIONS` (`api/models/file.py`), lowercase: image formats for
/// files the scanner cannot load. RAW and XMP live in [`is_raw`] / [`is_metadata`].
pub const IMAGE_EXTENSIONS: &[&str] = &[
    ".avif", ".bmp", ".gif", ".heic", ".heif", ".hif", ".j2k", ".jfif", ".jp2", ".jpe", ".jpeg",
    ".jpg", ".jxl", ".png", ".tif", ".tiff", ".webp",
];

/// `VIDEO_EXTENSIONS` (`api/models/file.py`), lowercase.
pub const VIDEO_EXTENSIONS: &[&str] = &[
    ".3g2", ".3gp", ".asf", ".avi", ".flv", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg",
    ".mpg", ".mts", ".ogv", ".vob", ".webm", ".wmv",
];

/// `looks_like_media`: whether a path the scanner could not load is still
/// worth reporting as a failure. True when its last extension (lowercased) is
/// in [`IMAGE_EXTENSIONS`] / [`VIDEO_EXTENSIONS`], is RAW or `.xmp`, or when
/// its content sniffs as `image/*` / `video/*` ([`sniffed_mime`]; an
/// unreadable file sniffs as nothing). RawTherapee `.pp3` sidecars or `.txt`
/// notes are not media, so a group of only those is skipped instead of
/// failing the scan.
pub fn looks_like_media(path: &Path) -> bool {
    let s = path_str(path);
    let ext = splitext(&s).1.to_lowercase();
    if IMAGE_EXTENSIONS.contains(&ext.as_str())
        || VIDEO_EXTENSIONS.contains(&ext.as_str())
        || is_raw(&s)
        || is_metadata(&s)
    {
        return true;
    }
    sniffed_mime(path).is_some_and(|m| m.starts_with("image/") || m.starts_with("video/"))
}

/// `detect_file_type`.
pub fn detect_file_type(path: &Path) -> i32 {
    let s = path_str(path);
    let mut t = IMAGE;
    if is_raw(&s) {
        t = RAW_FILE;
    }
    if is_video(path) {
        t = VIDEO;
    }
    if is_metadata(&s) {
        t = METADATA_FILE;
    }
    t
}

/// `(directory, lowercase stem)` like `get_file_grouping_key`.
pub fn grouping_key(path: &str) -> (String, String) {
    let sep = path.rfind(['/', '\\']);
    let (dir, name) = match sep {
        Some(i) => {
            // os.path.dirname keeps a root separator ("C:\\x" -> "C:\\").
            let d = &path[..i];
            let d = if d.is_empty() || d.ends_with(':') {
                &path[..=i]
            } else {
                d.trim_end_matches(['/', '\\'])
            };
            let d = if d.is_empty() { &path[..=i] } else { d };
            (d.to_string(), &path[i + 1..])
        }
        None => (String::new(), path),
    };
    (dir, splitext(name).0.to_lowercase())
}

/// `get_sidecar_grouping_keys`: `IMG.jpg.xmp` tries `img.jpg` then `img`.
pub fn sidecar_grouping_keys(path: &str) -> Vec<(String, String)> {
    let key = grouping_key(path);
    let (inner_stem, inner_ext) = splitext(&key.1);
    if !inner_ext.is_empty() {
        let inner = (key.0.clone(), inner_stem.to_string());
        vec![key, inner]
    } else {
        vec![key]
    }
}

/// Parsed `SKIP_PATTERNS` (`"a, b"` -> `["a", "b"]`; empty -> none).
pub fn skip_patterns(setting: &str) -> Vec<String> {
    if setting.is_empty() {
        return Vec::new();
    }
    setting.split(',').map(|p| p.trim().to_string()).collect()
}

pub fn should_skip(path: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|p| path.contains(p.as_str()))
}

/// Dot-files everywhere; on Windows also the hidden attribute.
pub fn is_hidden(path: &Path) -> bool {
    if path
        .file_name()
        .map(|n| n.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
    {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Ok(m) = std::fs::metadata(path) {
            return m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0;
        }
    }
    false
}

fn dir_identity(path: &Path) -> Option<String> {
    let real = std::fs::canonicalize(path).ok()?;
    let s = real.to_string_lossy().into_owned();
    Some(if cfg!(windows) { s.to_lowercase() } else { s })
}

/// `walk_directory`: follows symlinks, skips hidden entries, skip patterns,
/// dangling links and loops back into a directory being walked.
pub fn walk_directory(directory: &Path, patterns: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut ancestors = HashSet::new();
    walk(directory, patterns, &mut ancestors, &mut out);
    out
}

fn walk(dir: &Path, patterns: &[String], ancestors: &mut HashSet<String>, out: &mut Vec<PathBuf>) {
    let Some(identity) = dir_identity(dir) else {
        return;
    };
    if !ancestors.insert(identity.clone()) {
        tracing::warn!(dir = %dir.display(), "skipping symlink loop back to a directory already being scanned");
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let fpath = entry.path();
            if is_hidden(&fpath) || should_skip(&path_str(&fpath), patterns) {
                continue;
            }
            match std::fs::metadata(&fpath) {
                Ok(m) if m.is_dir() => walk(&fpath, patterns, ancestors, out),
                Ok(m) if m.is_file() => out.push(fpath),
                _ => {
                    tracing::warn!(path = %fpath.display(), "skipping: neither a file nor a directory (broken symlink?)");
                }
            }
        }
    }
    ancestors.remove(&identity);
}

/// The file's mtime in UTC. Django compares `fromtimestamp(mtime)` (local
/// wall time) labelled UTC, which is only right on a UTC host (its Docker
/// image); elsewhere every file looks modified. Rust compares real instants.
pub fn mtime_utc(path: &Path) -> Option<DateTime<Utc>> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.into())
}

/// MD5 of the whole file + `str(user_id)`.
pub fn calculate_hash(path: &Path, user_id: i32) -> std::io::Result<String> {
    use md5::{Digest, Md5};
    let mut f = std::fs::File::open(path)?;
    let mut hasher = Md5::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{}{}", hex::encode(hasher.finalize()), user_id))
}

/// Stored paths are spelled with the OS separator (`os.path.join`).
pub fn media_name(dir: &str, file: &str) -> String {
    format!("{dir}{}{file}", std::path::MAIN_SEPARATOR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grouping_keys() {
        assert_eq!(
            grouping_key(r"C:\p\IMG_1.JPG"),
            (r"C:\p".to_string(), "img_1".to_string())
        );
        assert_eq!(
            sidecar_grouping_keys(r"C:\p\IMG_1.jpg.xmp"),
            vec![
                (r"C:\p".to_string(), "img_1.jpg".to_string()),
                (r"C:\p".to_string(), "img_1".to_string())
            ]
        );
        assert_eq!(grouping_key("/a/b.tar.gz").1, "b.tar");
        assert_eq!(grouping_key(r"C:\x.jpg").0, r"C:\");
    }

    #[test]
    fn types() {
        assert!(is_raw(r"C:\a\DSC.dng"));
        assert!(!is_raw("a.jpg"));
        assert!(is_metadata("x.XMP"));
        assert_eq!(skip_patterns(""), Vec::<String>::new());
        assert_eq!(
            skip_patterns("a, b"),
            vec!["a".to_string(), "b".to_string()]
        );
        assert!(should_skip("/x/@eaDir/y", &skip_patterns("@eaDir")));
    }

    #[test]
    fn mpeg_ts() {
        let mut head = vec![0u8; 576];
        for i in [4, 196, 388] {
            head[i] = 0x47;
        }
        assert!(is_mpeg_ts(&head));
        assert!(!is_mpeg_ts(&head[..500]));
    }
}

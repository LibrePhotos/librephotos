//! `strip_thumbnail_metadata` (`api/thumbnail_metadata.py`, Django #2140):
//! remove the original's EXIF/XMP from WebP thumbnails and a video's
//! metadata (recorded location) from MP4 thumbnails written before they were
//! left out. Only the container changes, never the encoded picture, so pixels
//! and perceptual hashes stay the same; the ICC profile is kept. Only files
//! that still carry metadata are rewritten, so a second run just reads.
//!
//! New Rust thumbnails are written ICC-only (`LP_THUMB_KEEP`, `-map_metadata
//! -1` for ffmpeg); libraries rendered earlier, by Django or by Rust, need
//! this once.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use lp_proc::NoWindow;

pub const THUMBNAIL_DIRS: [&str; 3] = [
    crate::render::BIG,
    crate::render::SQUARE,
    crate::render::SQUARE_SMALL,
];

const METADATA_CHUNKS: [&[u8; 4]; 2] = [b"EXIF", b"XMP "];
/// The VP8X header announces the metadata chunks with these flag bits.
const VP8X_EXIF_FLAG: u8 = 0x08;
const VP8X_XMP_FLAG: u8 = 0x04;
/// ExifTool is started once per batch; the paths go through an argument file.
const BATCH_SIZE: usize = 500;
/// What a video thumbnail can carry from its source, by ExifTool group.
/// ffmpeg itself writes `ItemList:Encoder` into every file, which is harmless.
const MP4_METADATA_GROUPS: [&str; 4] = ["-UserData:all", "-ItemList:all", "-Keys:all", "-XMP:all"];
const HARMLESS_MP4_TAGS: [&str; 2] = ["SourceFile", "ItemList:Encoder"];

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct StripResult {
    pub scanned: usize,
    pub with_metadata: Vec<PathBuf>,
    pub stripped: usize,
    pub still_with_metadata: Vec<PathBuf>,
    pub errors: Vec<String>,
}

/// The RIFF chunks of a WebP file as `(fourcc, whole chunk)` ranges, or
/// None when it is not one.
fn webp_chunks(data: &[u8]) -> Option<Vec<([u8; 4], std::ops::Range<usize>)>> {
    if data.len() < 12 || &data[..4] != b"RIFF" || &data[8..12] != b"WEBP" {
        return None;
    }
    let declared = u32::from_le_bytes(data[4..8].try_into().ok()?) as usize;
    let end = data.len().min(8usize.saturating_add(declared));
    let mut chunks = Vec::new();
    let mut pos = 12;
    while pos + 8 <= end {
        let size = u32::from_le_bytes(data[pos + 4..pos + 8].try_into().ok()?) as usize;
        let chunk_end = (pos + 8).saturating_add(size).saturating_add(size & 1);
        let fourcc: [u8; 4] = data[pos..pos + 4].try_into().ok()?;
        // Python slicing clamps a truncated last chunk to the data.
        chunks.push((fourcc, pos..chunk_end.min(data.len())));
        pos = chunk_end;
    }
    Some(chunks)
}

fn is_metadata(fourcc: &[u8; 4]) -> bool {
    METADATA_CHUNKS.contains(&fourcc)
}

/// Whether the WebP at `path` has an EXIF or XMP chunk.
pub fn webp_has_metadata(path: &Path) -> std::io::Result<bool> {
    let data = std::fs::read(path)?;
    Ok(webp_chunks(&data)
        .unwrap_or_default()
        .iter()
        .any(|(c, _)| is_metadata(c)))
}

/// The WebP without its EXIF and XMP chunks (VP8X flags cleared), or None
/// when it has none.
pub fn webp_without_metadata(data: &[u8]) -> Option<Vec<u8>> {
    let chunks = webp_chunks(data)?;
    if !chunks.iter().any(|(c, _)| is_metadata(c)) {
        return None;
    }
    let mut body = b"WEBP".to_vec();
    for (fourcc, range) in chunks {
        if is_metadata(&fourcc) {
            continue;
        }
        let start = body.len();
        body.extend_from_slice(&data[range]);
        if &fourcc == b"VP8X" && body.len() > start + 8 {
            body[start + 8] &= !(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
        }
    }
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    Some(out)
}

/// Drop the EXIF and XMP chunks of the WebP at `path`; whether it changed.
/// The file is replaced atomically, so a reader never sees half of it.
pub fn strip_webp_metadata(path: &Path) -> std::io::Result<bool> {
    let data = std::fs::read(path)?;
    let Some(stripped) = webp_without_metadata(&data) else {
        return Ok(false);
    };
    let original = std::fs::metadata(path)?;
    let dir = path.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new().suffix(".tmp").tempfile_in(dir)?;
    std::io::Write::write_all(&mut tmp, &stripped)?;
    tmp.as_file().sync_all()?;
    // The temp file is private to this user; the proxy serving
    // protected_media may run as another one.
    std::fs::set_permissions(tmp.path(), original.permissions())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = std::os::unix::fs::chown(tmp.path(), Some(original.uid()), Some(original.gid()));
    }
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(true)
}

/// Run ExifTool on `paths` (passed in an argument file).
fn exiftool(exe: &Path, args: &[&str], paths: &[PathBuf]) -> std::io::Result<std::process::Output> {
    let mut argfile = tempfile::Builder::new().suffix(".args").tempfile()?;
    let list: String = paths.iter().map(|p| format!("{}\n", p.display())).collect();
    std::io::Write::write_all(&mut argfile, list.as_bytes())?;
    argfile.as_file().sync_all()?;
    std::process::Command::new(exe)
        .no_window()
        .args(["-charset", "filename=utf8"])
        .args(args)
        .arg("-@")
        .arg(argfile.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
}

fn normpath(path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if cfg!(windows) {
        PathBuf::from(path.replace('/', "\\"))
    } else {
        p
    }
}

/// The video thumbnails in `paths` that carry metadata from their source.
pub fn mp4s_with_metadata(exe: &Path, paths: &[PathBuf]) -> std::io::Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    let mut args = vec!["-j", "-G1", "-a"];
    args.extend(MP4_METADATA_GROUPS);
    for batch in paths.chunks(BATCH_SIZE) {
        let out = exiftool(exe, &args, batch)?;
        let text = String::from_utf8_lossy(&out.stdout);
        let entries: Vec<serde_json::Map<String, serde_json::Value>> =
            serde_json::from_str(if text.trim().is_empty() {
                "[]"
            } else {
                text.trim()
            })
            .map_err(std::io::Error::other)?;
        for entry in entries {
            // ExifTool:Error / Warning describe the file, they are not in it.
            let dirty = entry
                .keys()
                .any(|t| !t.starts_with("ExifTool:") && !HARMLESS_MP4_TAGS.contains(&t.as_str()));
            if dirty && let Some(src) = entry.get("SourceFile").and_then(|v| v.as_str()) {
                found.push(normpath(src));
            }
        }
    }
    Ok(found)
}

fn strip_mp4s(exe: &Path, paths: &[PathBuf], errors: &mut Vec<String>) {
    for batch in paths.chunks(BATCH_SIZE) {
        match exiftool(exe, &["-overwrite_original", "-q", "-q", "-all="], batch) {
            Ok(out) if out.status.success() => {}
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                errors.push(if stderr.is_empty() {
                    format!("exiftool exit {}", out.status.code().unwrap_or(-1))
                } else {
                    stderr
                });
            }
            Err(e) => errors.push(format!("exiftool: {e}")),
        }
    }
}

/// Every `.webp` and `.mp4` directly in the three thumbnail directories.
pub fn thumbnail_files(media_root: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let (mut webps, mut mp4s) = (Vec::new(), Vec::new());
    for dir in THUMBNAIL_DIRS {
        let Ok(entries) = std::fs::read_dir(media_root.join(dir)) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_type().is_ok_and(|t| t.is_file()) {
                continue;
            }
            let path = entry.path();
            match path
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref()
            {
                Some("webp") => webps.push(path),
                Some("mp4") => mp4s.push(path),
                _ => {}
            }
        }
    }
    (webps, mp4s)
}

fn webps(
    paths: &[PathBuf],
    action: fn(&Path) -> std::io::Result<bool>,
    errors: &mut Vec<String>,
    progress: &mut dyn FnMut(String),
) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        match action(path) {
            Ok(true) => found.push(path.clone()),
            Ok(false) => {}
            Err(e) => errors.push(format!("{}: {e}", path.display())),
        }
        if (i + 1) % 10_000 == 0 {
            progress(format!("{}/{} WebP thumbnails done", i + 1, paths.len()));
        }
    }
    found
}

/// Remove EXIF, XMP and video metadata from every thumbnail under `media_root`.
pub fn strip_thumbnail_metadata(
    media_root: &Path,
    exiftool_exe: &Path,
    dry_run: bool,
    progress: &mut dyn FnMut(String),
) -> StripResult {
    let mut result = StripResult::default();
    let (webp_paths, mp4_paths) = thumbnail_files(media_root);
    result.scanned = webp_paths.len() + mp4_paths.len();
    let dirty_mp4s = if mp4_paths.is_empty() {
        Vec::new()
    } else {
        match mp4s_with_metadata(exiftool_exe, &mp4_paths) {
            Ok(found) => found,
            Err(e) => {
                result.errors.push(format!("exiftool: {e}"));
                Vec::new()
            }
        }
    };
    if dry_run {
        let mut dirty = webps(&webp_paths, webp_has_metadata, &mut result.errors, progress);
        dirty.extend(dirty_mp4s);
        result.with_metadata = dirty;
        return result;
    }
    let stripped = webps(
        &webp_paths,
        strip_webp_metadata,
        &mut result.errors,
        progress,
    );
    strip_mp4s(exiftool_exe, &dirty_mp4s, &mut result.errors);
    // Counted from what is on disk afterwards, not from what the tools report.
    let mut left = webps(
        &stripped,
        webp_has_metadata,
        &mut result.errors,
        &mut |_| {},
    );
    if !dirty_mp4s.is_empty() {
        match mp4s_with_metadata(exiftool_exe, &dirty_mp4s) {
            Ok(found) => left.extend(found),
            Err(e) => result.errors.push(format!("exiftool: {e}")),
        }
    }
    result.with_metadata = stripped;
    result.with_metadata.extend(dirty_mp4s);
    result.stripped = result.with_metadata.len() - left.len();
    result.still_with_metadata = left;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(fourcc: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut c = fourcc.to_vec();
        c.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        c.extend_from_slice(payload);
        if payload.len() % 2 == 1 {
            c.push(0);
        }
        c
    }

    fn webp(chunks: &[Vec<u8>]) -> Vec<u8> {
        let body: Vec<u8> = b"WEBP".iter().copied().chain(chunks.concat()).collect();
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    #[test]
    fn strips_exif_and_xmp_and_clears_the_flags() {
        let vp8x = chunk(b"VP8X", &[0x20 | 0x08 | 0x04, 0, 0, 0, 9, 0, 0, 9, 0, 0]);
        let icc = chunk(b"ICCP", b"profile");
        let image = chunk(b"VP8 ", b"pixels!");
        let exif = chunk(b"EXIF", b"gps here");
        let xmp = chunk(b"XMP ", b"<x/>");
        let dirty = webp(&[vp8x.clone(), icc.clone(), image.clone(), exif, xmp]);
        let clean = webp_without_metadata(&dirty).expect("had metadata");
        let mut vp8x_clean = vp8x;
        vp8x_clean[8] = 0x20;
        assert_eq!(clean, webp(&[vp8x_clean, icc, image]));
        assert!(webp_without_metadata(&clean).is_none());
    }

    #[test]
    fn not_a_webp_is_left_alone() {
        assert!(webp_without_metadata(b"\x89PNG....").is_none());
        assert!(webp_without_metadata(b"").is_none());
    }

    #[test]
    fn rewrites_in_place_only_when_needed() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join(crate::render::BIG);
        std::fs::create_dir_all(&big).unwrap();
        let dirty = big.join("a.webp");
        let clean = big.join("b.webp");
        std::fs::write(
            &dirty,
            webp(&[chunk(b"VP8 ", b"px"), chunk(b"EXIF", b"gps")]),
        )
        .unwrap();
        std::fs::write(&clean, webp(&[chunk(b"VP8 ", b"px")])).unwrap();
        std::fs::write(big.join("c.txt"), b"x").unwrap();
        let exe = Path::new("exiftool-not-needed");
        let dry = strip_thumbnail_metadata(dir.path(), exe, true, &mut |_| {});
        assert_eq!(dry.scanned, 2);
        assert_eq!(dry.with_metadata, vec![dirty.clone()]);
        assert!(webp_has_metadata(&dirty).unwrap());
        let real = strip_thumbnail_metadata(dir.path(), exe, false, &mut |_| {});
        assert_eq!(real.stripped, 1);
        assert!(real.still_with_metadata.is_empty() && real.errors.is_empty());
        assert!(!webp_has_metadata(&dirty).unwrap());
        assert_eq!(
            std::fs::read(&dirty).unwrap(),
            webp(&[chunk(b"VP8 ", b"px")])
        );
        let again = strip_thumbnail_metadata(dir.path(), exe, false, &mut |_| {});
        assert_eq!(again.stripped, 0);
        assert!(again.with_metadata.is_empty());
    }
}

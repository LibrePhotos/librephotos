use std::path::Path;

use serde::Serialize;

pub const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif",
    "hif", "avif", "jxl",
];
pub const RAW_EXTS: &[&str] = &[
    "dng", "cr2", "cr3", "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "raf", "pef", "srw",
    "raw", "rwl", "3fr", "erf", "kdc", "mrw", "x3f",
];
pub const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "webm", "mkv", "avi"];

const PASSTHROUGH_EXTS: &[&str] = &["jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "bmp"];
const JPEG_EXTS: &[&str] = &["jpg", "jpeg", "jpe", "jfif"];

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Image,
    Raw,
    Video,
}

pub fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn kind_of_ext(ext: &str) -> Option<FileKind> {
    if IMAGE_EXTS.contains(&ext) {
        Some(FileKind::Image)
    } else if RAW_EXTS.contains(&ext) {
        Some(FileKind::Raw)
    } else if VIDEO_EXTS.contains(&ext) {
        Some(FileKind::Video)
    } else {
        None
    }
}

pub fn kind_of(path: &Path) -> Option<FileKind> {
    kind_of_ext(&ext_of(path))
}

pub fn is_passthrough(ext: &str) -> bool {
    PASSTHROUGH_EXTS.contains(&ext)
}

pub fn is_jpeg(ext: &str) -> bool {
    JPEG_EXTS.contains(&ext)
}

pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" | "jpe" | "jfif" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "tif" | "tiff" => "image/tiff",
        "heic" | "heif" | "hif" => "image/heic",
        "jxl" => "image/jxl",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

pub fn format_name(ext: &str) -> String {
    match ext {
        "jpg" | "jpeg" | "jpe" | "jfif" => "JPEG".into(),
        "png" => "PNG".into(),
        "gif" => "GIF".into(),
        "webp" => "WebP".into(),
        "bmp" => "BMP".into(),
        "tif" | "tiff" => "TIFF".into(),
        "heic" | "hif" => "HEIC".into(),
        "heif" => "HEIF".into(),
        "avif" => "AVIF".into(),
        "jxl" => "JPEG XL".into(),
        "mp4" | "m4v" => "MP4 video".into(),
        "mov" => "QuickTime video".into(),
        "webm" => "WebM video".into(),
        "mkv" => "Matroska video".into(),
        "avi" => "AVI video".into(),
        other => other.to_ascii_uppercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_filter() {
        assert_eq!(kind_of(Path::new("C:/a/IMG_1.JPG")), Some(FileKind::Image));
        assert_eq!(kind_of(Path::new("x.HeIc")), Some(FileKind::Image));
        assert_eq!(kind_of(Path::new("x.CR3")), Some(FileKind::Raw));
        assert_eq!(kind_of(Path::new("x.nef")), Some(FileKind::Raw));
        assert_eq!(kind_of(Path::new("clip.mp4")), Some(FileKind::Video));
        assert_eq!(kind_of(Path::new("notes.txt")), None);
        assert_eq!(kind_of(Path::new("off")), None);
        assert_eq!(kind_of(Path::new("signature")), None);
        assert_eq!(kind_of(Path::new("archive.tar.gz")), None);
        assert!(is_passthrough("webp"));
        assert!(!is_passthrough("heic"));
    }
}

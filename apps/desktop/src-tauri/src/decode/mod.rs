//! The decode pipeline behind `lpview://`: picks the cheapest way to produce `thumb`, `screen`
//! or `full` for a file (pass-through, embedded thumbnail/preview, scaled decode, develop).

pub mod generic;
pub mod raw;
#[cfg(windows)]
pub mod wic;

use std::path::Path;

use crate::formats::{FileKind, ext_of, is_jpeg, is_passthrough, kind_of_ext};
use crate::jpegmeta;
use crate::orient;
use crate::pixels::{Encoded, Pixels};
use crate::request::Kind;
#[cfg(windows)]
use crate::{pixels::full_box, request::THUMB_EDGE};

/// What a render produced.
pub enum Rendered {
    /// Decoded pixels, still to be encoded.
    Pixels(Pixels),
    /// Ready-made bytes (an embedded thumbnail or preview).
    Encoded(Encoded),
    /// Serve the file's own bytes.
    Passthrough,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderError {
    NotFound(String),
    Unsupported(String),
    Failed(String),
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::NotFound(s) | RenderError::Unsupported(s) | RenderError::Failed(s) => {
                f.write_str(s)
            }
        }
    }
}

/// An EXIF thumbnail is used for `thumb` only when its long edge is at least this.
const MIN_EMBEDDED_THUMB: u32 = 120;

/// `screen` of a JPEG passes the file through when its pixel count is at most this many times
/// the box (default 1: only when it fits, as CONTRACT.md says). Set `LPVIEW_SCREEN_PASSTHROUGH=4`
/// to let the webview decode moderately larger JPEGs itself (no decode/encode in Rust at all).
pub(crate) fn screen_passthrough_ratio() -> f64 {
    static R: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
    *R.get_or_init(|| {
        std::env::var("LPVIEW_SCREEN_PASSTHROUGH")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|r: &f64| *r >= 1.0)
            .unwrap_or(1.0)
    })
}

pub fn render(path: &Path, kind: Kind, bw: u32, bh: u32) -> Result<Rendered, RenderError> {
    let ext = ext_of(path);
    let fk = kind_of_ext(&ext)
        .ok_or_else(|| RenderError::Unsupported(format!("unsupported file type '.{ext}'")))?;
    if !path.is_file() {
        return Err(RenderError::NotFound(format!(
            "{} not found",
            path.display()
        )));
    }
    match fk {
        FileKind::Video => match kind {
            Kind::Full => Ok(Rendered::Passthrough),
            _ => video_frame(path, kind, bw, bh),
        },
        FileKind::Raw => raw::render(path, kind, bw, bh).or_else(|e| {
            platform_render(path, kind, bw, bh)
                .map_err(|e2| RenderError::Failed(format!("{e}; fallback: {e2}")))
        }),
        FileKind::Image => image_render(path, &ext, kind, bw, bh),
    }
}

fn image_render(
    path: &Path,
    ext: &str,
    kind: Kind,
    bw: u32,
    bh: u32,
) -> Result<Rendered, RenderError> {
    let passthrough = is_passthrough(ext);
    if kind == Kind::Full && passthrough {
        return Ok(Rendered::Passthrough);
    }
    if is_jpeg(ext) {
        if let Some(r) = jpeg_fast_path(path, kind, bw, bh) {
            return Ok(r);
        }
    } else if kind == Kind::Screen && passthrough {
        // GIFs keep their animation; the webview scales them.
        if ext == "gif" {
            return Ok(Rendered::Passthrough);
        }
        let fits = image::ImageReader::open(path)
            .ok()
            .and_then(|r| r.with_guessed_format().ok())
            .and_then(|r| r.into_dimensions().ok())
            .is_some_and(|(w, h)| w <= bw && h <= bh);
        if fits {
            return Ok(Rendered::Passthrough);
        }
    }
    if !cfg!(windows) && matches!(ext, "heic" | "heif" | "hif" | "avif") {
        return Err(RenderError::Unsupported(format!(
            ".{ext} needs the Windows codecs"
        )));
    }
    platform_render(path, kind, bw, bh).map_err(RenderError::Failed)
}

/// JPEG without decoding: the EXIF thumbnail for `thumb`, the file itself for a `screen` it fits.
fn jpeg_fast_path(path: &Path, kind: Kind, bw: u32, bh: u32) -> Option<Rendered> {
    if kind == Kind::Full {
        return None;
    }
    let buf = jpegmeta::read_head(path).ok()?;
    let head = jpegmeta::parse_head(&buf)?;
    match kind {
        Kind::Thumb => {
            let thumb = &buf[head.thumbnail.clone()?];
            let segs = jpegmeta::segments(thumb)?;
            let (w, h) = jpegmeta::sof_dims(thumb, &segs)?;
            if w.max(h) < MIN_EMBEDDED_THUMB {
                return None;
            }
            let bytes = jpegmeta::with_orientation(thumb, head.orientation)?;
            let (width, height) = orient::oriented_dims(w, h, head.orientation);
            Some(Rendered::Encoded(Encoded {
                bytes,
                mime: "image/jpeg",
                width,
                height,
            }))
        }
        _ => {
            let (w, h) = orient::oriented_dims(head.width, head.height, head.orientation);
            let fits = w <= bw && h <= bh;
            let small_enough =
                (w as f64 * h as f64) <= screen_passthrough_ratio() * bw as f64 * bh as f64;
            (w > 0 && (fits || small_enough)).then_some(Rendered::Passthrough)
        }
    }
}

/// Windows: WIC first (then the pure-Rust decoders); elsewhere the pure-Rust decoders.
fn platform_render(path: &Path, kind: Kind, bw: u32, bh: u32) -> Result<Rendered, String> {
    #[cfg(windows)]
    let wic_err = match wic_render(path, kind, bw, bh) {
        Ok(r) => return Ok(r),
        Err(e) => e,
    };
    #[cfg(not(windows))]
    let wic_err = String::new();
    generic::render(path, kind, bw, bh)
        .map(Rendered::Pixels)
        .map_err(|e| {
            if wic_err.is_empty() {
                e
            } else {
                format!("{wic_err}; {e}")
            }
        })
}

/// Thumbs from Explorer's thumbnail cache (oriented, ~15 ms on a hit). Formats that are slow to
/// decode (HEVC, AV1) let the shell generate and cache the thumbnail; the rest only take a hit
/// (formats with alpha are left out: shell bitmaps lose it).
#[cfg(windows)]
fn shell_thumb(path: &Path) -> Option<Pixels> {
    match ext_of(path).as_str() {
        "heic" | "heif" | "hif" | "avif" | "jxl" => wic::shell_thumbnail(path, THUMB_EDGE).ok(),
        // Big JPEGs: a 1/8 decode still entropy-decodes everything (~0.6 s at 300 MP), so let the
        // shell generate it once and serve it from its cache afterwards.
        "jpg" | "jpeg" | "jpe" | "jfif"
            if std::fs::metadata(path).is_ok_and(|m| m.len() > 12 << 20) =>
        {
            wic::shell_thumbnail(path, THUMB_EDGE).ok()
        }
        "jpg" | "jpeg" | "jpe" | "jfif" | "tif" | "tiff" | "bmp" => {
            wic::shell_cached_thumbnail(path, THUMB_EDGE)
        }
        _ => None,
    }
    .and_then(|p| p.fit_into(THUMB_EDGE, THUMB_EDGE).ok())
}

/// The `thmb` item of a HEIC, decoded alone.
#[cfg(windows)]
fn heif_thumb(path: &Path) -> Option<Pixels> {
    if !matches!(ext_of(path).as_str(), "heic" | "heif" | "hif") {
        return None;
    }
    let file = crate::heif::thumbnail_file(&std::fs::read(path).ok()?)?;
    wic::with_memory(&file, |s| wic::render(s, THUMB_EDGE, THUMB_EDGE)).ok()
}

#[cfg(windows)]
fn wic_render(path: &Path, kind: Kind, bw: u32, bh: u32) -> Result<Rendered, String> {
    if kind == Kind::Thumb
        && let Some(p) = heif_thumb(path).or_else(|| shell_thumb(path))
    {
        return Ok(Rendered::Pixels(p));
    }
    let src = wic::open_file(path)?;
    if kind == Kind::Thumb
        && !src.is_heif()
        && let Some(p) = wic::embedded_thumbnail(&src, THUMB_EDGE)
    {
        return Ok(Rendered::Pixels(p));
    }
    let (bw, bh) = if kind == Kind::Full {
        let (w, h) = src.oriented_dims();
        full_box(w, h)
    } else {
        (bw, bh)
    };
    Ok(Rendered::Pixels(wic::render(&src, bw, bh)?))
}

fn video_frame(path: &Path, kind: Kind, bw: u32, bh: u32) -> Result<Rendered, RenderError> {
    #[cfg(windows)]
    {
        let edge = if kind == Kind::Thumb {
            THUMB_EDGE
        } else {
            bw.max(bh).min(1920)
        };
        let px = wic::shell_thumbnail(path, edge).map_err(RenderError::Failed)?;
        let px = if kind == Kind::Thumb {
            px
        } else {
            px.fit_into(bw, bh).map_err(RenderError::Failed)?
        };
        Ok(Rendered::Pixels(px))
    }
    #[cfg(not(windows))]
    {
        let _ = (path, kind, bw, bh);
        Err(RenderError::Unsupported(
            "video frames are not available on this platform".into(),
        ))
    }
}

/// Decode JPEG bytes (RAW previews) to fit `sbw`x`sbh`, stored orientation.
pub fn decode_jpeg_bytes(bytes: &[u8], sbw: u32, sbh: u32) -> Result<Pixels, String> {
    #[cfg(windows)]
    {
        if let Ok(p) = wic::with_memory(bytes, |s| wic::render_stored(s, sbw, sbh)) {
            return Ok(p);
        }
    }
    generic::decode_jpeg_bytes(bytes)?.fit_into(sbw, sbh)
}

/// Decoded, oriented pixels fitting `edge`x`edge` (clipboard).
pub fn pixels(path: &Path, edge: u32) -> Result<Pixels, String> {
    let ext = ext_of(path);
    match kind_of_ext(&ext) {
        None => Err(format!("unsupported file type '.{ext}'")),
        Some(FileKind::Raw) => raw::pixels(path, edge, edge),
        Some(FileKind::Video) => match video_frame(path, Kind::Screen, edge, edge) {
            Ok(Rendered::Pixels(p)) => Ok(p),
            Err(e) => Err(e.to_string()),
            _ => Err("no video frame".into()),
        },
        Some(FileKind::Image) => match platform_render(path, Kind::Screen, edge, edge)? {
            Rendered::Pixels(p) => Ok(p),
            _ => Err("nothing decoded".into()),
        },
    }
}

/// Encode a render result (or read the file for pass-through).
pub fn finish(path: &Path, r: Rendered) -> Result<Encoded, String> {
    match r {
        Rendered::Pixels(p) => p.encode(),
        Rendered::Encoded(e) => Ok(e),
        Rendered::Passthrough => {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let ext = ext_of(path);
            let (width, height) = passthrough_dims(path, &ext, &bytes);
            Ok(Encoded {
                bytes,
                mime: crate::formats::mime_for_ext(&ext),
                width,
                height,
            })
        }
    }
}

/// Display size of a passed-through file (0x0 when unknown, e.g. videos).
fn passthrough_dims(path: &Path, ext: &str, bytes: &[u8]) -> (u32, u32) {
    if is_jpeg(ext)
        && let Some(h) = jpegmeta::parse_head(bytes)
    {
        return orient::oriented_dims(h.width, h.height, h.orientation);
    }
    if kind_of_ext(ext) == Some(FileKind::Video) {
        return (0, 0);
    }
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|r| r.into_dimensions().ok())
        .or_else(|| image::image_dimensions(path).ok())
        .unwrap_or((0, 0))
}

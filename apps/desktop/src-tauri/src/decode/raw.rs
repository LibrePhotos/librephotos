use std::path::Path;

use flashraw::{
    DecodeOptions, Demosaic, FlashRaw, OutputFormat, PreviewEncoding, PreviewInfo, RawPixelData,
};

use super::{Rendered, decode_jpeg_bytes};
use crate::jpegmeta;
use crate::orient;
use crate::pixels::{Encoded, PixFmt, Pixels, fit};
use crate::request::{Kind, THUMB_EDGE};

const PASSTHROUGH_THUMB_EDGE: u32 = 480;

fn open(path: &Path) -> Result<FlashRaw<'static>, String> {
    FlashRaw::open_path(path).map_err(|e| format!("FlashRaw: {e}"))
}

fn preview_dims(raw: &FlashRaw, p: &PreviewInfo) -> Option<(u32, u32)> {
    if p.width > 0 && p.height > 0 {
        return Some((p.width, p.height));
    }
    let b = raw.preview_bytes(p).ok()?;
    let segs = jpegmeta::segments(b)?;
    jpegmeta::sof_dims(b, &segs)
}

struct Preview<'a> {
    info: &'a PreviewInfo,
    w: u32,
    h: u32,
}

impl Preview<'_> {
    fn orientation(&self) -> u16 {
        self.info.orientation as u16
    }
    fn oriented(&self) -> (u32, u32) {
        orient::oriented_dims(self.w, self.h, self.orientation())
    }
    fn long(&self) -> u32 {
        self.w.max(self.h)
    }
}

fn jpeg_previews<'a>(raw: &'a FlashRaw) -> Vec<Preview<'a>> {
    let mut v: Vec<Preview> = raw
        .previews()
        .iter()
        .filter(|p| p.encoding == PreviewEncoding::Jpeg && p.length > 0)
        .filter_map(|p| preview_dims(raw, p).map(|(w, h)| Preview { info: p, w, h }))
        .collect();
    v.sort_by_key(|p| p.w as u64 * p.h as u64);
    v
}

fn passthrough(raw: &FlashRaw, p: &Preview) -> Result<Rendered, String> {
    let b = raw.preview_bytes(p.info).map_err(|e| e.to_string())?;
    let bytes = jpegmeta::with_orientation(b, p.orientation()).ok_or("broken JPEG preview")?;
    let (width, height) = p.oriented();
    Ok(Rendered::Encoded(Encoded {
        bytes,
        mime: "image/jpeg",
        width,
        height,
    }))
}

fn decode_preview(raw: &FlashRaw, p: &Preview, bw: u32, bh: u32) -> Result<Pixels, String> {
    let b = raw.preview_bytes(p.info).map_err(|e| e.to_string())?;
    let o = p.orientation();
    let (sbw, sbh) = if orient::swaps_axes(o) {
        (bh, bw)
    } else {
        (bw, bh)
    };
    let px = decode_jpeg_bytes(b, sbw, sbh)?;
    Ok(orient::apply(px, o))
}

fn develop(raw: &FlashRaw, demosaic: Demosaic) -> Result<Pixels, String> {
    let opts = DecodeOptions {
        output: OutputFormat::Rgba8,
        demosaic,
        preview_fallback: true,
        ..Default::default()
    };
    let frame = raw
        .decode(opts)
        .map_err(|e| format!("FlashRaw develop: {e}"))?;
    let (w, h) = (frame.width, frame.height);
    let RawPixelData::U8(data) = frame.data else {
        return Err("FlashRaw returned no 8-bit pixels".into());
    };
    if data.len() != w as usize * h as usize * 4 {
        return Err("FlashRaw returned an unexpected buffer size".into());
    }
    Ok(Pixels {
        width: w,
        height: h,
        format: PixFmt::Rgba8,
        data,
    })
}

pub fn render(path: &Path, kind: Kind, bw: u32, bh: u32) -> Result<Rendered, String> {
    let raw = open(path)?;
    let md = raw.metadata();
    let full = orient::oriented_dims(md.width, md.height, md.orientation as u16);
    let previews = jpeg_previews(&raw);
    match kind {
        Kind::Thumb => {
            let p = previews
                .iter()
                .find(|p| p.long() >= 150)
                .or(previews.last());
            if let Some(p) = p {
                if p.long() <= PASSTHROUGH_THUMB_EDGE {
                    return passthrough(&raw, p);
                }
                if let Ok(px) = decode_preview(&raw, p, THUMB_EDGE, THUMB_EDGE) {
                    return Ok(Rendered::Pixels(px.fit_into(THUMB_EDGE, THUMB_EDGE)?));
                }
            }
            Ok(Rendered::Pixels(
                develop(&raw, Demosaic::HalfSize)?.fit_into(THUMB_EDGE, THUMB_EDGE)?,
            ))
        }
        Kind::Screen => {
            let target = fit(full.0, full.1, bw, bh);
            if let Some(p) = previews.last().filter(|p| {
                let (pw, ph) = p.oriented();
                pw.max(ph) as f64 >= 0.9 * target.0.max(target.1) as f64
            }) {
                let (pw, ph) = p.oriented();
                let ratio = super::screen_passthrough_ratio();
                if (pw <= bw && ph <= bh)
                    || (pw as f64 * ph as f64) <= ratio * bw as f64 * bh as f64
                {
                    return passthrough(&raw, p);
                }
                if let Ok(px) = decode_preview(&raw, p, bw, bh) {
                    return Ok(Rendered::Pixels(px.fit_into(bw, bh)?));
                }
            }
            Ok(Rendered::Pixels(
                develop(&raw, Demosaic::HalfSize)?.fit_into(bw, bh)?,
            ))
        }
        Kind::Full => match develop(&raw, Demosaic::Auto) {
            Ok(px) => Ok(Rendered::Pixels(px)),
            Err(e) => match previews.last() {
                Some(p) => decode_preview(&raw, p, u32::MAX, u32::MAX).map(Rendered::Pixels),
                None => Err(e),
            },
        },
    }
}

pub fn pixels(path: &Path, bw: u32, bh: u32) -> Result<Pixels, String> {
    match render(path, Kind::Screen, bw, bh)? {
        Rendered::Pixels(p) => Ok(p),
        Rendered::Encoded(e) => {
            let o = jpegmeta::parse_head(&e.bytes)
                .map(|h| h.orientation)
                .unwrap_or(1);
            let px = decode_jpeg_bytes(&e.bytes, u32::MAX, u32::MAX)?;
            Ok(orient::apply(px, o))
        }
        Rendered::Passthrough => Err("unexpected pass-through".into()),
    }
}

pub fn metadata(path: &Path) -> Result<flashraw::RawMetadata, String> {
    Ok(open(path)?.metadata().clone())
}

pub fn exif_tiff(path: &Path) -> Option<Vec<u8>> {
    open(path).ok()?.exif_bytes().map(|b| b.to_vec())
}

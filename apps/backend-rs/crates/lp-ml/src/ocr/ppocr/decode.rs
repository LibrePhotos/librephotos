//! `read_image`: what `cv2.imdecode(buf, IMREAD_UNCHANGED)` + `to_bgr_3channel`
//! make of a file, as 8-bit 3-channel pixels (kept in RGB order here; the
//! tensors swap to the model's BGR). No EXIF orientation (IMREAD_UNCHANGED
//! applies none), alpha dropped without compositing, 16-bit samples
//! truncated `v / 257`, grey replicated; capped at 40 MP with `INTER_AREA`.

use std::path::Path;

use image::DynamicImage;

use super::warp::Image3;
use crate::preprocess;

/// `MAX_INPUT_PIXELS`.
pub const MAX_INPUT_PIXELS: usize = 40_000_000;

/// The file is missing, unreadable or not an image (the sidecar's 400).
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct DecodeError(pub String);

fn is_jpeg(buf: &[u8]) -> bool {
    buf.starts_with(&[0xFF, 0xD8, 0xFF])
}

/// Decode `path` like the sidecar's `read_image`.
pub fn read_image(path: &Path) -> Result<Image3, DecodeError> {
    let buf = std::fs::read(path)
        .map_err(|e| DecodeError(format!("could not read image at {}: {e}", path.display())))?;
    let img = if is_jpeg(&buf) {
        // 8-bit RGB or grey either way; goes through the process-wide
        // decoder when one is installed (libjpeg-turbo, like cv2).
        let rgb = preprocess::load_rgb(path).map_err(|e| {
            DecodeError(format!(
                "could not decode image at {}: {e:#}",
                path.display()
            ))
        })?;
        Image3 {
            w: rgb.width() as usize,
            h: rgb.height() as usize,
            data: rgb.into_raw(),
        }
    } else {
        let dynimg = image::load_from_memory(&buf).map_err(|e| {
            DecodeError(format!("could not decode image at {}: {e}", path.display()))
        })?;
        to_rgb8(dynimg)
    };
    if img.w == 0 || img.h == 0 {
        return Err(DecodeError(format!(
            "could not decode image at {}",
            path.display()
        )));
    }
    Ok(cap_pixels(img, MAX_INPUT_PIXELS))
}

/// `to_uint8` + `to_bgr_3channel` on whatever the decoder produced.
pub fn to_rgb8(img: DynamicImage) -> Image3 {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let u16_to_u8 = |v: u16| (v as f32 / 257.0) as u8;
    let f32_to_u8 = |v: f32| v.clamp(0.0, 255.0) as u8;
    let mut data = Vec::with_capacity(w * h * 3);
    match img {
        DynamicImage::ImageLuma8(b) => {
            for v in b.into_raw() {
                data.extend_from_slice(&[v, v, v]);
            }
        }
        DynamicImage::ImageLumaA8(b) => {
            for px in b.into_raw().chunks_exact(2) {
                data.extend_from_slice(&[px[0], px[0], px[0]]);
            }
        }
        DynamicImage::ImageRgb8(b) => data = b.into_raw(),
        DynamicImage::ImageRgba8(b) => {
            for px in b.into_raw().chunks_exact(4) {
                data.extend_from_slice(&px[..3]);
            }
        }
        DynamicImage::ImageLuma16(b) => {
            for v in b.into_raw() {
                let g = u16_to_u8(v);
                data.extend_from_slice(&[g, g, g]);
            }
        }
        DynamicImage::ImageLumaA16(b) => {
            for px in b.into_raw().chunks_exact(2) {
                let g = u16_to_u8(px[0]);
                data.extend_from_slice(&[g, g, g]);
            }
        }
        DynamicImage::ImageRgb16(b) => data = b.into_raw().into_iter().map(u16_to_u8).collect(),
        DynamicImage::ImageRgba16(b) => {
            for px in b.into_raw().chunks_exact(4) {
                data.extend(px[..3].iter().map(|&v| u16_to_u8(v)));
            }
        }
        DynamicImage::ImageRgb32F(b) => data = b.into_raw().into_iter().map(f32_to_u8).collect(),
        DynamicImage::ImageRgba32F(b) => {
            for px in b.into_raw().chunks_exact(4) {
                data.extend(px[..3].iter().map(|&v| f32_to_u8(v)));
            }
        }
        other => data = other.to_rgb8().into_raw(),
    }
    Image3 { w, h, data }
}

/// Scale anything over `max_pixels` down with `INTER_AREA`.
pub fn cap_pixels(img: Image3, max_pixels: usize) -> Image3 {
    let (w, h) = (img.w, img.h);
    if w * h <= max_pixels {
        return img;
    }
    let scale = (max_pixels as f64 / (h * w) as f64).sqrt();
    let nw = ((w as f64 * scale) as usize).max(1);
    let nh = ((h as f64 * scale) as usize).max(1);
    Image3 {
        w: nw,
        h: nh,
        data: preprocess::cv2::resize_area(&img.data, w, h, 3, nw, nh),
    }
}

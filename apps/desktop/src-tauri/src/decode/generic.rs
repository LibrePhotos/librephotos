//! Pure-Rust decoders, compiled everywhere: `image` (zune-jpeg, png, gif, webp, tiff, bmp) and
//! `jxl-oxide`. Used when WIC is unavailable or fails.

use std::path::Path;

use image::{DynamicImage, ImageDecoder};

use crate::formats::ext_of;
use crate::orient;
use crate::pixels::{PixFmt, Pixels, full_box};
use crate::request::Kind;

fn to_pixels(img: DynamicImage) -> Pixels {
    let (width, height) = (img.width(), img.height());
    if img.color().has_alpha() {
        Pixels {
            width,
            height,
            format: PixFmt::Rgba8,
            data: img.into_rgba8().into_raw(),
        }
    } else {
        Pixels {
            width,
            height,
            format: PixFmt::Rgb8,
            data: img.into_rgb8().into_raw(),
        }
    }
}

/// Decode a file, returning stored-orientation pixels and the orientation to apply.
fn decode(path: &Path) -> Result<(Pixels, u16), String> {
    if ext_of(path) == "jxl" {
        let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let dec = jxl_oxide::integration::JxlDecoder::new(std::io::BufReader::new(f))
            .map_err(|e| e.to_string())?;
        // jxl-oxide renders with the orientation applied.
        let img = DynamicImage::from_decoder(dec).map_err(|e| e.to_string())?;
        return Ok((to_pixels(img), 1));
    }
    let mut dec = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let o = dec.orientation().map(|o| o.to_exif() as u16).unwrap_or(1);
    let img = DynamicImage::from_decoder(dec).map_err(|e| e.to_string())?;
    Ok((to_pixels(img), o))
}

pub fn render(path: &Path, kind: Kind, bw: u32, bh: u32) -> Result<Pixels, String> {
    let (px, o) = decode(path)?;
    let (ow, oh) = orient::oriented_dims(px.width, px.height, o);
    let (bw, bh) = if kind == Kind::Full {
        full_box(ow, oh)
    } else {
        (bw, bh)
    };
    let (sbw, sbh) = if orient::swaps_axes(o) {
        (bh, bw)
    } else {
        (bw, bh)
    };
    Ok(orient::apply(px.fit_into(sbw, sbh)?, o))
}

pub fn decode_jpeg_bytes(bytes: &[u8]) -> Result<Pixels, String> {
    image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
        .map(to_pixels)
        .map_err(|e| e.to_string())
}

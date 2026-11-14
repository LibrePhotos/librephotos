//! `image_decoding.raw_preview`: the camera's own JPEG preview of a RAW
//! file, `height` pixels high, when it shows the whole picture (the sensor's
//! aspect within 2%) and is at least as tall as the render would be.
//! Otherwise the caller renders the sensor data (`RawThumbnailApi`).
//!
//! LibRaw's `extract_thumb` hands Python the largest embedded image; rawler
//! exposes a format's embedded images as preview / thumbnail, taken in that
//! (largest first) order here.

use std::path::Path;

use image::RgbImage;
use rawler::decoders::RawDecodeParams;

use super::develop::{libraw_flip, open, visible_area};
use super::resize::{rotate_exif, shrink_to_height, shrink_to_width};

/// The preview, shrunk and turned upright (LibRaw's orientation), or None.
pub fn raw_preview(path: &Path, height: u32) -> Option<RgbImage> {
    let p = path.to_path_buf();
    let found = std::panic::catch_unwind(move || embedded(&p))
        .ok()
        .flatten()?;
    let Embedded {
        image,
        sensor_w,
        sensor_h,
        orientation,
    } = found;
    let (pw, ph) = (image.width() as usize, image.height() as usize);
    if pw == 0 || ph == 0 || sensor_w == 0 || sensor_h == 0 {
        return None;
    }
    if !same_shape(pw, ph, sensor_w, sensor_h) {
        return None;
    }
    // Only 3, 6 and 8 (`_FLIP_TO_ORIENTATION`); mirrored flips stay unrotated.
    let orientation = match libraw_flip(orientation) {
        3 => 3,
        5 => 8,
        6 => 6,
        _ => 1,
    };
    let sideways = matches!(orientation, 6 | 8);
    let preview_height = if sideways { pw } else { ph };
    let render_height = if sideways { sensor_w } else { sensor_h };
    if preview_height < (height as usize).min(render_height) {
        return None;
    }
    Some(upright(&image, orientation, height))
}

/// Shrink before rotating, so a sideways picture is boxed by its width.
fn upright(image: &RgbImage, orientation: u8, height: u32) -> RgbImage {
    let small = if matches!(orientation, 6 | 8) {
        shrink_to_width(image, height)
    } else {
        shrink_to_height(image, height)
    };
    rotate_exif(small, orientation)
}

/// Last resort when the sensor data cannot be rendered at all (a camera
/// rawler does not know yet, which LibRaw may): the largest of `jpegs` (the
/// file's embedded JPEGs, e.g. from ExifTool), shrunk and turned by the
/// file's EXIF orientation like [`raw_preview`], without its shape checks
/// (there is no sensor size to check against). Django fails the thumbnail.
pub fn fallback_preview(jpegs: &[Vec<u8>], exif_orientation: i64, height: u32) -> Option<RgbImage> {
    let size = |b: &[u8]| {
        image::ImageReader::with_format(std::io::Cursor::new(b), image::ImageFormat::Jpeg)
            .into_dimensions()
            .ok()
            .map(|(w, h)| w as u64 * h as u64)
    };
    let best = jpegs
        .iter()
        .filter_map(|b| Some((size(b)?, b)))
        .max_by_key(|(n, _)| *n)?
        .1;
    let image = image::load_from_memory_with_format(best, image::ImageFormat::Jpeg)
        .ok()?
        .to_rgb8();
    if image.width() == 0 || image.height() == 0 {
        return None;
    }
    // EXIF 3, 6 and 8 are LibRaw's flips 3, 6 and 5 (`_FLIP_TO_ORIENTATION`).
    let orientation = match exif_orientation {
        3 => 3,
        6 => 6,
        8 => 8,
        _ => 1,
    };
    Some(upright(&image, orientation, height))
}

struct Embedded {
    image: RgbImage,
    sensor_w: usize,
    sensor_h: usize,
    orientation: u16,
}

fn embedded(path: &Path) -> Option<Embedded> {
    // Sizes and orientation only: dummy mode skips the pixel decode.
    let (raw, decoder, src) = open(path, true).ok()?;
    let params = RawDecodeParams::default();
    let (_, _, sensor_w, sensor_h) = visible_area(&raw);
    // Larger first; decoded lazily (a thumbnail is not decoded when the
    // preview is there). No decoder implements `full_image` (the trait's
    // default only logs a warning).
    let image = decoder
        .preview_image(&src, &params)
        .ok()
        .flatten()
        .or_else(|| decoder.thumbnail_image(&src, &params).ok().flatten())?;
    Some(Embedded {
        image: image.to_rgb8(),
        sensor_w,
        sensor_h,
        orientation: raw.orientation.to_u16(),
    })
}

/// `_same_shape`: aspect ratios within 2% of the sensor's.
fn same_shape(w: usize, h: usize, ow: usize, oh: usize) -> bool {
    let (a, b) = (w as f64 / h as f64, ow as f64 / oh as f64);
    (a - b).abs() <= 0.02 * b
}

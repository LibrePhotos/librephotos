//! `image_decoding.raw_preview`: the camera's own JPEG preview of a RAW
//! file, `height` pixels high, when it shows the whole picture (the sensor's
//! aspect within 2%) and is at least as tall as the render would be.
//! Otherwise the caller renders the sensor data (`RawThumbnailApi`).
//!
//! LibRaw's `extract_thumb` hands Python the largest embedded image; rawler
//! exposes a format's embedded images as full / preview / thumbnail, taken
//! in that (largest first) order here.

use std::path::Path;

use image::RgbImage;
use rawler::decoders::RawDecodeParams;
use rawler::rawsource::RawSource;

use super::develop::{libraw_flip, visible_area};
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
    // Shrink before rotating, so a sideways picture is boxed by its width.
    let small = if sideways {
        shrink_to_width(&image, height)
    } else {
        shrink_to_height(&image, height)
    };
    Some(rotate_exif(small, orientation))
}

struct Embedded {
    image: RgbImage,
    sensor_w: usize,
    sensor_h: usize,
    orientation: u16,
}

fn embedded(path: &Path) -> Option<Embedded> {
    let src = RawSource::new(path).ok()?;
    let decoder = rawler::get_decoder(&src).ok()?;
    let params = RawDecodeParams::default();
    // Sizes and orientation only: dummy mode skips the pixel decode.
    let raw = decoder.raw_image(&src, &params, true).ok()?;
    let (_, _, sensor_w, sensor_h) = visible_area(&raw);
    let image = [
        decoder.full_image(&src, &params),
        decoder.preview_image(&src, &params),
        decoder.thumbnail_image(&src, &params),
    ]
    .into_iter()
    .find_map(|r| r.ok().flatten())?;
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

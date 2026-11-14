//! libvips' `thumbnail(..., size=DOWN)` geometry with a Lanczos3 reduce,
//! `autorot`, and `webpsave`.

use std::path::Path;

use anyhow::anyhow;
use fast_image_resize as fr;
use image::RgbImage;

/// Shrink (never enlarge) to `height` rows, the width in proportion.
pub fn shrink_to_height(img: &RgbImage, height: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    if h <= height || height == 0 {
        return img.clone();
    }
    let nw = ((w as f64 * height as f64 / h as f64).round() as u32).max(1);
    resize(img, nw, height)
}

/// Shrink (never enlarge) to `width` columns, the height in proportion.
pub fn shrink_to_width(img: &RgbImage, width: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    if w <= width || width == 0 {
        return img.clone();
    }
    let nh = ((h as f64 * width as f64 / w as f64).round() as u32).max(1);
    resize(img, width, nh)
}

fn resize(img: &RgbImage, nw: u32, nh: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    let src = fr::images::ImageRef::new(w, h, img.as_raw(), fr::PixelType::U8x3)
        .expect("image buffer matches its size");
    let mut dst = fr::images::Image::new(nw, nh, fr::PixelType::U8x3);
    fr::Resizer::new()
        .resize(
            &src,
            &mut dst,
            &fr::ResizeOptions::new()
                .resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3)),
        )
        .expect("same pixel type");
    RgbImage::from_raw(nw, nh, dst.into_vec()).expect("buffer size")
}

/// libvips `autorot` for EXIF orientation 3, 6 or 8.
pub fn rotate_exif(img: RgbImage, orientation: u8) -> RgbImage {
    match orientation {
        3 => image::imageops::rotate180(&img),
        6 => image::imageops::rotate90(&img),
        8 => image::imageops::rotate270(&img),
        _ => img,
    }
}

/// `webpsave(path, Q=q)` (libwebp's default effort 4 unless `method` is given).
pub fn webp_save(img: &RgbImage, path: &Path, q: f32, method: Option<i32>) -> anyhow::Result<()> {
    let enc = webp::Encoder::from_rgb(img.as_raw(), img.width(), img.height());
    let mut cfg = webp::WebPConfig::new().map_err(|_| anyhow!("webp config"))?;
    cfg.quality = q;
    if let Some(m) = method {
        cfg.method = m;
    }
    let mem = enc
        .encode_advanced(&cfg)
        .map_err(|e| anyhow!("webp encode: {e:?}"))?;
    std::fs::write(path, &*mem)?;
    Ok(())
}

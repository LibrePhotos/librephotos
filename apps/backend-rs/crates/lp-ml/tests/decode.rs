//! `preprocess::load_rgb` follows Pillow's `Image.open().convert("RGB")` on
//! damaged files and 16-bit images (checked against Pillow 11 in the CLIP
//! review: a cut JPEG is unreadable, a PNG cut in its IEND is not; 16-bit
//! colour keeps the high byte, 16-bit grey clips at 255).

use std::path::Path;

use image::{DynamicImage, ImageBuffer, ImageFormat, Luma, Rgb, RgbImage};
use lp_ml::preprocess::{self, jpeg_truncated, load_rgb, png_close_tail};

fn gradient() -> RgbImage {
    ImageBuffer::from_fn(64, 48, |x, y| {
        Rgb([(x * 4) as u8, (y * 5) as u8, ((x + y) * 3) as u8])
    })
}

fn encoded(img: &DynamicImage, format: ImageFormat) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, format).unwrap();
    out.into_inner()
}

fn write(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, bytes).unwrap();
    p
}

#[test]
fn truncated_jpeg_is_unreadable_but_trailing_bytes_are_fine() {
    let dir = tempfile::tempdir().unwrap();
    let jpeg = encoded(&DynamicImage::ImageRgb8(gradient()), ImageFormat::Jpeg);
    assert!(!jpeg_truncated(&jpeg));
    assert!(load_rgb(&write(dir.path(), "ok.jpg", &jpeg)).is_ok());

    let mut trailing = jpeg.clone();
    trailing.extend_from_slice(&[0u8; 100]);
    assert!(load_rgb(&write(dir.path(), "trailing.jpg", &trailing)).is_ok());

    for cut in [2, 3, 10, jpeg.len() / 2] {
        let short = &jpeg[..jpeg.len() - cut];
        assert!(jpeg_truncated(short), "cut {cut}");
        let err = load_rgb(&write(dir.path(), "cut.jpg", short)).unwrap_err();
        assert!(format!("{err:#}").contains("truncated"), "{err:#}");
    }
    assert!(!jpeg_truncated(b"\x89PNG"));
}

#[test]
fn png_cut_in_iend_decodes_and_cut_image_data_does_not() {
    let dir = tempfile::tempdir().unwrap();
    let img = gradient();
    let png = encoded(&DynamicImage::ImageRgb8(img.clone()), ImageFormat::Png);
    assert!(png_close_tail(&png).is_none());
    for cut in [2, 10, 12] {
        let got = load_rgb(&write(dir.path(), "cut.png", &png[..png.len() - cut])).unwrap();
        assert_eq!(got, img, "cut {cut}");
    }
    assert!(load_rgb(&write(dir.path(), "half.png", &png[..png.len() / 2])).is_err());
}

#[test]
fn sixteen_bit_images_convert_like_pillow() {
    let rgb16: ImageBuffer<Rgb<u16>, Vec<u16>> = ImageBuffer::from_fn(8, 4, |x, y| {
        Rgb([x as u16 * 8000 + 255, y as u16 * 16000, 65535])
    });
    let got = preprocess::pillow_rgb8(DynamicImage::ImageRgb16(rgb16.clone()));
    for (g, s) in got.pixels().zip(rgb16.pixels()) {
        assert_eq!(g.0, [(s.0[0] >> 8) as u8, (s.0[1] >> 8) as u8, 255]);
    }

    let grey16: ImageBuffer<Luma<u16>, Vec<u16>> =
        ImageBuffer::from_fn(8, 4, |x, _| Luma([x as u16 * 60]));
    let got = preprocess::pillow_rgb8(DynamicImage::ImageLuma16(grey16));
    let row: Vec<u8> = got.pixels().take(8).map(|p| p.0[0]).collect();
    assert_eq!(row, [0, 60, 120, 180, 240, 255, 255, 255]);

    // Through a real file too.
    let dir = tempfile::tempdir().unwrap();
    let png = encoded(&DynamicImage::ImageRgb16(rgb16), ImageFormat::Png);
    let got = load_rgb(&write(dir.path(), "rgb16.png", &png)).unwrap();
    assert_eq!(
        got.get_pixel(1, 1).0,
        [(8255u16 >> 8) as u8, (16000u16 >> 8) as u8, 255]
    );
}

//! In-process RAW thumbnails against the Python goldens
//! (`tests/ml/golden_raw_thumbnail.py`: `image_decoding.raw_preview` and the
//! thumbnail service's `render_raw` on synthetic DNGs).
//!
//! `cargo test -p lp-ml --test raw_thumbnail -- --nocapture` prints the
//! per-file comparison.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::RgbImage;
use lp_ml::golden;
use lp_ml::raw_thumbnail;
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use lp_sidecars::{SidecarError, Sidecars};

fn load_png(p: &Path) -> RgbImage {
    image::open(p)
        .unwrap_or_else(|e| panic!("{}: {e}", p.display()))
        .to_rgb8()
}

struct Diff {
    mean: f64,
    max: u8,
    equal: f64,
    psnr: f64,
}

fn diff(a: &RgbImage, b: &RgbImage) -> Diff {
    assert_eq!(a.dimensions(), b.dimensions());
    let (mut sum, mut sq, mut max, mut eq) = (0f64, 0f64, 0u8, 0usize);
    for (x, y) in a.as_raw().iter().zip(b.as_raw()) {
        let d = x.abs_diff(*y);
        sum += d as f64;
        sq += (d as f64).powi(2);
        max = max.max(d);
        eq += (d == 0) as usize;
    }
    let n = a.as_raw().len() as f64;
    let mse = sq / n;
    Diff {
        mean: sum / n,
        max,
        equal: eq as f64 / n,
        psnr: if mse == 0.0 {
            f64::INFINITY
        } else {
            10.0 * (255.0f64 * 255.0 / mse).log10()
        },
    }
}

fn shape(img: &RgbImage) -> Vec<u64> {
    vec![img.height() as u64, img.width() as u64, 3]
}

fn goldens() -> Option<(golden::Golden, PathBuf)> {
    let g = golden::load("raw_thumbnail", "big")?;
    let dir = PathBuf::from(g.meta["images"].as_str()?);
    Some((g, dir))
}

#[test]
fn same_choice_and_dimensions_as_python() {
    let Some((g, dir)) = goldens() else { return };
    let mut worst_render = f64::INFINITY;
    for c in &g.cases {
        let path = PathBuf::from(c.input["path"].as_str().unwrap());
        let height = c.input["height"].as_u64().unwrap() as u32;
        let want_choice = c.output["choice"].as_str().unwrap();
        let python_pre = load_png(&dir.join(format!("{}.pre.png", c.id)));
        let python_webp = load_png(&dir.join(format!("{}.py.png", c.id)));

        let preview = raw_thumbnail::raw_preview(&path, height);
        let choice = if preview.is_some() {
            "preview"
        } else {
            "render"
        };
        assert_eq!(choice, want_choice, "{}: preview vs render", c.id);

        let ours = match preview {
            Some(p) => {
                println!("{:22} preview", c.id);
                p
            }
            None => {
                let dev = raw_thumbnail::develop_file(&path, height).unwrap();
                assert_eq!(dev.half, c.output["half"].as_bool().unwrap(), "{}", c.id);
                let rawpy = load_png(&dir.join(format!("{}.rawpy.png", c.id)));
                // rawpy hands a monochrome RAW back as one channel; ours is grey RGB.
                let want: Vec<u64> =
                    serde_json::from_value(c.output["rawpy_shape"].clone()).unwrap();
                assert_eq!(
                    shape(&dev.image)[..2],
                    want[..2],
                    "{}: postprocess size",
                    c.id
                );
                if let Ok(d) = std::env::var("LP_RAW_DUMP") {
                    dev.image
                        .save(Path::new(&d).join(format!("{}.rust.png", c.id)))
                        .unwrap();
                }
                let d = diff(&dev.image, &rawpy);
                println!(
                    "{:22} render  {:>4}x{:<4} vs rawpy : mean {:.3} max {:3} equal {:5.1}% PSNR {:.1} dB ({})",
                    c.id,
                    dev.image.width(),
                    dev.image.height(),
                    d.mean,
                    d.max,
                    d.equal * 100.0,
                    d.psnr,
                    if dev.half { "half size" } else { "demosaic" }
                );
                // Half size is LibRaw's arithmetic step for step; the full size
                // AHD differs only where near-equal homogeneity counts tip;
                // LinearRaw (no mosaic, never halved) within 1 level.
                let min = if c.input.get("linear").is_some() {
                    65.0
                } else if dev.half {
                    70.0
                } else {
                    55.0
                };
                assert!(d.psnr > min, "{}: develop PSNR {:.1}", c.id, d.psnr);
                worst_render = worst_render.min(d.psnr);
                raw_thumbnail::shrink_to_height(&dev.image, height)
            }
        };
        let want: Vec<u64> = serde_json::from_value(c.output["thumbnail_shape"].clone()).unwrap();
        assert_eq!(shape(&ours), want, "{}: thumbnail size", c.id);
        let d = diff(&ours, &python_pre);
        println!(
            "{:22} thumbnail {:>4}x{:<4} vs pyvips : mean {:.3} max {:3} PSNR {:.1} dB",
            "",
            ours.width(),
            ours.height(),
            d.mean,
            d.max,
            d.psnr
        );
        assert!(d.psnr > 40.0, "{}: thumbnail PSNR {:.1}", c.id, d.psnr);
        // Both through WebP Q95 (effort 2 for previews as Django writes them,
        // libwebp's default for the service).
        let tmp = tempfile::Builder::new().suffix(".webp").tempfile().unwrap();
        let method = (want_choice == "preview").then_some(2);
        raw_thumbnail::webp_save(&ours, tmp.path(), 95.0, method).unwrap();
        let d = diff(&load_png(tmp.path()), &python_webp);
        println!(
            "{:22} WebP      {:>4}x{:<4} vs Python: mean {:.3} max {:3} PSNR {:.1} dB",
            "",
            ours.width(),
            ours.height(),
            d.mean,
            d.max,
            d.psnr
        );
        assert!(d.psnr > 38.0, "{}: WebP PSNR {:.1}", c.id, d.psnr);
    }
    println!("worst develop PSNR vs rawpy: {worst_render:.1} dB");
}

fn ml(media_root: &Path) -> Ml {
    Ml::new(
        MlConfig::new(media_root.to_path_buf()),
        Arc::new(|| Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
            semantic_search_model: String::new(),
        }),
    )
}

#[tokio::test]
async fn inprocess_service_writes_webp_under_the_media_root_only() {
    let Some((g, _)) = goldens() else { return };
    let case = g.cases.iter().find(|c| c.id == "no_preview").unwrap();
    let source = case.input["path"].as_str().unwrap();
    let media = tempfile::tempdir().unwrap();
    let ml = ml(media.path());
    ml.set_mode(Service::RawThumbnail, Mode::InProcess);
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);
    assert!(view.is_inprocess(Service::RawThumbnail));

    let dir = media.path().join("thumbnails_big");
    std::fs::create_dir_all(&dir).unwrap();
    let dest = dir.join("x.webp");
    let dest_s = dest.to_string_lossy().to_string();
    let t = std::time::Instant::now();
    let written = view
        .raw_thumbnail()
        .render_thumbnail(source, &dest_s, 1080)
        .await
        .unwrap();
    println!("render_thumbnail: {:?}", t.elapsed());
    assert_eq!(written, dest_s);
    let img = image::open(&dest).unwrap();
    assert_eq!((img.width(), img.height()), (1620, 1080));

    let outside = media.path().join("..").join("escape.webp");
    let err = view
        .raw_thumbnail()
        .render_thumbnail(source, &outside.to_string_lossy(), 1080)
        .await
        .unwrap_err();
    assert!(
        matches!(err, SidecarError::Status { status: 400, .. }),
        "{err:?}"
    );

    let bad = media.path().join("not_raw.dng");
    std::fs::write(&bad, b"not a raw file").unwrap();
    let err = view
        .raw_thumbnail()
        .render_thumbnail(&bad.to_string_lossy(), &dest_s, 1080)
        .await
        .unwrap_err();
    assert!(
        matches!(err, SidecarError::Status { status: 500, .. }),
        "{err:?}"
    );
    assert!(raw_thumbnail::raw_preview(&bad, 1080).is_none());
}

/// Patches the LONG entry `tag` (little-endian, count 1) of a TIFF to `value`.
fn patch_long(bytes: &mut [u8], tag: u16, value: u32) {
    let mut entry = tag.to_le_bytes().to_vec();
    entry.extend([4, 0, 1, 0, 0, 0]);
    let at = bytes
        .windows(entry.len())
        .position(|w| w == entry.as_slice())
        .unwrap_or_else(|| panic!("tag {tag}"));
    bytes[at + 8..at + 12].copy_from_slice(&value.to_le_bytes());
}

#[test]
fn a_huge_declared_sensor_is_refused_before_allocating() {
    let Some((g, _)) = goldens() else { return };
    let case = g.cases.iter().find(|c| c.id == "no_preview").unwrap();
    let mut bytes = std::fs::read(case.input["path"].as_str().unwrap()).unwrap();
    patch_long(&mut bytes, 256, 100_000);
    patch_long(&mut bytes, 257, 100_000);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("huge.dng");
    std::fs::write(&path, &bytes).unwrap();
    let err = raw_thumbnail::develop_file(&path, 1080)
        .err()
        .expect("refused");
    assert!(format!("{err:#}").contains("pixel limit"), "{err:#}");
    assert!(raw_thumbnail::raw_preview(&path, 1080).is_none());

    // Truncated files are errors, not panics or garbage.
    let whole = std::fs::read(case.input["path"].as_str().unwrap()).unwrap();
    let cut = dir.path().join("cut.dng");
    std::fs::write(&cut, &whole[..whole.len() / 3]).unwrap();
    assert!(raw_thumbnail::develop_file(&cut, 1080).is_err());
    std::fs::write(&cut, []).unwrap();
    assert!(raw_thumbnail::develop_file(&cut, 1080).is_err());
    assert!(raw_thumbnail::raw_preview(&cut, 1080).is_none());
}

#[test]
fn fallback_preview_takes_the_largest_jpeg_upright() {
    let jpeg = |w: u32, h: u32| {
        let img = RgbImage::from_fn(w, h, |x, y| image::Rgb([x as u8, y as u8, 128]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
        out.into_inner()
    };
    let jpegs = vec![jpeg(160, 120), jpeg(3000, 2000), b"not a jpeg".to_vec()];
    let img = raw_thumbnail::fallback_preview(&jpegs, 1, 1080).unwrap();
    assert_eq!(img.dimensions(), (1620, 1080));
    // Sideways: boxed by the width before turning.
    let img = raw_thumbnail::fallback_preview(&jpegs, 6, 1080).unwrap();
    assert_eq!(img.dimensions(), (720, 1080));
    // Mirrored orientations stay unrotated, as Django's previews.
    let img = raw_thumbnail::fallback_preview(&jpegs, 5, 1080).unwrap();
    assert_eq!(img.dimensions(), (1620, 1080));
    assert!(raw_thumbnail::fallback_preview(&[], 1, 1080).is_none());
    assert!(raw_thumbnail::fallback_preview(&[b"junk".to_vec()], 1, 1080).is_none());
}

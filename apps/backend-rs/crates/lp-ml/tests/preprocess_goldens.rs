//! lp_ml::preprocess / tokenize against Pillow, OpenCV and HF tokenizers
//! (goldens from `tests/ml/golden_preprocess.py`). Skipped without goldens.
//! `cargo test -p lp-ml --test preprocess_goldens -- --nocapture` prints the
//! per-operation diff summary.

use std::collections::BTreeMap;
use std::path::Path;

use lp_ml::golden::{self, Array};
use lp_ml::preprocess::{self, Filter, Order, Scale, cv2, pil};

#[derive(Default)]
struct Tally {
    cases: usize,
    exact: usize,
    max_diff: u8,
    diff_bytes: usize,
    bytes: usize,
}

fn tally<'a>(t: &'a mut BTreeMap<&'static str, Tally>, k: &'static str) -> &'a mut Tally {
    t.entry(k).or_default()
}

fn record(t: &mut BTreeMap<&'static str, Tally>, k: &'static str, ours: &[u8], want: &Array) {
    let want = want.u8();
    assert_eq!(ours.len(), want.len(), "{k}: size");
    let (max, n) = golden::u8_diff(ours, want);
    let e = tally(t, k);
    e.cases += 1;
    e.exact += usize::from(n == 0);
    e.max_diff = e.max_diff.max(max);
    e.diff_bytes += n;
    e.bytes += want.len();
}

#[test]
fn resizes_match_pillow_and_opencv() {
    let Some(g) = golden::load("preprocess", "resize") else {
        return;
    };
    let mut t = BTreeMap::new();
    // extension -> (identical, total, max diff)
    let mut decode: BTreeMap<String, (usize, usize, u8)> = BTreeMap::new();
    for c in &g.cases {
        let png = c.input["decoded_png"].as_str().unwrap();
        let src = image::open(png).unwrap().to_rgb8();
        let (w, h) = (src.width() as usize, src.height() as usize);
        let out = &c.output;
        let odd = &c.input["odd"];
        let (ow, oh) = (
            odd[0].as_u64().unwrap() as usize,
            odd[1].as_u64().unwrap() as usize,
        );

        // Decoding the original like Pillow (informational: JPEG decoders differ).
        let orig = Path::new(c.input["image"].as_str().unwrap());
        if let Ok(ours) = preprocess::load_rgb(orig)
            && ours.dimensions() == src.dimensions()
        {
            let ext = orig
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let (max, n) = golden::u8_diff(ours.as_raw(), src.as_raw());
            let e = decode.entry(ext).or_default();
            e.0 += usize::from(n == 0);
            e.1 += 1;
            e.2 = e.2.max(max);
        }

        let crop224 = pil::resize_shortest_edge_center_crop(&src, 224, Filter::Bicubic);
        record(
            &mut t,
            "pil_bicubic_crop224",
            crop224.as_raw(),
            &Array::from_json(&out["pil_bicubic_crop224"]),
        );
        let crop256 = pil::resize_shortest_edge_center_crop(&src, 256, Filter::Bilinear);
        record(
            &mut t,
            "pil_bilinear_crop256",
            crop256.as_raw(),
            &Array::from_json(&out["pil_bilinear_crop256"]),
        );
        let sq = pil::resize_rgb(&src, 224, 224, Filter::Bicubic);
        record(
            &mut t,
            "pil_bicubic_224x224",
            sq.as_raw(),
            &Array::from_json(&out["pil_bicubic_224x224"]),
        );
        let bl = pil::resize(src.as_raw(), w, h, 3, ow, oh, Filter::Bilinear);
        record(
            &mut t,
            "pil_bilinear_odd",
            &bl,
            &Array::from_json(&out["pil_bilinear_odd"]),
        );
        let lz = pil::resize(src.as_raw(), w, h, 3, ow, oh, Filter::Lanczos);
        record(
            &mut t,
            "pil_lanczos_odd",
            &lz,
            &Array::from_json(&out["pil_lanczos_odd"]),
        );

        let lin = cv2::resize_linear(src.as_raw(), w, h, 3, ow, oh);
        record(
            &mut t,
            "cv2_linear_odd",
            &lin,
            &Array::from_json(&out["cv2_linear_odd"]),
        );
        let area = cv2::resize_area(src.as_raw(), w, h, 3, ow, oh);
        record(
            &mut t,
            "cv2_area_odd",
            &area,
            &Array::from_json(&out["cv2_area_odd"]),
        );

        let (cw, ch) = (w.min(50), h.min(40));
        let mut sub = Vec::with_capacity(cw * ch * 3);
        for y in 0..ch {
            sub.extend_from_slice(&src.as_raw()[y * w * 3..(y * w + cw) * 3]);
        }
        let up = &c.input["up"];
        let (uw, uh) = (
            up[0].as_u64().unwrap() as usize,
            up[1].as_u64().unwrap() as usize,
        );
        let upr = cv2::resize_linear(&sub, cw, ch, 3, uw, uh);
        record(
            &mut t,
            "cv2_linear_up",
            &upr,
            &Array::from_json(&out["cv2_linear_up"]),
        );

        if let Some(want) = out.get("cv2_linear_half") {
            let (hw, hh) = (w / 2, h / 2);
            let mut even = Vec::with_capacity(hw * 2 * hh * 2 * 3);
            for y in 0..hh * 2 {
                even.extend_from_slice(&src.as_raw()[y * w * 3..(y * w + hw * 2) * 3]);
            }
            let half = cv2::resize_linear(&even, hw * 2, hh * 2, 3, hw, hh);
            record(&mut t, "cv2_linear_half", &half, &Array::from_json(want));
        }

        if let Some(want) = out.get("clip_tensor") {
            let ours = preprocess::to_chw(
                crop224.as_raw(),
                224,
                224,
                Order::Rgb,
                Scale::Div255,
                preprocess::CLIP_MEAN,
                preprocess::CLIP_STD,
            );
            let want = Array::from_json(want).f32();
            let d = golden::max_abs_diff(&ours, &want);
            assert_eq!(d, 0.0, "{}: CLIP tensor differs by {d}", c.id);
        }
    }

    eprintln!(
        "{:<22} {:>5} {:>6} {:>4} {:>12}",
        "operation", "cases", "exact", "max", "diff bytes"
    );
    for (k, v) in &t {
        eprintln!(
            "{k:<22} {:>5} {:>6} {:>4} {:>7} ({:.4}%)",
            v.cases,
            v.exact,
            v.max_diff,
            v.diff_bytes,
            v.diff_bytes as f64 * 100.0 / v.bytes.max(1) as f64
        );
    }
    for (ext, (same, total, max)) in &decode {
        eprintln!("decode .{ext} vs Pillow: {same}/{total} identical, max diff {max}");
    }

    // Pillow's resizes are ported exactly.
    for k in [
        "pil_bicubic_crop224",
        "pil_bilinear_crop256",
        "pil_bicubic_224x224",
        "pil_bilinear_odd",
        "pil_lanczos_odd",
    ] {
        let v = &t[k];
        assert_eq!(
            v.exact,
            v.cases,
            "{k}: {} of {} cases differ",
            v.cases - v.exact,
            v.cases
        );
    }
    for (k, v) in &t {
        if k.starts_with("cv2") {
            assert_eq!(v.max_diff, 0, "{k}: max diff {}", v.max_diff);
        }
    }
}

#[test]
fn tokenizers_match_python() {
    let Some(g) = golden::load("preprocess", "tokenize") else {
        return;
    };
    let mut cache = BTreeMap::new();
    for c in &g.cases {
        let path = c.input["tokenizer"].as_str().unwrap().to_string();
        let tok = cache
            .entry(path.clone())
            .or_insert_with(|| lp_ml::tokenize::load(Path::new(&path)).unwrap());
        let ids =
            lp_ml::tokenize::encode_ids(tok, c.input["text"].as_str().unwrap(), None).unwrap();
        let want: Vec<i64> = c.output["ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect();
        assert_eq!(ids, want, "{}", c.id);
    }
}

/// Pillow opens 16-bit colour as 8-bit by its high byte and 16-bit grey as
/// `I;16`, whose `.convert("RGB")` clips at 255 (Pillow 12.3).
#[test]
fn sixteen_bit_converts_like_pillow() {
    use image::{DynamicImage, ImageBuffer, Luma, LumaA, Rgb, Rgba};
    let grey = ImageBuffer::<Luma<u16>, _>::from_raw(3, 1, vec![100u16, 256, 65535]).unwrap();
    assert_eq!(
        preprocess::pillow_rgb8(DynamicImage::ImageLuma16(grey)).into_raw(),
        vec![100, 100, 100, 255, 255, 255, 255, 255, 255]
    );
    let la = ImageBuffer::<LumaA<u16>, _>::from_raw(1, 1, vec![0x01ffu16, 7]).unwrap();
    assert_eq!(
        preprocess::pillow_rgb8(DynamicImage::ImageLumaA16(la)).into_raw(),
        vec![1, 1, 1]
    );
    let rgb = ImageBuffer::<Rgb<u16>, _>::from_raw(1, 1, vec![0x01ffu16, 0x80ff, 0xff00]).unwrap();
    assert_eq!(
        preprocess::pillow_rgb8(DynamicImage::ImageRgb16(rgb)).into_raw(),
        vec![1, 0x80, 0xff]
    );
    let rgba =
        ImageBuffer::<Rgba<u16>, _>::from_raw(1, 1, vec![0x01ffu16, 0x80ff, 0xff00, 9]).unwrap();
    assert_eq!(
        preprocess::pillow_rgb8(DynamicImage::ImageRgba16(rgba)).into_raw(),
        vec![1, 0x80, 0xff]
    );
}

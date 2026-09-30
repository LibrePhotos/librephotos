//! LFM2.5-VL captions against the Python goldens (`tests/ml/golden_caption.py`).
//!
//! The model tests skip without `LP_ORT_LIB` / goldens / the model. They run
//! the first 8 golden cases; `LP_CAPTION_GOLDEN_ALL=1` runs all of them
//! (~10 s a caption on a CPU) and prints the parity report.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use lp_ml::caption::lfm2_vl::{self, Lfm2Vl};
use lp_ml::golden::{self, Array};
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use lp_sidecars::{SidecarError, Sidecars};
use serde_json::Value;

#[test]
fn smart_resize_matches_python() {
    // (height, width) -> smart_resize, from lfm2_vl.smart_resize.
    for ((h, w), want) in [
        ((480, 640), (416, 576)),
        ((1, 1), (256, 256)),
        ((90, 1600), (96, 1600)),
        ((768, 1024), (416, 576)),
        ((260, 900), (256, 896)),
        ((517, 333), (512, 320)),
        ((4000, 3000), (576, 416)),
        ((100, 5000), (64, 3616)),
    ] {
        assert_eq!(lfm2_vl::smart_resize(h, w), want, "{h}x{w}");
    }
}

#[test]
fn captions_are_cleaned_like_python() {
    assert_eq!(lfm2_vl::clean_caption("  \"A dog.\" \n"), "A dog.");
    assert_eq!(lfm2_vl::clean_caption("'A cat'"), "A cat");
    assert_eq!(
        lfm2_vl::clean_caption("\"A \"quoted\" word"),
        "\"A \"quoted\" word"
    );
    assert_eq!(lfm2_vl::clean_caption("\""), "\"");
    assert_eq!(lfm2_vl::clean_caption("\"\""), "");
    assert_eq!(lfm2_vl::clean_caption("\x1cA\x1f"), "A");
}

#[test]
fn f16_conversion() {
    use lfm2_vl::f16_to_f32;
    assert_eq!(f16_to_f32(0x3c00), 1.0);
    assert_eq!(f16_to_f32(0xc000), -2.0);
    assert_eq!(f16_to_f32(0x7bff), 65504.0);
    assert_eq!(f16_to_f32(0x0001), 5.960_464_5e-8);
    assert_eq!(f16_to_f32(0x0000), 0.0);
    assert!(f16_to_f32(0xfc00).is_infinite());
    assert!(f16_to_f32(0x7e00).is_nan());
    assert_eq!(lfm2_vl::argmax(&[1.0, 3.0, 3.0, 2.0]), 1);
}

/// Preprocessing only (no runtime): resize target and the patch tensor.
#[test]
fn prepare_image_matches_python() {
    let Some(g) = golden::load("caption", "lfm2_vl") else {
        return;
    };
    for c in &g.cases {
        let path = c.input["image"].as_str().unwrap();
        let img = lp_ml::preprocess::load_rgb(Path::new(path)).unwrap();
        let p = lfm2_vl::prepare_image(&img);
        let want: Vec<u64> = serde_json::from_value(c.output["resized"].clone()).unwrap();
        assert_eq!(
            (p.resized.0 as u64, p.resized.1 as u64),
            (want[0], want[1]),
            "{}",
            c.id
        );
        let spatial: Vec<usize> =
            serde_json::from_value(c.output["spatial_shapes"].clone()).unwrap();
        assert_eq!(
            (p.patches_h, p.patches_w),
            (spatial[0], spatial[1]),
            "{}",
            c.id
        );
        assert_eq!(
            p.image_tokens(),
            c.output["image_tokens"].as_u64().unwrap() as usize
        );
        let sum: f64 = p.pixel_values.iter().map(|&v| v as f64).sum();
        let want_sum = c.output["pixel_sum"].as_f64().unwrap();
        let jpeg = is_jpeg(path);
        // Exact decoders give the same f32 values; JPEG (zune vs libjpeg-turbo)
        // may differ by a few levels per pixel.
        let tol = if jpeg {
            2e-2 * p.pixel_values.len() as f64
        } else {
            1e-3
        };
        assert!(
            (sum - want_sum).abs() <= tol,
            "{}: pixel sum {sum} vs {want_sum}",
            c.id
        );
    }
}

fn is_jpeg(path: &str) -> bool {
    let l = path.to_ascii_lowercase();
    l.ends_with(".jpg") || l.ends_with(".jpeg")
}

fn model_dir() -> Option<std::path::PathBuf> {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return None;
    }
    let dir = golden::data_models().join(lfm2_vl::MODEL_NAME);
    if !Lfm2Vl::model_files(&dir).iter().all(|p| p.exists()) {
        eprintln!("{} incomplete; skipping", dir.display());
        return None;
    }
    Some(dir)
}

fn case_limit(n: usize) -> usize {
    match std::env::var("LP_CAPTION_GOLDEN_ALL").ok().as_deref() {
        Some("1") | Some("true") => n,
        _ => n.min(8),
    }
}

/// Where two token sequences first differ.
fn first_divergence(a: &[i64], b: &[i64]) -> Option<usize> {
    (0..a.len().max(b.len())).find(|&i| a.get(i) != b.get(i))
}

#[test]
fn captions_match_python() {
    let Some(g) = golden::load("caption", "lfm2_vl") else {
        return;
    };
    let Some(dir) = model_dir() else {
        return;
    };
    let t = Instant::now();
    let mut m = Lfm2Vl::load(&dir).expect("model loads");
    eprintln!(
        "loaded in {:.2}s (python {:.2}s)",
        t.elapsed().as_secs_f64(),
        g.meta["load_seconds"].as_f64().unwrap_or(0.0)
    );

    let n = case_limit(g.cases.len());
    let (mut same, mut same_caption, mut exact_decoded, mut exact_same) = (0, 0, 0, 0);
    let (mut rust_secs, mut py_secs) = (0.0, 0.0);
    let mut report = Vec::new();
    for c in &g.cases[..n] {
        let path = c.input["image"].as_str().unwrap();
        let prompt = c.input["prompt"]
            .as_str()
            .unwrap_or(lfm2_vl::DEFAULT_PROMPT);
        let img = lp_ml::preprocess::load_rgb(Path::new(path)).unwrap();

        if let Some(want) = c.output.get("image_features") {
            let want = Array::from_json(want);
            let (shape, ours) = m.image_features(&lfm2_vl::prepare_image(&img)).unwrap();
            assert_eq!(
                shape.iter().map(|&d| d as usize).collect::<Vec<_>>(),
                want.shape,
                "{}",
                c.id
            );
            let min = if is_jpeg(path) { 0.99 } else { 0.9999 };
            golden::assert_cosine(&ours, &want.f32(), min, &c.id);
        }

        let t = Instant::now();
        let got = m
            .generate(&img, prompt, lfm2_vl::DEFAULT_MAX_NEW_TOKENS)
            .unwrap_or_else(|e| panic!("{}: {e:#}", c.id));
        let secs = t.elapsed().as_secs_f64();
        rust_secs += secs;
        py_secs += c.output["seconds"].as_f64().unwrap_or(0.0);

        let want_prompt: Vec<u32> = serde_json::from_value(c.output["prompt_ids"].clone()).unwrap();
        assert_eq!(got.prompt_ids, want_prompt, "{}: prompt ids", c.id);
        let want_ids: Vec<i64> = serde_json::from_value(c.output["token_ids"].clone()).unwrap();
        let want_caption = c.output["caption"].as_str().unwrap();
        let exact = !is_jpeg(path);
        exact_decoded += exact as usize;
        if got.token_ids == want_ids {
            same += 1;
            exact_same += exact as usize;
            assert_eq!(
                got.caption, want_caption,
                "{}: same ids, different text",
                c.id
            );
        } else {
            let at = first_divergence(&got.token_ids, &want_ids).unwrap();
            let margin = c.output["margins"]
                .as_array()
                .and_then(|m| m.get(at))
                .and_then(Value::as_f64);
            report.push(format!(
                "{} ({}): diverges at token {at} (python top-2 margin {:?})\n    rust:   {}\n    python: {}",
                c.id,
                if exact { "exact decode" } else { "jpeg" },
                margin,
                got.caption,
                want_caption
            ));
        }
        same_caption += (got.caption == want_caption) as usize;
        eprintln!(
            "{:6.2}s {:3} tok {}: {}",
            secs,
            got.token_ids.len(),
            c.id,
            got.caption
        );
    }
    eprintln!(
        "\nparity: identical token sequences {same}/{n} ({:.1}%), identical captions {same_caption}/{n}; \
         exact-decode inputs {exact_same}/{exact_decoded}\n\
         mean seconds per caption: rust {:.2}, python {:.2} (python timed when the goldens were made)",
        100.0 * same as f64 / n as f64,
        rust_secs / n as f64,
        py_secs / n as f64
    );
    for r in &report {
        eprintln!("{r}");
    }
    assert!(
        same as f64 >= 0.9 * n as f64,
        "only {same}/{n} captions have Python's token sequence"
    );
}

fn ml(media_root: &Path) -> Ml {
    Ml::new(
        MlConfig::from_env(media_root.to_path_buf()),
        Arc::new(|| Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
        }),
    )
}

/// Through the switch: auto picks the in-process captioner when the model is
/// on disk, answers the golden caption, reports an unreadable image as the
/// sidecar's 500 and unloads.
#[tokio::test]
async fn auto_mode_captions_in_process() {
    let Some(g) = golden::load("caption", "lfm2_vl") else {
        return;
    };
    if model_dir().is_none() {
        return;
    }
    let ml = ml(&golden::ml_root().join("protected_media"));
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);
    assert!(view.is_inprocess(Service::Caption));

    let c = g
        .cases
        .iter()
        .find(|c| !is_jpeg(c.input["image"].as_str().unwrap()) && c.input["prompt"].is_null())
        .expect("a lossless golden image");
    let caption = view
        .caption()
        .generate_caption(c.input["image"].as_str().unwrap(), None)
        .await
        .expect("caption");
    assert_eq!(caption, c.output["caption"].as_str().unwrap(), "{}", c.id);
    assert_eq!(
        ml.loaded_models(Service::Caption),
        vec![(lfm2_vl::MODEL_NAME.to_string(), 1)]
    );

    let err = view
        .caption()
        .generate_caption("Z:/does/not/exist.webp", Some("x"))
        .await
        .unwrap_err();
    match &err {
        SidecarError::Status { status, body, .. } => {
            assert_eq!(*status, 500);
            assert!(
                body.as_ref().unwrap()["error"]
                    .as_str()
                    .unwrap()
                    .contains("exist.webp")
            );
        }
        other => panic!("expected the sidecar's 500, got {other:?}"),
    }
    assert!(err.detail().contains("exist.webp"), "{}", err.detail());
    // A failed inference keeps the loaded model.
    assert_eq!(ml.loaded_models(Service::Caption).len(), 1);
    assert!(ml.unload(Service::Caption));
    assert!(ml.loaded_models(Service::Caption).is_empty());

    // Explicit sidecar mode goes to HTTP even with the model present.
    ml.set_mode(Service::Caption, Mode::Sidecar);
    assert!(!ml.view(&sidecars).is_inprocess(Service::Caption));
}

#[tokio::test]
async fn missing_model_is_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    let ml = ml(dir.path());
    ml.set_mode(Service::Caption, Mode::InProcess);
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let err = ml
        .view(&sidecars)
        .caption()
        .generate_caption("x.webp", None)
        .await
        .unwrap_err();
    assert!(matches!(err, SidecarError::Unreachable { .. }), "{err:?}");
}

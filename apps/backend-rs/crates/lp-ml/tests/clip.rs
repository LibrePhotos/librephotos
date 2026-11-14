//! In-process CLIP against the Python goldens (`tests/ml/golden_clip.py`).
//! Skipped without goldens, the model or `LP_ORT_LIB`.

use std::sync::Arc;
use std::time::Instant;

use lp_ml::golden::{self, Array};
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use lp_sidecars::Sidecars;

fn setup() -> Option<(Ml, String)> {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return None;
    }
    let dir = golden::data_models().join("clip_vit_b32");
    if !dir.join("vision_model.onnx").is_file() {
        eprintln!("{} missing; skipping", dir.display());
        return None;
    }
    let media_root = golden::ml_root().join("protected_media");
    let ml = Ml::new(
        MlConfig::from_env(media_root),
        Arc::new(|| Selection {
            tagging_model: "mobileclip_s2".into(),
            face_recognition_model: "buffalo_sc".into(),
            ocr_model: "ppocrv6_small".into(),
            captioning_model: "lfm2_vl_450m".into(),
            semantic_search_model: String::new(),
        }),
    );
    ml.set_mode(Service::Clip, Mode::InProcess);
    Some((ml, dir.display().to_string()))
}

/// Run one `image_embeddings` call over a golden set and compare: the same
/// slots empty, cosine >= 0.998 elsewhere.
async fn compare_images(name: &str) {
    let Some(g) = golden::load("clip", name) else {
        return;
    };
    let Some((ml, model)) = setup() else { return };
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);
    let imgs: Vec<String> = g
        .cases
        .iter()
        .map(|c| c.input["image"].as_str().unwrap().to_string())
        .collect();
    let started = Instant::now();
    let reply = view.clip().image_embeddings(&imgs, &model).await.unwrap();
    eprintln!(
        "{name}: {} images (incl. model load) in {:.2}s",
        imgs.len(),
        started.elapsed().as_secs_f64()
    );
    assert_eq!(reply.imgs_emb.len(), imgs.len());
    let (mut worst, mut worst_id, mut mag_err) = (1.0f64, String::new(), 0f64);
    let mut by_kind: std::collections::BTreeMap<&str, (usize, f64)> = Default::default();
    let (mut empty, mut failures) = (0, Vec::new());
    for (i, c) in g.cases.iter().enumerate() {
        let want = &c.output["embedding"];
        let got = reply.imgs_emb[i].as_ref();
        if want.is_null() {
            empty += 1;
            if got.is_some() || reply.magnitudes[i].is_some() {
                failures.push(format!("{}: expected no embedding", c.id));
            }
            continue;
        }
        let want = Array::from_json(want).f32();
        let Some(got) = got else {
            failures.push(format!("{}: no embedding", c.id));
            continue;
        };
        let got: Vec<f32> = got.iter().map(|v| *v as f32).collect();
        let cos = golden::cosine(&got, &want);
        let kind = std::path::Path::new(&c.id)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("?");
        let e = by_kind.entry(kind).or_insert((0, 1.0));
        e.0 += 1;
        e.1 = e.1.min(cos);
        if cos < worst {
            worst = cos;
            worst_id = c.id.clone();
        }
        let want_mag = c.output["magnitude"].as_f64().unwrap();
        mag_err = mag_err.max((reply.magnitudes[i].unwrap() - want_mag).abs() / want_mag);
        if cos < 0.998 {
            failures.push(format!("{}: cosine {cos:.6} < 0.998", c.id));
        } else if cos < 0.9999 {
            eprintln!("{name}: {} cosine {cos:.6}", c.id);
        }
    }
    eprintln!(
        "{name}: {empty} unreadable as in Python; min cosine {worst:.6} ({worst_id}); \
         max magnitude rel err {mag_err:.2e}"
    );
    eprintln!("{name}: min cosine by extension: {by_kind:?}");
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[tokio::test]
async fn image_embeddings_match_python() {
    compare_images("images").await;
}

/// Damaged, 16-bit, CMYK, palette, rotated, animated, tiny and huge images:
/// the same ones unreadable as for Pillow, the rest within the bar.
#[tokio::test]
async fn edge_image_embeddings_match_python() {
    compare_images("edge").await;
}

#[tokio::test]
async fn text_embeddings_match_python() {
    let Some(g) = golden::load("clip", "text") else {
        return;
    };
    let Some((ml, model)) = setup() else { return };
    let tok = lp_ml::tokenize::load(&std::path::Path::new(&model).join("tokenizer.json")).unwrap();
    let sidecars = Sidecars::new(reqwest::Client::new(), "127.0.0.1");
    let view = ml.view(&sidecars);
    let mut worst = 1.0f64;
    let mut max_diff = 0f32;
    for c in &g.cases {
        let q = c.input["query"].as_str().unwrap();
        let ids = lp_ml::tokenize::encode_ids(&tok, q, Some(77)).unwrap();
        assert_eq!(
            ids,
            Array::from_json(&c.output["ids"]).i64(),
            "{} ids",
            c.id
        );
        let reply = view.clip().query_embedding(q, &model).await.unwrap();
        let got: Vec<f32> = reply.emb.iter().map(|v| *v as f32).collect();
        let want = Array::from_json(&c.output["embedding"]).f32();
        worst = worst.min(golden::cosine(&got, &want));
        max_diff = max_diff.max(golden::max_abs_diff(&got, &want));
        golden::assert_cosine(&got, &want, 0.998, &c.id);
        let want_mag = c.output["magnitude"].as_f64().unwrap();
        assert!(
            (reply.magnitude - want_mag).abs() / want_mag < 1e-4,
            "{} magnitude",
            c.id
        );
    }
    eprintln!("text: min cosine {worst:.8}, max abs diff {max_diff:.2e}");
}

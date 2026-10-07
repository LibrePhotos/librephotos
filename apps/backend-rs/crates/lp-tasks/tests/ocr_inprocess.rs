//! `ocr.generate` end to end with the in-process PP-OCRv6 (tiny) on a
//! fixture clone: the rows it writes are compared with what the Python
//! engine answers for the same files (`ml-goldens/ocr/pipeline_tiny.json`,
//! from `tests/ml/golden_ocr.py`). Skipped without `LP_ORT_LIB`, the
//! bundle or the goldens.

#![allow(clippy::disallowed_methods, clippy::type_complexity)]

mod common;

use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use common::*;
use lp_jobs::{EnqueueOptions, JobType};
use lp_ml::{Mode, Service};
use serde_json::{Value, json};

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
    }
}

#[tokio::test]
async fn ocr_generate_in_process_matches_the_python_engine() {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return;
    }
    let bundle = lp_ml::golden::data_models().join("ocr/ppocrv6_tiny");
    let Some(golden) = lp_ml::golden::load("ocr", "pipeline_tiny") else {
        return;
    };
    if !bundle.join("rec.onnx").exists() {
        eprintln!("{} missing; skipping", bundle.display());
        return;
    }
    let reference: HashMap<String, Value> = golden
        .cases
        .iter()
        .filter_map(|c| {
            let p = c.input["image"].as_str()?;
            Some((
                p.replace('/', "\\").to_lowercase(),
                c.output["predict"].clone(),
            ))
        })
        .collect();

    let t = TasksApp::new().await;
    t.copy_thumbnails();
    copy_dir(
        &bundle,
        &t.state.config.data_models_dir().join("ocr/ppocrv6_tiny"),
    );
    t.state.ml.set_mode(Service::Ocr, Mode::InProcess);
    lp_db::write::settings::save(&t.state, &[("OCR_MODEL", json!("ppocrv6_tiny"))])
        .await
        .unwrap();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;

    let started = Instant::now();
    let (res, lrj) = run_job(
        &t.state,
        "ocr.generate",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::GenerateOcr, alice),
    )
    .await;
    res.unwrap();
    let secs = started.elapsed().as_secs_f64();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    assert!(t.mock.calls_to("/ocr").is_empty(), "went to the sidecar");

    let rows: Vec<(
        String,
        String,
        String,
        Value,
        Option<f64>,
        Option<f64>,
        Option<i32>,
    )> = lp_db::sql::query_as(
        "SELECT f.path, o.engine, o.text, o.blocks, o.mean_confidence, o.text_area_fraction, \
               o.source_width FROM api_photo_ocr o JOIN api_photo p ON p.id = o.photo_id \
             JOIN api_file f ON f.hash = p.main_file_id WHERE p.owner_id = $1",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    // photos without a decodable original or a thumbnail get no row
    assert!(
        rows.len() as i32 >= j.progress_target - 2,
        "{} rows of {}",
        rows.len(),
        j.progress_target
    );
    let (mut compared, mut same_text, mut same_boxes) = (0, 0, 0);
    let (mut max_area_diff, mut max_conf_diff) = (0f64, 0f64);
    for (path, engine, text, blocks, conf, area, width) in &rows {
        assert_eq!(engine, "ppocrv6_tiny");
        assert!(width.is_some());
        let Some(py) = reference.get(&path.replace('/', "\\").to_lowercase()) else {
            continue;
        };
        compared += 1;
        if py["text"].as_str() == Some(text.as_str()) {
            same_text += 1;
        } else {
            eprintln!("{path}: {text:?} vs python {:?}", py["text"]);
        }
        let boxes = |v: &Value| -> Vec<Value> {
            v.as_array()
                .unwrap()
                .iter()
                .map(|b| b["box"].clone())
                .collect()
        };
        if boxes(blocks) == boxes(&py["blocks"]) {
            same_boxes += 1;
        }
        // Most originals are JPEGs, decoded here by zune-jpeg (cv2 uses
        // libjpeg-turbo): a few levels of pixel noise move scores slightly.
        let diff = |a: Option<f64>, b: &Value| (a.unwrap() - b.as_f64().unwrap()).abs();
        max_area_diff = max_area_diff.max(diff(*area, &py["text_area_fraction"]));
        if py["text"].as_str() == Some(text.as_str()) && !text.is_empty() {
            max_conf_diff = max_conf_diff.max(diff(*conf, &py["mean_confidence"]));
        }
    }
    eprintln!(
        "ocr.generate in-process: {} photos in {secs:.1}s ({:.0} ms/photo); {compared} compared with Python: text identical {same_text}, blocks' boxes identical {same_boxes}, max |text_area_fraction| diff {max_area_diff:.4}, max |mean_confidence| diff {max_conf_diff:.4}",
        rows.len(),
        secs * 1000.0 / rows.len().max(1) as f64
    );
    assert!(
        compared >= 20,
        "only {compared} photos had a Python reference"
    );
    assert!(same_text as f64 >= 0.9 * compared as f64);
    assert!(max_area_diff < 0.02 && max_conf_diff < 0.05);

    // Rerun: nothing left for this engine.
    let (res, lrj) = run_job(
        &t.state,
        "ocr.generate",
        json!({"user_id": alice, "full_scan": false}),
        EnqueueOptions::tracked(JobType::GenerateOcr, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && j.progress_target <= 2, "{j:?}");
    assert_eq!(t.state.ml.loaded_models(Service::Ocr).len(), 1);
    t.cleanup().await;
}

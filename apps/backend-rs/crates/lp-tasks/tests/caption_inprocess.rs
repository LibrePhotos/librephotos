//! captions.generate end to end with the in-process LFM2.5-VL captioner on a
//! fixture clone: the stored `im2txt` must be the caption the Python
//! captioner wrote for the same thumbnail and prompt (the goldens of
//! `tests/ml/golden_caption.py`). Skips without `LP_ORT_LIB`, the model or
//! the goldens.

#![allow(clippy::disallowed_methods)]

mod common;

use std::sync::Arc;

use common::*;
use lp_jobs::{EnqueueOptions, JobType};
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use serde_json::{Value, json};
use uuid::Uuid;

fn in_process_ml() -> Option<Ml> {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return None;
    }
    let media_root = lp_ml::golden::ml_root().join("protected_media");
    if !lp_ml::models::captioning_model_exists(&media_root.join("data_models")) {
        eprintln!("no lfm2_vl_450m under {}; skipping", media_root.display());
        return None;
    }
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
    // The test's sidecars point at a mock, which keeps `auto` on HTTP.
    ml.set_mode(Service::Caption, Mode::InProcess);
    Some(ml)
}

#[tokio::test]
async fn captions_generate_in_process_matches_python() {
    let Some(golden) = lp_ml::golden::load("caption", "lfm2_vl") else {
        return;
    };
    let Some(ml) = in_process_ml() else {
        return;
    };
    let mut t = TasksApp::new().await;
    t.copy_thumbnails();
    t.state.ml = ml;
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    // llm_settings off: the default prompt, the one the goldens used.
    lp_db::sql::query("UPDATE api_user SET llm_settings = $2 WHERE id = $1")
        .bind(alice)
        .bind(json!({"enabled": false}))
        .execute(&db)
        .await
        .unwrap();

    let m = manifest();
    let mut checked = 0;
    for (i, key) in ["alice/e2e_01", "alice/e2e_05", "alice/e2e_03"]
        .iter()
        .enumerate()
    {
        let photo: Uuid = m["photos"][key]["id"].as_str().unwrap().parse().unwrap();
        let hash = m["photos"][key]["image_hash"].as_str().unwrap();
        let thumb = format!("{hash}.webp");
        let Some(case) = golden
            .cases
            .iter()
            .find(|c| c.id.ends_with(&thumb) && c.input["prompt"].is_null())
        else {
            eprintln!("no golden for {thumb}");
            continue;
        };
        let want = case.output["caption"].as_str().unwrap();
        let started = std::time::Instant::now();
        if i == 0 {
            // The synchronous path (/api/photosedit/generateim2txt).
            let outcome = lp_tasks::captions::generate_im2txt(&t.state, photo)
                .await
                .unwrap();
            assert_eq!(
                outcome,
                lp_tasks::captions::CaptionOutcome::Generated(want.to_string()),
                "{key}"
            );
        } else {
            let (res, lrj) = run_job(
                &t.state,
                "captions.generate",
                json!({"photo_id": photo}),
                EnqueueOptions::tracked(JobType::GenerateTags, alice),
            )
            .await;
            res.unwrap();
            let j = job(&db, lrj.as_deref().unwrap()).await;
            assert!(j.finished && !j.failed, "{key}: job failed");
        }
        eprintln!(
            "{key}: {:.2}s (python {:.2}s): {want}",
            started.elapsed().as_secs_f64(),
            case.output["seconds"].as_f64().unwrap_or(0.0)
        );
        let (cj, search): (Value, String) = lp_db::sql::query_as(
            "SELECT c.captions_json, s.search_captions FROM api_photo_caption c \
             JOIN api_photo_search s ON s.photo_id = c.photo_id WHERE c.photo_id = $1",
        )
        .bind(photo)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(cj["im2txt"], json!(want), "{key}");
        assert!(search.contains(want), "{key}: {search}");
        checked += 1;
    }
    assert!(checked > 0, "no fixture thumbnail has a golden");
    assert!(
        t.mock.calls_to("/generate-caption").is_empty(),
        "the sidecar was called"
    );
    t.cleanup().await;
}

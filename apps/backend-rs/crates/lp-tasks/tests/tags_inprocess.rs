//! tags.generate end to end with the in-process tagger (lp_ml::tags) on a
//! fixture clone: the tags stored per photo must be what the Python tagger
//! (the tags sidecar's model code, `tests/ml/golden_tags.py`) gives for the
//! same big thumbnails. Skipped without `LP_ORT_LIB`, the model or goldens.

#![allow(clippy::disallowed_methods)]

mod common;

use std::collections::HashMap;
use std::sync::Arc;

use common::*;
use lp_jobs::{EnqueueOptions, JobType};
use lp_ml::{Ml, MlConfig, Mode, Selection, Service};
use serde_json::{Value, json};
use uuid::Uuid;

#[tokio::test]
async fn tags_generate_in_process_matches_the_python_tagger() {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return;
    }
    let data_models = lp_ml::golden::data_models();
    if !data_models.join("mobileclip_s2/vision_model.onnx").exists() {
        eprintln!("no mobileclip_s2 under {}; skipping", data_models.display());
        return;
    }
    let Some(g) = lp_ml::golden::load("tags", "mobileclip_s2") else {
        return;
    };
    // Python's tags per thumbnail file name.
    let want: HashMap<String, Value> = g
        .cases
        .iter()
        .filter(|c| c.id.contains("thumbnails_big/"))
        .map(|c| (basename(&c.id), c.output["tags"].clone()))
        .collect();
    assert!(!want.is_empty());

    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let mut state = t.state.clone();
    lp_db::write::settings::save(&state, &[("TAGGING_MODEL", json!("mobileclip_s2"))])
        .await
        .unwrap();
    // The app's ML on the shared test models, the tagger forced in-process
    // (the other sidecars stay on the mock).
    let mut cfg = MlConfig::from_env(state.config.media_root.clone());
    cfg.data_models = data_models;
    let settings = state.settings.clone();
    state.ml = Ml::new(
        cfg,
        Arc::new(move || {
            let s = settings.load();
            Selection {
                tagging_model: s.tagging_model.clone(),
                face_recognition_model: s.face_recognition_model.clone(),
                ocr_model: s.ocr_model.clone(),
                captioning_model: s.captioning_model.clone(),
            }
        }),
    );
    state.ml.set_auto_download(false);
    state.ml.set_mode(Service::Tags, Mode::InProcess);
    assert!(state.ml().is_inprocess(Service::Tags));

    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    sqlx::query("UPDATE api_photo_caption SET captions_json = captions_json - 'mobileclip_s2'")
        .execute(&db)
        .await
        .unwrap();

    let started = std::time::Instant::now();
    let (res, lrj) = run_job(
        &state,
        "tags.generate",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::GenerateTags, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    assert!(j.result.is_none(), "{:?}", j.result);
    assert!(
        t.mock.calls_to("/generate-tags").is_empty(),
        "the sidecar was called"
    );

    let rows: Vec<(Uuid, String, Option<Value>)> = sqlx::query_as(
        "SELECT p.id, p.image_hash, c.captions_json FROM api_photo p \
         LEFT JOIN api_photo_caption c ON c.photo_id = p.id WHERE p.owner_id = $1",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    let (mut compared, mut same) = (0, 0);
    for (id, hash, cj) in &rows {
        let Some(expected) = want.get(&format!("{hash}.webp")) else {
            continue;
        };
        compared += 1;
        let got = cj.as_ref().and_then(|c| c.get("mobileclip_s2"));
        if got == Some(expected) {
            same += 1;
        } else {
            eprintln!("{id} ({hash}): ours {got:?}, python {expected}");
        }
    }
    eprintln!(
        "tags.generate in-process: {compared} photos in {:.1}s, {same}/{compared} identical to the Python tagger",
        started.elapsed().as_secs_f64()
    );
    assert!(compared > 20, "only {compared} photos had goldens");
    assert_eq!(same, compared);

    // Thing albums were filed from the in-process tags.
    let things: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_albumthing WHERE owner_id = $1 AND thing_type = 'mobileclip_s2_tag'",
    )
    .bind(alice)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(things > 0);
    t.cleanup().await;
}

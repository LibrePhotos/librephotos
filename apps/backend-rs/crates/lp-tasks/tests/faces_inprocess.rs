//! faces.scan end to end with the in-process face service (lp_ml::face) on
//! a fixture clone: alice's big thumbnails are replaced by photos with
//! faces, and the stored faces are compared with what the Python sidecar
//! answered for the same files (goldens `face/e2e`, tests/ml/golden_face.py).
//! Skipped without the goldens, the buffalo_sc pack or `LP_ORT_LIB`.

#![allow(clippy::disallowed_methods)]

mod common;

use std::sync::Arc;

use common::*;
use lp_core::codecs::FaceEncoding;
use lp_jobs::{EnqueueOptions, JobType};
use lp_ml::golden::{self, Array};
use lp_ml::{Mode, Service};
use lp_sidecars::FaceBox;
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn scan_with_inprocess_faces_matches_the_sidecar() {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return;
    }
    let Some(g) = golden::load("face", "e2e") else {
        return;
    };
    if !golden::data_models()
        .join("face_recognition/models/buffalo_sc")
        .is_dir()
    {
        eprintln!("no buffalo_sc; skipping");
        return;
    }

    let mut t = TasksApp::new().await;
    t.copy_thumbnails();
    // The shared test models, and faces in-process; every other service
    // stays on the mock.
    let ml = lp_ml::Ml::new(
        lp_ml::MlConfig::new(golden::ml_root().join("protected_media")),
        Arc::new(|| lp_ml::Selection {
            face_recognition_model: "buffalo_sc".into(),
            ..Default::default()
        }),
    );
    ml.set_mode(Service::Face, Mode::InProcess);
    ml.set_auto_download(false);
    t.state.ml = ml;
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;

    sqlx::query(
        "UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN \
         (SELECT f.id FROM api_face f JOIN api_photo p ON p.id = f.photo_id WHERE p.owner_id = $1)",
    )
    .bind(alice)
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(
        "DELETE FROM api_face f USING api_photo p WHERE p.id = f.photo_id AND p.owner_id = $1",
    )
    .bind(alice)
    .execute(&db)
    .await
    .unwrap();
    // Photos with a main file (extract_faces refuses the others) and no XMP
    // face regions (those are used instead of detection).
    let photos: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT p.id, t.thumbnail_big FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id \
         JOIN api_file f ON f.hash = p.main_file_id \
         WHERE p.owner_id = $1 AND t.thumbnail_big <> '' AND f.path NOT LIKE '%sidecar%' \
         ORDER BY p.id",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    assert!(
        photos.len() >= g.cases.len(),
        "alice has {} thumbnails",
        photos.len()
    );
    let media_root = t.state.config.media_root.clone();
    for ((_, thumb), c) in photos.iter().zip(&g.cases) {
        let dst = lp_tasks::photos::media_path(&media_root, thumb);
        std::fs::copy(c.input["source"].as_str().unwrap(), &dst).unwrap();
    }

    let started = std::time::Instant::now();
    let (res, lrj) = run_job(
        &t.state,
        "faces.scan",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::ScanFaces, alice),
    )
    .await;
    res.unwrap();
    let elapsed = started.elapsed();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished, "{j:?}");

    let mut faces_total = 0;
    let mut exact = 0;
    let mut min_iou = 1.0f64;
    let mut min_cos = 1.0f64;
    for ((photo, _), c) in photos.iter().zip(&g.cases) {
        let rows: Vec<(i32, i32, i32, i32, String)> = sqlx::query_as(
            "SELECT location_top, location_right, location_bottom, location_left, encoding \
             FROM api_face WHERE photo_id = $1 ORDER BY id",
        )
        .bind(photo)
        .fetch_all(&db)
        .await
        .unwrap();
        let want_locs: Vec<FaceBox> = c.output["face_locations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                let v: Vec<i32> = l
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|x| x.as_i64().unwrap() as i32)
                    .collect();
                [v[0], v[1], v[2], v[3]]
            })
            .collect();
        assert_eq!(rows.len(), want_locs.len(), "{}: stored faces", c.id);
        for (i, (top, right, bottom, left, enc)) in rows.iter().enumerate() {
            faces_total += 1;
            let got = [*top, *right, *bottom, *left];
            let want = want_locs[i];
            if got == want {
                exact += 1;
            }
            let iou = golden::iou_trbl(got.map(f64::from), want.map(f64::from));
            assert!(iou >= 0.95, "{} face {i}: {got:?} vs {want:?}", c.id);
            min_iou = min_iou.min(iou);
            let stored: Vec<f32> = FaceEncoding::decode(enc)
                .expect("an encoding is stored")
                .into_iter()
                .map(|v| v as f32)
                .collect();
            let want_enc = Array::from_json(&c.output["encodings"][i]).f32();
            let cos = golden::cosine(&stored, &want_enc);
            assert!(cos >= 0.99, "{} face {i}: cosine {cos}", c.id);
            min_cos = min_cos.min(cos);
        }
    }
    eprintln!(
        "faces.scan in-process: {} photos, {faces_total} faces ({exact} identical boxes), \
         min IoU {min_iou:.4}, min cosine {min_cos:.6}, {:.1}s",
        photos.len(),
        elapsed.as_secs_f64()
    );
    assert!(faces_total > 20);
    t.cleanup().await;
}

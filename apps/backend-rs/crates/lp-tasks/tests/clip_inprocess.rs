//! clip.embed + similarity.build with the in-process CLIP model and index on
//! a fixture clone, checked against the Python goldens, then semantic
//! search and the photo detail's similar photos through the API, and the
//! startup rebuild. Skipped without `LP_ORT_LIB`, the model or the goldens.

#![allow(clippy::disallowed_methods, clippy::type_complexity)]

mod common;

use std::path::Path;
use std::time::Instant;

use common::*;
use lp_jobs::{EnqueueOptions, JobType};
use lp_ml::golden::{self, Array};
use lp_ml::{Mode, Service};
use serde_json::{Value, json};
use uuid::Uuid;

/// Hard links (same volume, no copy) of the shared CLIP model into `media_root`.
fn link_model(media_root: &Path) -> bool {
    let from = golden::data_models().join("clip_vit_b32");
    let to = media_root.join("data_models").join("clip_vit_b32");
    std::fs::create_dir_all(&to).unwrap();
    for f in ["vision_model.onnx", "text_model.onnx", "tokenizer.json"] {
        let (src, dst) = (from.join(f), to.join(f));
        if dst.exists() {
            continue;
        }
        if std::fs::hard_link(&src, &dst).is_err() && std::fs::copy(&src, &dst).is_err() {
            return false;
        }
    }
    true
}

#[tokio::test]
async fn inprocess_clip_embed_index_and_search() {
    if std::env::var_os("LP_ORT_LIB").is_none() && std::env::var_os("ORT_DYLIB_PATH").is_none() {
        eprintln!("no LP_ORT_LIB; skipping");
        return;
    }
    if !golden::data_models()
        .join("clip_vit_b32/vision_model.onnx")
        .is_file()
    {
        eprintln!("no CLIP model; skipping");
        return;
    }
    let Some(g) = golden::load("clip", "images") else {
        return;
    };
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    assert!(link_model(&t.state.config.media_root));
    t.state.ml.set_mode(Service::Clip, Mode::InProcess);
    t.state.ml.set_mode(Service::Similarity, Mode::InProcess);
    // This test covers CLIP ViT-B/32 (MobileCLIP-S2 is the default).
    lp_db::write::settings::save(
        &t.state,
        &[("SEMANTIC_SEARCH_MODEL", json!("clip_vit_b32"))],
    )
    .await
    .unwrap();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    sqlx::query(
        "UPDATE api_photo SET clip_embeddings = NULL, clip_embeddings_magnitude = NULL WHERE owner_id = $1",
    )
    .bind(alice)
    .execute(&db)
    .await
    .unwrap();

    let started = Instant::now();
    let (res, lrj) = run_job(
        &t.state,
        "clip.embed",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::CalculateClipEmbeddings, alice),
    )
    .await;
    res.unwrap();
    eprintln!(
        "clip.embed (model load + index) {:.2}s",
        started.elapsed().as_secs_f64()
    );
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    assert!(
        t.mock.calls_to("/clip-embeddings").is_empty(),
        "no sidecar call"
    );
    assert!(t.mock.calls_to("/build/").is_empty(), "no sidecar call");

    // Every stored embedding is the Python sidecar's for that thumbnail.
    let rows: Vec<(Uuid, String, Option<Value>, Option<f64>, Option<String>)> = sqlx::query_as(
        "SELECT p.id, p.image_hash, p.clip_embeddings, p.clip_embeddings_magnitude, t.thumbnail_big \
         FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.owner_id = $1",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    let (mut compared, mut worst) = (0, 1.0f64);
    let mut embedded = Vec::new();
    for (id, hash, emb, mag, thumb) in &rows {
        let Some(emb) = emb else {
            assert!(
                thumb.as_deref().is_none_or(str::is_empty),
                "{hash} lacks an embedding"
            );
            continue;
        };
        embedded.push((*id, hash.clone()));
        let got: Vec<f32> = emb
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap() as f32)
            .collect();
        let case_id = format!("protected_media/thumbnails_big/{hash}.webp");
        let Some(c) = g.cases.iter().find(|c| c.id == case_id) else {
            continue;
        };
        let want = Array::from_json(&c.output["embedding"]).f32();
        let cos = golden::cosine(&got, &want);
        worst = worst.min(cos);
        golden::assert_cosine(&got, &want, 0.9999, hash);
        let want_mag = c.output["magnitude"].as_f64().unwrap();
        assert!(
            (mag.unwrap() - want_mag).abs() / want_mag < 1e-4,
            "{hash} magnitude"
        );
        compared += 1;
    }
    eprintln!("{compared} stored embeddings vs Python: min cosine {worst:.8}");
    assert!(compared > 0);

    let media_root = t.state.config.media_root.clone();
    let indexed: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_photo WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL",
    )
    .bind(alice)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(indexed > 0);
    assert_eq!(
        lp_ml::similarity::stored_len(&media_root, alice),
        Some(indexed as u64)
    );

    // A rebuild in several pages (keyset paging, the last one partial or
    // full) writes the same index as one page.
    let index_file = media_root.join("similarity").join(format!("{alice}.f32"));
    let one_page = std::fs::read(&index_file).unwrap();
    // It holds the stored embeddings, as float32, in image_hash order.
    let idx = lp_ml::similarity::FlatIndex::from_bytes(&one_page).unwrap();
    let want: Vec<(String, Vec<f32>)> = sqlx::query_as::<_, (String, Value)>(
        "SELECT image_hash, clip_embeddings FROM api_photo \
         WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL ORDER BY image_hash",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap()
    .into_iter()
    .map(|(h, e)| {
        let v = e
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap() as f32)
            .collect();
        (h, v)
    })
    .collect();
    assert_eq!(
        idx.hashes(),
        want.iter().map(|w| w.0.clone()).collect::<Vec<_>>()
    );
    for (i, (h, v)) in want.iter().enumerate() {
        assert_eq!(idx.vector(i), v.as_slice(), "{h}");
    }
    for page_size in [7, indexed as usize / 3, 1] {
        let size = lp_tasks::clip::build_index_paged(&t.state, alice, page_size)
            .await
            .unwrap();
        assert_eq!(size, indexed);
        assert_eq!(
            std::fs::read(&index_file).unwrap(),
            one_page,
            "pages of {page_size}"
        );
    }

    // Semantic search and similar photos through the API.
    let user = lp_db::users::by_id(&db, alice).await.unwrap().unwrap();
    let token = t.app.token_for(&user);
    let r = t
        .app
        .get("/api/photos/searchlist?search=photo", Some(&token))
        .await;
    assert_eq!(r.status, 200, "{}", r.text());
    let (id, hash) = &embedded[0];
    let r = t.app.get(&format!("/api/photos/{id}"), Some(&token)).await;
    assert_eq!(r.status, 200, "{}", r.text());
    let similar: Vec<String> = r.json()["similar_photos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["image_hash"].as_str().unwrap().to_string())
        .collect();
    assert!(
        similar.contains(hash),
        "a photo is similar to itself: {similar:?}"
    );

    // Startup: a missing index is rebuilt from the database, a current one kept.
    std::fs::remove_file(media_root.join("similarity").join(format!("{alice}.f32"))).unwrap();
    let rebuilt = lp_tasks::clip::rebuild_stale_indices(&t.state)
        .await
        .unwrap();
    assert_eq!(rebuilt, 1);
    assert_eq!(
        lp_ml::similarity::stored_len(&media_root, alice),
        Some(indexed as u64)
    );
    assert_eq!(
        lp_tasks::clip::rebuild_stale_indices(&t.state)
            .await
            .unwrap(),
        0
    );

    t.cleanup().await;
}

//! Which model produced a stored CLIP embedding (`clip_embeddings_model`,
//! NULL = Django's ViT-B/32): the startup/settings check, `clip.embed` and the
//! similarity index decide on that column alone, never on the magnitude, and
//! never NULL an embedding to switch models. Against the mock sidecars, so
//! the selected model is ViT-B/32 (the CLIP sidecar only runs that).

#![allow(clippy::disallowed_methods)]

mod common;

use common::*;
use lp_jobs::{EnqueueOptions, JobType};
use lp_ml::clip::SemanticModel;
use serde_json::{Value, json};
use sqlx::Connection;

async fn embedded(db: &sqlx::PgPool, owner: i32) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM api_photo WHERE owner_id = $1 AND clip_embeddings IS NOT NULL",
    )
    .bind(owner)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn queued_embeds(db: &sqlx::PgPool, owner: i32) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM job_queue WHERE kind = 'clip.embed' AND status = 'queued' \
           AND payload->'user_id' = to_jsonb($1::int)",
    )
    .bind(owner)
    .fetch_one(db)
    .await
    .unwrap()
}

/// Image hashes of the last `/build/` request.
fn last_build(t: &TasksApp) -> Vec<String> {
    let builds = t.mock.calls_to("/build/");
    let b = builds.last().expect("an index build");
    b["image_hashes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

async fn hashes(db: &sqlx::PgPool, sql: &str, owner: i32) -> Vec<String> {
    sqlx::query_scalar(sql)
        .bind(owner)
        .fetch_all(db)
        .await
        .unwrap()
}

#[tokio::test]
async fn embeddings_are_told_apart_by_their_recorded_model() {
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let vit = SemanticModel::ClipVitB32;
    assert_eq!(
        t.state.ml().semantic_model(),
        vit,
        "the CLIP sidecar is ViT-B/32"
    );

    // A Django-written library: no model recorded (NULL = ViT-B/32), and a
    // magnitude of 1 that the old heuristic took for MobileCLIP and dropped
    // (the contract fixture's synthetic embeddings look like this).
    sqlx::query(
        "UPDATE api_photo SET clip_embeddings_magnitude = 1, clip_embeddings_model = NULL, \
           clip_embeddings = (SELECT jsonb_agg(round(((i * 37) % 200) / 100.0 - 1, 2)) \
                              FROM generate_series(1, 512) i) \
         WHERE owner_id = $1",
    )
    .bind(alice)
    .execute(&db)
    .await
    .unwrap();
    let total = embedded(&db, alice).await;
    assert!(total > 10);

    assert!(
        lp_tasks::clip::mismatched_owners(&db, vit)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        lp_tasks::clip::reembed_mismatched(&t.state).await.unwrap(),
        0
    );
    assert_eq!(queued_embeds(&db, alice).await, 0);
    assert_eq!(embedded(&db, alice).await, total, "nothing dropped");
    lp_tasks::clip::build_index(&t.state, alice).await.unwrap();
    let visible = hashes(
        &db,
        "SELECT image_hash FROM api_photo WHERE owner_id = $1 AND NOT hidden ORDER BY image_hash",
        alice,
    )
    .await;
    assert_eq!(last_build(&t), visible, "NULL counts as ViT-B/32");

    // Five photos (with thumbnails) carry MobileCLIP embeddings, e.g. from a
    // Rust run with the other setting: mismatched for ViT-B/32 only.
    sqlx::query(
        "UPDATE api_photo SET clip_embeddings_model = 'mobileclip_s2' WHERE id IN ( \
           SELECT p.id FROM api_photo p JOIN api_thumbnail th ON th.photo_id = p.id \
           WHERE p.owner_id = $1 AND NOT p.hidden AND th.thumbnail_big <> '' \
           ORDER BY p.id LIMIT 5)",
    )
    .bind(alice)
    .execute(&db)
    .await
    .unwrap();
    let mc_sql = "SELECT image_hash FROM api_photo WHERE owner_id = $1 \
                  AND clip_embeddings_model = 'mobileclip_s2' ORDER BY image_hash";
    let converted = hashes(&db, mc_sql, alice).await;
    assert_eq!(converted.len(), 5);
    assert_eq!(
        lp_tasks::clip::mismatched_owners(&db, vit).await.unwrap(),
        vec![alice]
    );
    assert_eq!(
        lp_tasks::clip::mismatched_owners(&db, SemanticModel::MobileClipS2)
            .await
            .unwrap(),
        vec![alice],
        "the NULL rows are ViT-B/32"
    );

    // The check queues one re-embedding (not two) and deletes nothing.
    assert_eq!(
        lp_tasks::clip::reembed_mismatched(&t.state).await.unwrap(),
        1
    );
    assert_eq!(
        lp_tasks::clip::reembed_mismatched(&t.state).await.unwrap(),
        0
    );
    assert_eq!(queued_embeds(&db, alice).await, 1);
    assert_eq!(embedded(&db, alice).await, total, "nothing dropped");

    // The index leaves the other model's embeddings out until replaced.
    t.mock.clear();
    lp_tasks::clip::build_index(&t.state, alice).await.unwrap();
    let indexed = last_build(&t);
    assert_eq!(indexed.len(), visible.len() - 5);
    assert!(converted.iter().all(|h| !indexed.contains(h)));

    // clip.embed re-embeds exactly those five in place, and rebuilds the
    // index first (without them) and at the end (with them).
    t.mock.clear();
    let res = run_queued(&t.state, "clip.embed").await.expect("queued");
    res.unwrap();
    let sent: Vec<String> = t
        .mock
        .calls_to("/clip-embeddings")
        .iter()
        .flat_map(|r| {
            r["imgs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| basename(v.as_str().unwrap()))
                .collect::<Vec<_>>()
        })
        .collect();
    let mut sent_hashes: Vec<String> = sent
        .iter()
        .map(|f| f.trim_end_matches(".webp").to_string())
        .collect();
    sent_hashes.sort();
    assert_eq!(sent_hashes, converted);
    let builds = t.mock.calls_to("/build/");
    assert_eq!(builds.len(), 2, "one rebuild before, one after");
    assert_eq!(
        builds[0]["image_hashes"].as_array().unwrap().len(),
        visible.len() - 5
    );
    assert_eq!(last_build(&t), visible);

    assert_eq!(embedded(&db, alice).await, total, "nothing dropped");
    assert!(hashes(&db, mc_sql, alice).await.is_empty());
    let rows: Vec<(String, Value, Option<String>)> = sqlx::query_as(
        "SELECT image_hash, clip_embeddings, clip_embeddings_model FROM api_photo \
         WHERE owner_id = $1 AND image_hash = ANY($2)",
    )
    .bind(alice)
    .bind(&converted)
    .fetch_all(&db)
    .await
    .unwrap();
    for (hash, emb, model) in rows {
        assert_eq!(model.as_deref(), Some("clip_vit_b32"), "{hash}");
        assert_eq!(emb, json!(vector(&format!("{hash}.webp"), DIM)), "{hash}");
    }
    assert!(
        lp_tasks::clip::mismatched_owners(&db, vit)
            .await
            .unwrap()
            .is_empty()
    );

    // A full run re-embeds everything in place: never a NULL in between.
    t.mock.clear();
    let (res, _) = run_job(
        &t.state,
        "clip.embed",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::CalculateClipEmbeddings, alice),
    )
    .await;
    res.unwrap();
    assert_eq!(embedded(&db, alice).await, total);
    assert_eq!(
        t.mock.calls_to("/build/").len(),
        1,
        "no other model: one rebuild"
    );
    t.cleanup().await;
}

#[tokio::test]
async fn a_foreign_writer_changing_an_embedding_resets_its_model() {
    let t = TasksApp::new().await;
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let id: uuid::Uuid =
        sqlx::query_scalar("SELECT id FROM api_photo WHERE owner_id = $1 ORDER BY id LIMIT 1")
            .bind(alice)
            .fetch_one(&db)
            .await
            .unwrap();
    let model = |db: sqlx::PgPool| async move {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT clip_embeddings_model FROM api_photo WHERE id = $1",
        )
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap()
    };
    let set = "UPDATE api_photo SET clip_embeddings = $2 WHERE id = $1";

    // librephotos-rs connections set the column themselves.
    sqlx::query(
        "UPDATE api_photo SET clip_embeddings = $2, clip_embeddings_model = 'mobileclip_s2' \
         WHERE id = $1",
    )
    .bind(id)
    .bind(json!([0.25, 0.5]))
    .execute(&db)
    .await
    .unwrap();
    sqlx::query(set)
        .bind(id)
        .bind(json!([0.5, 0.25]))
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(model(db.clone()).await.as_deref(), Some("mobileclip_s2"));

    // Django (any other application_name) saves whole rows without the column.
    let opts = t
        .app
        .db
        .server
        .options(&t.app.db.name)
        .application_name("django");
    let mut django = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    // A save that leaves the embedding as it was keeps the model ...
    sqlx::query(set)
        .bind(id)
        .bind(json!([0.5, 0.25]))
        .execute(&mut django)
        .await
        .unwrap();
    sqlx::query("UPDATE api_photo SET rating = rating WHERE id = $1")
        .bind(id)
        .execute(&mut django)
        .await
        .unwrap();
    assert_eq!(model(db.clone()).await.as_deref(), Some("mobileclip_s2"));
    // ... one that writes another embedding (its ViT-B/32) clears it.
    sqlx::query(set)
        .bind(id)
        .bind(json!([1.5, 2.5]))
        .execute(&mut django)
        .await
        .unwrap();
    assert_eq!(model(db.clone()).await, None);
    assert_eq!(
        SemanticModel::stored(None),
        Some(SemanticModel::ClipVitB32),
        "so it counts as ViT-B/32"
    );
    django.close().await.unwrap();
    t.cleanup().await;
}

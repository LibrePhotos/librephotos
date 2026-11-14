//! Event-album generation (port of `api/autoalbum.py`) against the fixture,
//! whose auto albums were made by Django's real `generate_event_albums`.

#![allow(clippy::disallowed_methods)]

use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use lp_db::write::albums_tags::auto_albums;
use lp_testkit::TestApp;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, PartialEq)]
struct Snapshot {
    title: String,
    timestamp: DateTime<Utc>,
    gps: Option<(i64, i64)>,
    photos: BTreeSet<Uuid>,
}

type AlbumRow = (i32, String, DateTime<Utc>, Option<f64>, Option<f64>);

async fn snapshot(db: &PgPool, owner: i32) -> Vec<Snapshot> {
    let albums: Vec<AlbumRow> = sqlx::query_as(
        "SELECT id, title, timestamp, gps_lat, gps_lon FROM api_albumauto WHERE owner_id = $1 ORDER BY timestamp",
    )
    .bind(owner)
    .fetch_all(db)
    .await
    .unwrap();
    let mut out = Vec::new();
    for (id, title, timestamp, lat, lon) in albums {
        let photos: Vec<Uuid> =
            sqlx::query_scalar("SELECT photo_id FROM api_albumauto_photos WHERE albumauto_id = $1")
                .bind(id)
                .fetch_all(db)
                .await
                .unwrap();
        out.push(Snapshot {
            title,
            timestamp,
            gps: lat
                .zip(lon)
                .map(|(a, b)| ((a * 1e6).round() as i64, (b * 1e6).round() as i64)),
            photos: photos.into_iter().collect(),
        });
    }
    out
}

async fn user_id(db: &PgPool, name: &str) -> Option<i32> {
    sqlx::query_scalar("SELECT id FROM api_user WHERE username = $1")
        .bind(name)
        .fetch_optional(db)
        .await
        .unwrap()
}

#[tokio::test]
async fn regenerating_from_scratch_reproduces_djangos_albums() {
    let app = TestApp::new().await;
    let db = app.pool();
    let Some(alice) = user_id(db, "alice").await else {
        app.cleanup().await;
        return; // empty template: nothing to compare against
    };
    let before = snapshot(db, alice).await;
    assert!(!before.is_empty());

    auto_albums::delete_all(db, alice).await.unwrap();
    assert!(snapshot(db, alice).await.is_empty());
    auto_albums::generate_event_albums(db, alice).await.unwrap();
    assert_eq!(snapshot(db, alice).await, before);

    // A second run finds every album again: nothing new, same titles.
    let ids: Vec<i32> =
        sqlx::query_scalar("SELECT id FROM api_albumauto WHERE owner_id = $1 ORDER BY id")
            .bind(alice)
            .fetch_all(db)
            .await
            .unwrap();
    auto_albums::generate_event_albums(db, alice).await.unwrap();
    let again: Vec<i32> =
        sqlx::query_scalar("SELECT id FROM api_albumauto WHERE owner_id = $1 ORDER BY id")
            .bind(alice)
            .fetch_all(db)
            .await
            .unwrap();
    assert_eq!(ids, again);
    assert_eq!(snapshot(db, alice).await, before);

    // Titles regenerate to the same text.
    for (id, ts) in auto_albums::title_targets(db, alice).await.unwrap() {
        auto_albums::retitle(db, id, ts).await.unwrap();
    }
    assert_eq!(snapshot(db, alice).await, before);
    app.cleanup().await;
}

#[tokio::test]
async fn split_albums_are_merged_into_the_oldest() {
    let app = TestApp::new().await;
    let db = app.pool();
    let Some(alice) = user_id(db, "alice").await else {
        app.cleanup().await;
        return;
    };
    let before = snapshot(db, alice).await;
    // Split the biggest album: move half of its photos to a younger album.
    let (album, favorited): (i32, bool) = sqlx::query_as(
        "SELECT a.id, a.favorited FROM api_albumauto a WHERE owner_id = $1 ORDER BY \
           (SELECT count(*) FROM api_albumauto_photos l WHERE l.albumauto_id = a.id) DESC, id LIMIT 1",
    )
    .bind(alice)
    .fetch_one(db)
    .await
    .unwrap();
    assert!(!favorited);
    let split: i32 = sqlx::query_scalar(
        "INSERT INTO api_albumauto (title, timestamp, created_on, favorited, owner_id, last_modified) \
         VALUES ('Split', '1990-01-01T00:00:00Z', now(), TRUE, $1, now()) RETURNING id",
    )
    .bind(alice)
    .fetch_one(db)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE api_albumauto_photos SET albumauto_id = $2 WHERE id IN ( \
           SELECT l.id FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id \
           WHERE l.albumauto_id = $1 ORDER BY p.exif_timestamp DESC LIMIT 1)",
    )
    .bind(album)
    .bind(split)
    .execute(db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO api_albumauto_shared_to (albumauto_id, user_id) SELECT $1, id FROM api_user WHERE username = 'bob'")
        .bind(split)
        .execute(db)
        .await
        .unwrap();

    auto_albums::generate_event_albums(db, alice).await.unwrap();
    let after = snapshot(db, alice).await;
    assert_eq!(after, before);
    let gone: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM api_albumauto WHERE id = $1)")
            .bind(split)
            .fetch_one(db)
            .await
            .unwrap();
    assert!(!gone, "the younger duplicate is merged away");
    let (fav, shared): (bool, i64) = sqlx::query_as(
        "SELECT a.favorited, (SELECT count(*) FROM api_albumauto_shared_to s WHERE s.albumauto_id = a.id) \
         FROM api_albumauto a WHERE a.id = $1",
    )
    .bind(album)
    .fetch_one(db)
    .await
    .unwrap();
    assert!(fav, "favorited carries over");
    assert_eq!(shared, 1, "shares carry over");
    app.cleanup().await;
}

/// Runs the Rust generator for `LP_GEN_USER` on the existing database
/// `LP_GEN_DB`, for diffing against Django's run on a twin clone
/// (`LP_GEN_TITLES=1` runs `regenerate_event_titles` instead).
#[tokio::test]
#[ignore]
async fn run_on_database() {
    let name = std::env::var("LP_GEN_DB").expect("LP_GEN_DB");
    let user = std::env::var("LP_GEN_USER").expect("LP_GEN_USER");
    let app = TestApp::attach(&name, &[]).await;
    let db = app.pool();
    let uid = user_id(db, &user).await.expect("user");
    if std::env::var("LP_GEN_TITLES").is_ok() {
        for (id, ts) in auto_albums::title_targets(db, uid).await.unwrap() {
            auto_albums::retitle(db, id, ts).await.unwrap();
        }
    } else {
        auto_albums::generate_event_albums(db, uid).await.unwrap();
    }
    app.cleanup().await;
}

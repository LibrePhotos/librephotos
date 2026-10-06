//! clip.embed, similarity.build and geo.locate on a fixture clone against
//! the mock sidecars (and a mock Nominatim).

#![allow(clippy::disallowed_methods, clippy::type_complexity)]

mod common;

use common::*;
use lp_jobs::{EnqueueOptions, JobType};
use lp_tasks::geocode::Provider;
use serde_json::{Value, json};
use uuid::Uuid;

#[tokio::test]
async fn clip_embed_stores_embeddings_and_builds_the_index() {
    let t = TasksApp::new().await;
    t.copy_thumbnails();
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    lp_db::sql::query(
        "UPDATE api_photo SET clip_embeddings = NULL, clip_embeddings_magnitude = NULL WHERE owner_id = $1",
    )
    .bind(alice)
    .execute(&db)
    .await
    .unwrap();
    let missing: i64 =
        lp_db::sql::query_scalar("SELECT count(*) FROM api_photo WHERE owner_id = $1")
            .bind(alice)
            .fetch_one(&db)
            .await
            .unwrap();
    t.mock.knobs.lock().unwrap().clip_null_every = Some(10);

    let (res, lrj) = run_job(
        &t.state,
        "clip.embed",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::CalculateClipEmbeddings, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    assert_eq!(j.job_type, 6);
    assert_eq!(
        (j.progress_current as i64, j.progress_target as i64),
        (missing, missing)
    );

    let requests = t.mock.calls_to("/clip-embeddings");
    let sent: Vec<String> = requests
        .iter()
        .flat_map(|r| {
            r["imgs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
        })
        .collect();
    assert!(
        requests
            .iter()
            .all(|r| r["imgs"].as_array().unwrap().len() <= 64)
    );
    assert!(
        requests[0]["model"]
            .as_str()
            .unwrap()
            .ends_with("clip_vit_b32")
    );
    let rows: Vec<(String, Option<Value>, Option<f64>, Option<String>)> = lp_db::sql::query_as(
        "SELECT p.image_hash, p.clip_embeddings, p.clip_embeddings_magnitude, t.thumbnail_big \
         FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.owner_id = $1",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    let mut stored = 0;
    for (hash, emb, mag, thumb) in &rows {
        let file = format!("{hash}.webp");
        let was_sent = sent.iter().any(|s| s.ends_with(&file));
        if thumb.as_deref().is_none_or(str::is_empty) {
            assert!(!was_sent && emb.is_none(), "{hash}");
            continue;
        }
        if let Some(emb) = emb {
            let v = vector(&file, DIM);
            assert_eq!(emb, &json!(v));
            let m = v.iter().map(|x| x * x).sum::<f64>().sqrt();
            assert_eq!(*mag, Some(m));
            stored += 1;
        }
    }
    assert!(
        stored > 0 && stored < rows.len(),
        "the mock leaves some unreadable"
    );

    // One rebuild page, sorted by hash, of the non-hidden embedded photos.
    let builds = t.mock.calls_to("/build/");
    assert_eq!(builds.len(), 1);
    let b = &builds[0];
    assert_eq!(
        (
            b["begin"].clone(),
            b["commit"].clone(),
            b["user_id"].clone()
        ),
        (json!(true), json!(true), json!(alice))
    );
    let hashes: Vec<String> = b["image_hashes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().into())
        .collect();
    let mut sorted = hashes.clone();
    sorted.sort();
    assert_eq!(hashes, sorted);
    let expected: Vec<String> = lp_db::sql::query_scalar(
        "SELECT image_hash FROM api_photo WHERE owner_id = $1 AND NOT hidden AND clip_embeddings IS NOT NULL ORDER BY image_hash",
    )
    .bind(alice)
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(hashes, expected);
    assert_eq!(
        b["image_embeddings"].as_array().unwrap().len(),
        hashes.len()
    );

    // A refused page fails the job (the embeddings stay).
    t.mock.knobs.lock().unwrap().build_refuse = true;
    let (res, lrj) = run_job(
        &t.state,
        "clip.embed",
        json!({"user_id": alice}),
        EnqueueOptions::tracked(JobType::CalculateClipEmbeddings, alice),
    )
    .await;
    assert!(res.is_err());
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.failed);
    let err = j.result.unwrap()["error"].as_str().unwrap().to_string();
    assert!(
        err.starts_with("page 1 of 1 of the similarity index of alice was refused"),
        "{err}"
    );

    // similarity.build alone, and for a user without embeddings (one empty page).
    t.mock.knobs.lock().unwrap().build_refuse = false;
    t.mock.clear();
    let dave = user_id(&db, "dave").await;
    lp_db::sql::query("UPDATE api_photo SET clip_embeddings = NULL WHERE owner_id = $1")
        .bind(dave)
        .execute(&db)
        .await
        .unwrap();
    for user in [alice, dave] {
        let (res, lrj) = run_job(
            &t.state,
            "similarity.build",
            json!({"user_id": user}),
            EnqueueOptions::default(),
        )
        .await;
        res.unwrap();
        assert!(lrj.is_none());
    }
    let builds = t.mock.calls_to("/build/");
    assert_eq!(builds[1]["image_hashes"], json!([]));
    assert_eq!(builds[1]["commit"], json!(true));
    t.cleanup().await;
}

#[tokio::test]
async fn geo_locate_reverse_geocodes_into_places() {
    if exiftool().is_none() {
        eprintln!("no exiftool on this machine; skipping");
        return;
    }
    let t = TasksApp::new().await;
    lp_tasks::geocode::providers::set_base_url(Provider::Nominatim, &t.base);
    let db = t.db().clone();
    let alice = user_id(&db, "alice").await;
    let m = manifest();
    let berlin: Uuid = m["photos"]["alice/berlin_01"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let tokyo: Uuid = m["photos"]["alice/tokyo_01"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    // Forget what the fixture geocoded.
    lp_db::sql::query("UPDATE api_photo SET geolocation_json = NULL, exif_gps_lat = NULL, exif_gps_lon = NULL WHERE owner_id = $1")
        .bind(alice)
        .execute(&db)
        .await
        .unwrap();
    lp_db::sql::query("DELETE FROM api_albumplace_photos WHERE photo_id IN (SELECT id FROM api_photo WHERE owner_id = $1)")
        .bind(alice)
        .execute(&db)
        .await
        .unwrap();

    let (res, lrj) = run_job(
        &t.state,
        "geo.locate",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::AddGeolocation, alice),
    )
    .await;
    res.unwrap();
    let j = job(&db, lrj.as_deref().unwrap()).await;
    assert!(j.finished && !j.failed, "{j:?}");
    assert_eq!(j.job_type, 11);
    assert_eq!(t.mock.calls_to("/reverse").len(), 3, "the three GPS photos");
    let call = &t.mock.calls_to("/reverse")[0];
    assert_eq!(
        (call["format"].as_str(), call["addressdetails"].as_str()),
        (Some("json"), Some("1"))
    );

    let (geo, lat, lon): (Value, f64, f64) = lp_db::sql::query_as(
        "SELECT geolocation_json, exif_gps_lat, exif_gps_lon FROM api_photo WHERE id = $1",
    )
    .bind(berlin)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!((lat, lon), (52.5163, 13.3777));
    assert_eq!(
        geo["places"],
        json!(["Mock Street", "12345", "Berlin", "Berlin", "Deutschland"])
    );
    assert_eq!(geo["center"], json!([52.5163, 13.3777]));
    assert_eq!(geo["_v"], "1");
    assert_eq!(geo["address"], "Mock Street 1, Berlin, Deutschland");
    let search: String = lp_db::sql::query_scalar(
        "SELECT search_location FROM api_photo_search WHERE photo_id = $1",
    )
    .bind(berlin)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(search, "Mock Street 1, Berlin, Deutschland");

    // Places albums: no numeric titles, level = distance from the end.
    let places: Vec<(String, Option<i32>)> = lp_db::sql::query_as(
        "SELECT a.title, a.geolocation_level FROM api_albumplace a \
         JOIN api_albumplace_photos l ON l.albumplace_id = a.id WHERE l.photo_id = $1 ORDER BY a.title",
    )
    .bind(berlin)
    .fetch_all(&db)
    .await
    .unwrap();
    let titles: Vec<&str> = places.iter().map(|p| p.0.as_str()).collect();
    assert_eq!(titles, vec!["Berlin", "Deutschland", "Mock Street"]);
    let tokyo_places: i64 =
        lp_db::sql::query_scalar("SELECT count(*) FROM api_albumplace_photos WHERE photo_id = $1")
            .bind(tokyo)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(tokyo_places, 3);

    // The day album learned the city.
    let loc: Option<Value> = lp_db::sql::query_scalar(
        "SELECT a.location FROM api_albumdate a JOIN api_albumdate_photos l ON l.albumdate_id = a.id \
         WHERE l.photo_id = $1",
    )
    .bind(berlin)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(
        loc.unwrap()["places"]
            .as_array()
            .unwrap()
            .contains(&json!("Berlin"))
    );

    // Up to date: a second run calls nobody, but (as Django's
    // geolocation_job) still files the stored city under the day album.
    lp_db::sql::query(
        "UPDATE api_albumdate SET location = NULL WHERE id IN (            SELECT albumdate_id FROM api_albumdate_photos WHERE photo_id = $1)",
    )
    .bind(berlin)
    .execute(&db)
    .await
    .unwrap();
    t.mock.clear();
    let (res, _) = run_job(
        &t.state,
        "geo.locate",
        json!({"user_id": alice, "full_scan": true}),
        EnqueueOptions::tracked(JobType::AddGeolocation, alice),
    )
    .await;
    res.unwrap();
    assert!(t.mock.calls_to("/reverse").is_empty());
    let loc: Option<Value> = lp_db::sql::query_scalar(
        "SELECT a.location FROM api_albumdate a JOIN api_albumdate_photos l ON l.albumdate_id = a.id          WHERE l.photo_id = $1",
    )
    .bind(berlin)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(
        loc.expect("day album location")["places"]
            .as_array()
            .unwrap()
            .contains(&json!("Berlin"))
    );

    // Forward search for /api/geocode/search.
    let found = lp_tasks::geocode::search_location(&t.state, "Berlin", 5).await;
    assert!(
        found.is_empty(),
        "the mock has no /search: errors read as no results"
    );
    t.cleanup().await;
}

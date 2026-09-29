//! `photo_edits` endpoints on a private clone of the fixture template
//! (`lp_fixture`, see `apps/backend-rs/tests/README.md`).

#![allow(clippy::disallowed_methods)]

use axum::http::StatusCode;
use lp_testkit::TestApp;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

fn manifest() -> Value {
    let path = std::env::var("LP_MANIFEST")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json".into());
    serde_json::from_slice(&std::fs::read(path).expect("fixture manifest")).expect("manifest json")
}

struct Photo {
    id: Uuid,
    hash: String,
}

fn photo(m: &Value, key: &str) -> Photo {
    let p = &m["photos"][key];
    Photo {
        id: p["id"].as_str().unwrap().parse().unwrap(),
        hash: p["image_hash"].as_str().unwrap().to_string(),
    }
}

struct Ctx {
    app: TestApp,
    m: Value,
    alice: String,
    bob: String,
}

async fn setup() -> Ctx {
    let app = TestApp::new().await;
    let m = manifest();
    let alice = lp_db::users::by_username(app.pool(), "alice")
        .await
        .unwrap()
        .unwrap();
    let bob = lp_db::users::by_username(app.pool(), "bob")
        .await
        .unwrap()
        .unwrap();
    let alice = app.token_for(&alice);
    let bob = app.token_for(&bob);
    Ctx { app, m, alice, bob }
}

/// Point every stored file path into this test's temp dir (and create the
/// files), so nothing here can touch the shared fixture media.
async fn isolate_media(app: &TestApp) -> std::path::PathBuf {
    let dir = app.base_path().join("files");
    std::fs::create_dir_all(&dir).unwrap();
    let hashes: Vec<String> = sqlx::query_scalar("SELECT hash FROM api_file")
        .fetch_all(app.pool())
        .await
        .unwrap();
    for h in &hashes {
        std::fs::write(dir.join(format!("{h}.jpg")), b"x").unwrap();
    }
    sqlx::query("UPDATE api_file SET path = $1 || hash || '.jpg'")
        .bind(format!("{}{}", dir.display(), std::path::MAIN_SEPARATOR))
        .execute(app.pool())
        .await
        .unwrap();
    dir
}

async fn col<T>(app: &TestApp, sql: &str, id: Uuid) -> T
where
    T: for<'r> sqlx::Decode<'r, sqlx::Postgres> + sqlx::Type<sqlx::Postgres> + Send + Unpin,
{
    sqlx::query_scalar::<_, T>(sql)
        .bind(id)
        .fetch_one(app.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn bulk_flags_hashes_and_select_all() {
    let Ctx { app, m, alice, bob } = setup().await;
    let e03 = photo(&m, "alice/e2e_03");
    let e01 = photo(&m, "alice/e2e_01");

    // Anonymous callers are rejected before anything else.
    for path in ["favorite", "hide", "setdeleted", "makepublic", "share"] {
        let res = app
            .post_json(&format!("/api/photosedit/{path}/"), &json!({}), None)
            .await;
        assert_eq!(res.status, StatusCode::UNAUTHORIZED, "{path}");
    }

    // favorite: e2e_01 is rated 5 already (>= 4), e2e_03 is not; one unknown hash.
    let res = app
        .post_json(
            "/api/photosedit/favorite/",
            &json!({"image_hashes": [e03.hash, e01.hash, "nope", e03.hash], "favorite": true}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.json(),
        json!({"status": true, "count": 1, "updated_hashes": [e03.hash], "not_updated_hashes": [e01.hash]})
    );
    assert_eq!(
        col::<i32>(&app, "SELECT rating FROM api_photo WHERE id = $1", e03.id).await,
        4
    );

    // Bob cannot touch alice's photos: they are neither updated nor "already".
    let res = app
        .post_json(
            "/api/photosedit/hide/",
            &json!({"image_hashes": [e03.hash], "hidden": true}),
            Some(&bob),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": true, "count": 0, "updated_hashes": [], "not_updated_hashes": []})
    );
    assert!(!col::<bool>(&app, "SELECT hidden FROM api_photo WHERE id = $1", e03.id).await);

    // hide refreshes tag counts (S20): "family" holds e2e_01.
    let res = app
        .post_json(
            "/api/photosedit/hide/",
            &json!({"image_hashes": [e01.hash], "hidden": true}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["count"], 1);
    let family: i32 = sqlx::query_scalar("SELECT photo_count FROM api_tag WHERE name = 'family'")
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(family, 2);

    // select_all favorite=false over the favorites query: only changed photos count.
    let before: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM api_photo p WHERE owner_id = 2 AND rating >= 4 AND NOT hidden AND NOT in_trashcan",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    let res = app
        .post_json(
            "/api/photosedit/favorite/",
            &json!({"select_all": true, "query": {"favorite": true}, "excluded_hashes": [e03.hash], "favorite": false}),
            Some(&alice),
        )
        .await;
    let body = res.json();
    assert_eq!(body["status"], true);
    assert!(body.get("updated_hashes").is_none());
    let count = body["count"].as_i64().unwrap();
    assert!(count >= 1 && count < before, "{count} of {before}");
    assert_eq!(
        col::<i32>(&app, "SELECT rating FROM api_photo WHERE id = $1", e03.id).await,
        4
    );

    // makepublic + setdeleted (restore resets resolved stack reviews).
    let res = app
        .post_json(
            "/api/photosedit/makepublic/",
            &json!({"image_hashes": [e03.hash], "val_public": true}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["updated_hashes"], json!([e03.hash]));
    assert!(col::<bool>(&app, "SELECT public FROM api_photo WHERE id = $1", e03.id).await);

    let burst = photo(&m, "alice/burst_2");
    let stack: Uuid = m["stacks"]["burst"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    sqlx::query(
        "INSERT INTO api_stackreview (decision, trashed_count, created_at, reviewer_id, stack_id, uuid) \
         VALUES ('resolved', 0, now(), 2, $1, gen_random_uuid())",
    )
    .bind(stack)
    .execute(app.pool())
    .await
    .unwrap();
    for deleted in [true, false] {
        let res = app
            .post_json(
                "/api/photosedit/setdeleted/",
                &json!({"image_hashes": [burst.hash], "deleted": deleted}),
                Some(&alice),
            )
            .await;
        assert_eq!(res.json()["count"], 1);
    }
    let decision: String =
        sqlx::query_scalar("SELECT decision FROM api_stackreview WHERE stack_id = $1")
            .bind(stack)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(decision, "pending");

    // Missing value field / bad body.
    let res = app
        .post_json(
            "/api/photosedit/hide/",
            &json!({"image_hashes": []}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    app.cleanup().await;
}

#[tokio::test]
async fn favorite_queues_rating_write_when_metadata_goes_to_disk() {
    let Ctx { app, m, alice, .. } = setup().await;
    let e04 = photo(&m, "alice/e2e_04");
    sqlx::query(
        "UPDATE api_user SET save_metadata_to_disk = 'SIDECAR_FILE' WHERE username = 'alice'",
    )
    .execute(app.pool())
    .await
    .unwrap();
    let res = app
        .post_json(
            "/api/photosedit/favorite/",
            &json!({"image_hashes": [e04.hash], "favorite": true}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["count"], 1);
    let payloads: Vec<Value> =
        sqlx::query_scalar("SELECT payload FROM job_queue WHERE kind = 'metadata.write'")
            .fetch_all(app.pool())
            .await
            .unwrap();
    assert_eq!(
        payloads,
        vec![json!({"photo_id": e04.id, "fields": ["rating"]})]
    );
    app.cleanup().await;
}

#[tokio::test]
async fn share_to_user() {
    let Ctx { app, m, alice, bob } = setup().await;
    let e02 = photo(&m, "alice/e2e_02");
    let e06 = photo(&m, "alice/e2e_06"); // already shared to bob
    let bob_id = m["users"]["bob"]["id"].as_i64().unwrap();

    let res = app
        .post_json(
            "/api/photosedit/share/",
            &json!({"image_hashes": [e02.hash, e06.hash], "val_shared": true, "target_user_id": bob_id}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json(), json!({"status": true, "count": 1}));
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM api_photo_shared_to WHERE user_id = $1 AND photo_id = ANY($2)",
    )
    .bind(bob_id as i32)
    .bind(vec![e02.id, e06.id])
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(n, 2);

    // Bob cannot share alice's photo onwards (issue #1860).
    let res = app
        .post_json(
            "/api/photosedit/share/",
            &json!({"image_hashes": [e02.hash], "val_shared": true, "target_user_id": 5}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.json()["count"], 0);

    let res = app
        .post_json(
            "/api/photosedit/share/",
            &json!({"select_all": true, "query": {}, "val_shared": false, "target_user_id": bob_id}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json(), json!({"status": true, "count": 3}));
    app.cleanup().await;
}

#[tokio::test]
async fn patch_edit() {
    let Ctx { app, m, alice, bob } = setup().await;
    let e05 = photo(&m, "alice/e2e_05");
    let hidden = photo(&m, "alice/hidden");
    let url = format!("/api/photos/edit/{}/", e05.hash);

    assert_eq!(
        app.patch_json(&url, &json!({}), None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.patch_json(&url, &json!({}), Some(&bob)).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.patch_json(
            &format!("/api/photos/edit/{}/", hidden.hash),
            &json!({}),
            Some(&alice)
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    let res = app
        .patch_json(&url, &json!({"rating": "x"}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json()["errors"][0]["field"], "rating");

    // Other fields are ignored; the naive timestamp is UTC; the "Timestamp
    // set by user" rule makes it the capture time; the photo moves day album.
    let res = app
        .patch_json(
            &format!("/api/photos/edit/{}/", e05.id),
            &json!({"exif_timestamp": "2001-02-03T04:05:06", "rating": 1, "hidden": true, "is_document": true}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    assert_eq!(body["image_hash"], e05.hash);
    assert_eq!(body["timestamp"], "2001-02-03T04:05:06Z");
    assert_eq!(body["exif_timestamp"], "2001-02-03T04:05:06Z");
    assert_eq!(body["hidden"], false);
    assert_eq!(body["is_document"], true);
    assert_eq!(body["category_source"], "user");
    let keys: Vec<&str> = body
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "image_hash",
            "hidden",
            "rating",
            "in_trashcan",
            "removed",
            "video",
            "exif_timestamp",
            "timestamp",
            "exif_gps_lat",
            "exif_gps_lon",
            "is_screenshot",
            "is_document",
            "category_source"
        ]
    );
    let dates: Vec<Option<chrono::NaiveDate>> = sqlx::query_scalar(
        "SELECT a.date FROM api_albumdate a JOIN api_albumdate_photos ap ON ap.albumdate_id = a.id \
         WHERE ap.photo_id = $1",
    )
    .bind(e05.id)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(dates, vec![chrono::NaiveDate::from_ymd_opt(2001, 2, 3)]);

    // Clearing the time: the rules fall through to the file's EXIF; the
    // exiftool read fails in this environment unless LP_EXIFTOOL is set, so
    // only check the user timestamp was stored.
    let _ = app
        .patch_json(&url, &json!({"exif_timestamp": null}), Some(&alice))
        .await;
    let ts: Option<chrono::DateTime<chrono::Utc>> = col(
        &app,
        "SELECT \"timestamp\" FROM api_photo WHERE id = $1",
        e05.id,
    )
    .await;
    assert!(ts.is_none());

    // GPS: stored even though reverse geocoding is off.
    let res = app
        .patch_json(
            &url,
            &json!({"exif_gps_lat": 48.1, "exif_gps_lon": "11.5"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["exif_gps_lat"], 48.1);
    assert_eq!(res.json()["exif_gps_lon"], 11.5);
    app.cleanup().await;
}

#[tokio::test]
async fn captions() {
    let Ctx { app, m, alice, bob } = setup().await;
    let e04 = photo(&m, "alice/e2e_04");
    let no_thumb = photo(&m, "alice/no_thumbnail");

    let res = app
        .post_json(
            "/api/photosedit/savecaption/",
            &json!({"image_hash": e04.hash, "caption": "x"}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "photo not found"})
    );
    let res = app
        .post_json(
            "/api/photosedit/savecaption/",
            &json!({"image_hash": e04.hash, "caption": "x"}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    let res = app
        .post_json(
            "/api/photosedit/savecaption/",
            &json!({"image_hash": e04.hash, "caption": "<start> Beach day #summer #sea <end>"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json(), json!({"status": true}));
    let captions: Value = col(
        &app,
        "SELECT captions_json FROM api_photo_caption WHERE photo_id = $1",
        e04.id,
    )
    .await;
    assert_eq!(captions["user_caption"], "Beach day #summer #sea");
    let search: String = col(
        &app,
        "SELECT search_captions FROM api_photo_search WHERE photo_id = $1",
        e04.id,
    )
    .await;
    assert!(search.starts_with("Beach day #summer #sea "), "{search}");
    let things: Vec<(String, i32)> = sqlx::query(
        "SELECT a.title, a.photo_count FROM api_albumthing a JOIN api_albumthing_photos ap ON ap.albumthing_id = a.id \
         WHERE ap.photo_id = $1 AND a.thing_type = 'hashtag_attribute' ORDER BY a.title",
    )
    .bind(e04.id)
    .fetch_all(app.pool())
    .await
    .unwrap()
    .into_iter()
    .map(|r| (r.get(0), r.get(1)))
    .collect();
    assert_eq!(things, vec![("#sea".into(), 1), ("#summer".into(), 1)]);

    // Dropping a hashtag takes the photo out of that album.
    let res = app
        .post_json(
            "/api/photosedit/savecaption/",
            &json!({"image_hash": e04.hash, "caption": "Beach day #summer"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json(), json!({"status": true}));
    let sea: i32 =
        sqlx::query_scalar("SELECT photo_count FROM api_albumthing WHERE title = '#sea'")
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(sea, 0);

    // A photo whose thumbnail has no file answers status false.
    let res = app
        .post_json(
            "/api/photosedit/savecaption/",
            &json!({"image_hash": no_thumb.hash, "caption": "x"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json(), json!({"status": false}));

    // Captioning is off in tests (FEATURE_IMAGE_CAPTIONING default off here).
    let res = app
        .post_json(
            "/api/photosedit/generateim2txt/",
            &json!({"image_hash": e04.hash}),
            Some(&alice),
        )
        .await;
    if res.status == StatusCode::FORBIDDEN {
        assert_eq!(
            res.json(),
            json!({"status": false, "message": "Image captioning is disabled"})
        );
    }
    app.cleanup().await;
}

#[tokio::test]
async fn generate_caption_feature_gate_and_scope() {
    let app = TestApp::with_env(&[("FEATURE_IMAGE_CAPTIONING", "0")]).await;
    let m = manifest();
    let alice = lp_db::users::by_username(app.pool(), "alice")
        .await
        .unwrap()
        .unwrap();
    let e04 = photo(&m, "alice/e2e_04");
    let res = app
        .post_json(
            "/api/photosedit/generateim2txt/",
            &json!({"image_hash": e04.hash}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "Image captioning is disabled"})
    );
    app.cleanup().await;

    let app = TestApp::with_env(&[("FEATURE_IMAGE_CAPTIONING", "1")]).await;
    let tok = app.token_for(&alice);
    let res = app
        .post_json(
            "/api/photosedit/generateim2txt/",
            &json!({"image_hash": e04.hash}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    // No model files in the temp BASE_DATA: the "downloading" answer.
    let res = app
        .post_json(
            "/api/photosedit/generateim2txt/",
            &json!({"image_hash": e04.hash}),
            Some(&tok),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["reason"], "model_downloading");

    // With the model on disk but no captioning sidecar: Django's failure shape.
    let models = app.state.config.data_models_dir().join("lfm2_vl_450m");
    std::fs::create_dir_all(&models).unwrap();
    for f in [
        "vision_encoder_q4.onnx",
        "vision_encoder_q4.onnx_data",
        "embed_tokens_q4.onnx",
        "embed_tokens_q4.onnx_data",
        "decoder_model_merged_q4.onnx",
        "decoder_model_merged_q4.onnx_data",
        "tokenizer.json",
    ] {
        std::fs::write(models.join(f), b"").unwrap();
    }
    if std::net::TcpStream::connect("127.0.0.1:8007").is_err() {
        let res = app
            .post_json(
                "/api/photosedit/generateim2txt/",
                &json!({"image_hash": e04.hash}),
                Some(&tok),
            )
            .await;
        assert_eq!(res.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            res.json(),
            json!({"status": false, "message": "Failed to generate caption. Check service logs for details."})
        );
    }
    app.cleanup().await;
}

#[tokio::test]
async fn rotate() {
    let Ctx { app, m, alice, bob } = setup().await;
    let e02 = photo(&m, "alice/e2e_02");
    let video = photo(&m, "alice/video");
    let post = |body: Value, tok: Option<String>| {
        let app = &app;
        async move {
            app.post_json("/api/photosedit/rotate/", &body, tok.as_deref())
                .await
        }
    };

    assert_eq!(post(json!({}), None).await.status, StatusCode::UNAUTHORIZED);
    let res = post(json!({"angle": 90}), Some(alice.clone())).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "image_hash is required"})
    );
    let res = post(
        json!({"image_hash": e02.hash, "angle": 45}),
        Some(alice.clone()),
    )
    .await;
    assert_eq!(
        res.json()["message"],
        "angle must be a multiple of 90 degrees"
    );
    let res = post(
        json!({"image_hash": e02.hash, "angle": 90}),
        Some(bob.clone()),
    )
    .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = post(
        json!({"image_hash": video.hash, "angle": 90}),
        Some(alice.clone()),
    )
    .await;
    assert_eq!(
        res.json()["message"],
        "rotation is not supported for videos"
    );

    let res = post(
        json!({"image_hash": e02.hash, "angle": 90}),
        Some(alice.clone()),
    )
    .await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(body["status"], true);
    assert_eq!(body["image_hash"], e02.hash);
    assert_eq!(body["local_orientation"], 6);
    assert!(body["last_modified"].as_str().unwrap().ends_with("+00:00"));
    let res = post(
        json!({"image_hash": e02.hash, "angle": -90, "flip_horizontal": true}),
        Some(alice.clone()),
    )
    .await;
    assert_eq!(res.json()["local_orientation"], 4);
    let res = post(json!({"image_hash": e02.hash}), Some(alice.clone())).await;
    assert_eq!(res.json()["local_orientation"], 4);

    let jobs: Vec<Value> = sqlx::query_scalar(
        "SELECT payload FROM job_queue WHERE kind = 'thumbnails.rerender' ORDER BY id",
    )
    .fetch_all(app.pool())
    .await
    .unwrap();
    // Rendered in the request when libvips is available, else queued.
    assert!(jobs.len() <= 2);
    assert!(jobs.iter().all(|j| *j == json!({"photo_id": e02.id})));
    app.cleanup().await;
}

#[tokio::test]
async fn delete_trashed_photos() {
    let Ctx { app, m, alice, bob } = setup().await;
    let dir = isolate_media(&app).await;
    let trashed = photo(&m, "alice/trashed");
    let e07 = photo(&m, "alice/e2e_07");
    let dup = photo(&m, "alice/dup_resized");

    assert_eq!(
        app.delete(
            "/api/photosedit/delete/",
            Some(&json!({"image_hashes": []})),
            None
        )
        .await
        .status,
        StatusCode::UNAUTHORIZED
    );
    // Not trashed, not bob's: nothing happens.
    let res = app
        .delete(
            "/api/photosedit/delete/",
            Some(&json!({"image_hashes": [trashed.hash]})),
            Some(&bob),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": true, "results": [], "not_deleted": [trashed.hash], "deleted": []})
    );

    let file: String = col(
        &app,
        "SELECT main_file_id FROM api_photo WHERE id = $1",
        trashed.id,
    )
    .await;
    assert!(dir.join(format!("{file}.jpg")).exists());
    let res = app
        .delete(
            "/api/photosedit/delete/",
            Some(&json!({"image_hashes": [trashed.hash, e07.hash]})),
            Some(&alice),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": true, "results": [trashed.hash], "not_deleted": [e07.hash], "deleted": [trashed.hash]})
    );
    let row = sqlx::query("SELECT removed, main_file_id FROM api_photo WHERE id = $1")
        .bind(trashed.id)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert!(row.get::<bool, _>(0));
    assert!(row.get::<Option<String>, _>(1).is_none());
    let files: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_file WHERE hash = $1")
        .bind(&file)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(files, 0);
    assert!(!dir.join(format!("{file}.jpg")).exists());

    // select_all over the trash: trash a duplicate, purge; the group dissolves.
    let dup_group: Uuid = m["duplicates"]["visual"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    app.post_json(
        "/api/photosedit/setdeleted/",
        &json!({"image_hashes": [dup.hash], "deleted": true}),
        Some(&alice),
    )
    .await;
    let res = app
        .delete(
            "/api/photosedit/delete/",
            Some(&json!({"select_all": true, "query": {}, "excluded_hashes": []})),
            Some(&alice),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": true, "count": 1, "failed_count": 0})
    );
    let groups: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_duplicate WHERE id = $1")
        .bind(dup_group)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(groups, 0);
    app.cleanup().await;
}

#[tokio::test]
async fn public_photo_links() {
    let Ctx { app, m, alice, bob } = setup().await;
    let e03 = photo(&m, "alice/e2e_03");
    let shared = photo(&m, "alice/e2e_08");

    assert_eq!(
        app.get("/api/photo/share/list", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    let res = app.get("/api/photo/share/list", Some(&alice)).await;
    let list = res.json();
    assert_eq!(list["results"].as_array().unwrap().len(), 1);
    assert_eq!(list["results"][0]["slug"], "fixture-photo-share");
    assert_eq!(list["results"][0]["image_hash"], shared.hash);
    assert_eq!(list["results"][0]["photo_id"], shared.id.to_string());
    assert_eq!(list["results"][0]["url"], "/public/p/fixture-photo-share");

    let res = app
        .post_json(
            "/api/photo/share",
            &json!({"action": "enable"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "Missing parameters"})
    );
    let res = app
        .post_json(
            "/api/photo/share",
            &json!({"photo_id": e03.hash, "action": "nuke"}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "Unknown action"})
    );
    let res = app
        .post_json(
            "/api/photo/share",
            &json!({"photo_id": e03.hash}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "No such photo"})
    );

    let res = app
        .post_json(
            "/api/photo/share",
            &json!({"photo_id": e03.hash}),
            Some(&alice),
        )
        .await;
    let share = res.json()["share"].clone();
    let slug = share["slug"].as_str().unwrap().to_string();
    assert_eq!(slug.len(), 12);
    assert_eq!(share["enabled"], true);
    assert_eq!(share["url"], format!("/public/p/{slug}"));
    // Enabling again keeps the link; rotating replaces it.
    let res = app
        .post_json(
            "/api/photo/share",
            &json!({"photo_id": e03.id.to_string(), "action": "ENABLE"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["share"]["slug"], slug);
    let res = app
        .post_json(
            "/api/photo/share",
            &json!({"photo_id": e03.hash, "action": "rotate"}),
            Some(&alice),
        )
        .await;
    let rotated = res.json()["share"]["slug"].as_str().unwrap().to_string();
    assert_ne!(rotated, slug);
    let res = app
        .post_json(
            "/api/photo/share",
            &json!({"photo_id": e03.hash, "action": "disable"}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": true, "share": {"enabled": false, "slug": null, "url": null}})
    );
    let res = app.get("/api/photo/share/list", Some(&alice)).await;
    assert_eq!(res.json()["results"].as_array().unwrap().len(), 1);
    app.cleanup().await;
}

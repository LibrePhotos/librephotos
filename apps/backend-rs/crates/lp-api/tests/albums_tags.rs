//! albums_tags endpoints through the full app, on a clone of the fixture
//! (lp_fixture). Reads share one database; mutations get their own.

#![allow(clippy::disallowed_methods)]

use axum::http::StatusCode;
use lp_testkit::{TestApp, TestResponse};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

/// Skip quietly when the template has no fixture (empty schema).
async fn fixture(app: &TestApp) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM api_user WHERE username = 'alice')")
        .fetch_one(app.pool())
        .await
        .unwrap()
}

async fn token(app: &TestApp, username: &str) -> String {
    let user = lp_db::users::by_username(app.pool(), username)
        .await
        .unwrap()
        .expect("fixture user");
    app.token_for(&user)
}

async fn album_id(db: &PgPool, title: &str) -> i32 {
    sqlx::query_scalar("SELECT id FROM api_albumuser WHERE title = $1")
        .bind(title)
        .fetch_one(db)
        .await
        .unwrap()
}

async fn photo_ids(db: &PgPool, owner: &str, n: i64) -> Vec<Uuid> {
    sqlx::query_scalar(
        "SELECT p.id FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         WHERE u.username = $1 AND NOT p.hidden AND NOT p.in_trashcan ORDER BY p.exif_timestamp NULLS LAST, p.id LIMIT $2",
    )
    .bind(owner)
    .bind(n)
    .fetch_all(db)
    .await
    .unwrap()
}

async fn hash_of(db: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT image_hash FROM api_photo WHERE id = $1")
        .bind(id)
        .fetch_one(db)
        .await
        .unwrap()
}

fn keys(v: &Value) -> Vec<&str> {
    v.as_object().unwrap().keys().map(String::as_str).collect()
}

fn first_message(res: &TestResponse) -> String {
    res.json()["errors"][0]["message"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

#[tokio::test]
async fn user_album_reads() {
    let app = TestApp::shared().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let alice = token(&app, "alice").await;
    let carol = token(&app, "carol").await;

    let res = app.get("/api/albums/user/list/", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(keys(&body), ["count", "next", "previous", "results"]);
    let first = &body["results"][0];
    assert_eq!(
        keys(first),
        [
            "id",
            "cover_photo",
            "created_on",
            "favorited",
            "title",
            "shared_to",
            "owner",
            "photo_count",
            "public",
            "public_slug",
            "public_expires_at",
            "public_sharing_options"
        ]
    );
    assert_eq!(
        keys(&first["cover_photo"]),
        [
            "image_hash",
            "rating",
            "hidden",
            "exif_timestamp",
            "public",
            "video"
        ]
    );
    let titles: Vec<&str> = body["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["title"].as_str().unwrap())
        .collect();
    let mut sorted = titles.clone();
    sorted.sort();
    assert_eq!(titles, sorted, "ordered by title");
    assert_eq!(
        app.get("/api/albums/user/list/", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    let res = app.get("/api/albums/user/list/?page=9", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    // Detail: owner, recipient (read-only), stranger, anonymous.
    let shared = album_id(app.pool(), "Shared with Carol").await;
    let res = app
        .get(&format!("/api/albums/user/{shared}/"), Some(&carol))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(body["id"], json!(shared.to_string()));
    assert_eq!(
        keys(&body),
        [
            "id",
            "title",
            "owner",
            "shared_to",
            "date",
            "location",
            "grouped_photos",
            "public",
            "public_slug",
            "public_expires_at",
            "public_sharing_options"
        ]
    );
    assert!(body["grouped_photos"][0]["items"][0]["aspectRatio"].is_number());
    let vacation = album_id(app.pool(), "Vacation 2024").await;
    let res = app
        .get(&format!("/api/albums/user/{vacation}/"), Some(&carol))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(first_message(&res), "No AlbumUser matches the given query.");
    let res = app
        .get(&format!("/api/albums/user/{vacation}/"), None)
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    let res = app.get("/api/albums/user/abc/", Some(&alice)).await;
    assert_eq!(
        (res.status, first_message(&res).as_str()),
        (StatusCode::NOT_FOUND, "Not found.")
    );
    let res = app
        .get(
            &format!("/api/albums/user/{vacation}/?video=true"),
            Some(&alice),
        )
        .await;
    for group in res.json()["grouped_photos"].as_array().unwrap() {
        for item in group["items"].as_array().unwrap() {
            assert_eq!(item["type"], "video");
        }
    }

    // Public view: anonymous, timestamps/location not shared by default.
    let public = album_id(app.pool(), "Public Trip").await;
    let res = app
        .get(&format!("/api/albums/user/{public}/?public=true"), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(
        keys(&body),
        ["id", "title", "owner", "date", "location", "grouped_photos"]
    );
    assert_eq!(body["date"], "");
    assert_eq!(body["grouped_photos"][0]["date"], Value::Null);
    assert_eq!(body["grouped_photos"][0]["items"][0]["date"], "");
    assert_eq!(
        body["grouped_photos"][0]["items"][0]["exif_gps_lat"],
        Value::Null
    );
    let res = app
        .get(
            &format!("/api/albums/user/{public}/?public=true&username=bob"),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let expired = album_id(app.pool(), "Expired Share").await;
    let res = app
        .get(&format!("/api/albums/user/{expired}/?public=1"), None)
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    // A bad header token is a 401 even on the public view.
    let res = app
        .get(
            &format!("/api/albums/user/{public}/?public=true"),
            Some("garbage"),
        )
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // Shared from / to me.
    let res = app
        .get("/api/albums/user/shared/fromme/", Some(&alice))
        .await;
    assert_eq!(res.json()["results"][0]["id"], json!(shared));
    let res = app.get("/api/albums/user/shared/tome/", Some(&carol)).await;
    assert_eq!(res.json()["count"], 1);
    assert_eq!(
        res.json()["results"][0]["shared_to"][0]["username"],
        "carol"
    );
    app.cleanup().await;
}

#[tokio::test]
async fn auto_thing_place_reads() {
    let app = TestApp::shared().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;

    let res = app.get("/api/albums/auto/list/", Some(&alice)).await;
    let body = res.json();
    let list = body["results"].as_array().unwrap();
    assert!(!list.is_empty());
    assert_eq!(
        keys(&list[0]),
        [
            "id",
            "title",
            "timestamp",
            "photos",
            "photo_count",
            "favorited"
        ]
    );
    assert_eq!(keys(&list[0]["photos"]), ["image_hash", "video"]);
    let id = list[0]["id"].as_i64().unwrap();
    let res = app
        .get(&format!("/api/albums/auto/{id}/"), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(
        keys(&body),
        [
            "id",
            "title",
            "favorited",
            "timestamp",
            "created_on",
            "gps_lat",
            "people",
            "gps_lon",
            "photos"
        ]
    );
    let p = &body["photos"][0];
    assert!(
        p["square_thumbnail"]
            .as_str()
            .unwrap()
            .starts_with("/media/square_thumbnails/")
    );
    for person in body["people"].as_array().unwrap() {
        assert_eq!(
            keys(person),
            [
                "name",
                "face_url",
                "face_count",
                "face_photo_url",
                "video",
                "id"
            ]
        );
    }
    let res = app
        .get(&format!("/api/albums/auto/{id}/"), Some(&bob))
        .await;
    assert_eq!(first_message(&res), "No AlbumAuto matches the given query.");

    let res = app.get("/api/albums/thing/list/", Some(&alice)).await;
    let body = res.json();
    let things = body["results"].as_array().unwrap();
    assert_eq!(
        keys(&things[0]),
        ["id", "cover_photos", "title", "photo_count", "thing_type"]
    );
    let tid = things[0]["id"].as_i64().unwrap();
    let res = app
        .get(&format!("/api/albums/thing/{tid}/"), Some(&alice))
        .await;
    assert_eq!(res.json()["results"]["id"], json!(tid.to_string()));
    let res = app
        .get(&format!("/api/albums/thing/{tid}/"), Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json(), json!({"results": {"title": ""}}));

    let res = app.get("/api/albums/place/list/", Some(&alice)).await;
    let body = res.json();
    let places = body["results"].as_array().unwrap();
    assert_eq!(
        keys(&places[0]),
        [
            "id",
            "geolocation_level",
            "cover_photos",
            "title",
            "photo_count"
        ]
    );
    assert!(places[0]["cover_photos"].as_array().unwrap().len() <= 4);
    let pid = places[0]["id"].as_i64().unwrap();
    let res = app
        .get(
            &format!("/api/albums/place/{pid}/?photo=true"),
            Some(&alice),
        )
        .await;
    let groups = res.json()["results"]["grouped_photos"].clone();
    assert!(!groups.as_array().unwrap().is_empty());

    let res = app.get("/api/locclust/", Some(&alice)).await;
    let rows = res.json();
    let rows = rows.as_array().unwrap();
    assert!(!rows.is_empty());
    let names: Vec<&str> = rows.iter().map(|r| r[2].as_str().unwrap()).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);
    assert!(rows[0][0].is_f64() && rows[0][1].is_f64());
    assert_eq!(
        app.get("/api/locclust/", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    app.cleanup().await;
}

#[tokio::test]
async fn tag_reads_and_folders() {
    let app = TestApp::shared().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let admin = token(&app, "admin").await;

    let res = app.get("/api/tags/", Some(&alice)).await;
    let body = res.json();
    let tags = body["results"].as_array().unwrap();
    assert_eq!(
        keys(&tags[0]),
        ["id", "name", "photo_count", "cover_photos"]
    );
    let family = tags.iter().find(|t| t["name"] == "family").unwrap();
    let fid = family["id"].as_i64().unwrap();
    let res = app.get(&format!("/api/tags/{fid}/"), Some(&alice)).await;
    let detail = res.json();
    assert_eq!(keys(&detail["results"]), ["id", "name", "grouped_photos"]);
    assert_eq!(detail["results"]["id"], json!(fid));
    let member = detail["results"]["grouped_photos"][0]["items"][0].clone();
    // ?photo= by uuid and by hash.
    for value in [
        member["id"].as_str().unwrap(),
        member["image_hash"].as_str().unwrap(),
    ] {
        let res = app
            .get(&format!("/api/tags/?photo={value}"), Some(&alice))
            .await;
        let names: Vec<Value> = res.json()["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].clone())
            .collect();
        assert!(names.contains(&json!("family")), "{value}");
    }
    let res = app.get(&format!("/api/tags/{fid}/"), Some(&bob)).await;
    assert_eq!(first_message(&res), "No Tag matches the given query.");

    // Folders: alice browses her scan directory; the admin's DATA_ROOT is
    // the test's (missing) temp data dir.
    let res = app.get("/api/folders/subfolders/", Some(&alice)).await;
    if res.status == StatusCode::OK {
        let body = res.json();
        assert_eq!(
            keys(&body),
            ["current_path", "parent_path", "subfolders", "pagination"]
        );
        assert_eq!(body["parent_path"], Value::Null);
        assert_eq!(body["pagination"]["page_size"], 100);
        let bob_dir: String =
            sqlx::query_scalar("SELECT scan_directory FROM api_user WHERE username = 'bob'")
                .fetch_one(app.pool())
                .await
                .unwrap();
        let res = app
            .get(
                &format!(
                    "/api/folders/subfolders/?path={}",
                    urlencoding::encode(&bob_dir)
                ),
                Some(&alice),
            )
            .await;
        assert_eq!(res.status, StatusCode::FORBIDDEN);
        assert_eq!(
            res.json(),
            json!({"error": "Access denied - can only access folders within your scan directory"})
        );
    }
    let res = app.get("/api/folders/subfolders/", Some(&admin)).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json(), json!({"error": "Path does not exist"}));
    app.cleanup().await;
}

#[tokio::test]
async fn user_album_edits_and_sharing() {
    let app = TestApp::new().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let db = app.pool().clone();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let mine = photo_ids(&db, "alice", 3).await;
    let foreign = photo_ids(&db, "bob", 1).await;

    // Validation, before anything is written.
    let res = app
        .post_json(
            "/api/albums/user/edit/",
            &json!({"title": "T", "photos": [foreign[0]]}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json()["errors"][0]["field"], "photos");
    assert_eq!(
        first_message(&res),
        format!("Invalid pk \"{}\" - object does not exist.", foreign[0])
    );
    let res = app
        .post_json(
            "/api/albums/user/edit/",
            &json!({"photos": "x"}),
            Some(&alice),
        )
        .await;
    let fields: Vec<Value> = res.json()["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].clone())
        .collect();
    assert_eq!(fields, [json!("title"), json!("photos")]);

    // Create.
    let res = app
        .post_json(
            "/api/albums/user/edit/",
            &json!({"title": "Rust Album", "photos": [mine[0], mine[1]]}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED);
    let body = res.json();
    assert_eq!(
        keys(&body),
        [
            "id",
            "title",
            "photos",
            "created_on",
            "favorited",
            "cover_photo"
        ]
    );
    assert_eq!(body["photos"].as_array().unwrap().len(), 2);
    let id = body["id"].as_i64().unwrap();

    // Same title again = update: adds, removes by hash, sets the cover.
    let h0 = hash_of(&db, mine[0]).await;
    let res = app
        .post_json(
            "/api/albums/user/edit/",
            &json!({"title": "Rust Album", "photos": [mine[2]], "removedPhotos": [h0], "cover_photo": mine[2]}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED);
    assert_eq!(res.json()["id"], json!(id));
    let photos: Vec<Value> = res.json()["photos"].as_array().unwrap().clone();
    assert_eq!(photos.len(), 2);
    assert!(!photos.contains(&json!(mine[0])));
    assert_eq!(res.json()["cover_photo"], json!(mine[2]));

    // Select-all adds only the owner's matching photos.
    let res = app
        .patch_json(
            &format!("/api/albums/user/edit/{id}/"),
            &json!({"select_all": true, "query": {"video": true}, "excluded_hashes": []}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let videos: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_albumuser_photos l JOIN api_photo p ON p.id = l.photo_id \
         WHERE l.albumuser_id = $1 AND p.video",
    )
    .bind(id as i32)
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(videos >= 1);
    // Bob can't touch it.
    let res = app
        .patch_json(
            &format!("/api/albums/user/edit/{id}/"),
            &json!({"title": "x"}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = app
        .patch_json(
            &format!("/api/albums/user/{id}/"),
            &json!({"title": "x"}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    // Rename returns the detail serializer.
    let res = app
        .patch_json(
            &format!("/api/albums/user/{id}/"),
            &json!({"title": "Renamed"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["title"], "Renamed");
    let res = app
        .patch_json(
            &format!("/api/albums/user/{id}/"),
            &json!({"title": "  "}),
            Some(&alice),
        )
        .await;
    assert_eq!(first_message(&res), "This field may not be blank.");

    // Share to bob, then he sees it (read-only).
    let bob_id: i32 = sqlx::query_scalar("SELECT id FROM api_user WHERE username = 'bob'")
        .fetch_one(&db)
        .await
        .unwrap();
    let res = app
        .post_json(
            "/api/useralbum/share/",
            &json!({"album_id": id, "target_user_id": bob_id, "shared": true}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["shared_to"][0]["username"], "bob");
    let members: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_albumuser_photos WHERE albumuser_id = $1")
            .bind(id as i32)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(res.json()["photo_count"], members);
    assert_eq!(
        app.get(&format!("/api/albums/user/{id}/"), Some(&bob))
            .await
            .status,
        StatusCode::OK
    );
    let res = app
        .post_json(
            "/api/useralbum/share/",
            &json!({"album_id": id, "target_user_id": bob_id, "shared": true}),
            Some(&bob),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "You cannot share an album you don't own"})
    );

    // Public link: minted slug, then revoked.
    let res = app
        .post_json(
            "/api/useralbum/makepublic",
            &json!({"album_id": id, "val_public": true}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let slug = res.json()["album"]["public_slug"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(slug.len(), 12);
    assert!(slug.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(res.json()["album"]["public"], true);
    let res = app
        .get(&format!("/api/albums/user/{id}/?public=true"), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let res = app
        .post_json(
            "/api/useralbum/makepublic",
            &json!({"album_id": id, "val_public": true, "slug": slug, "sharing_options": {"share_timestamps": true}}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        res.json()["album"]["public_sharing_options"]["share_timestamps"],
        true
    );
    let res = app
        .get(&format!("/api/albums/user/{id}/?public=true"), None)
        .await;
    assert_ne!(res.json()["date"], "");
    let res = app
        .post_json(
            "/api/useralbum/makepublic",
            &json!({"album_id": id, "val_public": false}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["album"]["public_slug"], "");
    assert_eq!(
        app.get(&format!("/api/albums/user/{id}/?public=true"), None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    let res = app
        .post_json(
            "/api/useralbum/makepublic",
            &json!({"album_id": id}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    let res = app
        .post_json(
            "/api/useralbum/makepublic",
            &json!({"album_id": id, "val_public": true}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);

    // An explicit slug is kept as given.
    let other = album_id(&db, "Vacation 2024").await;
    let res = app
        .post_json(
            "/api/useralbum/makepublic",
            &json!({"album_id": other, "val_public": true, "slug": "my-slug"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["album"]["public_slug"], "my-slug");

    // Delete: recipients can't, the owner can (links and share go too).
    assert_eq!(
        app.delete(&format!("/api/albums/user/{id}/"), None, Some(&bob))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.delete(&format!("/api/albums/user/{id}/"), None, Some(&alice))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    let left: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM api_albumuser_photos WHERE albumuser_id = $1) \
              + (SELECT count(*) FROM api_albumuser_shared_to WHERE albumuser_id = $1) \
              + (SELECT count(*) FROM api_albumusershare WHERE album_id = $1)",
    )
    .bind(id as i32)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(left, 0);
    app.cleanup().await;
}

#[tokio::test]
async fn tag_mutations() {
    let app = TestApp::new().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let db = app.pool().clone();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let mine = photo_ids(&db, "alice", 2).await;

    let res = app
        .post_json("/api/tags/", &json!({"name": "  rusty "}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::CREATED);
    assert_eq!(keys(&res.json()), ["id", "name", "photo_count"]);
    assert_eq!(res.json()["name"], "rusty");
    let id = res.json()["id"].as_i64().unwrap();
    let res = app
        .post_json("/api/tags/", &json!({"name": "rusty"}), Some(&alice))
        .await;
    assert_eq!(
        (res.status, res.json()["id"].as_i64()),
        (StatusCode::OK, Some(id))
    );
    let res = app
        .post_json("/api/tags/", &json!({"name": ""}), Some(&alice))
        .await;
    assert_eq!(first_message(&res), "This field may not be blank.");
    let res = app
        .patch_json(
            &format!("/api/tags/{id}/"),
            &json!({"name": "family"}),
            Some(&alice),
        )
        .await;
    assert_eq!(first_message(&res), "Tag 'family' already exists.");
    let res = app
        .patch_json(
            &format!("/api/tags/{id}/"),
            &json!({"name": "x"}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    let h1 = hash_of(&db, mine[1]).await;
    let res = app
        .post_json(
            &format!("/api/tags/{id}/add/"),
            &json!({"photos": [mine[0], h1]}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["photo_count"], 2);
    let res = app
        .post_json(
            &format!("/api/tags/{id}/add/"),
            &json!({"photos": []}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        (res.status, res.json()),
        (
            StatusCode::BAD_REQUEST,
            json!({"error": "No photos provided"})
        )
    );
    let res = app
        .post_json(
            &format!("/api/tags/{id}/add/"),
            &json!({"photos": ["0123456789abcdef"]}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        (res.status, first_message(&res).as_str()),
        (StatusCode::NOT_FOUND, "Unknown photo")
    );
    let res = app
        .post_json(
            &format!("/api/tags/{id}/remove/"),
            &json!({"photos": [mine[0]]}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["photo_count"], 1);
    let res = app
        .post_json(
            &format!("/api/tags/{id}/add/"),
            &json!({"select_all": true, "query": {"video": true}}),
            Some(&alice),
        )
        .await;
    assert!(res.json()["photo_count"].as_i64().unwrap() >= 2);

    // Merge "family" into ours; the source goes away.
    let family: i32 = sqlx::query_scalar("SELECT id FROM api_tag WHERE name = 'family'")
        .fetch_one(&db)
        .await
        .unwrap();
    let res = app
        .post_json(
            &format!("/api/tags/{id}/merge/"),
            &json!({"tag": family}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let gone: bool = sqlx::query_scalar("SELECT NOT EXISTS (SELECT 1 FROM api_tag WHERE id = $1)")
        .bind(family)
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(gone);
    let res = app
        .post_json(
            &format!("/api/tags/{id}/merge/"),
            &json!({"tag": id}),
            Some(&alice),
        )
        .await;
    assert_eq!(
        res.json(),
        json!({"error": "A tag cannot be merged into itself"})
    );
    let res = app
        .post_json(
            &format!("/api/tags/{id}/merge/"),
            &json!({"tag": "nope"}),
            Some(&alice),
        )
        .await;
    assert_eq!((res.status, res.body.len()), (StatusCode::NOT_FOUND, 0));

    assert_eq!(
        app.delete(&format!("/api/tags/{id}/"), None, Some(&alice))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    let links: i64 = sqlx::query_scalar("SELECT count(*) FROM api_tag_photos WHERE tag_id = $1")
        .bind(id as i32)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(links, 0);
    app.cleanup().await;
}

#[tokio::test]
async fn auto_album_mutations_and_jobs() {
    let app = TestApp::new().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let db = app.pool().clone();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let alice_id: i32 = sqlx::query_scalar("SELECT id FROM api_user WHERE username = 'alice'")
        .fetch_one(&db)
        .await
        .unwrap();
    let ids: Vec<i32> =
        sqlx::query_scalar("SELECT id FROM api_albumauto WHERE owner_id = $1 ORDER BY id")
            .bind(alice_id)
            .fetch_all(&db)
            .await
            .unwrap();

    assert_eq!(
        app.delete(&format!("/api/albums/auto/{}/", ids[0]), None, Some(&bob))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.delete(&format!("/api/albums/auto/{}/", ids[0]), None, Some(&alice))
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    let res = app
        .post_json("/api/albums/auto/delete_all/", &json!({}), Some(&alice))
        .await;
    assert_eq!((res.status, res.json()), (StatusCode::OK, json!("success")));
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM api_albumauto WHERE owner_id = $1")
        .bind(alice_id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(left, 0);

    // Generation is queued as a tracked job...
    let res = app
        .post_json("/api/autoalbumgen/", &json!({}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["status"], true);
    let job_id = res.json()["job_id"].as_str().unwrap().to_string();
    let job: lp_jobs::QueuedJob = sqlx::query_as(
        "SELECT id, kind, payload, status, lrj_id, group_id, run_after, attempts, max_attempts, locked_by, \
           heartbeat_at, last_error, created_at, started_at, finished_at FROM job_queue WHERE lrj_id = $1",
    )
    .bind(&job_id)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(job.kind, "albums.auto_generate");
    assert_eq!(job.payload, json!({"user_id": alice_id}));

    // ...and the registered handler rebuilds the albums.
    let mut reg = lp_jobs::HandlerRegistry::new();
    lp_api::albums_tags::register_jobs(&mut reg);
    let handler = reg.get("albums.auto_generate").expect("registered").clone();
    handler(lp_jobs::JobCtx {
        state: app.state.clone(),
        job,
    })
    .await
    .unwrap();
    let lrj = lp_jobs::lrj::get(&db, &job_id).await.unwrap().unwrap();
    assert!(lrj.finished && !lrj.failed);
    assert_eq!(lrj.progress_current, lrj.progress_target);
    assert_eq!(lrj.job_type, lp_jobs::JobType::GenerateAutoAlbums.as_i32());
    let res = app.get("/api/albums/auto/list/", Some(&alice)).await;
    assert_eq!(res.json()["count"].as_i64().unwrap() as usize, ids.len());

    // Title regeneration is a job too.
    let res = app
        .post_json("/api/autoalbumtitlegen/", &json!({}), Some(&alice))
        .await;
    let job_id = res.json()["job_id"].as_str().unwrap().to_string();
    let job: lp_jobs::QueuedJob = sqlx::query_as(
        "SELECT id, kind, payload, status, lrj_id, group_id, run_after, attempts, max_attempts, locked_by, \
           heartbeat_at, last_error, created_at, started_at, finished_at FROM job_queue WHERE lrj_id = $1",
    )
    .bind(&job_id)
    .fetch_one(&db)
    .await
    .unwrap();
    let handler = reg.get("albums.auto_titles").expect("registered").clone();
    handler(lp_jobs::JobCtx {
        state: app.state.clone(),
        job,
    })
    .await
    .unwrap();
    assert!(
        lp_jobs::lrj::get(&db, &job_id)
            .await
            .unwrap()
            .unwrap()
            .finished
    );
    assert_eq!(
        app.post_json("/api/autoalbumgen/", &json!({}), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    app.cleanup().await;
}

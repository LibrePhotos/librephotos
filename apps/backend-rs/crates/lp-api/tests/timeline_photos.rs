//! Area `timeline_photos` against the lp_fixture pack: date albums, photo
//! sets, memories, photo detail, photo albums, metadata GET/PATCH.

#![allow(clippy::disallowed_methods)]

use axum::http::StatusCode;
use lp_db::db::DjUuid;
use lp_testkit::TestApp;
use serde_json::{Value, json};
use uuid::Uuid;

async fn user(app: &TestApp, name: &str) -> lp_db::users::User {
    lp_db::users::by_username(app.pool(), name)
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("fixture user {name}"))
}

async fn token(app: &TestApp, name: &str) -> String {
    let u = user(app, name).await;
    app.token_for(&u)
}

/// `(id, image_hash)` of the first photo matching `cond` (SQL over alias p).
async fn photo_where(app: &TestApp, cond: &str) -> (Uuid, String) {
    let (id, hash): (DjUuid, String) = lp_db::sql::query_as(format!(
        "SELECT p.id, p.image_hash FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         WHERE {cond} ORDER BY p.image_hash LIMIT 1"
    ))
    .fetch_one(app.pool())
    .await
    .unwrap_or_else(|e| panic!("no photo where {cond}: {e}"));
    (id.0, hash)
}

const VISIBLE: &str = "NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed AND EXISTS \
    (SELECT 1 FROM api_thumbnail t WHERE t.photo_id = p.id AND t.aspect_ratio IS NOT NULL)";

#[tokio::test]
async fn date_list_and_pages() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;

    let res = app.get("/api/albums/date/list/", None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    let res = app.get("/api/albums/date/list/", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    let groups = res.json()["results"].as_array().unwrap().clone();
    assert!(!groups.is_empty());
    let mut total = 0;
    for g in &groups {
        assert_eq!(g["incomplete"], true);
        assert_eq!(g["items"], json!([]));
        assert!(g["id"].is_string());
        let keys: Vec<&String> = g.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            [
                "id",
                "date",
                "location",
                "incomplete",
                "numberOfItems",
                "items"
            ]
        );
        total += g["numberOfItems"].as_i64().unwrap();
    }
    // Newest first, undated day last.
    let dates: Vec<Option<&str>> = groups.iter().map(|g| g["date"].as_str()).collect();
    let mut sorted = dates.clone();
    sorted.sort_by(|a, b| match (a, b) {
        (Some(a), Some(b)) => b.cmp(a),
        (None, None) => std::cmp::Ordering::Equal,
        (None, _) => std::cmp::Ordering::Greater,
        (_, None) => std::cmp::Ordering::Less,
    });
    assert_eq!(dates, sorted);

    // Each day page agrees with the list.
    let mut seen = 0;
    for g in &groups {
        let id = g["id"].as_str().unwrap();
        let res = app
            .get(&format!("/api/albums/date/{id}?page=1"), Some(&alice))
            .await;
        assert_eq!(res.status, StatusCode::OK, "day {id}");
        let r = &res.json()["results"];
        assert_eq!(r["id"], g["id"]);
        assert_eq!(r["incomplete"], false);
        assert_eq!(r["numberOfItems"], g["numberOfItems"]);
        let items = r["items"].as_array().unwrap();
        seen += items.len() as i64;
        for it in items {
            assert!(it["aspectRatio"].is_number());
            assert_eq!(it["owner"]["username"], "alice");
        }
    }
    assert_eq!(seen, total);

    // Filters narrow the list.
    for q in [
        "favorite=true",
        "video=true",
        "hidden=true",
        "in_trashcan=true",
        "public=true",
    ] {
        let res = app
            .get(&format!("/api/albums/date/list/?{q}"), Some(&alice))
            .await;
        assert_eq!(res.status, StatusCode::OK, "{q}");
        assert!(res.json()["results"].is_array());
    }
    let bad = app
        .get("/api/albums/date/list/?person=abc", Some(&alice))
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    app.cleanup().await;
}

#[tokio::test]
async fn date_page_paging_and_authz() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let (biggest, n): (i32, i64) = lp_db::sql::query_as(
        "SELECT a.id, count(*) FROM api_albumdate a JOIN api_albumdate_photos ap ON ap.albumdate_id = a.id \
         JOIN api_user u ON u.id = a.owner_id WHERE u.username = 'alice' GROUP BY a.id \
         ORDER BY count(*) DESC, a.id LIMIT 1",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert!(n >= 2, "fixture has a multi-photo day");

    let get = |q: String| {
        let app = &app;
        let alice = alice.clone();
        async move {
            let res = app
                .get(&format!("/api/albums/date/{biggest}?{q}"), Some(&alice))
                .await;
            assert_eq!(res.status, StatusCode::OK, "{q}");
            res.json()["results"].clone()
        }
    };
    let all = get("page=1".into()).await;
    let count = all["numberOfItems"].as_i64().unwrap();
    let ids: Vec<Value> = all["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].clone())
        .collect();
    assert_eq!(ids.len() as i64, count);
    // size=1: page 2 is the second photo; past the end and below 1 clamp to the last page.
    let p2 = get("size=1&page=2".into()).await;
    assert_eq!(p2["items"][0]["id"], ids[1]);
    let last = get("size=1&page=999".into()).await;
    assert_eq!(last["items"][0]["id"], ids[ids.len() - 1]);
    let zero = get("size=1&page=0".into()).await;
    assert_eq!(zero["items"][0]["id"], ids[ids.len() - 1]);
    let junk = get("size=1&page=abc".into()).await;
    assert_eq!(junk["items"][0]["id"], ids[0]);

    // Someone else's day, an unknown one, a non-numeric id: 404; anonymous: 401.
    let res = app
        .get(&format!("/api/albums/date/{biggest}"), Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        res.json()["errors"][0]["message"],
        "No AlbumDate matches the given query."
    );
    let res = app.get("/api/albums/date/99999999", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = app.get("/api/albums/date/abc", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = app.get(&format!("/api/albums/date/{biggest}"), None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // Public view: only days holding a public photo, only public photos.
    let (public_day,): (i32,) = lp_db::sql::query_as(
        "SELECT a.id FROM api_albumdate a JOIN api_albumdate_photos ap ON ap.albumdate_id = a.id \
         JOIN api_photo p ON p.id = ap.photo_id WHERE p.public ORDER BY a.id LIMIT 1",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    let res = app
        .get(&format!("/api/albums/date/{public_day}?public=true"), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let res = app
        .get(
            &format!("/api/albums/date/{public_day}?public=true&username=nobody"),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    app.cleanup().await;
}

/// `_public_place` indexes whatever `places` holds: a scalar used to make
/// `jsonb_array_length` fail, a 500 for the whole public timeline.
#[tokio::test]
async fn public_place_tolerates_scalar_places() {
    let app = TestApp::new().await;
    let (day, photo): (i32, DjUuid) = lp_db::sql::query_as(
        "SELECT ap.albumdate_id, p.id FROM api_albumdate_photos ap JOIN api_photo p ON p.id = ap.photo_id \
         WHERE p.public AND NOT p.hidden AND NOT p.in_trashcan ORDER BY p.id LIMIT 1",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    // Leave this photo the only geotagged public one of its day.
    lp_db::sql::query(
        "UPDATE api_photo SET geolocation_json = '{}' WHERE id IN \
         (SELECT photo_id FROM api_albumdate_photos WHERE albumdate_id = $1)",
    )
    .bind(day)
    .execute(app.pool())
    .await
    .unwrap();
    lp_db::sql::query(
        r#"UPDATE api_photo SET geolocation_json = '{"places": "ab"}' WHERE id = $1"#,
    )
    .bind(photo)
    .execute(app.pool())
    .await
    .unwrap();
    lp_db::sql::query(r#"UPDATE api_albumdate SET location = '{"places": "Xyz"}' WHERE id = $1"#)
        .bind(day)
        .execute(app.pool())
        .await
        .unwrap();

    let res = app.get("/api/albums/date/list/?public=true", None).await;
    assert_eq!(res.status, StatusCode::OK);
    let group = res.json()["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["id"].as_str() == Some(day.to_string().as_str()))
        .cloned()
        .expect("public day listed");
    assert_eq!(group["location"], "a");
    let res = app
        .get(&format!("/api/albums/date/{day}?public=true"), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["results"]["location"], "a");

    let owner = lp_db::sql::query_scalar::<_, String>(
        "SELECT u.username FROM api_albumdate a JOIN api_user u ON u.id = a.owner_id WHERE a.id = $1",
    )
    .bind(day)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let tok = token(&app, &owner).await;
    let res = app
        .get(&format!("/api/albums/date/{day}"), Some(&tok))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["results"]["location"], "X");
    app.cleanup().await;
}

#[tokio::test]
async fn recently_added_and_no_timestamp() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    let res = app.get("/api/photos/recentlyadded/", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert!(body["date"].as_str().unwrap().ends_with('Z'));
    assert!(!body["results"].as_array().unwrap().is_empty());
    assert_eq!(
        app.get("/api/photos/recentlyadded/", None).await.status,
        StatusCode::UNAUTHORIZED
    );

    let (expected,): (i64,) = lp_db::sql::query_as(format!(
        "SELECT count(*) FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         WHERE u.username = 'alice' AND p.exif_timestamp IS NULL AND {VISIBLE}"
    ))
    .fetch_one(app.pool())
    .await
    .unwrap();
    let res = app.get("/api/photos/notimestamp/", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(body["count"], expected);
    assert_eq!(
        body["results"].as_array().unwrap().len() as i64,
        expected.min(100)
    );
    assert!(body["next"].is_null() && body["previous"].is_null());
    let res = app
        .get("/api/photos/notimestamp/?page=99", Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    if expected >= 2 {
        let res = app
            .get("/api/photos/notimestamp/?page_size=1&page=2", Some(&alice))
            .await;
        let body = res.json();
        assert!(
            body["previous"]
                .as_str()
                .unwrap()
                .contains("/api/photos/notimestamp/")
        );
        assert_eq!(body["results"].as_array().unwrap().len(), 1);
    }
    app.cleanup().await;
}

#[tokio::test]
async fn empty_library() {
    let app = TestApp::shared().await;
    let name = format!("tl_empty_{}", &Uuid::new_v4().simple().to_string()[..8]);
    let u = app.create_user(&name, "pw", false).await;
    let t = app.token_for(&u);
    let body = app.get("/api/photos/recentlyadded/", Some(&t)).await.json();
    assert_eq!(body, json!({"date": "", "results": []}));
    let body = app.get("/api/photos/notimestamp/", Some(&t)).await.json();
    assert_eq!(body["count"], 0);
    let body = app.get("/api/albums/date/list/", Some(&t)).await.json();
    assert_eq!(body, json!({"results": []}));
    let body = app.get("/api/memories", Some(&t)).await.json();
    assert_eq!(body["results"], json!([]));
    assert_eq!(body["window_days"], 3);
    app.cleanup().await;
}

#[tokio::test]
async fn memories_around_an_anniversary() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    assert_eq!(
        app.get("/api/memories", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    // A day of alice's two years before the reference date.
    let (day,): (chrono::NaiveDate,) = lp_db::sql::query_as(
        "SELECT a.date FROM api_albumdate a JOIN api_user u ON u.id = a.owner_id \
         JOIN api_albumdate_photos ap ON ap.albumdate_id = a.id \
         JOIN api_photo p ON p.id = ap.photo_id \
         WHERE u.username = 'alice' AND a.date IS NOT NULL AND NOT p.hidden AND NOT p.in_trashcan \
           AND NOT p.is_screenshot AND NOT p.is_document \
         ORDER BY a.date DESC LIMIT 1",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    use chrono::Datelike;
    let reference = day.with_year(day.year() + 2).unwrap_or(day);
    let res = app
        .get(
            &format!("/api/memories?date={}&size=1", reference.format("%Y-%m-%d")),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(body["date"], reference.format("%Y-%m-%d").to_string());
    let results = body["results"].as_array().unwrap();
    let m = results
        .iter()
        .find(|m| m["years_ago"] == 2)
        .expect("a memory two years ago");
    assert_eq!(m["type"], "years_ago");
    assert_eq!(m["id"], format!("years_ago-{}", day.year()));
    assert_eq!(m["items"].as_array().unwrap().len(), 1);
    assert!(m["numberOfItems"].as_i64().unwrap() >= 1);
    assert!(m["cover"]["id"].is_string());
    app.cleanup().await;
}

#[tokio::test]
async fn photo_detail_fields_and_access() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let dave = token(&app, "dave").await;

    let (ocr_id, ocr_hash) = photo_where(
        &app,
        &format!("u.username = 'alice' AND EXISTS (SELECT 1 FROM api_photo_ocr o WHERE o.photo_id = p.id) AND {VISIBLE}"),
    )
    .await;
    for key in [ocr_hash.clone(), ocr_id.to_string()] {
        let res = app.get(&format!("/api/photos/{key}/"), Some(&alice)).await;
        assert_eq!(res.status, StatusCode::OK, "{key}");
        let d = res.json();
        assert_eq!(d["id"], ocr_id.to_string());
        for f in [
            "image_hash",
            "image_path",
            "video",
            "embedded_media",
            "rating",
            "hidden",
            "exif_timestamp",
            "exif_gps_lat",
            "exif_gps_lon",
            "search_location",
            "camera",
            "lens",
            "fstop",
            "iso",
            "focal_length",
            "shutter_speed",
            "subjectDistance",
            "focalLength35Equivalent",
            "digitalZoomRatio",
            "width",
            "height",
            "size",
            "captions_json",
            "people",
            "similar_photos",
            "owner",
            "metadata",
            "ocr",
        ] {
            assert!(d.get(f).is_some(), "missing {f}");
        }
        assert!(d.get("exif_json").is_none());
        assert!(!d["ocr"]["blocks"].as_array().unwrap().is_empty());
        for b in d["ocr"]["blocks"].as_array().unwrap() {
            for pt in b["box"].as_array().unwrap() {
                let x = pt[0].as_f64().unwrap();
                assert!((0.0..=1.0).contains(&x));
            }
        }
        assert!(
            d["big_thumbnail_url"]
                .as_str()
                .unwrap()
                .starts_with("/media/thumbnails_big/")
        );
    }

    // Shared directly to bob: visible, but OCR is owner-only.
    let (shared_id, _) = photo_where(
        &app,
        &format!("u.username = 'alice' AND EXISTS (SELECT 1 FROM api_photo_shared_to s JOIN api_user su ON su.id = s.user_id \
          WHERE s.photo_id = p.id AND su.username = 'bob') AND {VISIBLE}"),
    )
    .await;
    let res = app
        .get(&format!("/api/photos/{shared_id}/"), Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert!(res.json()["ocr"].is_null());
    let res = app
        .get(&format!("/api/photos/{shared_id}/"), Some(&dave))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        app.get(&format!("/api/photos/{shared_id}/"), None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );

    // Public: anyone, anonymous included.
    let (public_id, _) = photo_where(&app, &format!("p.public AND {VISIBLE}")).await;
    assert_eq!(
        app.get(&format!("/api/photos/{public_id}/"), None)
            .await
            .status,
        StatusCode::OK
    );

    // Photo.visible excludes hidden photos, even for their owner.
    let (hidden_id, _) = photo_where(&app, "u.username = 'alice' AND p.hidden").await;
    assert_eq!(
        app.get(&format!("/api/photos/{hidden_id}/"), Some(&alice))
            .await
            .status,
        StatusCode::NOT_FOUND
    );

    // Stacks and file variants.
    let (stacked, _) = photo_where(
        &app,
        &format!("EXISTS (SELECT 1 FROM api_photo_stacks ps JOIN api_photostack s ON s.id = ps.photostack_id \
          WHERE ps.photo_id = p.id AND s.stack_type = 'burst') AND {VISIBLE}"),
    )
    .await;
    let d = app
        .get(&format!("/api/photos/{stacked}/"), Some(&alice))
        .await
        .json();
    let st = &d["stacks"][0];
    assert_eq!(st["type"], "burst");
    assert_eq!(st["type_display"], "Burst Sequence");
    assert_eq!(
        st["photo_count"].as_u64().unwrap() as usize,
        st["photos"].as_array().unwrap().len()
    );
    let (multi, _) = photo_where(
        &app,
        &format!(
            "(SELECT count(*) FROM api_photo_files pf WHERE pf.photo_id = p.id) > 1 AND {VISIBLE}"
        ),
    )
    .await;
    let d = app
        .get(&format!("/api/photos/{multi}/"), Some(&alice))
        .await
        .json();
    let variants = d["file_variants"].as_array().unwrap();
    assert!(variants.len() > 1);
    assert_eq!(variants.iter().filter(|v| v["is_main"] == true).count(), 1);
    app.cleanup().await;
}

#[tokio::test]
async fn photo_albums_scope() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    let dave = token(&app, "dave").await;
    let (in_album, hash) = photo_where(
        &app,
        "u.username = 'alice' AND NOT p.public AND EXISTS (SELECT 1 FROM api_albumuser_photos ap \
         JOIN api_albumuser a ON a.id = ap.albumuser_id WHERE ap.photo_id = p.id AND a.owner_id = p.owner_id) \
         AND NOT EXISTS (SELECT 1 FROM api_photo_shared_to s WHERE s.photo_id = p.id)",
    )
    .await;
    let res = app
        .get(&format!("/api/photos/{hash}/albums/"), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let albums = res.json()["results"].as_array().unwrap().clone();
    assert!(!albums.is_empty());
    for a in &albums {
        assert!(a["id"].is_number());
        assert!(a["photo_count"].as_i64().unwrap() >= 1);
        assert!(a["cover_photo"]["image_hash"].is_string());
        assert!(a["created_on"].as_str().unwrap().ends_with('Z'));
    }
    let res = app
        .get(&format!("/api/photos/{in_album}/albums/"), Some(&dave))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert!(res.body.is_empty());
    let (public, _) = photo_where(&app, "p.public").await;
    let res = app
        .get(&format!("/api/photos/{public}/albums/"), None)
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json(), json!({"results": []}));
    app.cleanup().await;
}

#[tokio::test]
async fn metadata_get_scope() {
    let app = TestApp::shared().await;
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let admin = token(&app, "admin").await;
    let (id, hash) = photo_where(&app, "u.username = 'alice'").await;
    for key in [id.to_string(), hash.clone()] {
        let res = app
            .get(&format!("/api/photos/{key}/metadata"), Some(&alice))
            .await;
        assert_eq!(res.status, StatusCode::OK);
        let m = res.json();
        for f in [
            "id",
            "camera_display",
            "resolution",
            "has_location",
            "keywords",
            "source",
            "version",
            "edit_history",
            "sidecar_files",
        ] {
            assert!(m.get(f).is_some(), "missing {f}");
        }
    }
    let res = app
        .get(&format!("/api/photos/{id}/metadata"), Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = app
        .get(&format!("/api/photos/{id}/metadata"), Some(&admin))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        app.get(&format!("/api/photos/{id}/metadata"), None)
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    let res = app.get("/api/photos/NOT-HEX/metadata", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    app.cleanup().await;
}

#[tokio::test]
async fn metadata_patch_tracks_edits_and_tags() {
    let app = TestApp::new().await;
    let alice = token(&app, "alice").await;
    let (id, _) = photo_where(&app, &format!("u.username = 'alice' AND {VISIBLE}")).await;
    let before = app
        .get(&format!("/api/photos/{id}/metadata"), Some(&alice))
        .await
        .json();
    let version = before["version"].as_i64().unwrap();

    let res = app
        .patch_json(
            &format!("/api/photos/{id}/metadata"),
            &json!({"rating": "x", "title": "y".repeat(501)}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    let errs = res.json()["errors"].clone();
    assert_eq!(errs[0]["field"], "title");
    assert_eq!(errs[1]["field"], "rating");

    let res = app
        .patch_json(
            &format!("/api/photos/{id}/metadata"),
            &json!({"title": "  Sunset  ", "keywords": ["tl-kw-a", "tl-kw-b"], "rating": 4, "unknown": 1}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let m = res.json();
    assert_eq!(m["title"], "Sunset");
    assert_eq!(m["source"], "user_edit");
    assert_eq!(m["version"].as_i64().unwrap(), version + 1);
    let fields: Vec<&str> = m["edit_history"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field_name"].as_str().unwrap())
        .collect();
    // Created in serializer field order, listed newest first.
    assert!(
        fields.starts_with(&["rating", "keywords", "title"]),
        "{fields:?}"
    );
    assert_eq!(m["edit_history"][0]["user_name"], "alice");

    let tags: Vec<(String, i32)> = lp_db::sql::query_as(
        "SELECT t.name, t.photo_count FROM api_tag t JOIN api_tag_photos tp ON tp.tag_id = t.id \
         WHERE tp.photo_id = $1 AND t.name LIKE 'tl-kw-%' ORDER BY t.name",
    )
    .bind(id)
    .fetch_all(app.pool())
    .await
    .unwrap();
    assert_eq!(tags, vec![("tl-kw-a".into(), 1), ("tl-kw-b".into(), 1)]);

    // Dropping a keyword detaches its tag; an unchanged value adds no edit.
    let res = app
        .patch_json(
            &format!("/api/photos/{id}/metadata"),
            &json!({"keywords": ["tl-kw-b"], "title": "Sunset"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let m = res.json();
    assert_eq!(m["edit_history"][0]["field_name"], "keywords");
    assert_eq!(m["edit_history"][1]["field_name"], "rating");
    let (a_count,): (i32,) =
        lp_db::sql::query_as("SELECT photo_count FROM api_tag WHERE name = 'tl-kw-a'")
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(a_count, 0);

    let bob = token(&app, "bob").await;
    let res = app
        .patch_json(
            &format!("/api/photos/{id}/metadata"),
            &json!({"title": "x"}),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    app.cleanup().await;
}

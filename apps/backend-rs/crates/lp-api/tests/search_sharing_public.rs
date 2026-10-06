//! Search, sharing and public pages on the fixture (lp_fixture clones).
#![allow(clippy::disallowed_methods)] // seeds rows for the mutation cases

use std::collections::BTreeSet;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use lp_testkit::TestApp;
use serde_json::Value;

fn manifest() -> Value {
    let path = std::env::var("LP_MANIFEST")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json".into());
    serde_json::from_str(&std::fs::read_to_string(path).expect("fixture manifest"))
        .expect("manifest json")
}

fn photo<'a>(m: &'a Value, key: &str) -> &'a Value {
    &m["photos"][key]
}

async fn token(app: &TestApp, username: &str) -> String {
    let user = lp_db::users::by_username(app.pool(), username)
        .await
        .unwrap()
        .expect("fixture user");
    app.token_for(&user)
}

fn grouped_hashes(body: &Value) -> Vec<String> {
    body["results"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|g| g["items"].as_array().unwrap().iter())
        .map(|i| i["image_hash"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn search_list() {
    let app = TestApp::shared().await;
    let m = manifest();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;

    // Anonymous: 401; a bad header token: 401.
    let res = app.get("/api/photos/searchlist/?search=berlin", None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    let res = app
        .get("/api/photos/searchlist/?search=berlin", Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    let hashes = grouped_hashes(&body);
    assert!(
        hashes.contains(
            &photo(&m, "alice/berlin_01")["image_hash"]
                .as_str()
                .unwrap()
                .to_string()
        )
    );
    let group = &body["results"][0];
    assert_eq!(group["location"], "");
    assert!(group["date"].as_str().unwrap().ends_with('Z'));
    let item = &group["items"][0];
    let keys: Vec<&String> = item.as_object().unwrap().keys().collect();
    assert_eq!(keys.first().unwrap().as_str(), "id");
    assert!(item["aspectRatio"].is_number());

    // OCR full-text: alice's invoice, nobody else's.
    let res = app
        .get("/api/photos/searchlist/?search=Invoice", Some(&alice))
        .await;
    let ocr = grouped_hashes(&res.json());
    let expected: Vec<String> = m["categories"]["ocr"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| {
            photo(&m, k.as_str().unwrap())["image_hash"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert!(!expected.is_empty());
    assert!(expected.iter().all(|h| ocr.contains(h)));
    let res = app
        .get("/api/photos/searchlist/?search=Invoice", Some(&bob))
        .await;
    assert_eq!(res.json()["results"], serde_json::json!([]));

    // Terms are AND-ed; a term with no match empties the result.
    let res = app
        .get(
            "/api/photos/searchlist/?search=berlin%20zzz-nothing",
            Some(&alice),
        )
        .await;
    assert_eq!(res.json()["results"], serde_json::json!([]));

    // Empty search lists every visible photo exactly once; hidden ones never.
    let res = app
        .get("/api/photos/searchlist/?search=", Some(&alice))
        .await;
    let all = grouped_hashes(&res.json());
    let unique: BTreeSet<&String> = all.iter().collect();
    assert_eq!(unique.len(), all.len());
    for key in m["categories"]["hidden"].as_array().unwrap() {
        let h = photo(&m, key.as_str().unwrap())["image_hash"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!all.contains(&h));
    }
    // "No timestamp" photos come last.
    let groups = res.json()["results"].as_array().unwrap().clone();
    assert_eq!(groups.last().unwrap()["date"], "No timestamp");

    // Media filters: video wins over photo.
    let res = app
        .get(
            "/api/photos/searchlist/?search=&video=true&photo=true",
            Some(&alice),
        )
        .await;
    let body = res.json();
    let items: Vec<&Value> = body["results"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|g| g["items"].as_array().unwrap().iter())
        .collect();
    assert!(!items.is_empty());
    assert!(items.iter().all(|i| i["type"] == "video"));
    let res = app
        .get(
            "/api/photos/searchlist/?search=&is_screenshot=true",
            Some(&alice),
        )
        .await;
    let shots = grouped_hashes(&res.json());
    let expected: BTreeSet<String> = m["photos"]
        .as_object()
        .unwrap()
        .values()
        .filter(|p| {
            p["owner"] == "alice"
                && p["is_screenshot"] == true
                && p["hidden"] == false
                && p["in_trashcan"] == false
                && p["removed"] == false
        })
        .map(|p| p["image_hash"].as_str().unwrap().to_string())
        .collect();
    assert!(!expected.is_empty());
    assert_eq!(shots.into_iter().collect::<BTreeSet<_>>(), expected);

    // LIKE metacharacters are literal.
    let res = app
        .get("/api/photos/searchlist/?search=%25", Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);

    // DRF's CharField rejects NUL characters.
    let res = app
        .get("/api/photos/searchlist/?search=a%00b", Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json()["errors"][0]["field"], "non_field_errors");
    app.cleanup().await;
}

#[tokio::test]
async fn search_term_examples() {
    let app = TestApp::shared().await;
    let res = app.get("/api/searchtermexamples/", None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // dave has no captioned photos: the default prompts.
    let dave = token(&app, "dave").await;
    let res = app.get("/api/searchtermexamples/", Some(&dave)).await;
    let got: BTreeSet<String> = serde_json::from_value(res.json()["results"].clone()).unwrap();
    let want: BTreeSet<String> = [
        "for people",
        "for places",
        "for things",
        "for time",
        "for file path or file name",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    assert_eq!(got, want);

    let alice = token(&app, "alice").await;
    let res = app.get("/api/searchtermexamples/", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    let terms: Vec<String> = serde_json::from_value(res.json()["results"].clone()).unwrap();
    assert!(!terms.is_empty());
    assert!(terms.iter().all(|t| !t.is_empty() && t.trim() == t));
    assert_eq!(terms.iter().collect::<BTreeSet<_>>().len(), terms.len());
    assert!(
        terms
            .iter()
            .any(|t| t.len() == 4 && t.chars().all(|c| c.is_ascii_digit()))
    );
    assert!(!terms.contains(&"for people".to_string()));
    // Cached per user.
    let again = app.get("/api/searchtermexamples/", Some(&alice)).await;
    assert_eq!(again.json()["results"], res.json()["results"]);
    app.cleanup().await;
}

#[tokio::test]
async fn shared_photo_lists() {
    let app = TestApp::shared().await;
    let m = manifest();
    let bob = token(&app, "bob").await;
    let alice = token(&app, "alice").await;
    let dave = token(&app, "dave").await;

    assert_eq!(
        app.get("/api/photos/shared/tome/", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.get("/api/photos/shared/fromme/", None).await.status,
        StatusCode::UNAUTHORIZED
    );

    let res = app.get("/api/photos/shared/tome/", Some(&bob)).await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    let keys: Vec<&String> = body.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["count", "next", "previous", "results"]);
    let visible: BTreeSet<String> = m["categories"]["shared_to_bob"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| photo(&m, k.as_str().unwrap()))
        .filter(|p| p["hidden"] == false && p["in_trashcan"] == false && p["removed"] == false)
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    let got: BTreeSet<String> = body["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(got, visible);
    assert_eq!(body["count"], visible.len());
    assert_eq!(body["results"][0]["owner"]["username"], "alice");

    // Oldest first, pages of one with DRF links (trailing slash kept).
    let res = app
        .get("/api/photos/shared/tome?page_size=1", Some(&bob))
        .await;
    let body = res.json();
    assert_eq!(body["results"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["next"],
        "http://localhost/api/photos/shared/tome/?page=2&page_size=1"
    );
    let res = app
        .get("/api/photos/shared/tome/?page_size=1&page=99", Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(res.json()["errors"][0]["message"], "Invalid page.");

    let res = app.get("/api/photos/shared/tome/", Some(&dave)).await;
    assert_eq!(res.json()["count"], 0);

    let res = app.get("/api/photos/shared/fromme/", Some(&alice)).await;
    let body = res.json();
    let rows = body["results"].as_array().unwrap();
    assert!(!rows.is_empty());
    for r in rows {
        let keys: Vec<&String> = r.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["user_id", "user", "photo"]);
        assert_eq!(r["user_id"], r["user"]["id"]);
        assert_eq!(r["photo"]["owner"]["username"], "alice");
    }
    let res = app.get("/api/photos/shared/fromme/", Some(&bob)).await;
    assert_eq!(res.json()["results"], serde_json::json!([]));
    app.cleanup().await;
}

#[tokio::test]
async fn public_pages_on_the_fixture() {
    let app = TestApp::shared().await;
    let m = manifest();
    let slug = m["shares"]["public_album"]["slug"]
        .as_str()
        .unwrap()
        .to_string();
    let trip = &m["albums"]["user"]["public_trip"];

    let res = app
        .get(&format!("/api/public/albums/s/{slug}/"), None)
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    let album = &body["results"];
    let keys: Vec<&String> = album.as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        ["id", "title", "owner", "date", "location", "grouped_photos"]
    );
    assert_eq!(album["id"], trip["id"].to_string());
    assert_eq!(album["date"], "");
    let groups = album["grouped_photos"].as_array().unwrap();
    assert_eq!(groups.len(), 1);
    assert!(groups[0]["date"].is_null());
    let ids: BTreeSet<&str> = groups[0]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap())
        .collect();
    let want: BTreeSet<&str> = trip["photos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(ids, want);
    for i in groups[0]["items"].as_array().unwrap() {
        assert_eq!(i["date"], "");
        assert_eq!(i["birthTime"], "");
        assert!(i["exif_gps_lat"].is_null());
        assert_eq!(i["location"], "");
    }
    assert_eq!(body["sharing_settings"]["share_location"], false);

    // Signed in or not, same page; a bad header token is still a 401.
    let dave = token(&app, "dave").await;
    let res = app
        .get(&format!("/api/public/albums/s/{slug}/"), Some(&dave))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let res = app
        .get(&format!("/api/public/albums/s/{slug}/"), Some("garbage"))
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // Expired and unknown: a bare 404.
    let expired = m["shares"]["expired_album"]["slug"].as_str().unwrap();
    for path in [
        format!("/api/public/albums/s/{expired}/"),
        "/api/public/albums/s/nope/".to_string(),
        "/api/public/photo/nope/".to_string(),
    ] {
        let res = app.get(&path, None).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{path}");
        assert!(res.body.is_empty(), "{path}");
    }

    // A photo of the album, by hash and by id.
    let first_id = trip["photos"][0].as_str().unwrap();
    let first = m["photos"]
        .as_object()
        .unwrap()
        .values()
        .find(|p| p["id"] == first_id)
        .unwrap();
    for r in [first["image_hash"].as_str().unwrap(), first_id] {
        let res = app
            .get(&format!("/api/public/albums/s/{slug}/photos/{r}/"), None)
            .await;
        assert_eq!(res.status, StatusCode::OK, "{}", res.text());
        let d = &res.json()["results"];
        assert_eq!(d["image_hash"], first["image_hash"]);
        assert!(
            d["big_thumbnail_url"]
                .as_str()
                .unwrap()
                .starts_with("/media/thumbnails_big/")
        );
        assert!(d["exif_timestamp"].is_null());
        assert_eq!(d["width"], 0);
        assert_eq!(d["captions_json"], serde_json::json!({"im2txt": ""}));
        assert_eq!(d["people"], serde_json::json!([]));
    }
    let outside = photo(&m, "alice/e2e_01")["image_hash"].as_str().unwrap();
    let res = app
        .get(
            &format!("/api/public/albums/s/{slug}/photos/{outside}/"),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        res.json(),
        serde_json::json!({"error": "Photo not found in album"})
    );
    let res = app
        .get(
            &format!("/api/public/albums/s/{expired}/photos/{outside}/"),
            None,
        )
        .await;
    assert_eq!(
        res.json(),
        serde_json::json!({"error": "Album not found or not public"})
    );

    // The photo link: no hash-derived fields, slug-scoped media.
    let pslug = m["shares"]["photo_share"]["slug"].as_str().unwrap();
    let res = app.get(&format!("/api/public/photo/{pslug}/"), None).await;
    assert_eq!(res.status, StatusCode::OK);
    let r = &res.json()["results"];
    for k in [
        "image_hash",
        "square_thumbnail_url",
        "big_thumbnail_url",
        "small_square_thumbnail_url",
    ] {
        assert!(r.get(k).is_none(), "{k}");
    }
    assert_eq!(
        r["thumbnail_url"],
        format!("/api/public/photo/{pslug}/media/thumbnail/")
    );
    assert!(r["video_url"].is_null());
    let keys: Vec<&String> = r.as_object().unwrap().keys().collect();
    assert_eq!(keys.last().unwrap().as_str(), "video_url");
    app.cleanup().await;
}

/// Sharing options switched on, a revoked photo link, and the shared tags join.
#[tokio::test]
async fn public_pages_with_sharing_options_and_search_semantics() {
    let app = TestApp::new().await;
    let m = manifest();
    let db = app.pool();
    let trip_id = m["albums"]["user"]["public_trip"]["id"].as_i64().unwrap() as i32;
    let e2e_01 = photo(&m, "alice/e2e_01");
    let e2e_01_id: uuid::Uuid = e2e_01["id"].as_str().unwrap().parse().unwrap();
    let video_id: uuid::Uuid = photo(&m, "alice/video")["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    lp_db::sql::query(
        "INSERT INTO api_albumuser_photos (albumuser_id, photo_id) VALUES ($1, $2), ($1, $3)",
    )
    .bind(trip_id)
    .bind(e2e_01_id)
    .bind(video_id)
    .execute(db)
    .await
    .unwrap();
    lp_db::sql::query(
        "UPDATE api_albumusershare SET share_location = true, share_timestamps = true, \
         share_captions = true, share_faces = true, share_camera_info = true WHERE album_id = $1",
    )
    .bind(trip_id)
    .execute(db)
    .await
    .unwrap();

    let slug = m["shares"]["public_album"]["slug"].as_str().unwrap();
    let res = app
        .get(&format!("/api/public/albums/s/{slug}/"), None)
        .await;
    let body = res.json();
    let album = &body["results"];
    assert!(album["date"].as_str().unwrap().ends_with('Z'));
    assert_ne!(album["location"], "");
    let groups = album["grouped_photos"].as_array().unwrap();
    assert!(groups.len() >= 2);
    assert!(groups.iter().all(|g| g["date"].is_string()));
    let berlin = groups
        .iter()
        .flat_map(|g| g["items"].as_array().unwrap())
        .find(|i| i["exif_gps_lat"].is_number())
        .expect("GPS is shared now");
    assert!(berlin["date"].as_str().unwrap().ends_with("+00:00"));
    assert_eq!(body["sharing_settings"]["share_faces"], true);

    // ?video=true keeps only the video; the album date still comes from all photos.
    let res = app
        .get(&format!("/api/public/albums/s/{slug}/?video=true"), None)
        .await;
    let only: Vec<Value> = res.json()["results"]["grouped_photos"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|g| g["items"].as_array().unwrap().clone())
        .collect();
    assert_eq!(only.len(), 1);
    assert_eq!(only[0]["type"], "video");

    let hash = e2e_01["image_hash"].as_str().unwrap();
    let res = app
        .get(&format!("/api/public/albums/s/{slug}/photos/{hash}/"), None)
        .await;
    let d = res.json()["results"].clone();
    assert!(d["exif_timestamp"].as_str().unwrap().ends_with('Z'));
    assert_ne!(d["captions_json"], serde_json::json!({"im2txt": ""}));
    assert!(d["width"].as_i64().unwrap() > 0);
    let people = d["people"].as_array().unwrap();
    assert!(!people.is_empty());
    for p in people {
        assert!(p["face_url"].as_str().unwrap().starts_with("/media/faces/"));
        assert!(p["face_id"].is_number());
    }

    // The owner's defaults drive the photo link; faces become bare names.
    lp_db::sql::query(
        "UPDATE api_user SET public_sharing_defaults = '{\"share_faces\": true, \"share_timestamps\": true}' \
         WHERE username = 'alice'",
    )
    .execute(db)
    .await
    .unwrap();
    let pslug = m["shares"]["photo_share"]["slug"].as_str().unwrap();
    let res = app.get(&format!("/api/public/photo/{pslug}/"), None).await;
    let body = res.json();
    assert_eq!(body["sharing_settings"]["share_timestamps"], true);
    assert_eq!(body["sharing_settings"]["share_location"], false);
    assert!(body["results"]["exif_timestamp"].is_string());
    for p in body["results"]["people"].as_array().unwrap() {
        assert_eq!(p.as_object().unwrap().keys().collect::<Vec<_>>(), ["name"]);
    }
    // Revoked, or the photo trashed: 404.
    lp_db::sql::query("UPDATE api_photo SET in_trashcan = true WHERE id = (SELECT photo_id FROM api_photoshare WHERE slug = $1)")
        .bind(pslug)
        .execute(db)
        .await
        .unwrap();
    assert_eq!(
        app.get(&format!("/api/public/photo/{pslug}/"), None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );

    // One tag row must satisfy every term (Django filters in one `filter()`
    // call, so the tags join is shared): two separate tags do not match two
    // terms, one tag holding both does.
    let owner: i32 = lp_db::sql::query_scalar("SELECT id FROM api_user WHERE username = 'alice'")
        .fetch_one(db)
        .await
        .unwrap();
    let berlin_id: uuid::Uuid = photo(&m, "alice/berlin_01")["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    for name in ["qqalpha", "qqbeta"] {
        lp_db::sql::query(
            "WITH t AS (INSERT INTO api_tag (name, owner_id, photo_count, last_modified) VALUES ($1, $2, 1, now()) RETURNING id) \
             INSERT INTO api_tag_photos (tag_id, photo_id) SELECT id, $3 FROM t",
        )
        .bind(name)
        .bind(owner)
        .bind(berlin_id)
        .execute(db)
        .await
        .unwrap();
    }
    let alice = token(&app, "alice").await;
    let hits = |q: &'static str| {
        let app = &app;
        let alice = alice.clone();
        async move {
            grouped_hashes(
                &app.get(&format!("/api/photos/searchlist/?search={q}"), Some(&alice))
                    .await
                    .json(),
            )
        }
    };
    let berlin_hash = photo(&m, "alice/berlin_01")["image_hash"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(hits("qqalpha").await, vec![berlin_hash.clone()]);
    assert!(hits("qqalpha%20qqbeta").await.is_empty());
    // A caption match for one term plus a tag for the other does match.
    assert_eq!(hits("qqalpha%20berlin").await, vec![berlin_hash.clone()]);
    lp_db::sql::query(
        "INSERT INTO api_tag (name, owner_id, photo_count, last_modified) VALUES ('qqalpha qqbeta', $1, 1, now())",
    )
    .bind(owner)
    .execute(db)
    .await
    .unwrap();
    lp_db::sql::query(
        "INSERT INTO api_tag_photos (tag_id, photo_id) SELECT id, $1 FROM api_tag WHERE name = 'qqalpha qqbeta'",
    )
    .bind(berlin_id)
    .execute(db)
    .await
    .unwrap();
    assert_eq!(hits("qqalpha%20qqbeta").await, vec![berlin_hash]);
    app.cleanup().await;
}

#[tokio::test]
async fn bad_token_on_public_photo_is_401() {
    let app = TestApp::shared().await;
    let req = Request::get("/api/public/photo/whatever/")
        .header("authorization", "Bearer nope")
        .body(Body::empty())
        .unwrap();
    assert_eq!(app.request(req).await.status, StatusCode::UNAUTHORIZED);
    app.cleanup().await;
}

/// DRF's default authentication: the `jwt` cookie counts on media and upload
/// views only, and simplejwt's header scheme is exactly `Bearer`.
#[tokio::test]
async fn only_the_bearer_header_authenticates() {
    let app = TestApp::shared().await;
    let m = manifest();
    let bob = token(&app, "bob").await;
    let send = |path: String, name: &'static str, value: String| {
        let app = &app;
        async move {
            let req = Request::get(path)
                .header(name, value)
                .body(Body::empty())
                .unwrap();
            app.request(req).await.status
        }
    };
    for path in [
        "/api/photos/searchlist/?search=a",
        "/api/searchtermexamples/",
        "/api/photos/shared/tome/",
        "/api/photos/shared/fromme/",
        "/api/geocode/search?q=",
    ] {
        let cookie = send(path.into(), "cookie", format!("jwt={bob}")).await;
        assert_eq!(cookie, StatusCode::UNAUTHORIZED, "jwt cookie on {path}");
        let lower = send(path.into(), "authorization", format!("bearer {bob}")).await;
        assert_eq!(
            lower,
            StatusCode::UNAUTHORIZED,
            "lowercase scheme on {path}"
        );
        let ok = send(path.into(), "authorization", format!("Bearer {bob}")).await;
        assert_eq!(ok, StatusCode::OK, "Bearer header on {path}");
    }
    let public = [
        format!(
            "/api/public/albums/s/{}/",
            m["shares"]["public_album"]["slug"].as_str().unwrap()
        ),
        format!(
            "/api/public/photo/{}/",
            m["shares"]["photo_share"]["slug"].as_str().unwrap()
        ),
    ];
    for path in public {
        let foreign = send(path.clone(), "authorization", "BEARER nope".into()).await;
        assert_eq!(foreign, StatusCode::OK, "foreign scheme on {path}");
        let cookie = send(path.clone(), "cookie", "jwt=nope".into()).await;
        assert_eq!(cookie, StatusCode::OK, "junk cookie on {path}");
    }
    app.cleanup().await;
}

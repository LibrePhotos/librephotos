//! albums_tags: `page=last` / out-of-range pages on every list, the
//! `AlbumUserViewSet` list/create, the `AlbumUserEditViewSet` list,
//! retrieve, PUT and DELETE, PUT on user albums and tags, and the public
//! share expiry parsing.

#![allow(clippy::disallowed_methods)]

use axum::http::{Method, StatusCode};
use lp_testkit::{TestApp, TestResponse};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

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

fn first_message(res: &TestResponse) -> String {
    res.json()["errors"][0]["message"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

fn ids(body: &Value) -> Vec<Value> {
    body["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].clone())
        .collect()
}

#[tokio::test]
async fn last_and_out_of_range_pages() {
    let app = TestApp::shared().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let alice = token(&app, "alice").await;

    let res = app
        .get("/api/albums/user/list/?page=last&page_size=2", Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    assert_eq!(body["count"], 5);
    assert_eq!(body["next"], Value::Null);
    assert!(body["previous"].as_str().unwrap().contains("page=2"));
    assert_eq!(body["results"].as_array().unwrap().len(), 1);

    for path in [
        "/api/albums/user/shared/fromme/?page=last",
        "/api/albums/user/shared/tome/?page=last",
        "/api/albums/auto/list/?page=last",
        "/api/albums/thing/list/?page=last",
        "/api/albums/place/list/?page=last",
        "/api/tags/?page=last",
        "/api/albums/user/?page=last",
        "/api/albums/user/edit/?page=last",
    ] {
        let res = app.get(path, Some(&alice)).await;
        assert_eq!(res.status, StatusCode::OK, "{path}: {}", res.text());
    }
    for path in [
        "/api/tags/?page=99999999999999999",
        "/api/albums/user/list/?page=9223372036854775806",
        "/api/albums/auto/list/?page=4611686018427387904",
    ] {
        let res = app.get(path, Some(&alice)).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{path}: {}", res.text());
        assert_eq!(first_message(&res), "Invalid page.");
    }
    app.cleanup().await;
}

#[tokio::test]
async fn album_viewset_reads() {
    let app = TestApp::shared().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let db = app.pool().clone();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let carol = token(&app, "carol").await;
    let shared = album_id(&db, "Shared with Carol").await;
    let public = album_id(&db, "Public Trip").await;
    let vacation = album_id(&db, "Vacation 2024").await;

    // Own albums, newest first, as AlbumUserSerializer (string ids).
    let res = app.get("/api/albums/user/", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(body["count"], 5);
    let got = ids(&body);
    let mut sorted = got.clone();
    sorted.sort_by_key(|v| std::cmp::Reverse(v.as_str().unwrap().parse::<i32>().unwrap()));
    assert_eq!(got, sorted);
    let vacation_id = vacation.to_string();
    let vac = body["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"].as_str() == Some(vacation_id.as_str()))
        .unwrap();
    let detail = app
        .get(&format!("/api/albums/user/{vacation}/"), Some(&alice))
        .await
        .json();
    assert_eq!(vac, &detail);
    let videos = app
        .get("/api/albums/user/?video=true", Some(&alice))
        .await
        .json();
    for album in videos["results"].as_array().unwrap() {
        for group in album["grouped_photos"].as_array().unwrap() {
            for item in group["items"].as_array().unwrap() {
                assert_eq!(item["type"], "video");
            }
        }
    }

    // A recipient sees the album shared to them; strangers see nothing of it.
    let res = app.get("/api/albums/user/", Some(&carol)).await.json();
    assert_eq!(ids(&res), [json!(shared.to_string())]);
    let res = app.get("/api/albums/user/", Some(&bob)).await.json();
    assert!(!ids(&res).contains(&json!(shared.to_string())));
    let res = app.get("/api/albums/user/", None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // ?public lists active public shares to anyone, public serializer shape.
    let res = app.get("/api/albums/user/?public=true", None).await;
    assert_eq!(res.status, StatusCode::OK);
    let body = res.json();
    assert_eq!(ids(&body), [json!(public.to_string())]);
    let keys: Vec<&str> = body["results"][0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        ["id", "title", "owner", "date", "location", "grouped_photos"]
    );
    let one = app
        .get(&format!("/api/albums/user/{public}/?public=true"), None)
        .await
        .json();
    assert_eq!(body["results"][0], one);
    let res = app
        .get("/api/albums/user/?public=true&username=bob", None)
        .await
        .json();
    assert_eq!(res["count"], 0);

    // The edit viewset: own albums by title, retrieve, others' are missing.
    let res = app.get("/api/albums/user/edit/", Some(&alice)).await;
    assert_eq!(res.status, StatusCode::OK);
    let titles: Vec<String> = res.json()["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["title"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(titles.len(), 5);
    assert!(titles.contains(&"Vacation 2024".to_string()));
    let res = app
        .get(&format!("/api/albums/user/edit/{vacation}/"), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["photos"].as_array().unwrap().len(), 4);
    let res = app
        .get(&format!("/api/albums/user/edit/{vacation}/"), Some(&bob))
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(first_message(&res), "No AlbumUser matches the given query.");
    let res = app.get("/api/albums/user/edit/abc/", Some(&alice)).await;
    assert_eq!(first_message(&res), "Not found.");
    app.cleanup().await;
}

#[tokio::test]
async fn put_create_delete_and_expiry() {
    let app = TestApp::new().await;
    if !fixture(&app).await {
        return app.cleanup().await;
    }
    let db = app.pool().clone();
    let alice = token(&app, "alice").await;
    let bob = token(&app, "bob").await;
    let carol = token(&app, "carol").await;
    let shared = album_id(&db, "Shared with Carol").await;
    let vacation = album_id(&db, "Vacation 2024").await;
    let tag: i32 = sqlx::query_scalar("SELECT id FROM api_tag WHERE name = 'trips'")
        .fetch_one(&db)
        .await
        .unwrap();

    // PUT requires what PATCH may leave out.
    let res = app
        .send(
            Method::PUT,
            &format!("/api/tags/{tag}/"),
            Some(&json!({})),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json()["errors"][0]["field"], "name");
    assert_eq!(first_message(&res), "This field is required.");
    let res = app
        .send(
            Method::PUT,
            &format!("/api/tags/{tag}/"),
            Some(&json!({"name": " journeys "})),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["name"], "journeys");
    let res = app
        .send(
            Method::PUT,
            &format!("/api/tags/{tag}/"),
            Some(&json!({"name": "x"})),
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);

    let res = app
        .send(
            Method::PUT,
            &format!("/api/albums/user/{shared}/"),
            Some(&json!({})),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json()["errors"][0]["field"], "title");
    let res = app
        .send(
            Method::PUT,
            &format!("/api/albums/user/{shared}/"),
            Some(&json!({"title": "mine now"})),
            Some(&carol),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = app
        .send(
            Method::PUT,
            &format!("/api/albums/user/{shared}/"),
            Some(&json!({"title": "Shared with C."})),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["title"], "Shared with C.");
    assert_eq!(res.json()["id"], shared.to_string());

    // POST /albums/user/: a bare, empty album; a taken title is Django's 500.
    let res = app
        .post_json(
            "/api/albums/user/",
            &json!({"title": "Fresh"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.text());
    let fresh = res.json();
    assert_eq!(fresh["title"], "Fresh");
    assert_eq!(fresh["grouped_photos"], json!([]));
    assert_eq!(fresh["public"], false);
    let res = app
        .post_json(
            "/api/albums/user/",
            &json!({"title": "Fresh"}),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::INTERNAL_SERVER_ERROR);
    let res = app
        .post_json("/api/albums/user/", &json!({}), Some(&alice))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    let res = app
        .post_json("/api/albums/user/", &json!({"title": "x"}), None)
        .await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    // PUT on the edit viewset needs title and photos; DELETE is owner-only.
    let res = app
        .send(
            Method::PUT,
            &format!("/api/albums/user/edit/{vacation}/"),
            Some(&json!({"title": "Vacation 2024"})),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(res.json()["errors"][0]["field"], "photos");
    let fresh_id: i32 = fresh["id"].as_str().unwrap().parse().unwrap();
    let photo: Uuid = sqlx::query_scalar(
        "SELECT l.photo_id FROM api_albumuser_photos l WHERE l.albumuser_id = $1 LIMIT 1",
    )
    .bind(vacation)
    .fetch_one(&db)
    .await
    .unwrap();
    let res = app
        .send(
            Method::PUT,
            &format!("/api/albums/user/edit/{fresh_id}/"),
            Some(&json!({"title": "Fresher", "photos": [photo]})),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    assert_eq!(res.json()["photos"], json!([photo]));
    let res = app
        .delete(
            &format!("/api/albums/user/edit/{fresh_id}/"),
            None,
            Some(&bob),
        )
        .await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = app
        .delete(
            &format!("/api/albums/user/edit/{fresh_id}/"),
            None,
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
    let left: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_albumuser_photos WHERE albumuser_id = $1")
            .bind(fresh_id)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(left, 0);

    // expires_at: unreadable text clears it, an impossible date keeps it.
    let expiry = |db: PgPool| async move {
        sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
            "SELECT expires_at FROM api_albumusershare WHERE album_id = $1",
        )
        .bind(vacation)
        .fetch_one(&db)
        .await
        .unwrap()
    };
    let make_public =
        |expires: &str| json!({"album_id": vacation, "val_public": true, "expires_at": expires});
    let res = app
        .post_json(
            "/api/useralbum/makepublic",
            &make_public("2030-01-02T03:04:05Z"),
            Some(&alice),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let set = expiry(db.clone()).await;
    assert!(set.is_some());
    app.post_json(
        "/api/useralbum/makepublic",
        &make_public("2030-13-45T00:00"),
        Some(&alice),
    )
    .await;
    assert_eq!(expiry(db.clone()).await, set);
    app.post_json(
        "/api/useralbum/makepublic",
        &make_public("soon"),
        Some(&alice),
    )
    .await;
    assert_eq!(expiry(db.clone()).await, None);
    app.cleanup().await;
}

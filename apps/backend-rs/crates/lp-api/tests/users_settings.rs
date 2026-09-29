//! Area users_settings end to end through the full app, on clones of the
//! fixture (alice, bob, carol, dave, admin, the `deleted` user).
#![allow(clippy::disallowed_methods)] // raw SQL for setup and state checks

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use lp_db::users::User;
use lp_testkit::TestApp;
use serde_json::{Value, json};

async fn fixture_user(app: &TestApp, name: &str) -> User {
    lp_db::users::by_username(app.pool(), name)
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("fixture user {name}"))
}

async fn token(app: &TestApp, name: &str) -> String {
    let u = fixture_user(app, name).await;
    app.token_for(&u)
}

fn unique(prefix: &str) -> String {
    format!(
        "{prefix}{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    )
}

async fn scalar_i64(app: &TestApp, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(app.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn user_reads_follow_the_serializer_rules() {
    let app = TestApp::shared().await;
    let alice = fixture_user(&app, "alice").await;
    let bob = fixture_user(&app, "bob").await;
    let ta = token(&app, "alice").await;
    let tadmin = token(&app, "admin").await;
    let alice_photos = scalar_i64(
        &app,
        &format!(
            "SELECT count(*) FROM api_photo WHERE owner_id = {}",
            alice.id
        ),
    )
    .await;

    // Anonymous: only users that opted into public sharing (none in the fixture).
    let res = app.get("/api/user/", None).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(
        res.json(),
        json!({"count": 0, "next": null, "previous": null, "results": []})
    );

    // Non-admin list rows are the public serializer.
    let res = app.get("/api/user/", Some(&ta)).await;
    let body = res.json();
    let active = scalar_i64(&app, "SELECT count(*) FROM api_user WHERE is_active").await;
    assert_eq!(body["count"], json!(active));
    let row = body["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == json!(alice.id))
        .unwrap();
    let keys: Vec<&str> = row
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "id",
            "avatar_url",
            "username",
            "first_name",
            "last_name",
            "public_photo_count",
            "public_photo_samples",
            "public_sharing"
        ]
    );

    // Admin list rows are the full serializer.
    let res = app.get("/api/user/", Some(&tadmin)).await;
    let row = res.json()["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == json!(alice.id))
        .cloned()
        .unwrap();
    assert_eq!(row["photo_count"], json!(alice_photos));
    assert_eq!(row["email"], json!(alice.email));
    assert!(row.get("password").is_none());

    // Detail: self is full, others public, anonymous 404, unknown 404.
    let res = app
        .get(&format!("/api/user/{}/", alice.id), Some(&ta))
        .await;
    assert_eq!(res.status, StatusCode::OK);
    let me = res.json();
    assert_eq!(me["photo_count"], json!(alice_photos));
    assert!(me["datetime_rules"].is_string());
    assert!(me["date_joined"].as_str().unwrap().ends_with('Z'));
    assert!(
        me["public_photo_samples"].as_array().unwrap().len() as i64
            == me["public_photo_count"].as_i64().unwrap().min(10)
    );
    let res = app.get(&format!("/api/user/{}/", bob.id), Some(&ta)).await;
    assert!(res.json().get("email").is_none());
    let res = app.get(&format!("/api/user/{}/", alice.id), None).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    let res = app.get("/api/user/999999/", Some(&ta)).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        res.json()["errors"][0]["message"],
        json!("No User matches the given query.")
    );
    let res = app.get("/api/user/abc/", Some(&ta)).await;
    assert_eq!(res.json()["errors"][0]["message"], json!("Not found."));

    // LimitOffset links keep the trailing slash and sort their keys.
    let res = app
        .request(
            Request::get("/api/user/?offset=1&limit=1")
                .header("host", "example.com")
                .header("authorization", format!("Bearer {ta}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    let page = res.json();
    assert_eq!(
        page["next"],
        json!("http://example.com/api/user/?limit=1&offset=2")
    );
    assert_eq!(
        page["previous"],
        json!("http://example.com/api/user/?limit=1")
    );
    app.cleanup().await;
}

#[tokio::test]
async fn small_read_endpoints() {
    let app = TestApp::shared().await;
    let ta = token(&app, "alice").await;
    let tadmin = token(&app, "admin").await;

    let res = app.get("/api/firsttimesetup/", None).await;
    assert_eq!(res.json(), json!({"isFirstTimeSetup": false}));

    for path in [
        "/api/timezones/",
        "/api/predefinedrules/",
        "/api/predefinedburstrules/",
    ] {
        assert_eq!(app.get(path, None).await.status, StatusCode::UNAUTHORIZED);
        let res = app.get(path, Some(&ta)).await;
        let encoded = res.json();
        let inner: Value = serde_json::from_str(encoded.as_str().unwrap()).unwrap();
        assert!(inner.as_array().unwrap().len() > 3, "{path}");
    }

    let res = app.get("/api/sitesettings", None).await;
    let s = res.json();
    assert_eq!(s["map_api_key"], json!(""));
    assert_eq!(s["heavyweight_process"], json!(0));
    assert_eq!(s["email_configured"], json!(false));
    assert_eq!(
        app.get("/api/sitesettings", Some(&tadmin)).await.status,
        StatusCode::OK
    );

    let res = app
        .request(
            Request::get("/api/auth/sso/config/")
                .header("authorization", "Bearer broken")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "sso config ignores tokens");
    assert_eq!(
        res.json(),
        json!({"enabled": false, "label": "Sign in with SSO", "providers": []})
    );

    assert_eq!(
        app.get("/api/nextcloud/listdir/?fpath=/", Some(&ta))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.get("/api/email-config/", Some(&ta)).await.status,
        StatusCode::FORBIDDEN
    );
    let res = app.get("/api/email-config/", Some(&tadmin)).await;
    let cfg = res.json();
    assert_eq!(cfg["provider"], json!("disabled"));
    assert_eq!(
        cfg["presets"]["sendgrid"]["default_username"],
        json!("apikey")
    );

    // dirtree: DATA_ROOT is the test's temp PHOTOS dir.
    let data = app.state.config.photos.clone();
    std::fs::create_dir_all(data.join("zeta").join("inner")).unwrap();
    std::fs::create_dir_all(data.join("Alpha")).unwrap();
    std::fs::create_dir_all(data.join(".hidden")).unwrap();
    let res = app.get("/api/dirtree/", Some(&tadmin)).await;
    assert_eq!(res.status, StatusCode::OK);
    let tree = res.json();
    let titles: Vec<&str> = tree[0]["children"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["Alpha", "zeta"]);
    assert_eq!(
        tree[0]["children"][1]["children"][0]["title"],
        json!("inner")
    );
    assert_eq!(tree[0]["children"][1]["children"][0]["children"], json!([]));
    let res = app
        .get("/api/dirtree/?path=/elsewhere", Some(&tadmin))
        .await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(
        app.get("/api/dirtree/", Some(&ta)).await.status,
        StatusCode::FORBIDDEN
    );
    app.cleanup().await;
}

#[tokio::test]
async fn site_settings_writes() {
    let app = TestApp::new().await;
    let ta = token(&app, "alice").await;
    let tadmin = token(&app, "admin").await;
    let body = json!({"allow_registration": true, "map_api_key": "k-123"});
    assert_eq!(
        app.post_json("/api/sitesettings", &body, None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.post_json("/api/sitesettings", &body, Some(&ta))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    let res = app
        .post_json("/api/sitesettings", &body, Some(&tadmin))
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    assert_eq!(res.json()["allow_registration"], json!(true));
    assert_eq!(res.json()["map_api_key"], json!("k-123"));
    assert_eq!(
        app.get("/api/sitesettings", Some(&ta)).await.json()["map_api_key"],
        json!("")
    );
    let stored: String = sqlx::query_scalar(
        "SELECT value FROM constance_constance WHERE key = 'ALLOW_REGISTRATION'",
    )
    .fetch_one(app.pool())
    .await
    .unwrap();
    assert_eq!(stored, r#"{"__type__": "default", "__value__": true}"#);
    for bad in [json!({}), json!({"allow_upload": "yes"}), json!([1])] {
        let res = app
            .post_json("/api/sitesettings", &bad, Some(&tadmin))
            .await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{bad}");
    }
    app.cleanup().await;
}

#[tokio::test]
async fn signup_and_admin_create() {
    let app = TestApp::new().await;
    let tadmin = token(&app, "admin").await;
    let ta = token(&app, "alice").await;
    let name = unique("newbie");
    let body = json!({"username": name, "password": "pw-123", "email": "n@example.com",
                      "first_name": "New", "last_name": "Bie"});

    // Registration closed and setup done: anonymous 401, users 403.
    assert_eq!(
        app.post_json("/api/user/", &body, None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.post_json("/api/user/", &body, Some(&ta)).await.status,
        StatusCode::FORBIDDEN
    );

    lp_db::write::settings::save(&app.state, &[("ALLOW_REGISTRATION", json!(true))])
        .await
        .unwrap();
    let res = app
        .post_json("/api/user/", &json!({"username": "x y"}), None)
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    let errors = res.json();
    let fields: Vec<&str> = errors["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(
        fields,
        ["username", "password", "email", "first_name", "last_name"]
    );

    let res = app.post_json("/api/user/", &body, None).await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.text());
    assert_eq!(
        res.json(),
        json!({"username": name, "email": "n@example.com", "first_name": "New", "last_name": "Bie"})
    );
    let created = fixture_user(&app, &name).await;
    assert!(!created.is_superuser && !created.is_staff);
    assert!(lp_auth::password::verify("pw-123", &created.password));
    let res = app.post_json("/api/user/", &body, None).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json()["errors"][0]["message"],
        json!("A user with that username already exists.")
    );

    // Admin create: lower-cased username, scan directory normalized.
    let dir = app.state.config.photos.join("created");
    std::fs::create_dir_all(&dir).unwrap();
    let admin_name = unique("MadeByAdmin");
    let res = app
        .post_json(
            "/api/user/",
            &json!({"username": admin_name, "password": "pw", "scan_directory": dir.to_string_lossy(),
                    "confidence": 0.3}),
            Some(&tadmin),
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.text());
    let made = res.json();
    assert_eq!(made["username"], json!(admin_name.to_lowercase()));
    assert_eq!(made["confidence"], json!(0.3));
    assert_eq!(made["photo_count"], json!(0));
    assert!(
        made["scan_directory"]
            .as_str()
            .unwrap()
            .ends_with("created")
    );
    let res = app
        .post_json(
            "/api/user/",
            &json!({"username": unique("other"), "password": "pw", "scan_directory": dir.to_string_lossy()}),
            Some(&tadmin),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert!(
        res.json()["errors"][0]["message"]
            .as_str()
            .unwrap()
            .contains("overlaps")
    );

    // First-time setup: with no superuser left, the next sign-up becomes admin.
    sqlx::query("UPDATE api_user SET is_superuser = FALSE")
        .execute(app.pool())
        .await
        .unwrap();
    lp_db::write::settings::save(&app.state, &[("ALLOW_REGISTRATION", json!(false))])
        .await
        .unwrap();
    assert_eq!(
        app.get("/api/firsttimesetup/", None).await.json()["isFirstTimeSetup"],
        json!(true)
    );
    let first = unique("first");
    let res = app
        .post_json(
            "/api/user/",
            &json!({"username": first, "password": "pw-123", "email": "", "first_name": "", "last_name": ""}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::CREATED, "{}", res.text());
    let first = fixture_user(&app, &first).await;
    assert!(first.is_superuser && first.is_staff);
    app.cleanup().await;
}

fn png_bytes() -> Vec<u8> {
    let img = image::RgbImage::from_pixel(4, 4, image::Rgb([200, 10, 10]));
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

fn multipart(field: &str, filename: &str, bytes: &[u8]) -> (String, Vec<u8>) {
    let boundary = "----lpboundary7MA4YWxk";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

#[tokio::test]
async fn profile_updates() {
    let app = TestApp::new().await;
    let alice = fixture_user(&app, "alice").await;
    let ta = token(&app, "alice").await;
    let tb = token(&app, "bob").await;
    let tadmin = token(&app, "admin").await;
    let path = format!("/api/user/{}/", alice.id);

    // The settings page sends the whole object back.
    let mut me = app.get(&path, Some(&ta)).await.json();
    me["confidence"] = json!(0.42);
    me["header_size"] = json!("small");
    me["username"] = json!("ignored-by-update");
    me["semantic_search_topk"] = json!(5);
    me["password"] = json!("new-Password-1");
    me.as_object_mut().unwrap().remove("avatar");
    let res = app.patch_json(&path, &me, Some(&ta)).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let out = res.json();
    assert_eq!(out["confidence"], json!(0.42));
    assert_eq!(out["header_size"], json!("small"));
    assert_eq!(out["username"], json!("alice"));
    let after = fixture_user(&app, "alice").await;
    assert_eq!(
        after.last_modified, alice.last_modified,
        "Django saves a `.only()` instance: last_modified stays"
    );
    assert!(lp_auth::password::verify("new-Password-1", &after.password));
    let clip_jobs = scalar_i64(
        &app,
        &format!(
            "SELECT count(*) FROM job_queue WHERE kind = 'clip.embed' AND payload->>'user_id' = '{}'",
            alice.id
        ),
    )
    .await;
    assert_eq!(clip_jobs, 1, "topk 0 -> 5 queues the embeddings");

    // Validation errors come back per field, in serializer order.
    let res = app
        .patch_json(
            &path,
            &json!({"header_size": "huge", "email": "nope", "username": "bob"}),
            Some(&ta),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json()["errors"],
        json!([
            {"field": "username", "message": "A user with that username already exists."},
            {"field": "email", "message": "Enter a valid email address."},
            {"field": "header_size", "message": "\"huge\" is not a valid choice."},
        ])
    );

    // Only self or staff; anonymous cannot even see the (private) user.
    assert_eq!(
        app.patch_json(&path, &json!({}), Some(&tb)).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.patch_json(&path, &json!({}), None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.patch_json(&path, &json!({}), Some(&tadmin))
            .await
            .status,
        StatusCode::OK
    );

    // Avatar upload (multipart), then clearing it with null.
    let (ctype, body) = multipart("avatar", "Alice avatar.png", &png_bytes());
    let res = app
        .request(
            Request::builder()
                .method(Method::PATCH)
                .uri(&path)
                .header("authorization", format!("Bearer {ta}"))
                .header("content-type", ctype)
                .header("host", "lp.test")
                .body(Body::from(body))
                .unwrap(),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let out = res.json();
    assert_eq!(out["avatar_url"], json!("/media/avatars/Alice_avatar.png"));
    assert_eq!(
        out["avatar"],
        json!("http://lp.test/media/avatars/Alice_avatar.png")
    );
    assert!(
        app.state
            .config
            .avatars_dir()
            .join("Alice_avatar.png")
            .is_file()
    );
    let (ctype, body) = multipart("avatar", "a.png", b"not an image");
    let res = app
        .request(
            Request::builder()
                .method(Method::PATCH)
                .uri(&path)
                .header("authorization", format!("Bearer {ta}"))
                .header("content-type", ctype)
                .body(Body::from(body))
                .unwrap(),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    let res = app
        .patch_json(&path, &json!({"avatar": null}), Some(&ta))
        .await;
    assert_eq!(res.json()["avatar_url"], json!(null));
    app.cleanup().await;
}

#[tokio::test]
async fn manage_and_delete_users() {
    let app = TestApp::new().await;
    let bob = fixture_user(&app, "bob").await;
    let alice = fixture_user(&app, "alice").await;
    let tadmin = token(&app, "admin").await;
    let ta = token(&app, "alice").await;
    let path = format!("/api/manage/user/{}/", bob.id);

    assert_eq!(
        app.patch_json(&path, &json!({}), None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.patch_json(&path, &json!({}), Some(&ta)).await.status,
        StatusCode::FORBIDDEN
    );
    let res = app
        .patch_json(
            &path,
            &json!({"scan_directory": "/definitely/outside"}),
            Some(&tadmin),
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json()["errors"][0],
        json!({"field": "non_field_errors", "message": "Scan directory must be inside the data root."})
    );
    let dir = app.state.config.photos.join("bobs");
    std::fs::create_dir_all(&dir).unwrap();
    let res = app
        .patch_json(
            &path,
            &json!({"scan_directory": dir.to_string_lossy(), "stack_raw_jpeg": false,
                    "first_name": "Robert", "confidence": 0.9}),
            Some(&tadmin),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let out = res.json();
    let keys: Vec<&str> = out
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(keys[..3], ["username", "scan_directory", "skip_raw_files"]);
    assert_eq!(out["first_name"], json!("Robert"));
    assert_eq!(out["stack_raw_jpeg"], json!(false));
    assert_eq!(
        out["confidence"],
        json!(bob.confidence),
        "manage ignores confidence"
    );
    let res = app
        .patch_json(&path, &json!({"username": "alice"}), Some(&tadmin))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);

    // Delete: superuser only, never a superuser, S15 reassignment.
    let del = format!("/api/delete/user/{}/", bob.id);
    assert_eq!(
        app.delete(&del, None, Some(&ta)).await.status,
        StatusCode::FORBIDDEN
    );
    let staff = app.create_user(&unique("staff"), "pw", false).await;
    sqlx::query("UPDATE api_user SET is_staff = TRUE WHERE id = $1")
        .bind(staff.id)
        .execute(app.pool())
        .await
        .unwrap();
    let tstaff = app.token_for(&staff);
    assert_eq!(
        app.delete(&del, None, Some(&tstaff)).await.status,
        StatusCode::UNAUTHORIZED
    );
    let admin = fixture_user(&app, "admin").await;
    assert_eq!(
        app.delete(
            &format!("/api/delete/user/{}/", admin.id),
            None,
            Some(&tadmin)
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.delete("/api/delete/user/999999/", None, Some(&tadmin))
            .await
            .status,
        StatusCode::NOT_FOUND
    );

    let bob_photos = scalar_i64(
        &app,
        &format!("SELECT count(*) FROM api_photo WHERE owner_id = {}", bob.id),
    )
    .await;
    assert!(bob_photos > 0);
    let deleted_id: i32 = sqlx::query_scalar("SELECT id FROM api_user WHERE username = 'deleted'")
        .fetch_one(app.pool())
        .await
        .unwrap();
    let before_deleted = scalar_i64(
        &app,
        &format!("SELECT count(*) FROM api_photo WHERE owner_id = {deleted_id}"),
    )
    .await;
    let res = app.delete(&del, None, Some(&tadmin)).await;
    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.text());
    assert!(
        lp_db::users::by_id(app.pool(), bob.id)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        scalar_i64(
            &app,
            &format!("SELECT count(*) FROM api_photo WHERE owner_id = {deleted_id}")
        )
        .await,
        before_deleted + bob_photos
    );
    assert_eq!(
        scalar_i64(
            &app,
            &format!(
                "SELECT count(*) FROM api_photo_shared_to WHERE user_id = {}",
                bob.id
            )
        )
        .await,
        0
    );
    // alice still exists and still owns her photos.
    assert!(
        scalar_i64(
            &app,
            &format!(
                "SELECT count(*) FROM api_photo WHERE owner_id = {}",
                alice.id
            )
        )
        .await
            > 0
    );
    app.cleanup().await;
}

#[tokio::test]
async fn email_config_and_password_reset() {
    let app = TestApp::new().await;
    let tadmin = token(&app, "admin").await;
    let res = app
        .post_json(
            "/api/email-config/",
            &json!({"provider": "sendgrid", "from_email": "lp@example.com", "secret": "s3cret"}),
            Some(&tadmin),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let cfg = res.json();
    assert_eq!(cfg["has_secret"], json!(true));
    assert_eq!(
        cfg["is_configured"],
        json!(true),
        "the preset supplies the host"
    );
    let stored: Vec<u8> = sqlx::query_scalar("SELECT secret FROM api_emailconfig WHERE id = 1")
        .fetch_one(app.pool())
        .await
        .unwrap();
    let crypto = lp_core::django_crypto::DjangoCrypto::new(&app.state.config.secret_key);
    assert_eq!(crypto.decrypt_str(&stored).unwrap(), "s3cret");
    assert_eq!(
        app.get("/api/sitesettings", None).await.json()["email_configured"],
        json!(true)
    );
    // An empty secret keeps the stored one; clear_secret wipes it.
    let res = app
        .post_json("/api/email-config/", &json!({"secret": ""}), Some(&tadmin))
        .await;
    assert_eq!(res.json()["has_secret"], json!(true));
    let res = app
        .post_json(
            "/api/email-config/",
            &json!({"clear_secret": true, "provider": "disabled"}),
            Some(&tadmin),
        )
        .await;
    assert_eq!(res.json()["has_secret"], json!(false));
    let res = app
        .post_json("/api/email-config/test/", &json!({}), Some(&tadmin))
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json(),
        json!({"status": false, "message": "Email is not configured."})
    );

    // Password reset request: always 200, then throttled per client.
    let ip = unique("10.1.2.");
    for i in 0..6 {
        let res = app
            .request(
                Request::post("/api/auth/password/reset/")
                    .header("content-type", "application/json")
                    .header("x-forwarded-for", &ip)
                    .body(Body::from(r#"{"email": "ALICE@fixture.invalid"}"#))
                    .unwrap(),
            )
            .await;
        if i < 5 {
            assert_eq!(res.status, StatusCode::OK, "{}", res.text());
        } else {
            assert_eq!(res.status, StatusCode::TOO_MANY_REQUESTS);
            assert!(res.header("retry-after").is_some());
            assert!(
                res.json()["errors"][0]["message"]
                    .as_str()
                    .unwrap()
                    .starts_with("Request was throttled.")
            );
        }
    }

    // Confirm with a Django-format token.
    let alice = fixture_user(&app, "alice").await;
    let token =
        lp_api::users_settings::password_reset::make_token(&app.state.config.secret_key, &alice);
    let uid = lp_api::users_settings::password_reset::encode_uid(alice.id);
    let res = app
        .post_json(
            "/api/auth/password/reset/confirm/",
            &json!({"uid": uid, "token": token, "new_password": "alice"}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        res.json()["message"],
        json!(
            "The password is too similar to the username. This password is too short. It must contain at least 8 characters. This password is too common."
        )
    );
    let res = app
        .post_json(
            "/api/auth/password/reset/confirm/",
            &json!({"uid": uid, "token": token, "new_password": "Vivid-Orchard-73"}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let after = fixture_user(&app, "alice").await;
    assert!(lp_auth::password::verify(
        "Vivid-Orchard-73",
        &after.password
    ));
    let res = app
        .post_json(
            "/api/auth/password/reset/confirm/",
            &json!({"uid": uid, "token": token, "new_password": "Another-Orchard-74"}),
            None,
        )
        .await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST, "a used token is dead");
    assert_eq!(
        res.json()["message"],
        json!("Invalid or expired reset link")
    );
    app.cleanup().await;
}

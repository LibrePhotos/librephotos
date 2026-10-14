//! Token interchangeability with a running Django (ignored by default).
//!
//! Run Django (uvicorn) on an adopted copy of a Django DB, then:
//!
//! ```text
//! LP_INTEROP_DJANGO=http://127.0.0.1:18101 LP_INTEROP_DB=m0_ref \
//! LP_INTEROP_SECRET=rust-bench-secret LP_INTEROP_USER=admin LP_INTEROP_PASS=... \
//! cargo test -p lp-auth --test django_interop -- --ignored
//! ```

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use http_body_util::BodyExt;
use lp_auth::AuthUser;
use lp_testkit::TestApp;
use serde_json::{Value, json};
use tower::ServiceExt;

fn env(k: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| panic!("{k} not set"))
}

#[tokio::test]
#[ignore]
async fn tokens_work_both_ways() {
    let django = env("LP_INTEROP_DJANGO");
    let app = TestApp::attach(
        &env("LP_INTEROP_DB"),
        &[("SECRET_KEY", env("LP_INTEROP_SECRET").as_str())],
    )
    .await;
    let http = reqwest::Client::new();
    let creds = json!({"username": env("LP_INTEROP_USER"), "password": env("LP_INTEROP_PASS")});

    // Django-issued tokens, accepted by Rust.
    let dj: Value = http
        .post(format!("{django}/api/auth/token/obtain/"))
        .json(&creds)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let dj_access = dj["access"].as_str().expect("django access").to_string();
    let dj_refresh = dj["refresh"].as_str().expect("django refresh").to_string();

    let probe: Router = Router::new()
        .route(
            "/me",
            get(|AuthUser(u): AuthUser| async move { u.username }),
        )
        .with_state(app.state.clone());
    let res = probe
        .clone()
        .oneshot(
            Request::builder()
                .uri("/me")
                .header("authorization", format!("Bearer {dj_access}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        res.status(),
        StatusCode::OK,
        "Rust rejected a Django access token"
    );
    let name = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(name, env("LP_INTEROP_USER").to_lowercase().as_bytes());

    let res = app
        .post_json(
            "/api/auth/token/refresh/",
            &json!({"refresh": dj_refresh}),
            None,
        )
        .await;
    assert_eq!(
        res.status,
        StatusCode::OK,
        "Rust rejected a Django refresh token: {}",
        res.text()
    );

    // Rust-issued tokens, accepted by Django.
    let res = app.post_json("/api/auth/token/obtain/", &creds, None).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let rs = res.json();
    let rs_access = rs["access"].as_str().unwrap();
    let status = http
        .get(format!("{django}/api/jobs/?page_size=1"))
        .bearer_auth(rs_access)
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(status.as_u16(), 200, "Django rejected a Rust access token");
    let status = http
        .get(format!("{django}/api/jobs/?page_size=1"))
        .header("cookie", format!("jwt={rs_access}"))
        .send()
        .await
        .unwrap()
        .status();
    assert_ne!(status.as_u16(), 500);
    let res = http
        .post(format!("{django}/api/auth/token/refresh/"))
        .json(&json!({"refresh": rs["refresh"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        res.status().as_u16(),
        200,
        "Django rejected a Rust refresh token"
    );
    let unauth = http
        .get(format!("{django}/api/jobs/?page_size=1"))
        .send()
        .await
        .unwrap()
        .status();
    assert_eq!(unauth.as_u16(), 401);
    app.cleanup().await;
}

//! App-level behavior: routing, trailing slashes, error envelope, health.

use axum::http::StatusCode;
use lp_testkit::TestApp;
use serde_json::json;

#[tokio::test]
async fn trailing_slash_is_optional() {
    let app = TestApp::shared().await;
    for path in ["/api/healthz", "/api/healthz/"] {
        let res = app.get(path, None).await;
        assert_eq!(res.status, StatusCode::OK, "{path}");
        assert_eq!(res.json(), json!({"status": "ok"}));
    }
    let res = app.get("/api/healthz/ready/", None).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json()["checks"]["postgresql"]["status"], "ok");
    app.cleanup().await;
}

#[tokio::test]
async fn unknown_route_is_a_404_envelope() {
    let app = TestApp::shared().await;
    let res = app.get("/api/definitely/not/here/", None).await;
    assert_eq!(res.status, StatusCode::NOT_FOUND);
    assert_eq!(
        res.json(),
        json!({"errors": [{"field": "detail", "message": "Not found."}]})
    );
    app.cleanup().await;
}

#[tokio::test]
async fn registry_builds_without_duplicate_kinds() {
    let reg = lp_server::registry();
    let kinds = reg.kinds();
    let mut dedup = kinds.clone();
    dedup.dedup();
    assert_eq!(kinds, dedup);
}

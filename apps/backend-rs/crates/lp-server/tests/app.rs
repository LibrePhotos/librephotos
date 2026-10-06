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

/// `serve_until`: the shutdown token (what SIGTERM / Ctrl-C / Ctrl-Break
/// cancel) stops the listener, then the embedded worker, and returns.
#[tokio::test]
async fn serve_stops_on_the_shutdown_signal() {
    let app = TestApp::new().await;
    let mut config = (*app.state.config).clone();
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    config.bind = probe.local_addr().unwrap();
    drop(probe);
    let bind = config.bind;
    let stop = tokio_util::sync::CancellationToken::new();
    let server = tokio::spawn(lp_server::serve_until(config, false, stop.clone()));
    let url = format!("http://{bind}/api/healthz");
    let client = reqwest::Client::new();
    let mut up = false;
    for _ in 0..100 {
        if client
            .get(&url)
            .send()
            .await
            .is_ok_and(|r| r.status() == 200)
        {
            up = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(up, "server came up");
    let t = std::time::Instant::now();
    stop.cancel();
    tokio::time::timeout(std::time::Duration::from_secs(20), server)
        .await
        .expect("serve returns after the signal")
        .unwrap()
        .unwrap();
    assert!(t.elapsed() < std::time::Duration::from_secs(15));
    assert!(client.get(&url).send().await.is_err(), "listener closed");
    app.cleanup().await;
}

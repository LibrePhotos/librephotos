//! `POST /api/services/{name}/start` and `/stop` success paths through the
//! supervisor, with a stand-in sidecar script. Own test binary: it points
//! the process-wide `LP_BACKEND_DIR` at a temp checkout.

use std::path::PathBuf;

use lp_testkit::TestApp;
use serde_json::json;

fn python() -> Option<PathBuf> {
    let p = std::env::var_os("LP_TEST_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                r"C:\Users\Niaz\librephotos\wt-windev\apps\backend\.venv-win\Scripts\python.exe",
            )
        });
    p.exists().then_some(p)
}

#[tokio::test]
async fn admin_starts_and_stops_a_sidecar() {
    let Some(py) = python() else {
        eprintln!("no python; skipped");
        return;
    };
    let backend = tempfile::tempdir().unwrap();
    let script = backend.path().join("service/thumbnail/main.py");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "import time\ntime.sleep(120)\n").unwrap();
    // SAFETY: the only test in this binary; nothing else reads the env concurrently.
    unsafe { std::env::set_var("LP_BACKEND_DIR", backend.path()) };

    let py = py.display().to_string();
    let app = TestApp::with_env(&[("LP_PYTHON", py.as_str())]).await;
    let admin = app.create_user("svc_admin", "pw", true).await;
    let at = app.token_for(&admin);
    let user = app.create_user("svc_user", "pw", false).await;
    let ut = app.token_for(&user);

    let start = "/api/services/thumbnail/start/";
    let stop = "/api/services/thumbnail/stop/";
    assert_eq!(
        app.post_json(start, &json!({}), Some(&ut)).await.status,
        403
    );

    let res = app.post_json(start, &json!({}), Some(&at)).await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (
            200,
            json!({"message": "Service thumbnail started successfully"})
        )
    );
    let pid = lp_sidecars::supervisor::global().pid("thumbnail").unwrap();
    // Already running: reported as started, not spawned twice.
    let res = app.post_json(start, &json!({}), Some(&at)).await;
    assert_eq!(res.status, 200);
    assert_eq!(
        lp_sidecars::supervisor::global().pid("thumbnail"),
        Some(pid)
    );

    // Our child is alive; if it does not answer /health it counts as busy.
    let res = app.get("/api/services/thumbnail/", Some(&at)).await;
    assert_eq!(
        res.json(),
        json!({"service_name": "thumbnail", "healthy": true, "enabled": true, "feature_flag": null, "mode": "sidecar"})
    );

    assert_eq!(app.post_json(stop, &json!({}), Some(&ut)).await.status, 403);
    let res = app.post_json(stop, &json!({}), Some(&at)).await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (
            200,
            json!({"message": "Service thumbnail stopped successfully"})
        )
    );
    assert!(!lp_sidecars::supervisor::global().is_running("thumbnail"));
    let res = app.post_json(stop, &json!({}), Some(&at)).await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (500, json!({"error": "Failed to stop service thumbnail"}))
    );

    // A spawn that fails is a 500.
    std::fs::create_dir_all(backend.path().join("service/clip_embeddings")).unwrap();
    let bad = TestApp::attach(&app.db.name, &[("LP_PYTHON", "Z:/no-such-python.exe")]).await;
    let res = bad
        .post_json(
            "/api/services/clip_embeddings/start/",
            &json!({}),
            Some(&at),
        )
        .await;
    assert_eq!(
        (res.status.as_u16(), res.json()),
        (
            500,
            json!({"error": "Failed to start service clip_embeddings"})
        )
    );
    app.cleanup().await;
}

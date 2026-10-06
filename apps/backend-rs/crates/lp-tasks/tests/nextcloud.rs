//! `nextcloud.scan` end to end against an in-test WebDAV server: the
//! endpoint queues the job, the job lists the scan directory recursively,
//! downloads new media (not other files, never outside the user's folder)
//! and runs the scan pipeline; a second scan downloads and adds nothing; a
//! rejected app password fails the LongRunningJob. Needs ExifTool, ffmpeg
//! and libvips like the pipeline tests (skipped without them).

#![allow(clippy::disallowed_methods)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use lp_core::django_crypto::DjangoCrypto;
use lp_jobs::{HandlerRegistry, JobCtx};
use lp_testkit::TestApp;
use serde_json::{Value, json};

/// The WebDAV mock's port, an ephemeral one picked when it starts.
static PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
const FIXTURE: &str = "C:/Users/Niaz/librephotos/rust-pg/fixture/data/alice";
const DAV_ROOT: &str = "/nc/remote.php/webdav";

fn tools() -> Option<Vec<(String, String)>> {
    let venv = std::env::var("LP_TEST_VENV")
        .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win".into());
    let site = Path::new(&venv).join("Lib").join("site-packages");
    let vips = std::fs::read_dir(&site).ok().and_then(|d| {
        d.flatten().map(|e| e.path()).find(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("libvips-42"))
        })
    });
    let pick = |var: &str, default: Option<PathBuf>| -> Option<(String, String)> {
        let p = std::env::var(var).ok().map(PathBuf::from).or(default)?;
        p.exists()
            .then(|| (var.to_string(), p.to_string_lossy().into_owned()))
    };
    let out = vec![
        pick(
            "LP_EXIFTOOL",
            Some(site.join("exiftool_bin").join("exiftool.exe")),
        )?,
        pick(
            "LP_FFMPEG",
            Some(site.join("ffmpeg_bin").join("bin").join("ffmpeg.exe")),
        )?,
        pick(
            "LP_FFPROBE",
            Some(site.join("ffmpeg_bin").join("bin").join("ffprobe.exe")),
        )?,
        pick("LP_VIPS_LIB", vips)?,
    ];
    Path::new(FIXTURE).exists().then_some(out)
}

/// Remote path (decoded, relative to the WebDAV root) -> local fixture file;
/// `None` marks a directory.
fn tree() -> Vec<(&'static str, Option<PathBuf>, &'static str)> {
    let f = |rel: &str| Some(Path::new(FIXTURE).join(rel));
    vec![
        ("/Photos/", None, ""),
        ("/Photos/plain.png", f("formats/plain.png"), "image/png"),
        (
            "/Photos/Straße ☀ 東京.jpg",
            f("names/Straße ☀ 東京.jpg"),
            "image/jpeg",
        ),
        (
            "/Photos/notes.pdf",
            f("formats/plain.png"),
            "application/pdf",
        ),
        ("/Photos/Sub/", None, ""),
        (
            "/Photos/Sub/hidden.jpg",
            f("states/hidden.jpg"),
            "image/jpeg",
        ),
        // A hostile listing: `..` segments must not escape the user's folder.
        (
            "/Photos/../../../evil.jpg",
            f("states/hidden.jpg"),
            "image/jpeg",
        ),
    ]
}

#[derive(Default)]
struct Dav {
    gets: Vec<String>,
    propfinds: Vec<String>,
}

type Shared = Arc<Mutex<Dav>>;

fn encode(p: &str) -> String {
    const SET: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'/')
        .remove(b'-')
        .remove(b'_')
        .remove(b'.');
    percent_encoding::utf8_percent_encode(p, SET).to_string()
}

fn parent(p: &str) -> String {
    let t = p.trim_end_matches('/');
    match t.rfind('/') {
        Some(i) => t[..=i].to_string(),
        None => "/".into(),
    }
}

async fn serve(
    state: Shared,
    method: Method,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    let auth = format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode("ncuser:ncpass")
    );
    if headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        != Some(&auth)
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let raw = uri.path();
    let Some(rel) = raw.strip_prefix(DAV_ROOT) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let rel = percent_encoding::percent_decode_str(rel)
        .decode_utf8_lossy()
        .into_owned();
    let t = tree();
    match method.as_str() {
        "PROPFIND" => {
            state.lock().unwrap().propfinds.push(rel.clone());
            let dir = format!("{}/", rel.trim_end_matches('/'));
            if !t.iter().any(|(p, f, _)| f.is_none() && *p == dir) {
                return StatusCode::NOT_FOUND.into_response();
            }
            let mut body = String::from(r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">"#);
            let entry = |p: &str, is_dir: bool, ct: &str| {
                let rt = if is_dir {
                    "<d:resourcetype><d:collection/></d:resourcetype>".to_string()
                } else {
                    format!("<d:resourcetype/><d:getcontenttype>{ct}</d:getcontenttype>")
                };
                format!(
                    "<d:response><d:href>{DAV_ROOT}{}</d:href><d:propstat><d:prop>{rt}</d:prop>\
                     <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>",
                    encode(p)
                )
            };
            body.push_str(&entry(&dir, true, ""));
            for (p, f, ct) in &t {
                let is_dir = f.is_none();
                let listed_under = if p.contains("/../") {
                    "/Photos/".to_string()
                } else {
                    parent(p)
                };
                if listed_under == dir && *p != dir {
                    body.push_str(&entry(p, is_dir, ct));
                }
            }
            body.push_str("</d:multistatus>");
            (
                StatusCode::MULTI_STATUS,
                [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
                body,
            )
                .into_response()
        }
        "GET" => {
            state.lock().unwrap().gets.push(rel.clone());
            match t.iter().find(|(p, _, _)| *p == rel) {
                Some((_, Some(file), _)) => std::fs::read(file).unwrap().into_response(),
                _ => StatusCode::NOT_FOUND.into_response(),
            }
        }
        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

async fn start_dav() -> Shared {
    let state: Shared = Arc::default();
    let s = state.clone();
    let app = Router::new().fallback(
        move |method: Method, uri: axum::http::Uri, headers: HeaderMap| {
            let s = s.clone();
            async move { serve(s, method, uri, headers).await }
        },
    );
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("bind the WebDAV mock port");
    PORT.set(listener.local_addr().unwrap().port())
        .expect("one WebDAV mock per test binary");
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    state
}

async fn run_queued(app: &TestApp, kind: &str) -> anyhow::Result<()> {
    let mut conn = app.pool().acquire().await.unwrap();
    let job = lp_jobs::queue::claim_next(&mut conn, "nextcloud-test", &[kind.to_string()])
        .await
        .unwrap()
        .expect("a queued job");
    drop(conn);
    let mut reg = HandlerRegistry::new();
    lp_tasks::register_jobs(&mut reg);
    let handler = reg.get(kind).expect("registered").clone();
    handler(JobCtx {
        state: app.state.clone(),
        job,
    })
    .await
}

async fn lrj(app: &TestApp, job_id: &str) -> (bool, bool, Option<Value>) {
    lp_db::sql::query_as(
        "SELECT finished, failed, result FROM api_longrunningjob WHERE job_id = $1",
    )
    .bind(job_id)
    .fetch_one(app.pool())
    .await
    .unwrap()
}

async fn photo_paths(app: &TestApp, user: i32) -> Vec<String> {
    lp_db::sql::query_scalar(
        "SELECT f.path FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
         WHERE p.owner_id = $1 ORDER BY f.path",
    )
    .bind(user)
    .fetch_all(app.pool())
    .await
    .map(|mut v: Vec<String>| {
        v.sort();
        v
    })
    .unwrap()
}

async fn start_scan(app: &TestApp, token: &str) -> String {
    let res = app
        .request(
            Request::post("/api/nextcloud/scanphotos/")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.text());
    let body = res.json();
    assert_eq!(body["status"], true);
    body["job_id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn nextcloud_scan_downloads_and_ingests_new_media() {
    let Some(tools) = tools() else {
        eprintln!("ExifTool/ffmpeg/libvips or the fixture not found; skipping");
        return;
    };
    // SAFETY: the only test of this binary; set before the app reads env.
    unsafe { std::env::set_var("LP_NEXTCLOUD_TEST_ALLOW_LOOPBACK", "1") };
    let dav = start_dav().await;
    let env: Vec<(&str, &str)> = tools
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let app = TestApp::with_env(&env).await;
    let user = app.create_user("nc_alice", "pw", false).await;
    let token = app.token_for(&user);
    let crypto = DjangoCrypto::new(&app.state.config.secret_key);
    lp_db::sql::query(
        "UPDATE api_user SET nextcloud_server_address = $2, nextcloud_username = 'ncuser', \
           nextcloud_app_password = $3, nextcloud_scan_directory = '/Photos' WHERE id = $1",
    )
    .bind(user.id)
    .bind(format!("http://127.0.0.1:{}/nc", PORT.get().unwrap()))
    .bind(crypto.encrypt_str("ncpass"))
    .execute(app.pool())
    .await
    .unwrap();

    let off = app
        .post_json("/api/nextcloud/scanphotos/", &json!({}), Some(&token))
        .await;
    assert_eq!(off.status, StatusCode::FORBIDDEN);
    lp_db::write::settings::save(&app.state, &[("NEXTCLOUD_ENABLED", json!(true))])
        .await
        .unwrap();

    // The directory picker goes through the same client.
    let dirs = app
        .get("/api/nextcloud/listdir/?fpath=/Photos", Some(&token))
        .await;
    assert_eq!(
        dirs.json(),
        json!([{"absolute_path": "/Photos/Sub/", "title": "Sub", "children": []}])
    );

    let job_id = start_scan(&app, &token).await;
    let t = std::time::Instant::now();
    run_queued(&app, "nextcloud.scan").await.unwrap();
    let first_scan = t.elapsed();
    let (finished, failed, result) = lrj(&app, &job_id).await;
    assert!(finished && !failed, "{result:?}");

    let root = app
        .state
        .config
        .photos
        .join("nextcloud_media")
        .join("nc_alice");
    let expected: Vec<PathBuf> = vec![
        root.join("Photos").join("Straße ☀ 東京.jpg"),
        root.join("Photos").join("Sub").join("hidden.jpg"),
        root.join("Photos").join("plain.png"),
    ];
    for p in &expected {
        assert!(p.is_file(), "{} downloaded", p.display());
    }
    assert!(!root.join("Photos").join("notes.pdf").exists());
    assert!(!app.state.config.photos.join("evil.jpg").exists());
    assert!(
        !app.base_path().join("evil.jpg").exists() && !root.join("evil.jpg").exists(),
        "the hostile path was skipped"
    );
    let leftovers: Vec<_> = walk(&root)
        .into_iter()
        .filter(|p| p.to_string_lossy().ends_with(".part"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    let mut want: Vec<String> = expected
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    want.sort();
    assert_eq!(photo_paths(&app, user.id).await, want);
    let gets = dav.lock().unwrap().gets.clone();
    assert_eq!(gets.len(), 3, "{gets:?}");

    // Nothing new: no downloads, no new photos.
    let job2 = start_scan(&app, &token).await;
    run_queued(&app, "nextcloud.scan").await.unwrap();
    let (finished, failed, _) = lrj(&app, &job2).await;
    assert!(finished && !failed);
    assert_eq!(dav.lock().unwrap().gets.len(), 3);
    assert_eq!(photo_paths(&app, user.id).await, want);

    // A rejected app password fails the job instead of leaving it running.
    lp_db::sql::query("UPDATE api_user SET nextcloud_app_password = $2 WHERE id = $1")
        .bind(user.id)
        .bind(crypto.encrypt_str("wrong"))
        .execute(app.pool())
        .await
        .unwrap();
    let job3 = start_scan(&app, &token).await;
    run_queued(&app, "nextcloud.scan").await.unwrap();
    let (finished, failed, result) = lrj(&app, &job3).await;
    assert!(finished && failed, "{result:?}");
    assert!(
        result.unwrap().to_string().contains("HTTP error: 401"),
        "the error names the refusal"
    );
    eprintln!(
        "nextcloud scan of 3 files (listing + download + ingest): {:?}",
        first_scan
    );
    app.cleanup().await;
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                out.extend(walk(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}

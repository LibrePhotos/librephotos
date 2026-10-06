//! Shared setup for the media integration tests: the fixture's manifest and
//! media tree (`LP_FIXTURE_ROOT`, default the shared read-only pack), apps in
//! either delivery mode, tokens for the fixture's users.

#![allow(dead_code)]

use std::path::PathBuf;

use axum::body::Body;
use axum::http::{Method, Request};
use lp_testkit::{TestApp, TestResponse};
use serde_json::Value;

pub fn fixture_root() -> PathBuf {
    PathBuf::from(
        std::env::var("LP_FIXTURE_ROOT")
            .unwrap_or_else(|_| "C:/Users/Niaz/librephotos/rust-pg/fixture".into()),
    )
}

pub fn manifest() -> Value {
    let path = std::env::var("LP_MANIFEST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| fixture_root().join("manifest.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    serde_json::from_str(&text).expect("manifest.json")
}

pub struct Photo {
    pub id: String,
    /// `id` parsed, for binds (a dashed string never matches SQLite's char(32)).
    pub uuid: uuid::Uuid,
    pub hash: String,
    pub path: String,
}

pub fn photo(m: &Value, key: &str) -> Photo {
    let p = &m["photos"][key];
    assert!(p.is_object(), "manifest has no photo {key}");
    Photo {
        id: p["id"].as_str().unwrap().to_string(),
        uuid: p["id"].as_str().unwrap().parse().unwrap(),
        hash: p["image_hash"].as_str().unwrap().to_string(),
        path: p["path"].as_str().unwrap().to_string(),
    }
}

/// The app on `db`, serving the fixture's media (or `base_data`).
pub async fn app_on(db: &str, mode: &str, base_data: Option<&str>) -> TestApp {
    let root = fixture_root();
    let base = base_data
        .map(str::to_string)
        .unwrap_or_else(|| root.to_string_lossy().into_owned());
    let photos = format!("{}/data", root.to_string_lossy());
    let venv = "C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Lib/site-packages";
    let ffmpeg =
        std::env::var("LP_FFMPEG").unwrap_or_else(|_| format!("{venv}/ffmpeg_bin/bin/ffmpeg.exe"));
    let ffprobe = std::env::var("LP_FFPROBE")
        .unwrap_or_else(|_| format!("{venv}/ffmpeg_bin/bin/ffprobe.exe"));
    TestApp::attach(
        db,
        &[
            ("BASE_DATA", base.as_str()),
            ("PHOTOS", photos.as_str()),
            ("LP_MEDIA_MODE", mode),
            ("LP_FFMPEG", ffmpeg.as_str()),
            ("LP_FFPROBE", ffprobe.as_str()),
        ],
    )
    .await
}

pub async fn token(app: &TestApp, username: &str) -> String {
    let user = lp_db::users::by_username(app.pool(), username)
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("no user {username}"));
    app.token_for(&user)
}

pub async fn get_with(
    app: &TestApp,
    method: Method,
    path: &str,
    headers: &[(&str, &str)],
) -> TestResponse {
    let mut b = Request::builder().method(method).uri(path);
    for (k, v) in headers {
        b = b.header(*k, *v);
    }
    app.request(b.body(Body::empty()).unwrap()).await
}

pub fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

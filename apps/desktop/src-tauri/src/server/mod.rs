//! The LibrePhotos server connection (CONTRACT.md "Server").
//!
//! - Settings (server URL, user, backup switch) in `settings.json` next to the library database;
//!   the refresh token in the OS keychain; the access token only in memory, refreshed before it
//!   expires and once more on a 401.
//! - `fetch`: authenticated JSON requests for the UI, so CORS never applies and tokens never
//!   reach JavaScript. Only `/api/...` paths of the connected server.
//! - `media`: server thumbnails for the `lpview` scheme, with a disk cache.
//! - [`worker`]: hashes library files, asks the server which it has, and uploads the rest.

pub mod auth;
pub mod worker;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::library::Library;
use crate::library::db::{self, RemoteCounts};
use auth::SecretStore;

/// Refresh the access token when it has less than this long to live.
const REFRESH_MARGIN_S: i64 = 30;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub url: Option<String>,
    pub username: Option<String>,
    pub user_id: Option<i64>,
    /// Upload every library file the server lacks.
    pub backup: bool,
    /// Uploads paused (checks still run).
    pub paused: bool,
    /// `url|user_id` the library's server state belongs to.
    pub remote_key: Option<String>,
}

#[derive(Default)]
struct Tokens {
    access: Option<(String, i64)>,
    refresh: Option<String>,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Upload {
    pub name: String,
    pub sent: i64,
    pub total: i64,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub connected: bool,
    pub url: Option<String>,
    pub username: Option<String>,
    pub user_id: Option<i64>,
    pub backup: bool,
    pub paused: bool,
    /// Why the connection or the last request failed, for the UI.
    pub error: Option<String>,
    pub counts: RemoteCounts,
    pub uploads: Vec<Upload>,
    /// Upload speed over the last few seconds, bytes per second.
    pub rate: f64,
    /// Files uploaded and bytes sent since the app started.
    pub uploaded_files: i64,
    pub uploaded_bytes: i64,
}

/// What the server knows about one local file.
#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOf {
    pub state: String,
    pub photo_id: Option<String>,
    pub md5: Option<String>,
    pub image_hash: Option<String>,
    pub in_library: bool,
}

pub type Emit = Box<dyn Fn() + Send + Sync>;

pub struct Server {
    pub(crate) lib: Arc<Library>,
    data_dir: PathBuf,
    secrets: Box<dyn SecretStore>,
    pub(crate) http: reqwest::Client,
    settings: Mutex<Settings>,
    tokens: Mutex<Tokens>,
    /// One refresh at a time.
    refreshing: tokio::sync::Mutex<()>,
    pub(crate) wake: tokio::sync::Notify,
    error: Mutex<Option<String>>,
    pub(crate) stats: Mutex<worker::Stats>,
    emit: Emit,
}

fn http_error(status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("detail")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    v.get("errors")
                        .and_then(|e| e.get(0))
                        .and_then(|e| e.get("message"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    if detail.trim().is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {}: {}", status.as_u16(), detail.trim())
    }
}

/// `/api/...` without `..`, a scheme or a host: the only paths `fetch` sends anywhere.
pub fn valid_api_path(path: &str) -> bool {
    path.starts_with("/api/")
        && !path.contains("..")
        && !path.contains("://")
        && !path.contains('\\')
        && !path.contains('#')
}

/// The server thumbnail kinds the media proxy serves.
pub fn media_dir(kind: &str) -> Option<&'static str> {
    match kind {
        "square" => Some("square_thumbnails"),
        "big" => Some("thumbnails_big"),
        _ => None,
    }
}

fn sniff_mime(b: &[u8]) -> &'static str {
    if b.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if b.starts_with(b"\x89PNG") {
        "image/png"
    } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        "image/webp"
    } else if b.len() > 12 && &b[4..8] == b"ftyp" {
        "image/avif"
    } else {
        "application/octet-stream"
    }
}

impl Server {
    pub fn new(
        lib: Arc<Library>,
        data_dir: PathBuf,
        secrets: Box<dyn SecretStore>,
        emit: Emit,
    ) -> Arc<Server> {
        let settings = std::fs::read(data_dir.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .user_agent(concat!("LibrePhotos-Viewer/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client");
        let s = Arc::new(Server {
            lib,
            data_dir,
            secrets,
            http,
            settings: Mutex::new(settings),
            tokens: Mutex::new(Tokens::default()),
            refreshing: tokio::sync::Mutex::new(()),
            wake: tokio::sync::Notify::new(),
            error: Mutex::new(None),
            stats: Mutex::new(worker::Stats::default()),
            emit,
        });
        let account = s.account();
        if let Some(a) = account {
            s.tokens.lock().unwrap().refresh = s.secrets.get(&a);
        }
        s
    }

    pub(crate) fn changed(&self) {
        (self.emit)();
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    fn save_settings(&self, f: impl FnOnce(&mut Settings)) -> Result<(), String> {
        let mut s = self.settings.lock().unwrap();
        f(&mut s);
        let _ = std::fs::create_dir_all(&self.data_dir);
        let tmp = self.data_dir.join("settings.json.tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(&*s).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, self.data_dir.join("settings.json")).map_err(|e| e.to_string())
    }

    /// Keychain account of the current sign-in: `<url>|<username>`.
    fn account(&self) -> Option<String> {
        let s = self.settings.lock().unwrap();
        Some(format!("{}|{}", s.url.as_ref()?, s.username.as_ref()?))
    }

    pub fn connected(&self) -> bool {
        let s = self.settings.lock().unwrap();
        s.url.is_some() && s.user_id.is_some() && self.tokens.lock().unwrap().refresh.is_some()
    }

    pub fn user_id(&self) -> Option<i64> {
        self.settings.lock().unwrap().user_id
    }

    fn base(&self) -> Result<String, String> {
        self.settings
            .lock()
            .unwrap()
            .url
            .clone()
            .ok_or_else(|| "not connected to a server".into())
    }

    /// The server answered again: forget the last network error.
    pub(crate) fn clear_error(&self) {
        let had = self.error.lock().unwrap().take().is_some();
        if had {
            self.changed();
        }
    }

    pub(crate) fn set_error(&self, e: Option<String>) {
        *self.error.lock().unwrap() = e;
        self.changed();
    }

    pub fn status(&self) -> ServerStatus {
        let s = self.settings();
        let counts = db::remote_counts(&self.lib.conn()).unwrap_or_default();
        let stats = self.stats.lock().unwrap();
        ServerStatus {
            connected: self.connected(),
            url: s.url,
            username: s.username,
            user_id: s.user_id,
            backup: s.backup,
            paused: s.paused,
            error: self.error.lock().unwrap().clone(),
            counts,
            uploads: stats.current.values().cloned().collect(),
            rate: stats.rate(),
            uploaded_files: stats.files,
            uploaded_bytes: stats.bytes,
        }
    }

    /// Signs in; on success the refresh token goes to the keychain and the worker starts.
    pub async fn connect(
        &self,
        url: &str,
        username: &str,
        password: &str,
    ) -> Result<ServerStatus, String> {
        let url = auth::normalize_url(url)?;
        let res = self
            .http
            .post(format!("{url}/api/auth/token/obtain/"))
            .json(&serde_json::json!({ "username": username, "password": password }))
            .send()
            .await
            .map_err(|e| format!("couldn't reach {url}: {e}"))?;
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Wrong username or password".into());
        }
        if !status.is_success() {
            return Err(http_error(status, &body));
        }
        let v: Value = serde_json::from_str(&body)
            .map_err(|_| format!("{url} doesn't look like a LibrePhotos server"))?;
        let (Some(access), Some(refresh)) = (v["access"].as_str(), v["refresh"].as_str()) else {
            return Err(format!("{url} doesn't look like a LibrePhotos server"));
        };
        let claims = auth::claims(access).ok_or("the server's sign-in token has no user id")?;
        if let Some(old) = self.account() {
            self.secrets.delete(&old);
        }
        let key = format!("{url}|{}", claims.user_id);
        let same_server = self.settings().remote_key.as_deref() == Some(key.as_str());
        self.save_settings(|s| {
            s.url = Some(url.clone());
            s.username = Some(username.to_string());
            s.user_id = Some(claims.user_id);
            s.remote_key = Some(key.clone());
        })?;
        self.secrets.set(&format!("{url}|{username}"), refresh)?;
        {
            let mut t = self.tokens.lock().unwrap();
            t.access = Some((access.to_string(), claims.exp));
            t.refresh = Some(refresh.to_string());
        }
        if !same_server {
            db::forget_remote(&self.lib.conn()).map_err(|e| e.to_string())?;
            self.lib.notify_changed();
        }
        *self.error.lock().unwrap() = None;
        self.wake.notify_waiters();
        self.changed();
        Ok(self.status())
    }

    /// Signs out: forgets the tokens (the keychain entry too). The address and user name stay
    /// for the next sign-in form; the library keeps what it knew about the server.
    pub fn disconnect(&self) {
        if let Some(a) = self.account() {
            self.secrets.delete(&a);
        }
        *self.tokens.lock().unwrap() = Tokens::default();
        let _ = self.save_settings(|s| s.user_id = None);
        *self.error.lock().unwrap() = None;
        self.changed();
    }

    pub fn set_backup(&self, on: bool) -> Result<(), String> {
        self.save_settings(|s| s.backup = on)?;
        self.wake.notify_waiters();
        self.changed();
        Ok(())
    }

    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        self.save_settings(|s| s.paused = paused)?;
        self.wake.notify_waiters();
        self.changed();
        Ok(())
    }

    /// A valid access token, refreshed when it is about to expire (or when `force`).
    pub(crate) async fn access_token(&self, force: bool) -> Result<String, String> {
        let now = chrono::Utc::now().timestamp();
        let fresh = |t: &Tokens| {
            t.access
                .as_ref()
                .filter(|(_, exp)| *exp - REFRESH_MARGIN_S > now)
                .map(|(a, _)| a.clone())
        };
        let before = self.tokens.lock().unwrap().access.clone();
        if !force && let Some(a) = fresh(&self.tokens.lock().unwrap()) {
            return Ok(a);
        }
        let _guard = self.refreshing.lock().await;
        // Someone else refreshed while we waited.
        {
            let t = self.tokens.lock().unwrap();
            if t.access != before
                && let Some(a) = fresh(&t)
            {
                return Ok(a);
            }
        }
        let refresh = self
            .tokens
            .lock()
            .unwrap()
            .refresh
            .clone()
            .ok_or("not signed in")?;
        let base = self.base()?;
        let res = self
            .http
            .post(format!("{base}/api/auth/token/refresh/"))
            .json(&serde_json::json!({ "refresh": refresh }))
            .send()
            .await
            .map_err(|e| format!("couldn't reach {base}: {e}"))?;
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::BAD_REQUEST
        {
            // The refresh token expired or was revoked: sign in again.
            if let Some(a) = self.account() {
                self.secrets.delete(&a);
            }
            *self.tokens.lock().unwrap() = Tokens::default();
            self.set_error(Some("Your sign-in expired. Sign in again.".into()));
            return Err("signed out".into());
        }
        if !status.is_success() {
            return Err(http_error(status, &body));
        }
        let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        let access = v["access"].as_str().ok_or("no access token")?.to_string();
        let exp = auth::claims(&access).map_or(now + 60, |c| c.exp);
        let mut t = self.tokens.lock().unwrap();
        t.access = Some((access.clone(), exp));
        if let Some(r) = v["refresh"].as_str() {
            // Rotated refresh tokens replace the stored one.
            t.refresh = Some(r.to_string());
            if let Some(a) = self.account() {
                let _ = self.secrets.set(&a, r);
            }
        }
        Ok(access)
    }

    /// Sends a request built by `build` with the access token; on a 401 refreshes once and
    /// sends it again.
    pub(crate) async fn send(
        &self,
        build: impl Fn(&str) -> reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, String> {
        let base = self.base()?;
        let token = self.access_token(false).await?;
        let res = build(&base)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("couldn't reach {base}: {e}"))?;
        if res.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(res);
        }
        let token = self.access_token(true).await?;
        build(&base)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("couldn't reach {base}: {e}"))
    }

    /// JSON request to `/api/...` of the connected server for the UI.
    pub async fn fetch(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        if !valid_api_path(path) {
            return Err(format!("not an API path: {path}"));
        }
        let method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
            .map_err(|_| format!("bad method {method}"))?;
        let res = self
            .send(|base| {
                let r = self.http.request(method.clone(), format!("{base}{path}"));
                match &body {
                    Some(b) => r.json(b),
                    None => r,
                }
            })
            .await?;
        let status = res.status();
        let text = res.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(http_error(status, &text));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|e| format!("not JSON: {e}"))
    }

    /// `GET /api/exists/<md5><user id>` -> the photo id when the server has the file.
    pub(crate) async fn exists(&self, md5: &str) -> Result<Option<String>, String> {
        let uid = self.user_id().ok_or("not signed in")?;
        let v = self
            .fetch("GET", &format!("/api/exists/{md5}{uid}"), None)
            .await?;
        Ok(if v["exists"].as_bool() == Some(true) {
            Some(match &v["photo_id"] {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            })
        } else {
            None
        })
    }

    /// A server thumbnail (`kind` "square" or "big") of `image_hash`, from the disk cache or the
    /// server. Err carries the HTTP status to answer.
    pub async fn media(
        &self,
        kind: &str,
        image_hash: &str,
    ) -> Result<(Vec<u8>, &'static str), (u16, String)> {
        let dir = media_dir(kind).ok_or((400, format!("unknown kind {kind}")))?;
        if image_hash.is_empty()
            || image_hash.len() > 80
            || !image_hash.bytes().all(|c| c.is_ascii_alphanumeric())
        {
            return Err((400, "bad hash".into()));
        }
        let uid = self.user_id().map(|u| u.to_string()).unwrap_or_default();
        let file = self
            .data_dir
            .join("server-media")
            .join(format!("{dir}-{uid}"))
            .join(image_hash);
        if let Ok(b) = std::fs::read(&file) {
            let mime = sniff_mime(&b);
            return Ok((b, mime));
        }
        let res = self
            .send(|base| self.http.get(format!("{base}/media/{dir}/{image_hash}")))
            .await
            .map_err(|e| (502, e))?;
        let status = res.status();
        if !status.is_success() {
            return Err((status.as_u16(), format!("server answered {status}")));
        }
        let bytes = res
            .bytes()
            .await
            .map_err(|e| (502, e.to_string()))?
            .to_vec();
        if let Some(parent) = file.parent()
            && std::fs::create_dir_all(parent).is_ok()
        {
            let tmp = file.with_extension("tmp");
            if std::fs::write(&tmp, &bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &file);
            }
        }
        let mime = sniff_mime(&bytes);
        Ok((bytes, mime))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_paths() {
        assert!(valid_api_path("/api/photos/searchlist/?search=x"));
        assert!(!valid_api_path("/media/photos/x"));
        assert!(!valid_api_path("/api/../admin"));
        assert!(!valid_api_path("/api/x?u=http://evil"));
        assert!(!valid_api_path("https://evil/api/"));
    }

    #[test]
    fn errors_and_mime() {
        let s = reqwest::StatusCode::BAD_REQUEST;
        assert_eq!(
            http_error(s, r#"{"detail":"md5 checksum does not match"}"#),
            "HTTP 400: md5 checksum does not match"
        );
        assert_eq!(
            http_error(s, r#"{"errors":[{"field":"album_id","message":"nope"}]}"#),
            "HTTP 400: nope"
        );
        assert_eq!(sniff_mime(b"\xFF\xD8\xFF"), "image/jpeg");
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
    }

    #[test]
    fn settings_survive_a_restart_and_tokens_stay_out_of_the_file() {
        let dir = std::env::temp_dir().join(format!("lpview-server-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let lib = Library::open(db::open_memory().unwrap(), |_| ());
        let store = auth::MemoryStore::default();
        store.set("http://h|bob", "refresh-token").unwrap();
        let s = Server::new(lib.clone(), dir.clone(), Box::new(store), Box::new(|| ()));
        assert!(!s.connected());
        s.save_settings(|st| {
            st.url = Some("http://h".into());
            st.username = Some("bob".into());
            st.user_id = Some(3);
            st.backup = true;
        })
        .unwrap();
        let text = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!text.contains("refresh-token"));
        let store = auth::MemoryStore::default();
        store.set("http://h|bob", "refresh-token").unwrap();
        let again = Server::new(lib, dir.clone(), Box::new(store), Box::new(|| ()));
        assert!(again.connected());
        assert!(again.settings().backup);
        again.disconnect();
        assert!(!again.connected());
        assert_eq!(again.settings().username.as_deref(), Some("bob"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

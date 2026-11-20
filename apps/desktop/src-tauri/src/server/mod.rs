//! The LibrePhotos server connection (CONTRACT.md "Server").
//!
//! Every API request is made by the UI with `packages/api-client` (endpoint functions + zod
//! schemas); Rust only carries the bytes. What stays native:
//!
//! - [`http`]: the api-client's transport (`createNativeFetch`): the UI hands over an encoded
//!   request, Rust sends it with `reqwest` and hands back status, headers and body. CORS never
//!   applies. Only URLs of the connected server (or the one being signed in to) go out.
//! - Settings (server URL, user, backup switch) in `settings.json` in the data directory,
//!   and the refresh token in the OS keychain. The UI's token supplier is fed from here at start
//!   and tells Rust when it signs in, refreshes or signs out.
//! - `media`: server thumbnails for the `lpview` scheme, with a disk cache, fetched with the access
//!   token the UI last handed over.
//! - [`backup`]: MD5 hashing and chunk reads for the UI's backup engine (its queue is the shared
//!   local database's `upload_queue`, written by `packages/local-db`).

pub mod auth;
pub mod backup;
pub mod http;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use auth::SecretStore;

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
}

/// What Rust knows about the connection; the UI adds its upload progress and errors.
#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub connected: bool,
    pub url: Option<String>,
    pub username: Option<String>,
    pub user_id: Option<i64>,
    pub backup: bool,
    pub paused: bool,
    /// Why the last sign-in ended ("Your sign-in expired. Sign in again."), until the next one.
    pub error: Option<String>,
}

/// The session the UI's token supplier starts from: settings plus the keychain's refresh token.
#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub url: Option<String>,
    pub username: Option<String>,
    pub user_id: Option<i64>,
    pub refresh: Option<String>,
}

/// What the UI reports after a successful sign-in (`/api/auth/token/obtain/` via api-client).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SignIn {
    pub url: String,
    pub username: String,
    pub user_id: i64,
    pub refresh: String,
    pub access: String,
}

pub type Emit = Box<dyn Fn() + Send + Sync>;

#[derive(Default)]
struct Tokens {
    access: Option<String>,
    refresh: Option<String>,
}

pub struct Server {
    data_dir: PathBuf,
    secrets: Box<dyn SecretStore>,
    pub(crate) http: reqwest::Client,
    settings: Mutex<Settings>,
    tokens: Mutex<Tokens>,
    /// The server being signed in to, which `http` may reach before the sign-in is saved.
    signing_in: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    pub(crate) requests: http::InFlight,
    emit: Emit,
}

/// The server thumbnail folders the media proxy serves (`packages/api-client` `media.ts`).
const MEDIA_DIRS: [&str; 2] = ["square_thumbnails", "thumbnails_big"];

/// `<server>/media/<dir>/<file>` of the connected server -> (dir, file), for the server
/// thumbnails only. `file` is an image hash (letters and digits), optionally `.webp`.
pub fn media_path<'a>(base: &str, src: &'a str) -> Option<(&'a str, &'a str)> {
    let rest = src.strip_prefix(base)?.strip_prefix("/media/")?;
    let (dir, file) = rest.split_once('/')?;
    let dir = MEDIA_DIRS.iter().find(|d| **d == dir)?;
    let stem = file.strip_suffix(".webp").unwrap_or(file);
    let ok =
        !stem.is_empty() && stem.len() <= 80 && stem.bytes().all(|c| c.is_ascii_alphanumeric());
    ok.then_some((dir, file))
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
    pub fn new(data_dir: PathBuf, secrets: Box<dyn SecretStore>, emit: Emit) -> Arc<Server> {
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
            data_dir,
            secrets,
            http,
            settings: Mutex::new(settings),
            tokens: Mutex::new(Tokens::default()),
            signing_in: Mutex::new(None),
            error: Mutex::new(None),
            requests: http::InFlight::default(),
            emit,
        });
        if let Some(a) = s.account() {
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

    pub fn state(&self) -> ServerState {
        let s = self.settings();
        ServerState {
            connected: self.connected(),
            url: s.url,
            username: s.username,
            user_id: s.user_id,
            backup: s.backup,
            paused: s.paused,
            error: self.error.lock().unwrap().clone(),
        }
    }

    /// Where the UI's token supplier starts: the saved sign-in, if any.
    pub fn session(&self) -> Session {
        let s = self.settings();
        let connected = self.connected();
        Session {
            url: s.url,
            username: s.username,
            user_id: s.user_id.filter(|_| connected),
            refresh: self.tokens.lock().unwrap().refresh.clone(),
        }
    }

    /// Normalises the address typed into the sign-in form and lets `http` reach it.
    pub fn prepare_sign_in(&self, url: &str) -> Result<String, String> {
        let url = auth::normalize_url(url)?;
        *self.signing_in.lock().unwrap() = Some(url.clone());
        Ok(url)
    }

    /// The UI signed in: the refresh token goes to the keychain, the settings to disk. (Which
    /// account the local database's hashes and upload queue belong to is the UI's business: it
    /// keeps that in the database and rebuilds both on a change.)
    pub fn signed_in(&self, s: SignIn) -> Result<ServerState, String> {
        if self.signing_in.lock().unwrap().as_deref() != Some(s.url.as_str())
            && self.settings().url.as_deref() != Some(s.url.as_str())
        {
            return Err(format!("{} was not prepared for sign-in", s.url));
        }
        if let Some(old) = self.account() {
            self.secrets.delete(&old);
        }
        self.save_settings(|st| {
            st.url = Some(s.url.clone());
            st.username = Some(s.username.clone());
            st.user_id = Some(s.user_id);
        })?;
        self.secrets
            .set(&format!("{}|{}", s.url, s.username), &s.refresh)?;
        *self.tokens.lock().unwrap() = Tokens {
            access: Some(s.access),
            refresh: Some(s.refresh),
        };
        *self.signing_in.lock().unwrap() = None;
        *self.error.lock().unwrap() = None;
        self.changed();
        Ok(self.state())
    }

    /// The access token the UI's client holds now, for the media proxy.
    pub fn set_access(&self, token: Option<String>) {
        self.tokens.lock().unwrap().access = token;
    }

    /// Signs out: forgets the tokens (the keychain entry too). The address and user name stay
    /// for the next sign-in form; the library keeps what it knew about the server. `reason` is
    /// shown until the next sign-in (an expired session, not a click on "Sign out").
    pub fn signed_out(&self, reason: Option<String>) {
        if let Some(a) = self.account() {
            self.secrets.delete(&a);
        }
        *self.tokens.lock().unwrap() = Tokens::default();
        let _ = self.save_settings(|s| s.user_id = None);
        *self.error.lock().unwrap() = reason;
        self.changed();
    }

    pub fn set_backup(&self, on: bool) -> Result<(), String> {
        self.save_settings(|s| s.backup = on)?;
        self.changed();
        Ok(())
    }

    pub fn set_paused(&self, paused: bool) -> Result<(), String> {
        self.save_settings(|s| s.paused = paused)?;
        self.changed();
        Ok(())
    }

    /// The origin `http` may send to: the connected server, or the one being signed in to.
    pub(crate) fn allows(&self, url: &str) -> bool {
        let under = |base: &str| {
            url.strip_prefix(base)
                .is_some_and(|rest| rest.starts_with('/'))
        };
        let settings = self.settings();
        settings.url.as_deref().is_some_and(under)
            || self
                .signing_in
                .lock()
                .unwrap()
                .as_deref()
                .is_some_and(under)
    }

    /// A server thumbnail at `src` (a `packages/api-client` media URL of the connected server),
    /// from the disk cache or the server. Err carries the HTTP status to answer.
    pub async fn media(&self, src: &str) -> Result<(Vec<u8>, &'static str), (u16, String)> {
        let base = self
            .settings()
            .url
            .ok_or((503, "not connected".to_string()))?;
        let (dir, file) = media_path(&base, src).ok_or((400, format!("not a thumbnail: {src}")))?;
        let uid = self.user_id().map(|u| u.to_string()).unwrap_or_default();
        let path = self
            .data_dir
            .join("server-media")
            .join(format!("{dir}-{uid}"))
            .join(file);
        if let Ok(b) = std::fs::read(&path) {
            let mime = sniff_mime(&b);
            return Ok((b, mime));
        }
        let token = self.tokens.lock().unwrap().access.clone();
        let mut req = self.http.get(src);
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let res = req
            .send()
            .await
            .map_err(|e| (502, format!("couldn't reach {base}: {e}")))?;
        let status = res.status();
        if !status.is_success() {
            return Err((status.as_u16(), format!("server answered {status}")));
        }
        let bytes = res
            .bytes()
            .await
            .map_err(|e| (502, e.to_string()))?
            .to_vec();
        if let Some(parent) = path.parent()
            && std::fs::create_dir_all(parent).is_ok()
        {
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, &bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
        let mime = sniff_mime(&bytes);
        Ok((bytes, mime))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(dir: &std::path::Path, store: auth::MemoryStore) -> Arc<Server> {
        Server::new(dir.to_path_buf(), Box::new(store), Box::new(|| ()))
    }

    #[test]
    fn media_paths_follow_the_api_client() {
        let base = "http://h:8000";
        let hash = "5d41402abc4b2a76b9719d911017c5921";
        assert_eq!(
            media_path(base, &format!("{base}/media/square_thumbnails/{hash}")),
            Some(("square_thumbnails", hash))
        );
        assert_eq!(
            media_path(base, &format!("{base}/media/square_thumbnails/{hash}.webp")),
            Some(("square_thumbnails", &*format!("{hash}.webp")))
        );
        assert!(media_path(base, &format!("{base}/media/thumbnails_big/{hash}")).is_some());
        assert!(media_path(base, &format!("{base}/media/photos/{hash}")).is_none());
        assert!(media_path(base, &format!("http://evil/media/square_thumbnails/{hash}")).is_none());
        assert!(media_path(base, &format!("{base}/media/square_thumbnails/../x")).is_none());
        assert!(media_path(base, &format!("{base}/media/square_thumbnails/")).is_none());
        assert_eq!(sniff_mime(b"\xFF\xD8\xFF"), "image/jpeg");
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
    }

    #[test]
    fn sign_in_saves_settings_and_keeps_tokens_out_of_the_file() {
        let dir = std::env::temp_dir().join(format!("lpview-server-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let s = server(&dir, auth::MemoryStore::default());
        assert!(!s.connected());
        let sign_in = SignIn {
            url: "http://h".into(),
            username: "bob".into(),
            user_id: 3,
            refresh: "refresh-token".into(),
            access: "access-token".into(),
        };
        // Only a prepared server may be signed in to (and reached by `http`).
        assert!(s.signed_in(sign_in.clone()).is_err());
        assert!(!s.allows("http://h/api/auth/token/obtain/"));
        assert_eq!(s.prepare_sign_in("h/api/").unwrap(), "https://h");
        let url = s.prepare_sign_in("http://h").unwrap();
        assert!(s.allows(&format!("{url}/api/auth/token/obtain/")));
        assert!(!s.allows("http://hx/api/"));
        s.signed_in(sign_in).unwrap();
        s.set_backup(true).unwrap();
        assert!(s.connected());
        let text = std::fs::read_to_string(dir.join("settings.json")).unwrap();
        assert!(!text.contains("refresh-token"));

        let store = auth::MemoryStore::default();
        store.set("http://h|bob", "refresh-token").unwrap();
        let again = server(&dir, store);
        assert!(again.connected());
        assert!(again.settings().backup);
        assert_eq!(again.session().refresh.as_deref(), Some("refresh-token"));
        assert_eq!(again.session().user_id, Some(3));
        assert!(again.allows("http://h/api/photos/"));
        again.signed_out(Some("Your sign-in expired. Sign in again.".into()));
        assert!(!again.connected());
        assert_eq!(again.session().refresh, None);
        assert_eq!(again.settings().username.as_deref(), Some("bob"));
        assert!(again.state().error.is_some());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

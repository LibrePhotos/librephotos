//! Tauri commands, events and the `remote` media route of the library and the server
//! connection (CONTRACT.md "Library" and "Server").

use std::sync::{Arc, OnceLock};

use serde::Serialize;
use tauri::{Emitter, State};

use crate::library::db::{LibraryFile, Root};
use crate::library::{self, Library};
use crate::server::{self, Server};
use crate::{appdirs, blocking, request};

// ------------------------------------------------------------------ library

#[tauri::command]
pub async fn library_roots(lib: State<'_, Arc<Library>>) -> Result<Vec<Root>, String> {
    let lib = lib.inner().clone();
    blocking(move || lib.roots()).await
}

#[tauri::command]
pub async fn library_add_root(lib: State<'_, Arc<Library>>, path: String) -> Result<Root, String> {
    let lib = lib.inner().clone();
    blocking(move || lib.add_root_and_scan(&path)).await
}

#[tauri::command]
pub async fn library_remove_root(lib: State<'_, Arc<Library>>, id: i64) -> Result<(), String> {
    let lib = lib.inner().clone();
    blocking(move || lib.remove_root(id)).await
}

#[tauri::command]
pub async fn library_files(
    lib: State<'_, Arc<Library>>,
    root_id: Option<i64>,
) -> Result<Vec<LibraryFile>, String> {
    let lib = lib.inner().clone();
    blocking(move || lib.files(root_id)).await
}

#[tauri::command]
pub async fn library_search(
    lib: State<'_, Arc<Library>>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<LibraryFile>, String> {
    let lib = lib.inner().clone();
    blocking(move || lib.search(&query, limit.unwrap_or(5000))).await
}

#[derive(Serialize)]
pub struct HashMatch {
    hash: String,
    file: LibraryFile,
}

/// The MD5 in a server `image_hash` (MD5 hex + user id).
fn md5_of_hash(h: &str) -> Option<String> {
    let m = h.get(..32)?;
    m.bytes()
        .all(|c| c.is_ascii_hexdigit())
        .then(|| m.to_ascii_lowercase())
}

/// Local files (library first) of server `image_hash`es.
#[tauri::command]
pub async fn library_by_hashes(
    lib: State<'_, Arc<Library>>,
    hashes: Vec<String>,
) -> Result<Vec<HashMatch>, String> {
    let lib = lib.inner().clone();
    blocking(move || {
        let md5s: Vec<String> = hashes.iter().filter_map(|h| md5_of_hash(h)).collect();
        let files = library::db::by_md5(&lib.conn(), &md5s).map_err(|e| e.to_string())?;
        Ok(hashes
            .into_iter()
            .filter_map(|h| {
                let md5 = md5_of_hash(&h)?;
                let file = files
                    .iter()
                    .find(|f| f.md5.as_deref() == Some(md5.as_str()))?
                    .clone();
                Some(HashMatch { hash: h, file })
            })
            .collect())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    root: Option<Root>,
    file: Option<LibraryFile>,
}

/// Whether `path` is in the library: its root, and its row once indexed.
#[tauri::command]
pub async fn library_status(
    lib: State<'_, Arc<Library>>,
    path: String,
) -> Result<LibraryStatus, String> {
    let lib = lib.inner().clone();
    blocking(move || {
        let root = lib.root_of(&path);
        let file = library::db::by_path(&lib.conn(), &path)
            .map_err(|e| e.to_string())?
            .filter(|f| f.root_id.is_some());
        Ok(LibraryStatus { root, file })
    })
    .await
}

// ------------------------------------------------------------------ server

#[tauri::command]
pub async fn server_status(server: State<'_, Arc<Server>>) -> Result<server::ServerStatus, String> {
    let server = server.inner().clone();
    blocking(move || Ok(server.status())).await
}

#[tauri::command]
pub async fn server_connect(
    server: State<'_, Arc<Server>>,
    url: String,
    username: String,
    password: String,
) -> Result<server::ServerStatus, String> {
    server.connect(&url, &username, &password).await
}

#[tauri::command]
pub fn server_disconnect(server: State<'_, Arc<Server>>) {
    server.disconnect();
}

#[tauri::command]
pub fn server_set_backup(server: State<'_, Arc<Server>>, on: bool) -> Result<(), String> {
    server.set_backup(on)
}

#[tauri::command]
pub fn server_set_paused(server: State<'_, Arc<Server>>, paused: bool) -> Result<(), String> {
    server.set_paused(paused)
}

#[tauri::command]
pub fn server_retry_failed(server: State<'_, Arc<Server>>) -> Result<usize, String> {
    server.retry_failed()
}

#[tauri::command]
pub async fn server_fetch(
    server: State<'_, Arc<Server>>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    server.fetch(&method, &path, body).await
}

#[tauri::command]
pub async fn server_upload_file(
    server: State<'_, Arc<Server>>,
    path: String,
) -> Result<server::RemoteOf, String> {
    let server = server.inner().clone();
    blocking(move || server.upload_file(&path)).await
}

#[tauri::command]
pub async fn server_remote_of(
    server: State<'_, Arc<Server>>,
    path: String,
) -> Result<server::RemoteOf, String> {
    server.remote_of(&path).await
}

// ------------------------------------------------------------------ wiring

/// The app handle, for events from threads started before the window exists.
pub static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn emit_event<S: Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP.get() {
        let _ = app.emit(event, payload);
    }
}

pub fn open_library() -> Arc<Library> {
    let conn = appdirs::data_dir()
        .and_then(|d| match library::db::open(&d.join("library.db")) {
            Ok(c) => Some(c),
            Err(e) => {
                eprintln!("library database unavailable ({e}); using a temporary one");
                None
            }
        })
        .unwrap_or_else(|| library::db::open_memory().expect("in-memory database"));
    Library::open(conn, |ev| match ev {
        library::LibraryEvent::Changed => emit_event("library://changed", ()),
        p @ library::LibraryEvent::Progress { .. } => emit_event("library://progress", p),
    })
}

pub fn open_server(lib: Arc<Library>) -> Arc<Server> {
    let dir = appdirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let store = server::auth::Keychain {
        service: appdirs::keyring_service(),
    };
    let server = Server::new(
        lib.clone(),
        dir,
        Box::new(store),
        Box::new(|| emit_event("server://status", ())),
    );
    let s = server.clone();
    lib.set_on_new(move || s.wake.notify_waiters());
    server
}

/// `lpview://.../remote?kind=square|big&hash=<image_hash>`: a server thumbnail through the
/// signed-in session (CONTRACT.md "Server media").
pub fn handle_remote(
    server: Arc<Server>,
    query: Option<&str>,
    respond: impl FnOnce(tauri::http::Response<Vec<u8>>) + Send + 'static,
) {
    let q = query.unwrap_or("");
    let kind = request::query_param(q, "kind").unwrap_or_else(|| "square".into());
    let hash = request::query_param(q, "hash").unwrap_or_default();
    tauri::async_runtime::spawn(async move {
        let r = match server.media(&kind, &hash).await {
            Ok((bytes, mime)) => tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", mime)
                .header("Cache-Control", "max-age=31536000, immutable")
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes),
            Err((status, msg)) => tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", "text/plain; charset=utf-8")
                .header("Access-Control-Allow-Origin", "*")
                .body(msg.into_bytes()),
        };
        if let Ok(r) = r {
            respond(r);
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn md5_of_server_hashes() {
        let md5 = "5d41402abc4b2a76b9719d911017c592";
        assert_eq!(
            super::md5_of_hash(&format!("{md5}12")).as_deref(),
            Some(md5)
        );
        assert_eq!(super::md5_of_hash("short"), None);
        assert_eq!(super::md5_of_hash(&format!("{}1", "z".repeat(32))), None);
    }
}

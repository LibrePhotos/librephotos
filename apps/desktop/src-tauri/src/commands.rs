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
pub async fn server_status(server: State<'_, Arc<Server>>) -> Result<server::ServerState, String> {
    let server = server.inner().clone();
    blocking(move || Ok(server.state())).await
}

#[tauri::command]
pub fn server_session(server: State<'_, Arc<Server>>) -> server::Session {
    server.session()
}

#[tauri::command]
pub fn server_prepare_sign_in(
    server: State<'_, Arc<Server>>,
    url: String,
) -> Result<String, String> {
    server.prepare_sign_in(&url)
}

#[tauri::command]
pub async fn server_signed_in(
    server: State<'_, Arc<Server>>,
    sign_in: server::SignIn,
) -> Result<server::ServerState, String> {
    let server = server.inner().clone();
    blocking(move || server.signed_in(sign_in)).await
}

#[tauri::command]
pub fn server_set_access(server: State<'_, Arc<Server>>, token: Option<String>) {
    server.set_access(token);
}

#[tauri::command]
pub fn server_signed_out(server: State<'_, Arc<Server>>, reason: Option<String>) {
    server.signed_out(reason);
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
pub async fn server_retry_failed(server: State<'_, Arc<Server>>) -> Result<usize, String> {
    let server = server.inner().clone();
    blocking(move || server.retry_failed()).await
}

#[tauri::command]
pub async fn server_upload_file(
    server: State<'_, Arc<Server>>,
    path: String,
) -> Result<server::RemoteOf, String> {
    let server = server.inner().clone();
    blocking(move || server.upload_file(&path)).await
}

/// The api-client's native transport: one framed request in, one framed response out
/// (`server::http`).
#[tauri::command]
pub async fn http_fetch(
    server: State<'_, Arc<Server>>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(raw) = request.body() else {
        return Err("http_fetch takes a framed binary request".into());
    };
    let (head, body) = server::http::unframe(raw)?;
    let meta: server::http::RequestMeta =
        serde_json::from_slice(head).map_err(|e| e.to_string())?;
    let body = body.to_vec();
    let server = server.inner().clone();
    server.http(meta, body).await.map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn http_fetch_abort(server: State<'_, Arc<Server>>, id: String) {
    server.requests.abort(&id);
}

// ------------------------------------------------------------------ backup queue

#[tauri::command]
pub async fn backup_reset(server: State<'_, Arc<Server>>) -> Result<(), String> {
    let server = server.inner().clone();
    blocking(move || server.backup_reset()).await
}

#[tauri::command]
pub async fn backup_claim_checks(
    server: State<'_, Arc<Server>>,
    limit: i64,
) -> Result<Vec<library::db::Job>, String> {
    let server = server.inner().clone();
    blocking(move || server.claim_checks(limit)).await
}

#[tauri::command]
pub async fn backup_claim_upload(
    server: State<'_, Arc<Server>>,
) -> Result<Option<library::db::Job>, String> {
    let server = server.inner().clone();
    blocking(move || server.claim_upload()).await
}

#[tauri::command]
pub async fn backup_next_retry(server: State<'_, Arc<Server>>) -> Result<Option<i64>, String> {
    let server = server.inner().clone();
    blocking(move || server.next_retry()).await
}

#[tauri::command]
pub async fn backup_hash(server: State<'_, Arc<Server>>, id: i64) -> Result<String, String> {
    let server = server.inner().clone();
    blocking(move || server.hash(id)).await
}

#[tauri::command]
pub async fn backup_prepare(
    server: State<'_, Arc<Server>>,
    id: i64,
) -> Result<server::backup::Prepared, String> {
    let server = server.inner().clone();
    blocking(move || server.prepare(id)).await
}

#[tauri::command]
pub async fn backup_set_remote(
    server: State<'_, Arc<Server>>,
    id: i64,
    state: String,
    photo_id: Option<String>,
) -> Result<(), String> {
    let server = server.inner().clone();
    blocking(move || server.set_remote(id, &state, photo_id.as_deref())).await
}

#[tauri::command]
pub async fn backup_set_failed(
    server: State<'_, Arc<Server>>,
    id: i64,
    error: String,
    attempts: i64,
    next_try_ms: i64,
) -> Result<(), String> {
    let server = server.inner().clone();
    blocking(move || server.set_failed(id, &error, attempts, next_try_ms)).await
}

#[tauri::command]
pub async fn backup_set_progress(
    server: State<'_, Arc<Server>>,
    id: i64,
    upload_id: Option<String>,
    offset: i64,
) -> Result<(), String> {
    let server = server.inner().clone();
    blocking(move || server.set_progress(id, upload_id.as_deref(), offset)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOf {
    id: i64,
    #[serde(flatten)]
    remote: server::RemoteOf,
}

/// A local file's row (made when it is outside the library), its MD5 and what the library knows.
#[tauri::command]
pub async fn backup_local_of(
    server: State<'_, Arc<Server>>,
    path: String,
) -> Result<LocalOf, String> {
    let server = server.inner().clone();
    blocking(move || {
        server
            .local_of(&path)
            .map(|(id, remote)| LocalOf { id, remote })
    })
    .await
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
    // New files may need a backup: the UI's engine looks for work on this event.
    lib.set_on_new(|| emit_event("server://status", ()));
    server
}

/// `lpview://.../remote?src=<media URL>`: a server thumbnail through the signed-in session
/// (CONTRACT.md "Server media"). `src` is the URL `packages/api-client`'s media helpers build.
pub fn handle_remote(
    server: Arc<Server>,
    query: Option<&str>,
    respond: impl FnOnce(tauri::http::Response<Vec<u8>>) + Send + 'static,
) {
    let src = request::query_param(query.unwrap_or(""), "src").unwrap_or_default();
    tauri::async_runtime::spawn(async move {
        let r = match server.media(&src).await {
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

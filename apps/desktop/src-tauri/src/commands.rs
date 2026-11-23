use std::sync::{Arc, OnceLock};

use serde::Serialize;
use tauri::{Emitter, State};

use crate::localdb::{self, LocalDb};
use crate::platform::{self, watch::WatchService};
use crate::server::{self, Server};
use crate::{appdirs, blocking, request};

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

fn trace_db(what: &str, n: usize, t: std::time::Instant, out: &Result<localdb::Answer, String>) {
    static ON: OnceLock<bool> = OnceLock::new();
    if *ON.get_or_init(|| std::env::var_os("LPVIEW_DB_TRACE").is_some()) {
        let size = out.as_ref().map(Vec::len);
        eprintln!("db: {what} x{n}: {:?}, {size:?} bytes", t.elapsed());
    }
}

fn answer(out: Result<localdb::Answer, String>) -> Result<tauri::ipc::Response, String> {
    out.map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn db_exec(
    db: State<'_, Arc<LocalDb>>,
    sql: String,
    params: Vec<localdb::value::Param>,
    method: localdb::Method,
) -> Result<tauri::ipc::Response, String> {
    let db = db.inner().clone();
    blocking(move || {
        let t = std::time::Instant::now();
        let out = db.exec(&localdb::Statement {
            sql,
            params,
            method,
        });
        trace_db("exec", 1, t, &out);
        answer(out)
    })
    .await
}

#[tauri::command]
pub async fn db_batch(
    db: State<'_, Arc<LocalDb>>,
    statements: Vec<localdb::Statement>,
) -> Result<tauri::ipc::Response, String> {
    let db = db.inner().clone();
    blocking(move || {
        let t = std::time::Instant::now();
        let out = db.batch(&statements);
        trace_db("batch", statements.len(), t, &out);
        answer(out)
    })
    .await
}

#[tauri::command]
pub fn db_info(db: State<'_, Arc<LocalDb>>) -> localdb::DbInfo {
    db.info()
}

#[tauri::command]
pub async fn fs_walk(
    root: String,
    on_batch: tauri::ipc::Channel<platform::WalkBatch>,
) -> Result<usize, String> {
    blocking(move || {
        platform::walk(std::path::Path::new(&root), platform::WALK_BATCH, |b| {
            on_batch.send(b).is_ok()
        })
    })
    .await
}

#[tauri::command]
pub fn fs_watch(watch: State<'_, WatchService>, root: String) -> Result<String, String> {
    watch.watch(&root)
}

#[tauri::command]
pub fn fs_unwatch(watch: State<'_, WatchService>, root: String) -> bool {
    watch.unwatch(&root)
}

fn check_paths(paths: &[String]) -> Result<(), String> {
    if paths.len() > platform::MAX_PATHS {
        return Err(format!("at most {} paths per call", platform::MAX_PATHS));
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_read_metadata(
    paths: Vec<String>,
) -> Result<Vec<Option<platform::FileMeta>>, String> {
    check_paths(&paths)?;
    blocking(move || Ok(platform::read_metadata(&paths))).await
}

#[tauri::command]
pub async fn fs_stat(paths: Vec<String>) -> Result<Vec<Option<platform::FsEntry>>, String> {
    check_paths(&paths)?;
    blocking(move || Ok(paths.iter().map(|p| platform::stat(p)).collect())).await
}

#[tauri::command]
pub async fn fs_md5(path: String) -> Result<String, String> {
    blocking(move || {
        server::backup::md5_file(std::path::Path::new(&path)).map_err(|e| format!("{path}: {e}"))
    })
    .await
}

pub static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn emit_event<S: Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP.get() {
        let _ = app.emit(event, payload);
    }
}

pub fn open_local_db() -> Arc<LocalDb> {
    let hub = localdb::changes::ChangeHub::spawn(localdb::changes::WINDOW, |tables| {
        emit_event("db://changed", localdb::changes::Changed { tables })
    });
    let migrations = localdb::migrate::bundled();
    let opened = appdirs::data_dir().and_then(|d| {
        match LocalDb::open(&d.join(localdb::FILE_NAME), &migrations, hub.clone()) {
            Ok(db) => Some(db),
            Err(e) => {
                eprintln!("local database unavailable ({e}); using a temporary one");
                None
            }
        }
    });
    Arc::new(
        opened
            .unwrap_or_else(|| LocalDb::open_memory(&migrations, hub).expect("in-memory database")),
    )
}

pub fn open_watchers() -> WatchService {
    WatchService::new(
        platform::watch::QUIET,
        platform::watch::MAX_WAIT,
        |changes| emit_event("fs://changed", changes),
    )
}

pub fn open_server() -> Arc<Server> {
    let dir = appdirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let store = server::auth::Keychain {
        service: appdirs::keyring_service(),
    };
    Server::new(
        dir,
        Box::new(store),
        Box::new(|| emit_event("server://status", ())),
    )
}

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

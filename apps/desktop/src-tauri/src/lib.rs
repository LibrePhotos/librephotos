//! LibrePhotos Viewer: the Rust side of CONTRACT.md.
//!
//! - `lpview://` pixels: [`protocol`] -> [`pipeline`] (pool, dedupe, LRU, [`diskcache`]) ->
//!   [`decode`] (WIC on Windows, FlashRaw for RAW, pure-Rust fallbacks).
//! - Deep zoom: `lpview://.../tile` and `tile_info` -> [`tiles`] (pyramid, memory + disk caches).
//! - Commands: [`listing`], [`info`], [`ops`].
//! - The library (folders the user added) lives in the shared local database: its schema,
//!   queries and writers are `packages/local-db`, run in the UI. [`localdb`] executes their SQL
//!   and applies their migrations; [`platform`] hands over what the disk knows (walks, watch
//!   batches, metadata, MD5) as data for those writers.
//! - The LibrePhotos server connection (sign-in, API and media proxy, upload bytes): [`server`].
//! - Their commands: [`commands`].

pub mod appdirs;
pub mod cache;
pub mod commands;
pub mod decode;
pub mod diskcache;
pub mod formats;
pub mod heif;
pub mod info;
pub mod jpegmeta;
pub mod listing;
pub mod localdb;
pub mod ops;
pub mod orient;
pub mod pipeline;
pub mod pixels;
pub mod platform;
pub mod protocol;
pub mod request;
pub mod server;
pub mod tiles;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::pipeline::{Pipeline, Priority};
use crate::request::{Kind, THUMB_EDGE};
use crate::tiles::{TileInfo, TileService};

/// Run blocking work off the IPC thread.
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn arg_path() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.is_empty() && !a.starts_with('-'))
}

#[tauri::command]
fn initial_path() -> Option<String> {
    arg_path()
}

type Listing = Result<listing::FolderListing, String>;

/// The listing of the command-line path, made while the webview boots (50 ms for 2000 files).
static STARTUP_LISTING: Mutex<Option<(String, JoinHandle<Listing>)>> = Mutex::new(None);

fn start_listing(path: String) {
    let p = path.clone();
    if let Ok(handle) = std::thread::Builder::new()
        .name("lpview-startup-listing".into())
        .spawn(move || listing::list_folder(&p))
    {
        *STARTUP_LISTING.lock().unwrap() = Some((path, handle));
    }
}

/// The startup listing if it is for `path` (once), waiting for it if it is still running.
fn take_startup_listing(path: &str) -> Option<Listing> {
    let mut slot = STARTUP_LISTING.lock().unwrap();
    if slot.as_ref().is_some_and(|(p, _)| p == path) {
        let (_, handle) = slot.take()?;
        drop(slot);
        return handle.join().ok();
    }
    None
}

#[tauri::command]
async fn list_folder(path: String) -> Result<listing::FolderListing, String> {
    blocking(move || take_startup_listing(&path).unwrap_or_else(|| listing::list_folder(&path)))
        .await
}

#[tauri::command]
async fn image_info(path: String) -> Result<info::ImageInfo, String> {
    blocking(move || info::image_info(&path)).await
}

#[tauri::command]
async fn trash_file(path: String) -> Result<(), String> {
    blocking(move || ops::trash_file(&path)).await
}

#[tauri::command]
async fn rotate_file(path: String, clockwise: bool) -> Result<i64, String> {
    blocking(move || ops::rotate_file(&path, clockwise)).await
}

#[tauri::command]
async fn reveal_in_folder(path: String) -> Result<(), String> {
    blocking(move || ops::reveal_in_folder(&path)).await
}

#[tauri::command]
async fn copy_image(path: String) -> Result<(), String> {
    blocking(move || ops::copy_image(&path)).await
}

#[tauri::command]
async fn tile_info(
    tiles: State<'_, TileService>,
    path: String,
) -> Result<Option<TileInfo>, String> {
    let tiles = tiles.inner().clone();
    blocking(move || tiles.info(std::path::Path::new(&path))).await
}

#[tauri::command]
fn tile_release(tiles: State<'_, TileService>, path: String) {
    tiles.release(std::path::Path::new(&path));
}

#[tauri::command]
async fn prewarm_thumbs(
    pipeline: State<'_, Arc<Pipeline>>,
    paths: Vec<String>,
) -> Result<usize, String> {
    let pipeline = pipeline.inner().clone();
    blocking(move || Ok(pipeline.prewarm(paths.into_iter().map(PathBuf::from).collect()))).await
}

#[tauri::command]
async fn clear_cache(pipeline: State<'_, Arc<Pipeline>>) -> Result<u64, String> {
    let pipeline = pipeline.inner().clone();
    blocking(move || {
        pipeline.prewarm(Vec::new());
        Ok(pipeline.disk().map_or(0, |d| d.clear()))
    })
    .await
}

#[tauri::command]
async fn open_default_apps_settings() -> Result<(), String> {
    blocking(ops::open_default_apps_settings).await
}

/// The picture file given on the command line, if any (not a folder, not a video).
fn initial_picture() -> Option<PathBuf> {
    let path = PathBuf::from(arg_path()?);
    let picture = formats::kind_of_ext(&formats::ext_of(&path))
        .is_some_and(|k| k != formats::FileKind::Video);
    (picture && path.is_file()).then_some(path)
}

/// CSS height of the chrome above and below the stage (`.topbar` and `.filmstrip` heights).
const CHROME_CSS_PX: f64 = 48.0 + 76.0;

/// Device-pixel box the stage will ask `screen` for in a window of this inner size (physical
/// pixels) and scale: the whole width, the height minus the top bar and the filmstrip. Mirrors
/// `useStageSize` in `src/stage/Stage.tsx`; a wrong guess costs one extra decode, nothing else.
pub fn predicted_stage_box(inner_w: u32, inner_h: u32, scale: f64) -> Option<(u32, u32)> {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    let w = (inner_w as f64 / scale * scale).round();
    let h = ((inner_h as f64 / scale - CHROME_CSS_PX) * scale).round();
    (w >= 1.0 && h >= 1.0).then_some((w as u32, h as u32))
}

/// Start the pictures of the file given on the command line while the webview boots, so the
/// page's first requests find them done or in flight: the thumb at once, the `screen` as soon
/// as the window (and so the stage size) exists.
fn preload_initial(pipeline: &Pipeline, screen_box: Option<(u32, u32)>) {
    let Some(path) = initial_picture() else {
        return;
    };
    let (kind, w, h) = match screen_box {
        Some((w, h)) => (Kind::Screen, w, h),
        None => (Kind::Thumb, THUMB_EDGE, THUMB_EDGE),
    };
    pipeline.submit_with(path, kind, w, h, Priority::High, Box::new(|_| ()));
}

fn open_disk_cache() -> Option<diskcache::DiskCache> {
    let dir = diskcache::default_dir()?;
    match diskcache::DiskCache::open(dir.clone(), diskcache::DEFAULT_CAP) {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("disk cache disabled: {}: {e}", dir.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn predicts_the_stage_box() {
        assert_eq!(
            super::predicted_stage_box(1280, 820, 1.0),
            Some((1280, 696))
        );
        assert_eq!(
            super::predicted_stage_box(1600, 1025, 1.25),
            Some((1600, 870))
        );
        assert_eq!(super::predicted_stage_box(500, 100, 1.0), None);
    }
}

#[derive(Clone, Serialize)]
struct OpenPayload {
    path: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pipeline = Arc::new(Pipeline::with_disk(
        pipeline::DEFAULT_WORKERS,
        pipeline::DEFAULT_CACHE_BYTES,
        open_disk_cache(),
    ));
    if let Some(path) = arg_path() {
        start_listing(path);
    }
    preload_initial(&pipeline, None);
    let for_protocol = pipeline.clone();
    let tiles = TileService::new(tiles::disk::default_root(), tiles::disk::DEFAULT_CAP_BYTES);
    let tile_handler = tiles.clone();
    // Migrations run here, before the window (and so the UI's first query) exists.
    let local_db = commands::open_local_db();
    let watchers = commands::open_watchers();
    let server = commands::open_server();
    let for_remote = server.clone();
    let mut builder = tauri::Builder::default()
        .manage(tiles)
        .manage(local_db)
        .manage(watchers)
        .manage(server);
    // LPVIEW_MULTI_INSTANCE=1 lets test harnesses run several copies side by side.
    if std::env::var_os("LPVIEW_MULTI_INSTANCE").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv.iter().skip(1).find(|a| !a.starts_with('-')) {
                let _ = app.emit("viewer://open", OpenPayload { path: path.clone() });
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(pipeline)
        .setup(|app| {
            let _ = commands::APP.set(app.handle().clone());
            if let Some(win) = app.get_webview_window("main")
                && let (Ok(size), Ok(scale)) = (win.inner_size(), win.scale_factor())
            {
                let pipeline = app.state::<Arc<Pipeline>>();
                preload_initial(
                    &pipeline,
                    predicted_stage_box(size.width, size.height, scale),
                );
            }
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("lpview", move |_ctx, request, responder| {
            if request.uri().path() == "/remote" {
                let query = request.uri().query();
                commands::handle_remote(for_remote.clone(), query, move |r| responder.respond(r));
            } else if tiles::is_tile_url(request.uri().path()) {
                let query = request.uri().query();
                tiles::handle(&tile_handler, query, move |r| responder.respond(r));
            } else {
                protocol::handle(&for_protocol, &request, move |r| responder.respond(r));
            }
        })
        .invoke_handler(tauri::generate_handler![
            initial_path,
            list_folder,
            image_info,
            trash_file,
            rotate_file,
            reveal_in_folder,
            copy_image,
            prewarm_thumbs,
            clear_cache,
            open_default_apps_settings,
            tile_info,
            tile_release,
            commands::server_status,
            commands::server_session,
            commands::server_prepare_sign_in,
            commands::server_signed_in,
            commands::server_set_access,
            commands::server_signed_out,
            commands::server_set_backup,
            commands::server_set_paused,
            commands::http_fetch,
            commands::http_fetch_abort,
            commands::db_exec,
            commands::db_batch,
            commands::db_info,
            commands::fs_walk,
            commands::fs_watch,
            commands::fs_unwatch,
            commands::fs_read_metadata,
            commands::fs_stat,
            commands::fs_md5
        ])
        .run(tauri::generate_context!())
        .expect("error while running the viewer");
}

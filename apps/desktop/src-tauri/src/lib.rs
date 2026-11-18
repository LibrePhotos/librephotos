//! LibrePhotos Viewer: the Rust side of CONTRACT.md.
//!
//! - `lpview://` pixels: [`protocol`] -> [`pipeline`] (pool, dedupe, LRU) -> [`decode`]
//!   (WIC on Windows, FlashRaw for RAW, pure-Rust fallbacks).
//! - Deep zoom: `lpview://.../tile` and `tile_info` -> [`tiles`] (pyramid, memory + disk caches).
//! - Commands: [`listing`], [`info`], [`ops`].

pub mod cache;
pub mod decode;
pub mod formats;
pub mod heif;
pub mod info;
pub mod jpegmeta;
pub mod listing;
pub mod ops;
pub mod orient;
pub mod pipeline;
pub mod pixels;
pub mod protocol;
pub mod request;
pub mod tiles;

use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::pipeline::Pipeline;
use crate::tiles::{TileInfo, TileService};

/// Run blocking work off the IPC thread.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn initial_path() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with('-'))
}

#[tauri::command]
async fn list_folder(path: String) -> Result<listing::FolderListing, String> {
    blocking(move || listing::list_folder(&path)).await
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

#[derive(Clone, Serialize)]
struct OpenPayload {
    path: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pipeline = Arc::new(Pipeline::new(
        pipeline::DEFAULT_WORKERS,
        pipeline::DEFAULT_CACHE_BYTES,
    ));
    let tiles = TileService::new(tiles::disk::default_root(), tiles::disk::DEFAULT_CAP_BYTES);
    let tile_handler = tiles.clone();
    let mut builder = tauri::Builder::default().manage(tiles);
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
        .register_asynchronous_uri_scheme_protocol("lpview", move |_ctx, request, responder| {
            if tiles::is_tile_url(request.uri().path()) {
                let query = request.uri().query();
                tiles::handle(&tile_handler, query, move |r| responder.respond(r));
            } else {
                protocol::handle(&pipeline, &request, move |r| responder.respond(r));
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
            tile_info,
            tile_release
        ])
        .run(tauri::generate_context!())
        .expect("error while running the viewer");
}

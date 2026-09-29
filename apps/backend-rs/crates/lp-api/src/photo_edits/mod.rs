//! Area `photo_edits`. Photo edits (03 §5): PATCH /photos/edit/{h}/; /photosedit/ favorite, hide, setdeleted, DELETE-with-body delete, makepublic, share, savecaption, generateim2txt, rotate. Bulk ops take image_hashes OR {select_all, query, excluded_hashes} (lp_db::scope::photo_filters).
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::photo_edits`, writes in `lp_db::write::photo_edits`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

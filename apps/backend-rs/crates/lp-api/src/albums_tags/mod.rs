//! Area `albums_tags`. Albums & tags (03 §5, §6): user/place/thing/auto lists and details, /locclust/, /folders/subfolders/, tags list/detail, album CRUD + sharing, auto-album delete/delete_all/generate, tag CRUD/add/remove/merge.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::albums_tags`, writes in `lp_db::write::albums_tags`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

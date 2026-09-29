//! Area `search_sharing_public`. Search, sharing, public (03 §5): /photos/searchlist/?search= (grouped via lp_db::pig::group_by_date, or flat when semantic_search_topk), /searchtermexamples/, /photos/shared/fromme + tome (owner required), /public/albums/s/{slug}/, /public/albums/s/{slug}/photos/{h}/, /public/photo/{slug}/ (anonymous), /geocode/search.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::search_sharing_public`, writes in `lp_db::write::search_sharing_public`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

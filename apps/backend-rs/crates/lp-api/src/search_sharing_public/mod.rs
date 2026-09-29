//! Area `search_sharing_public`. Search, sharing, public (03 §5): /photos/searchlist/?search= (grouped via lp_db::pig::group_by_date, or flat when semantic_search_topk), /searchtermexamples/, /photos/shared/fromme + tome (owner required), /public/albums/s/{slug}/, /public/albums/s/{slug}/photos/{h}/, /public/photo/{slug}/ (anonymous), /geocode/search.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::search_sharing_public`, writes in `lp_db::write::search_sharing_public`.

use axum::Router;
use axum::routing::get;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

mod auth;
mod examples;
mod geocode;
mod public;
mod search;
mod sharing;
mod sidecar;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/photos/searchlist", get(search::search_list))
        .route(
            "/api/searchtermexamples",
            get(examples::search_term_examples),
        )
        .route("/api/photos/shared/tome", get(sharing::shared_to_me))
        .route("/api/photos/shared/fromme", get(sharing::shared_from_me))
        .route("/api/public/albums/s/{slug}", get(public::album_by_slug))
        .route(
            "/api/public/albums/s/{slug}/photos/{photo_id}",
            get(public::album_photo_by_slug),
        )
        .route("/api/public/photo/{slug}", get(public::photo_by_slug))
        .route("/api/geocode/search", get(geocode::geocode_search))
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

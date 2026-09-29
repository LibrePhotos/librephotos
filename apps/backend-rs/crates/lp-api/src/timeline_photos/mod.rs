//! Area `timeline_photos`. Timeline & photosets + photo detail (03 §4, §5, §6): /albums/date/list/, /albums/date/{id}, /photos/recentlyadded/, /photos/notimestamp/, /memories/..., GET /photos/{hash|uuid}/, /photos/{h}/albums/, metadata GET/PATCH, /media/diagnostics/{h}/, /photo/share/list, POST /photo/share.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::timeline_photos`, writes in `lp_db::write::timeline_photos`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

//! Area `upload`. Upload (03 §5, 04 §6): GET /exists/{md5+uid} (no slash), POST /upload/ (1 MB multipart chunks, Content-Range total = chunk size), POST /upload/complete/.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::upload`, writes in `lp_db::write::upload`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

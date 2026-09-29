//! Area `people_faces`. People & faces (03 §5): /persons/?page_size=1000, person PATCH/DELETE, /faces/incomplete/ (bare array), /faces/?person&page&inferred&order_by, labelfaces, deletefaces, addface, trainfaces, GET /scanfaces (starts a job), /clusterfaces.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::people_faces`, writes in `lp_db::write::people_faces`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

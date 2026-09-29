//! Area `jobs_zip_services`. Jobs, zip, services (03 §5): GET /jobs/?page_size&page&mine, GET /rqavailable/, job detail/cancel/delete, scanphotos, fullscanphotos, deletemissingphotos, generateocr; POST /photos/download (+ ?job_id= poll), DELETE /delete/zip/{uuid}; /services/ list + status + start/stop.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::jobs_zip_services`, writes in `lp_db::write::jobs_zip_services`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

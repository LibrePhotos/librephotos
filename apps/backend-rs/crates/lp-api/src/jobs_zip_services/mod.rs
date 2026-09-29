//! Area `jobs_zip_services` (03 §5): the jobs page and worker indicator,
//! the job-starting buttons, zip downloads and the services page.
//!
//! Reads in `lp_db::jobs_zip_services`, writes in `lp_db::write::jobs_zip_services`;
//! the worker loop, schedules and maintenance handlers live in `lp-jobs`,
//! the sidecar supervisor in `lp_sidecars::supervisor`.

use axum::Router;
use axum::routing::{get, post};
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub mod jobs;
pub mod services;
pub mod triggers;
pub mod zip;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/jobs", get(jobs::list))
        .route("/api/jobs/{id}", get(jobs::detail).delete(jobs::destroy))
        .route("/api/jobs/{id}/cancel", post(jobs::cancel))
        .route("/api/rqavailable", get(jobs::rq_available))
        .route(
            "/api/scanphotos",
            get(triggers::scan_photos).post(triggers::scan_photos),
        )
        .route(
            "/api/fullscanphotos",
            get(triggers::full_scan_photos).post(triggers::full_scan_photos),
        )
        .route(
            "/api/deletemissingphotos",
            get(triggers::delete_missing_photos).post(triggers::delete_missing_photos),
        )
        .route("/api/generateocr", post(triggers::generate_ocr))
        .route("/api/photos/download", get(zip::poll).post(zip::start))
        .route(
            "/api/delete/zip/{fname}",
            axum::routing::delete(zip::delete),
        )
        .route("/api/services", get(services::list))
        .route("/api/services/{name}", get(services::status))
        .route("/api/services/{name}/start", post(services::start))
        .route("/api/services/{name}/stop", post(services::stop))
}

pub fn register_jobs(reg: &mut HandlerRegistry) {
    reg.register("zip.build", zip::build);
    lp_jobs::maintenance::register(reg);
}

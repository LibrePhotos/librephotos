//! HTTP handlers, one module per frontend feature area (03 §5). Each area
//! owns `src/<area>/` and exposes `routes()` + `register_jobs()`; this file
//! already merges all of them, so adding endpoints never touches it.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub mod common;

pub mod albums_tags;
pub mod auth;
pub mod jobs_zip_services;
pub mod people_faces;
pub mod photo_edits;
pub mod search_sharing_public;
pub mod stats_admin_stacks_dupes;
pub mod sync;
pub mod timeline_photos;
pub mod upload;
pub mod users_settings;

/// Every `/api` route of every area.
pub fn routes() -> Router<AppState> {
    Router::new()
        .merge(auth::routes())
        .merge(users_settings::routes())
        .merge(timeline_photos::routes())
        .merge(photo_edits::routes())
        .merge(albums_tags::routes())
        .merge(people_faces::routes())
        .merge(search_sharing_public::routes())
        .merge(stats_admin_stacks_dupes::routes())
        .merge(sync::routes())
        .merge(jobs_zip_services::routes())
        .merge(upload::routes())
}

pub fn register_jobs(reg: &mut HandlerRegistry) {
    users_settings::register_jobs(reg);
    timeline_photos::register_jobs(reg);
    photo_edits::register_jobs(reg);
    albums_tags::register_jobs(reg);
    people_faces::register_jobs(reg);
    search_sharing_public::register_jobs(reg);
    stats_admin_stacks_dupes::register_jobs(reg);
    sync::register_jobs(reg);
    jobs_zip_services::register_jobs(reg);
    upload::register_jobs(reg);
}

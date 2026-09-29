//! Area `stats_admin_stacks_dupes`: dashboards (`/api/stats/`,
//! `/api/photomonthcounts/`, `/api/wordcloud/`, `/api/socialgraph/`,
//! `/api/locationsunburst/`, `/api/locationtimeline/`), server/admin
//! (`/api/storagestats/`, `/api/imagetag/`, `/api/serverstats/`,
//! `/api/serverlogs`, `/api/serverlogs/view`), photo stacks (custom paging)
//! and duplicate groups (no trailing slashes), plus the `stacks.detect` and
//! `dupes.detect` jobs.

use axum::Router;
use axum::routing::{delete, get, post};
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub mod dupes;
pub mod jobs;
pub mod layout;
pub mod paging;
pub mod palette;
pub mod server;
pub mod stacks;
pub mod stats;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/stats", get(stats::count_stats))
        .route("/api/photomonthcounts", get(stats::photo_month_counts))
        .route("/api/wordcloud", get(stats::word_cloud))
        .route("/api/socialgraph", get(stats::social_graph_view))
        .route("/api/locationsunburst", get(stats::location_sunburst_view))
        .route("/api/locationtimeline", get(stats::location_timeline_view))
        .route("/api/storagestats", get(server::storage_stats))
        .route("/api/imagetag", get(server::image_tag))
        .route("/api/serverstats", get(server::server_stats))
        .route("/api/serverlogs", get(server::server_logs))
        .route("/api/serverlogs/view", get(server::server_logs_view))
        .route("/api/stacks", get(stacks::list))
        .route("/api/stacks/stats", get(stacks::stats))
        .route("/api/stacks/detect", post(stacks::detect))
        .route("/api/stacks/manual", post(stacks::manual))
        .route("/api/stacks/merge", post(stacks::merge))
        .route(
            "/api/stacks/{id}",
            get(stacks::detail).delete(stacks::delete),
        )
        .route("/api/stacks/{id}/delete", delete(stacks::delete))
        .route("/api/stacks/{id}/remove", post(stacks::remove))
        .route("/api/stacks/{id}/primary", post(stacks::set_primary))
        .route("/api/duplicates", get(dupes::list))
        .route("/api/duplicates/stats", get(dupes::stats))
        .route("/api/duplicates/detect", post(dupes::detect))
        .route("/api/duplicates/{id}", get(dupes::detail))
        .route("/api/duplicates/{id}/resolve", post(dupes::resolve))
        .route("/api/duplicates/{id}/dismiss", post(dupes::dismiss))
        .route("/api/duplicates/{id}/revert", post(dupes::revert))
        .route("/api/duplicates/{id}/delete", delete(dupes::delete))
}

pub fn register_jobs(reg: &mut HandlerRegistry) {
    jobs::register(reg);
}

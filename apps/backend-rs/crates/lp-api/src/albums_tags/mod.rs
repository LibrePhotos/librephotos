//! Area `albums_tags`. Albums & tags (03 §5, §6): user/place/thing/auto lists and details, /locclust/, /folders/subfolders/, tags list/detail, album CRUD + sharing, auto-album delete/delete_all/generate, tag CRUD/add/remove/merge.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::albums_tags`, writes in `lp_db::write::albums_tags`.

use axum::Router;
use axum::routing::{get, post};
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

mod auto_albums;
mod dto;
mod misc;
mod tags;
mod things_places;
mod user_albums;
mod validate;

pub fn routes() -> Router<AppState> {
    Router::new()
        // User albums.
        .route("/api/albums/user/list", get(user_albums::list))
        .route(
            "/api/albums/user/{id}",
            get(user_albums::detail)
                .patch(user_albums::rename)
                .delete(user_albums::delete),
        )
        .route("/api/albums/user/edit", post(user_albums::edit_create))
        .route(
            "/api/albums/user/edit/{id}",
            axum::routing::patch(user_albums::edit_update),
        )
        .route(
            "/api/albums/user/shared/fromme",
            get(user_albums::shared_from_me),
        )
        .route(
            "/api/albums/user/shared/tome",
            get(user_albums::shared_to_me),
        )
        .route("/api/useralbum/share", post(user_albums::share))
        .route("/api/useralbum/makepublic", post(user_albums::make_public))
        // Auto (event) albums.
        .route("/api/albums/auto/list", get(auto_albums::list))
        .route("/api/albums/auto/delete_all", post(auto_albums::delete_all))
        .route(
            "/api/albums/auto/{id}",
            get(auto_albums::detail).delete(auto_albums::delete),
        )
        .route(
            "/api/autoalbumgen",
            get(auto_albums::generate).post(auto_albums::generate),
        )
        .route(
            "/api/autoalbumtitlegen",
            get(auto_albums::regenerate_titles).post(auto_albums::regenerate_titles),
        )
        // Thing / place albums.
        .route("/api/albums/thing/list", get(things_places::thing_list))
        .route("/api/albums/thing/{id}", get(things_places::thing_detail))
        .route("/api/albums/place/list", get(things_places::place_list))
        .route("/api/albums/place/{id}", get(things_places::place_detail))
        // Misc.
        .route("/api/locclust", get(misc::location_clusters))
        .route("/api/folders/subfolders", get(misc::subfolders))
        // Tags.
        .route("/api/tags", get(tags::list).post(tags::create))
        .route(
            "/api/tags/{id}",
            get(tags::detail).patch(tags::rename).delete(tags::delete),
        )
        .route("/api/tags/{id}/add", post(tags::add))
        .route("/api/tags/{id}/remove", post(tags::remove))
        .route("/api/tags/{id}/merge", post(tags::merge))
}

pub fn register_jobs(reg: &mut HandlerRegistry) {
    auto_albums::register_jobs(reg);
}

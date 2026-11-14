//! Area `timeline_photos`. Timeline & photosets + photo detail (03 §4, §5, §6): /albums/date/list/, /albums/date/{id}, /photos/recentlyadded/, /photos/notimestamp/, /memories/..., GET /photos/{hash|uuid}/, /photos/{h}/albums/, metadata GET/PATCH.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::timeline_photos`, writes in `lp_db::write::timeline_photos`.

use axum::Router;
use axum::routing::get;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

mod date_albums;
mod detail;
mod lists;
mod memories;
mod metadata;
mod similar;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/albums/date/list", get(date_albums::list))
        .route("/api/albums/date/{id}", get(date_albums::page))
        .route("/api/photos/recentlyadded", get(lists::recently_added))
        .route("/api/photos/notimestamp", get(lists::no_timestamp))
        .route("/api/memories", get(memories::memories))
        .route("/api/photos/{id}", get(detail::photo_detail))
        .route("/api/photos/{id}/albums", get(detail::photo_albums))
        .route(
            "/api/photos/{id}/metadata",
            get(metadata::get_metadata).patch(metadata::patch_metadata),
        )
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

/// Python `int(s)` for a query value (surrounding whitespace allowed).
pub(crate) fn py_int(s: &str) -> Option<i64> {
    let t = s.trim();
    let t = t.strip_prefix('+').unwrap_or(t);
    if t.is_empty() || t.starts_with('+') {
        return None;
    }
    t.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_ints() {
        assert_eq!(py_int(" 3 "), Some(3));
        assert_eq!(py_int("+2"), Some(2));
        assert_eq!(py_int("-1"), Some(-1));
        assert_eq!(py_int("1.0"), None);
        assert_eq!(py_int(""), None);
        assert_eq!(py_int("++1"), None);
    }
}

//! `GET /api/photos/recentlyadded/` and `GET /api/photos/notimestamp/`.

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::time::drf_datetime;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::pig::PigPhoto;
use lp_db::timeline_photos::lists;
use serde::Serialize;

use crate::common::pagination::{DrfPage, PageRequest};

#[derive(Serialize)]
struct RecentlyAdded {
    /// The latest upload's `added_on`. Django sends `null` for an empty
    /// library, which the frontend's schema (`z.string()`) rejects, so an
    /// empty library gets `""`.
    date: String,
    results: Vec<PigPhoto>,
}

pub async fn recently_added(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> ApiResult<Response> {
    let (latest, results) = lists::recently_added(&state.db, user.id).await?;
    Ok(Json(RecentlyAdded {
        date: latest.as_ref().map(drf_datetime).unwrap_or_default(),
        results,
    })
    .into_response())
}

pub async fn no_timestamp(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: HeaderMap,
    uri: Uri,
    q: QueryMap,
) -> ApiResult<Response> {
    let mut req = PageRequest::from_query(&q, "page_size", 100, 200)?;
    if req.page == i64::MAX {
        let count = lists::no_timestamp_count(&state.db, user.id).await?;
        req = req.valid_for(count)?;
    }
    let (count, results) =
        lists::no_timestamp_page(&state.db, user.id, req.offset(), req.page_size).await?;
    if results.is_empty() && req.page > 1 {
        return Err(ApiError::not_found_msg("Invalid page."));
    }
    // Links point at the path as Django spells it (with its trailing slash).
    let canonical: Uri = match uri.query() {
        Some(query) => format!("/api/photos/notimestamp/?{query}"),
        None => "/api/photos/notimestamp/".to_string(),
    }
    .parse()
    .unwrap_or(uri);
    Ok(Json(DrfPage::new(&headers, &canonical, req, count, results)).into_response())
}

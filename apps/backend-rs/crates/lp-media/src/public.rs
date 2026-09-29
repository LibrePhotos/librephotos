//! `GET /api/public/photo/{slug}/media/{kind}` (`PublicPhotoMediaBySlug`):
//! media for a shared photo, addressed by the share's slug. Only the big
//! thumbnail, plus the original of a video.

use axum::extract::{Path as UrlPath, State};
use axum::http::header::CACHE_CONTROL;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;
use lp_auth::OptionalUser;
use lp_core::AppState;
use lp_db::media as q;

use crate::serve::empty;
use crate::view::{Ctx, generate, generate_original};

pub async fn public_photo_media(
    State(state): State<AppState>,
    // Authentication still runs (a bad bearer token is a 401, as on Django).
    _user: OptionalUser,
    method: Method,
    headers: HeaderMap,
    UrlPath((slug, kind)): UrlPath<(String, String)>,
) -> Response {
    if kind != "thumbnail" && kind != "video" {
        return empty(StatusCode::NOT_FOUND);
    }
    let photo = match q::photo_for_share(&state.db, &slug).await {
        Ok(Some(p)) => p,
        Ok(None) => return empty(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!(error = %e, "photo share lookup failed");
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let ctx = Ctx::new(&state, &method, &headers);
    let mut res = if kind == "thumbnail" {
        let hash = photo.image_hash.clone();
        generate(&ctx, &photo, "thumbnails_big", &hash, false).await
    } else if photo.video {
        generate_original(&ctx, &photo, false, false).await
    } else {
        return empty(StatusCode::NOT_FOUND);
    };
    res.headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    res
}

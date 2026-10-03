//! `GET /api/photos/shared/tome/` and `/api/photos/shared/fromme/`
//! (api/views/sharing.py, `HugeResultsSetPagination`: 2500 per page, `page_size` ≤ 5000).

use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, Uri};
use lp_auth::AuthUser;
use lp_core::{ApiResult, AppState, QueryMap};
use lp_db::pig::PigPhoto;
use lp_db::search_sharing_public::sharing;
use lp_db::users::SimpleUser;
use serde::Serialize;

use crate::common::{DrfPage, PageRequest};

const PAGE_SIZE: i64 = 2500;
const MAX_PAGE_SIZE: i64 = 5000;

/// The DRF router URL of these lists always ends in a slash (Django redirects
/// the bare form), so its `next`/`previous` links do too; the router here
/// sees the path with the slash already stripped.
fn django_uri(uri: &Uri) -> Uri {
    let path = uri.path();
    if path.ends_with('/') {
        return uri.clone();
    }
    let pq = match uri.query() {
        Some(q) => format!("{path}/?{q}"),
        None => format!("{path}/"),
    };
    pq.parse().unwrap_or_else(|_| uri.clone())
}

pub(super) async fn shared_to_me(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: HeaderMap,
    uri: Uri,
    q: QueryMap,
) -> ApiResult<Json<DrfPage<PigPhoto>>> {
    let req = PageRequest::from_query(&q, "page_size", PAGE_SIZE, MAX_PAGE_SIZE)?;
    let count = sharing::shared_to_me_count(&state.db, user.id).await?;
    let req = req.valid_for(count)?;
    let photos = if count == 0 {
        Vec::new()
    } else {
        sharing::shared_to_me(&state.db, user.id, req.page_size, req.offset()).await?
    };
    Ok(Json(DrfPage::new(
        &headers,
        &django_uri(&uri),
        req,
        count,
        photos,
    )))
}

/// `SharedFromMePhotoThroughSerializer`: `(user_id, user, photo)`.
#[derive(Serialize)]
pub(super) struct SharedFromMeItem {
    user_id: i32,
    user: SimpleUser,
    photo: PigPhoto,
}

pub(super) async fn shared_from_me(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: HeaderMap,
    uri: Uri,
    q: QueryMap,
) -> ApiResult<Json<DrfPage<SharedFromMeItem>>> {
    let req = PageRequest::from_query(&q, "page_size", PAGE_SIZE, MAX_PAGE_SIZE)?;
    let count = sharing::shared_from_me_count(&state.db, user.id).await?;
    let req = req.valid_for(count)?;
    let rows = if count == 0 {
        Vec::new()
    } else {
        sharing::shared_from_me(&state.db, user.id, req.page_size, req.offset()).await?
    };
    let items = rows
        .into_iter()
        .map(|r| SharedFromMeItem {
            user_id: r.user.id,
            user: r.user,
            photo: r.photo,
        })
        .collect();
    Ok(Json(DrfPage::new(
        &headers,
        &django_uri(&uri),
        req,
        count,
        items,
    )))
}

//! Thing and place albums: lists and grouped details.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Uri};
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::{ApiResult, AppState, QueryMap};
use lp_db::albums_tags::search_terms;
use lp_db::albums_tags::things_places::{
    self as reads, AlbumPhotos, CoverAlbumRow, active_thing_types, album_photos,
};
use serde::Serialize;
use serde_json::{Value, json};

use super::dto::{Group, grouped, media_filter};
use crate::common::{DrfPage, PageRequest};

/// `AlbumThingListSerializer`.
#[derive(Debug, Serialize)]
pub struct ThingItem {
    id: i32,
    cover_photos: Value,
    title: String,
    photo_count: i64,
    thing_type: Option<String>,
}

/// `AlbumPlaceListSerializer`.
#[derive(Debug, Serialize)]
pub struct PlaceItem {
    id: i32,
    geolocation_level: Option<i32>,
    cover_photos: Value,
    title: String,
    photo_count: i64,
}

/// `GET /api/albums/thing/list/`.
pub async fn thing_list(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<ThingItem>>> {
    let req = PageRequest::from_query(&q, "page_size", 1000, 2000)?;
    let types = active_thing_types(&state.settings().tagging_model);
    let search = search_terms(q.get("search"));
    let paged = reads::thing_list(
        &state.db,
        user.id,
        &types,
        &search,
        req.page_size,
        req.offset(),
    )
    .await?;
    let req = req.valid_for(paged.total)?;
    let results = paged
        .rows
        .into_iter()
        .map(|r: CoverAlbumRow| ThingItem {
            id: r.id,
            cover_photos: r.cover_photos.0,
            title: r.title,
            photo_count: r.photo_count,
            thing_type: r.thing_type,
        })
        .collect();
    Ok(Json(DrfPage::new(
        &headers,
        &uri,
        req,
        paged.total,
        results,
    )))
}

/// `GET /api/albums/place/list/`.
pub async fn place_list(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<PlaceItem>>> {
    let req = PageRequest::from_query(&q, "page_size", 1000, 2000)?;
    let search = search_terms(q.get("search"));
    let paged = reads::place_list(&state.db, user.id, &search, req.page_size, req.offset()).await?;
    let req = req.valid_for(paged.total)?;
    let results = paged
        .rows
        .into_iter()
        .map(|r| PlaceItem {
            id: r.id,
            geolocation_level: r.geolocation_level,
            cover_photos: r.cover_photos.0,
            title: r.title,
            photo_count: r.photo_count,
        })
        .collect();
    Ok(Json(DrfPage::new(
        &headers,
        &uri,
        req,
        paged.total,
        results,
    )))
}

/// `Grouped{Thing,Place}PhotosSerializer`: `{id: "<id>", title, grouped_photos}`.
#[derive(Debug, Serialize)]
struct GroupedAlbum {
    id: String,
    title: String,
    grouped_photos: Vec<Group>,
}

/// `{"results": ...}`; an album the user may not see serializes as
/// `GroupedThingPhotosSerializer(None).data`, i.e. `{"title": ""}` with 200.
async fn grouped_response(
    state: &AppState,
    header: Option<(i32, String)>,
    source: impl FnOnce(i32) -> AlbumPhotos,
    q: &QueryMap,
) -> ApiResult<Response> {
    let Some((id, title)) = header else {
        return Ok(Json(json!({ "results": { "title": "" } })).into_response());
    };
    let photos = album_photos(&state.db, source(id), media_filter(q)).await?;
    Ok(Json(json!({
        "results": GroupedAlbum {
            id: id.to_string(),
            title,
            grouped_photos: grouped(photos),
        }
    }))
    .into_response())
}

/// The id as Django's `re.findall` + `filter(id=...)` would use it; a
/// non-numeric id matches nothing.
fn lookup_id(raw: &str) -> Option<i32> {
    raw.trim().parse().ok()
}

/// `GET /api/albums/thing/{id}/`.
pub async fn thing_detail(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    q: QueryMap,
) -> ApiResult<Response> {
    let types = active_thing_types(&state.settings().tagging_model);
    let header = match lookup_id(&raw_id) {
        Some(id) => reads::thing_header(&state.db, id, user.id, &types).await?,
        None => None,
    };
    grouped_response(
        &state,
        header,
        |album_id| AlbumPhotos::Thing { album_id },
        &q,
    )
    .await
}

/// `GET /api/albums/place/{id}/`.
pub async fn place_detail(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    q: QueryMap,
) -> ApiResult<Response> {
    let header = match lookup_id(&raw_id) {
        Some(id) => reads::place_header(&state.db, id, user.id).await?,
        None => None,
    };
    grouped_response(
        &state,
        header,
        |album_id| AlbumPhotos::Place { album_id },
        &q,
    )
    .await
}

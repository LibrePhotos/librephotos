//! Tags (`TagViewSet`): list, detail, create, rename, delete, add/remove
//! photos, merge. Another account's tag behaves like a missing one.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::{ApiError, ApiJson, ApiResult, AppState, QueryMap};
use lp_db::albums_tags::search_terms;
use lp_db::albums_tags::tags::{self as reads, PhotoRef, TagRow};
use lp_db::albums_tags::things_places::{AlbumPhotos, album_photos};
use lp_db::scope::PhotoFilterParams;
use lp_db::users::User;
use lp_db::write::albums_tags::PhotoSelection;
use lp_db::write::albums_tags::tags as writes;
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::dto::{Group, drf_page, fetch_page, grouped, media_filter};
use super::validate::{self as v, Errors};
use crate::common::{DrfPage, PageRequest};

/// `TagListSerializer`.
#[derive(Debug, Serialize)]
pub struct TagItem {
    id: i32,
    name: String,
    photo_count: i32,
    cover_photos: Value,
}

/// `GET /api/tags/` (`?photo=<id or hash>` narrows to one photo's tags).
pub async fn list(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<TagItem>>> {
    let req = PageRequest::from_query(&q, "page_size", 1000, 2000)?;
    let photo = q.non_empty("photo").map(PhotoRef::parse);
    let search = search_terms(q.get("search"));
    let (req, paged) = fetch_page(req, |limit, offset| {
        reads::list(&state.db, user.id, photo.as_ref(), &search, limit, offset)
    })
    .await?;
    let results = paged
        .rows
        .into_iter()
        .map(|r| TagItem {
            id: r.id,
            name: r.name,
            photo_count: r.photo_count,
            cover_photos: r.cover_photos.0,
        })
        .collect();
    Ok(Json(drf_page(&headers, &uri, req, paged.total, results)))
}

fn not_found_tag() -> ApiError {
    ApiError::not_found_msg("No Tag matches the given query.")
}

async fn owned_tag(state: &AppState, user: &User, raw_id: &str) -> ApiResult<TagRow> {
    let id: i32 = raw_id.trim().parse().map_err(|_| ApiError::not_found())?;
    reads::owned(&state.db, id, user.id)
        .await?
        .ok_or_else(not_found_tag)
}

/// `GroupedTagPhotosSerializer`.
#[derive(Debug, Serialize)]
struct TagAlbum {
    id: i32,
    name: String,
    grouped_photos: Vec<Group>,
}

/// `GET /api/tags/{id}/` -> `{"results": {id, name, grouped_photos}}`.
pub async fn detail(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    q: QueryMap,
) -> ApiResult<Json<Value>> {
    let tag = owned_tag(&state, &user, &raw_id).await?;
    let photos = album_photos(
        &state.db,
        AlbumPhotos::Tag { tag_id: tag.id },
        media_filter(&q),
    )
    .await?;
    Ok(Json(json!({
        "results": TagAlbum {
            id: tag.id,
            name: tag.name,
            grouped_photos: grouped(photos),
        }
    })))
}

/// `TagSerializer.validate_name` after the `CharField` checks.
async fn validate_name(
    state: &AppState,
    user: &User,
    value: &Value,
    except: Option<i32>,
) -> ApiResult<String> {
    let mut errors = Errors::default();
    let name = errors.check("name", v::char_field(value, 512));
    if let Some(name) = &name
        && reads::name_taken(&state.db, name, user.id, except).await?
    {
        errors.add("name", format!("Tag '{name}' already exists."));
    }
    errors.into_result()?;
    Ok(name.unwrap_or_default())
}

/// `POST /api/tags/`: an existing name answers 200 with that tag.
pub async fn create(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let obj = v::body_object(&body)?;
    // `str(request.data.get("name") or "").strip()`
    let probe = obj
        .get("name")
        .filter(|n| py_truthy(n))
        .map(v::py_str)
        .unwrap_or_default();
    if let Some(existing) = reads::by_name(&state.db, probe.trim(), user.id).await? {
        return Ok(Json(existing).into_response());
    }
    let Some(raw) = obj.get("name") else {
        return Err(ApiError::bad_request("name", v::REQUIRED));
    };
    let name = validate_name(&state, &user, raw, None).await?;
    let tag = writes::create(&state.db, user.id, &name).await?;
    Ok((StatusCode::CREATED, Json(tag)).into_response())
}

async fn save_name(
    state: &AppState,
    user: &User,
    raw_id: &str,
    body: &Value,
    partial: bool,
) -> ApiResult<Json<TagRow>> {
    let tag = owned_tag(state, user, raw_id).await?;
    let obj = v::body_object(body)?;
    let name = match obj.get("name") {
        Some(raw) => Some(validate_name(state, user, raw, Some(tag.id)).await?),
        None if !partial => return Err(ApiError::bad_request("name", v::REQUIRED)),
        None => None,
    };
    Ok(Json(
        writes::rename(&state.db, tag.id, name.as_deref()).await?,
    ))
}

/// `PATCH /api/tags/{id}/`.
pub async fn rename(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<TagRow>> {
    save_name(&state, &user, &raw_id, &body, true).await
}

/// `PUT /api/tags/{id}/`: the same with `name` required.
pub async fn replace(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<TagRow>> {
    save_name(&state, &user, &raw_id, &body, false).await
}

/// `DELETE /api/tags/{id}/`.
pub async fn delete(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
) -> ApiResult<StatusCode> {
    let tag = owned_tag(&state, &user, &raw_id).await?;
    writes::delete(&state.db, tag.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn raw_error(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
}

/// `_resolve_photos`: `None` when no photos were given.
async fn resolve_photos(
    state: &AppState,
    user: &User,
    body: &Value,
) -> ApiResult<Option<PhotoSelection>> {
    let obj = v::body_object(body)?;
    if obj.get("select_all").is_some_and(py_truthy) {
        let query = match obj.get("query") {
            Some(q @ Value::Object(_)) => q.clone(),
            _ => json!({}),
        };
        let excluded_hashes: Vec<String> = match obj.get("excluded_hashes") {
            Some(Value::Array(items)) => items.iter().map(v::py_str).collect(),
            _ => Vec::new(),
        };
        return Ok(Some(PhotoSelection::SelectAll {
            owner_id: user.id,
            favorite_min_rating: user.favorite_min_rating,
            params: PhotoFilterParams::from_json(&query)?,
            excluded_hashes,
        }));
    }
    let Some(Value::Array(identifiers)) = obj.get("photos") else {
        return Ok(None);
    };
    if identifiers.is_empty() {
        return Ok(None);
    }
    let mut ids: Vec<Uuid> = Vec::new();
    let mut hashes: Vec<String> = Vec::new();
    for identifier in identifiers {
        match PhotoRef::parse(&v::py_str(identifier)) {
            PhotoRef::Id(id) => ids.push(id),
            PhotoRef::Hash(h) => hashes.push(h),
        }
    }
    let found = reads::owned_photos_matching(&state.db, user.id, &ids, &hashes).await?;
    let all_resolved = ids.iter().all(|id| found.iter().any(|(fid, _)| fid == id))
        && hashes.iter().all(|h| found.iter().any(|(_, fh)| fh == h));
    if !all_resolved {
        return Err(ApiError::not_found_msg("Unknown photo"));
    }
    Ok(Some(PhotoSelection::Ids(
        found.into_iter().map(|(id, _)| id).collect(),
    )))
}

/// `POST /api/tags/{id}/add/`.
pub async fn add(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let tag = owned_tag(&state, &user, &raw_id).await?;
    let Some(sel) = resolve_photos(&state, &user, &body).await? else {
        return Ok(raw_error("No photos provided"));
    };
    Ok(Json(writes::add_photos(&state.db, tag.id, &sel).await?).into_response())
}

/// `POST /api/tags/{id}/remove/`.
pub async fn remove(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let tag = owned_tag(&state, &user, &raw_id).await?;
    let Some(sel) = resolve_photos(&state, &user, &body).await? else {
        return Ok(raw_error("No photos provided"));
    };
    Ok(Json(writes::remove_photos(&state.db, tag.id, &sel).await?).into_response())
}

/// `POST /api/tags/{id}/merge/` `{tag: <source id>}`.
pub async fn merge(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let tag = owned_tag(&state, &user, &raw_id).await?;
    let obj = v::body_object(&body)?;
    let source_id = match obj.get("tag") {
        None | Some(Value::Null) => return Ok(raw_error("No tag provided")),
        Some(s) => v::py_int(s).and_then(|i| i32::try_from(i).ok()),
    };
    let source = match source_id {
        Some(id) => reads::owned(&state.db, id, user.id).await?,
        None => None,
    };
    let Some(source) = source else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    if source.id == tag.id {
        return Ok(raw_error("A tag cannot be merged into itself"));
    }
    Ok(Json(writes::merge(&state.db, tag.id, source.id).await?).into_response())
}

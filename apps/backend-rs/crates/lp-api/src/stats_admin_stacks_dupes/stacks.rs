//! Photo stacks (`api/views/stacks.py`): list, detail, stats, delete,
//! remove, merge, manual, detect, primary.

use std::collections::HashMap;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use chrono::{DateTime, Utc};
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::time::{ser_drf, ser_drf_opt};
use lp_core::{ApiError, ApiJson, ApiResult, AppState, QueryMap};
use lp_db::stats_admin_stacks_dupes::stacks::{self as db, MemberPhoto};
use lp_db::stats_admin_stacks_dupes::{big_thumbnail_url, file_type_display, small_thumbnail_url};
use lp_db::write::stats_admin_stacks_dupes::stacks as write;
use lp_jobs::{EnqueueOptions, JobType};
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::paging::{Page, Paging, field, hash_list, parse_id};
use super::stats::py_str;

const NOT_FOUND: &str = "Photo stack not found";

#[derive(Debug, Serialize)]
pub struct PhotoRef {
    pub image_hash: String,
    pub thumbnail_url: Option<String>,
}

impl PhotoRef {
    pub fn of(m: &MemberPhoto) -> Self {
        PhotoRef {
            image_hash: m.image_hash.clone(),
            thumbnail_url: small_thumbnail_url(&m.image_hash, m.thumb_small.as_deref()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StackListItem {
    pub id: Uuid,
    pub stack_type: String,
    pub stack_type_display: String,
    pub photo_count: i64,
    #[serde(serialize_with = "ser_drf_opt")]
    pub sequence_start: Option<DateTime<Utc>>,
    #[serde(serialize_with = "ser_drf_opt")]
    pub sequence_end: Option<DateTime<Utc>>,
    #[serde(serialize_with = "ser_drf")]
    pub created_at: DateTime<Utc>,
    pub primary_photo: Option<PhotoRef>,
    pub preview_photos: Vec<PhotoRef>,
}

/// Group members by group id, keeping their order.
pub fn by_group(members: Vec<MemberPhoto>) -> HashMap<Uuid, Vec<MemberPhoto>> {
    let mut out: HashMap<Uuid, Vec<MemberPhoto>> = HashMap::new();
    for m in members {
        out.entry(m.group_id).or_default().push(m);
    }
    out
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
) -> ApiResult<Json<Page<StackListItem>>> {
    let paging = Paging::from_query(&q);
    let types: Vec<&str> = match q.non_empty("stack_type") {
        Some(t) if db::VALID_TYPES.contains(&t) => vec![t],
        _ => db::VALID_TYPES.to_vec(),
    };
    let count = db::count_listed(&state.db, user.id, &types).await?;
    let rows = db::list_page(
        &state.db,
        user.id,
        &types,
        paging.page_size,
        paging.offset(count),
    )
    .await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut previews = by_group(db::stack_members(&state.db, &ids, Some(4)).await?);
    let results = rows
        .into_iter()
        .map(|r| StackListItem {
            primary_photo: r.primary_hash.as_ref().map(|h| PhotoRef {
                thumbnail_url: small_thumbnail_url(h, r.primary_thumb_small.as_deref()),
                image_hash: h.clone(),
            }),
            preview_photos: previews
                .remove(&r.id)
                .unwrap_or_default()
                .iter()
                .map(PhotoRef::of)
                .collect(),
            id: r.id,
            stack_type_display: db::type_display(&r.stack_type),
            stack_type: r.stack_type,
            photo_count: r.photo_count,
            sequence_start: r.sequence_start,
            sequence_end: r.sequence_end,
            created_at: r.created_at,
        })
        .collect();
    Ok(Json(paging.envelope(count, results)))
}

#[derive(Debug, Serialize)]
pub struct FileVariant {
    pub hash: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub is_main: bool,
    pub filename: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StackPhoto {
    pub id: Uuid,
    pub image_hash: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub size: i64,
    pub camera: Option<String>,
    #[serde(serialize_with = "ser_drf_opt")]
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub is_primary: bool,
    pub file_path: Option<String>,
    pub file_type: Option<String>,
    pub file_variants: Option<Vec<FileVariant>>,
    pub thumbnail_url: Option<String>,
    pub thumbnail_big_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StackDetail {
    pub id: Uuid,
    pub stack_type: String,
    pub stack_type_display: String,
    pub photo_count: i64,
    #[serde(serialize_with = "ser_drf_opt")]
    pub sequence_start: Option<DateTime<Utc>>,
    #[serde(serialize_with = "ser_drf_opt")]
    pub sequence_end: Option<DateTime<Utc>>,
    #[serde(serialize_with = "ser_drf")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "ser_drf")]
    pub updated_at: DateTime<Utc>,
    pub primary_photo_hash: Option<String>,
    pub photos: Vec<StackPhoto>,
}

/// `GET /api/stacks/{id}/`. Legacy `raw_jpeg` / `live_photo` stacks, which
/// Django still shows, are a 404: the frontend's `StackType` rejects them.
pub async fn detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<StackDetail>> {
    let id = parse_id(&id, NOT_FOUND)?;
    let stack = db::get(&state.db, user.id, id, &db::VALID_TYPES)
        .await?
        .ok_or_else(|| ApiError::not_found_msg(NOT_FOUND))?;
    let members = db::stack_members(&state.db, &[id], None).await?;
    let photo_ids: Vec<Uuid> = members.iter().map(|m| m.id).collect();
    let mut files: HashMap<Uuid, Vec<FileVariant>> = HashMap::new();
    let main_of: HashMap<Uuid, Option<String>> = members
        .iter()
        .map(|m| (m.id, m.main_file_hash.clone()))
        .collect();
    for f in db::photo_files(&state.db, &photo_ids).await? {
        let is_main =
            main_of.get(&f.photo_id).cloned().flatten().as_deref() == Some(f.hash.as_str());
        files.entry(f.photo_id).or_default().push(FileVariant {
            filename: (!f.path.is_empty())
                .then(|| f.path.rsplit('/').next().unwrap_or("").to_string()),
            kind: file_type_display(f.file_type).to_lowercase(),
            hash: f.hash,
            path: f.path,
            is_main,
        });
    }
    let photos = members
        .into_iter()
        .map(|m| StackPhoto {
            is_primary: stack.primary_hash.as_deref() == Some(m.image_hash.as_str()),
            file_path: m.main_file_path.clone(),
            file_type: m
                .main_file_type
                .map(|t| file_type_display(t).to_lowercase()),
            file_variants: files.remove(&m.id),
            thumbnail_url: small_thumbnail_url(&m.image_hash, m.thumb_small.as_deref()),
            thumbnail_big_url: big_thumbnail_url(&m.image_hash, m.thumb_big.as_deref()),
            id: m.id,
            width: m.width,
            height: m.height,
            size: m.size,
            camera: m.camera,
            exif_timestamp: m.exif_timestamp,
            image_hash: m.image_hash,
        })
        .collect();
    Ok(Json(StackDetail {
        id: stack.id,
        stack_type_display: db::type_display(&stack.stack_type),
        stack_type: stack.stack_type,
        photo_count: stack.photo_count,
        sequence_start: stack.sequence_start,
        sequence_end: stack.sequence_end,
        created_at: stack.created_at,
        updated_at: stack.updated_at,
        primary_photo_hash: stack.primary_hash,
        photos,
    }))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id, NOT_FOUND)?;
    let n = write::delete(&state.db, user.id, id)
        .await?
        .ok_or_else(|| ApiError::not_found_msg(NOT_FOUND))?;
    Ok(Json(json!({"status": "deleted", "unlinked_count": n})))
}

pub async fn stats(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let s = db::stats(&state.db, user.id).await?;
    let counts: HashMap<String, i64> = s.by_type.0.into_iter().collect();
    let by_type: serde_json::Map<String, Value> = db::ALL_TYPES
        .iter()
        .map(|t| (t.to_string(), json!(counts.get(*t).copied().unwrap_or(0))))
        .collect();
    Ok(Json(json!({
        "total_stacks": s.total_stacks,
        "by_type": by_type,
        "photos_in_stacks": s.photos_in_stacks,
        "total_photos": s.total_photos,
    })))
}

pub async fn set_primary(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id, NOT_FOUND)?;
    let Some(hash) = field(&body, "photo_hash")
        .filter(|v| py_truthy(v))
        .map(py_str)
    else {
        // The stack is looked up first.
        if !db::exists(&state.db, user.id, id).await? {
            return Err(ApiError::not_found_msg(NOT_FOUND));
        }
        return Err(ApiError::bad_request(
            "photo_hash",
            "photo_hash is required",
        ));
    };
    match write::set_primary(&state.db, user.id, id, &hash).await? {
        write::SetPrimary::StackNotFound => Err(ApiError::not_found_msg(NOT_FOUND)),
        write::SetPrimary::PhotoNotInStack => Err(ApiError::bad_request(
            "photo_hash",
            "Photo not found in this stack",
        )),
        write::SetPrimary::Updated => Ok(Json(
            json!({"status": "updated", "primary_photo_hash": hash}),
        )),
    }
}

pub async fn remove(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id, NOT_FOUND)?;
    let raw = field(&body, "photo_hashes");
    if !raw.is_some_and(py_truthy) {
        if !db::exists(&state.db, user.id, id).await? {
            return Err(ApiError::not_found_msg(NOT_FOUND));
        }
        return Err(ApiError::bad_request(
            "photo_hashes",
            "photo_hashes is required",
        ));
    }
    let hashes = hash_list(raw);
    Ok(Json(
        match write::remove_photos(&state.db, user.id, id, &hashes).await? {
            write::RemoveOutcome::StackNotFound => return Err(ApiError::not_found_msg(NOT_FOUND)),
            write::RemoveOutcome::Deleted { removed } => json!({
                "status": "deleted",
                "removed_count": removed,
                "message": "Stack deleted because fewer than 2 photos remain",
            }),
            write::RemoveOutcome::Updated { removed, remaining } => json!({
                "status": "updated",
                "removed_count": removed,
                "total_count": remaining,
            }),
        },
    ))
}

pub async fn merge(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    let raw = field(&body, "photo_hashes");
    if !raw.is_some_and(py_truthy) {
        return Err(ApiError::bad_request(
            "photo_hashes",
            "photo_hashes is required",
        ));
    }
    let hashes = hash_list(raw);
    Ok(Json(
        match write::merge_manual(&state.db, user.id, &hashes).await? {
            write::MergeOutcome::PhotosNotFound => {
                return Err(ApiError::bad_request(
                    "photo_hashes",
                    "Some photos not found",
                ));
            }
            write::MergeOutcome::NoManualStacks => {
                return Err(ApiError::bad_request(
                    "photo_hashes",
                    "No manual stacks found containing selected photos",
                ));
            }
            write::MergeOutcome::NoMergeNeeded {
                stack_id,
                photo_count,
            } => json!({
                "status": "no_merge_needed",
                "stack_id": stack_id,
                "photo_count": photo_count,
                "message": "Only one stack found, nothing to merge",
            }),
            write::MergeOutcome::Merged {
                stack_id,
                photo_count,
                merged,
            } => json!({
                "status": "merged",
                "stack_id": stack_id,
                "photo_count": photo_count,
                "merged_count": merged,
            }),
        },
    ))
}

pub async fn manual(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<impl IntoResponse> {
    let hashes = hash_list(field(&body, "photo_hashes"));
    if hashes.len() < 2 {
        return Err(ApiError::bad_request(
            "photo_hashes",
            "At least 2 unique photos required to create a stack",
        ));
    }
    match write::create_manual(&state.db, user.id, &hashes).await? {
        write::ManualOutcome::PhotosNotFound => Err(ApiError::bad_request(
            "photo_hashes",
            "Some photos not found",
        )),
        write::ManualOutcome::Created {
            stack_id,
            photo_count,
        } => Ok((
            StatusCode::CREATED,
            Json(json!({"status": "created", "stack_id": stack_id, "photo_count": photo_count})),
        )),
    }
}

/// `POST /api/stacks/detect/`: queue burst detection (`stacks.detect`).
pub async fn detect(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<impl IntoResponse> {
    let options = json!({
        "detect_bursts": field(&body, "detect_bursts").cloned().unwrap_or(json!(true)),
    });
    lp_jobs::enqueue(
        &state,
        super::jobs::STACKS_DETECT,
        json!({"user_id": user.id, "options": options}),
        EnqueueOptions::tracked(JobType::DetectStacks, user.id),
    )
    .await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"status": "queued", "message": "Stack detection started", "options": options})),
    ))
}

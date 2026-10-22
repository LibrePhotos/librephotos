//! Duplicate groups (`api/views/duplicates.py`): list, detail, stats,
//! detect, resolve, dismiss, revert, delete. Paths have no trailing slash.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use chrono::{DateTime, Utc};
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::time::{ser_drf, ser_drf_opt};
use lp_core::{ApiError, ApiJson, ApiResult, AppState, QueryMap};
use lp_db::stats_admin_stacks_dupes::dupes as db;
use lp_db::stats_admin_stacks_dupes::{big_thumbnail_url, file_type_display};
use lp_db::write::stats_admin_stacks_dupes::dupes as write;
use lp_jobs::{EnqueueOptions, JobType};
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::paging::{Page, Paging, field, json_int, parse_id};
use super::stacks::{PhotoRef, by_group};
use super::stats::py_str;

const NOT_FOUND: &str = "Duplicate group not found";

#[derive(Debug, Serialize)]
pub struct DuplicateListItem {
    pub id: Uuid,
    pub duplicate_type: String,
    pub duplicate_type_display: String,
    pub review_status: String,
    pub review_status_display: String,
    pub photo_count: i64,
    pub potential_savings: i64,
    pub similarity_score: Option<f64>,
    #[serde(serialize_with = "ser_drf")]
    pub created_at: DateTime<Utc>,
    pub kept_photo: Option<PhotoRef>,
    pub preview_photos: Vec<PhotoRef>,
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
) -> ApiResult<Json<Page<DuplicateListItem>>> {
    let paging = Paging::from_query(&q);
    let dtype = q.non_empty("duplicate_type");
    let status = q.non_empty("status");
    let count = db::count_listed(&state.db, user.id, dtype, status).await?;
    let rows = db::list_page(
        &state.db,
        user.id,
        dtype,
        status,
        paging.page_size,
        paging.offset(count),
    )
    .await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut previews = by_group(db::dup_members(&state.db, &ids, Some(4)).await?);
    let results = rows
        .into_iter()
        .map(|r| DuplicateListItem {
            kept_photo: r.kept_hash.as_ref().map(|h| PhotoRef {
                thumbnail_url: lp_db::stats_admin_stacks_dupes::small_thumbnail_url(
                    h,
                    r.kept_thumb_small.as_deref(),
                ),
                image_hash: h.clone(),
            }),
            preview_photos: previews
                .remove(&r.id)
                .unwrap_or_default()
                .iter()
                .map(PhotoRef::of)
                .collect(),
            id: r.id,
            duplicate_type_display: db::type_display(&r.duplicate_type),
            duplicate_type: r.duplicate_type,
            review_status_display: db::status_display(&r.review_status),
            review_status: r.review_status,
            photo_count: r.photo_count,
            potential_savings: r.potential_savings,
            similarity_score: r.similarity_score,
            created_at: r.created_at,
        })
        .collect();
    Ok(Json(paging.envelope(count, results)))
}

#[derive(Debug, Serialize)]
pub struct DuplicatePhoto {
    pub id: Uuid,
    pub image_hash: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub size: i64,
    pub camera: Option<String>,
    #[serde(serialize_with = "ser_drf_opt")]
    pub exif_timestamp: Option<DateTime<Utc>>,
    /// Null (not false) when nothing was kept yet, as Django answers.
    pub is_kept: Option<bool>,
    pub file_path: Option<String>,
    pub file_type: Option<String>,
    pub thumbnail_url: Option<String>,
    pub thumbnail_big_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DuplicateDetail {
    pub id: Uuid,
    pub duplicate_type: String,
    pub duplicate_type_display: String,
    pub review_status: String,
    pub review_status_display: String,
    pub photo_count: i64,
    pub potential_savings: i64,
    pub similarity_score: Option<f64>,
    #[serde(serialize_with = "ser_drf")]
    pub created_at: DateTime<Utc>,
    #[serde(serialize_with = "ser_drf")]
    pub updated_at: DateTime<Utc>,
    pub kept_photo_hash: Option<String>,
    pub suggested_photo_hash: Option<String>,
    pub photos: Vec<DuplicatePhoto>,
}

pub async fn detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<DuplicateDetail>> {
    let id = parse_id(&id, NOT_FOUND)?;
    let dup = db::get(&state.db, user.id, id)
        .await?
        .ok_or_else(|| ApiError::not_found_msg(NOT_FOUND))?;
    let members = db::dup_members(&state.db, &[id], None).await?;
    let suggested = {
        let mut conn = state.db.acquire().await?;
        db::best_photo(&mut conn, id, &dup.duplicate_type).await?
    };
    let photos = members
        .into_iter()
        .map(|m| DuplicatePhoto {
            is_kept: dup.kept_hash.as_ref().map(|k| *k == m.image_hash),
            file_path: m.main_file_path.clone(),
            file_type: m.main_file_type.map(file_type_display),
            thumbnail_url: lp_db::stats_admin_stacks_dupes::small_thumbnail_url(
                &m.image_hash,
                m.thumb_small.as_deref(),
            ),
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
    Ok(Json(DuplicateDetail {
        id: dup.id,
        duplicate_type_display: db::type_display(&dup.duplicate_type),
        duplicate_type: dup.duplicate_type,
        review_status_display: db::status_display(&dup.review_status),
        review_status: dup.review_status,
        photo_count: dup.photo_count,
        potential_savings: dup.potential_savings,
        similarity_score: dup.similarity_score,
        created_at: dup.created_at,
        updated_at: dup.updated_at,
        kept_photo_hash: dup.kept_hash,
        suggested_photo_hash: suggested.map(|s| s.1),
        photos,
    }))
}

pub async fn stats(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let s = db::stats(&state.db, user.id).await?;
    let savings = s.pending_savings.unwrap_or(0);
    let mb = if savings == 0 {
        json!(0)
    } else {
        json!(lp_core::codecs::py_round(
            savings as f64 / (1024.0 * 1024.0),
            2
        ))
    };
    Ok(Json(json!({
        "total_duplicates": s.total_duplicates,
        "pending_duplicates": s.pending,
        "resolved_duplicates": s.resolved,
        "dismissed_duplicates": s.dismissed,
        "by_type": {db::EXACT_COPY: s.exact_copy, db::VISUAL_DUPLICATE: s.visual_duplicate},
        "photos_in_duplicates": s.photos_in_duplicates,
        "total_photos": s.total_photos,
        "potential_savings_bytes": savings,
        "potential_savings_mb": mb,
    })))
}

/// `POST /api/duplicates/detect`: queue `dupes.detect`.
pub async fn detect(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<impl IntoResponse> {
    let int_field = |key: &str, default: i64| -> ApiResult<i64> {
        match field(&body, key) {
            None => Ok(default),
            Some(v) => json_int(v)
                .ok_or_else(|| ApiError::bad_request(key, "A valid integer is required.")),
        }
    };
    let batch_size = int_field("batch_size", 10000)?.clamp(100, 50000);
    let options = json!({
        "detect_exact_copies": field(&body, "detect_exact_copies").cloned().unwrap_or(json!(true)),
        "detect_visual_duplicates": field(&body, "detect_visual_duplicates").cloned().unwrap_or(json!(true)),
        "visual_threshold": int_field("visual_threshold", 10)?,
        "clear_pending": field(&body, "clear_pending").cloned().unwrap_or(json!(false)),
        "batch_size": batch_size,
    });
    lp_jobs::enqueue(
        &state,
        super::jobs::DUPES_DETECT,
        json!({"user_id": user.id, "options": options}),
        EnqueueOptions::tracked(JobType::DetectDuplicates, user.id),
    )
    .await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(
            json!({"status": "queued", "message": "Duplicate detection started", "options": options}),
        ),
    ))
}

pub async fn resolve(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id, NOT_FOUND)?;
    let keep = field(&body, "keep_photo_hash")
        .filter(|v| py_truthy(v))
        .cloned();
    let trash_others = field(&body, "trash_others").is_none_or(py_truthy);
    let Some(keep) = keep else {
        if db::get(&state.db, user.id, id).await?.is_none() {
            return Err(ApiError::not_found_msg(NOT_FOUND));
        }
        return Err(ApiError::bad_request(
            "keep_photo_hash",
            "keep_photo_hash is required",
        ));
    };
    match write::resolve(&state.db, user.id, id, &py_str(&keep), trash_others).await? {
        write::ResolveOutcome::NotFound => Err(ApiError::not_found_msg(NOT_FOUND)),
        write::ResolveOutcome::PhotoNotInGroup => Err(ApiError::bad_request(
            "keep_photo_hash",
            "Photo not found in this duplicate group",
        )),
        write::ResolveOutcome::Resolved { trashed_count } => Ok(Json(json!({
            "status": "resolved",
            "kept_photo": keep,
            "trashed_count": trashed_count,
        }))),
    }
}

pub async fn dismiss(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id, NOT_FOUND)?;
    if !write::dismiss(&state.db, user.id, id).await? {
        return Err(ApiError::not_found_msg(NOT_FOUND));
    }
    Ok(Json(json!({"status": "dismissed"})))
}

pub async fn revert(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let id = parse_id(&id, NOT_FOUND)?;
    match write::revert(&state.db, user.id, id).await? {
        write::RevertOutcome::NotFound => Err(ApiError::not_found_msg(NOT_FOUND)),
        write::RevertOutcome::NotResolved => Err(ApiError::bad_request(
            "review_status",
            "Can only revert resolved duplicates",
        )),
        write::RevertOutcome::Reverted { restored } => Ok(Json(
            json!({"status": "reverted", "restored_count": restored}),
        )),
    }
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

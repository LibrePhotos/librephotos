//! `BulkPhotoMutationView` subclasses and `SetPhotosShared`.

use axum::Json;
use axum::extract::State;
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::{ApiError, ApiJson, ApiResult, AppState};
use lp_db::write::photo_edits::bulk::{self as svc, Flag};
use lp_db::write::photo_edits::sharing;
use serde_json::{Map, Value, json};

use super::{metadata_to_disk, model_bool, required, selection};

pub(super) fn object(body: Value) -> ApiResult<Map<String, Value>> {
    match body {
        Value::Object(m) => Ok(m),
        _ => Err(ApiError::bad_request(
            "non_field_errors",
            "Invalid data. Expected a dictionary.",
        )),
    }
}

async fn run(
    state: AppState,
    user: &lp_db::users::User,
    body: Value,
    flag: Flag,
    value_field: &str,
) -> ApiResult<Json<Value>> {
    let body = object(body)?;
    let raw = required(&body, value_field)?;
    let value = if flag == Flag::Favorite {
        py_truthy(raw)
    } else {
        model_bool(raw)
            .ok_or_else(|| ApiError::bad_request(value_field, "Must be a valid boolean."))?
    };
    let sel = selection(&body, false)?;

    let mut tx = state.db.begin().await?;
    let out = svc::apply(
        &mut tx,
        user.id,
        user.favorite_min_rating,
        flag,
        value,
        &sel,
    )
    .await?;
    let queued = flag == Flag::Favorite && metadata_to_disk(user) && !out.touched.is_empty();
    if queued {
        let payloads: Vec<Value> = out
            .touched
            .iter()
            .map(|id| json!({"photo_id": id, "fields": ["rating"]}))
            .collect();
        lp_jobs::enqueue_many_in(&mut tx, "metadata.write", &payloads).await?;
    }
    tx.commit().await?;
    if queued {
        lp_jobs::wake(&state);
    }

    Ok(Json(match out.hashes {
        None => json!({"status": true, "count": out.count}),
        Some((updated, not_updated)) => json!({
            "status": true,
            "count": out.count,
            "updated_hashes": updated,
            "not_updated_hashes": not_updated,
        }),
    }))
}

pub(super) async fn favorite(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    run(state, &user, body, Flag::Favorite, "favorite").await
}

pub(super) async fn hide(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    run(state, &user, body, Flag::Hidden, "hidden").await
}

pub(super) async fn set_deleted(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    run(state, &user, body, Flag::Deleted, "deleted").await
}

pub(super) async fn make_public(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    run(state, &user, body, Flag::Public, "val_public").await
}

/// `SetPhotosShared`: `val_shared` + `target_user_id` on the requester's photos.
pub(super) async fn share(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<Value>> {
    let body = object(body)?;
    // `if shared:` on the raw value.
    let shared = py_truthy(required(&body, "val_shared")?);
    let target = required(&body, "target_user_id")?;
    let target_user_id = match target {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
    .and_then(|v| i32::try_from(v).ok())
    .ok_or_else(|| ApiError::bad_request("target_user_id", "A valid integer is required."))?;
    let sel = selection(&body, false)?;

    let mut tx = state.db.begin().await?;
    let count = sharing::set_shared(
        &mut tx,
        user.id,
        user.favorite_min_rating,
        &sel,
        target_user_id,
        shared,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"status": true, "count": count})))
}

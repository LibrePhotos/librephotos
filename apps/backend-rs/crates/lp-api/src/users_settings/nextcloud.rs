//! `GET /api/nextcloud/listdir/?fpath=` (WebDAV `PROPFIND`, Depth 1) and
//! `POST /api/nextcloud/scanphotos/` (queues `nextcloud.scan`). The WebDAV
//! client and the SSRF guard of `nextcloud/server_address.py` live in
//! `lp_tasks::nextcloud`.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_jobs::{EnqueueOptions, JobType};
pub use lp_tasks::nextcloud::validate_server_address;
use lp_tasks::nextcloud::{Dav, DavError};
use serde_json::{Value, json};

fn rejected(message: String) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"status": false, "message": message})),
    )
        .into_response()
}

fn nextcloud_enabled(state: &AppState) -> Result<(), ApiError> {
    if state.settings().nextcloud_enabled {
        Ok(())
    } else {
        Err(ApiError::permission_denied())
    }
}

pub async fn listdir(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
) -> ApiResult<Response> {
    nextcloud_enabled(&state)?;
    let Some(path) = q.non_empty("fpath").map(str::to_string) else {
        return Ok(Json(json!([])).into_response());
    };
    if user.nextcloud_server_address.is_empty() {
        return Ok(Json(json!([])).into_response());
    }
    if let Err(m) = validate_server_address(user.nextcloud_server_address.trim()).await {
        return Ok(rejected(m));
    }
    let dav = Dav::for_user(&state, &user).await?;
    let entries = match dav.list(&path).await {
        Ok(e) => e,
        Err(DavError::Unsafe(m)) => return Ok(rejected(m)),
        Err(e @ DavError::Status(_)) => {
            tracing::warn!("Nextcloud responded with an error: {e}");
            return Ok(rejected(e.to_string()));
        }
        Err(e @ (DavError::Unreachable | DavError::TooDeep(_))) => {
            return Ok(rejected(e.to_string()));
        }
    };
    let dirs: Vec<Value> = entries
        .into_iter()
        .filter(|e| e.is_dir)
        .map(|e| {
            let parts: Vec<&str> = e.path.split('/').collect();
            let title = if parts.len() >= 2 {
                parts[parts.len() - 2].to_string()
            } else {
                String::new()
            };
            json!({"absolute_path": e.path, "title": title, "children": []})
        })
        .collect();
    Ok(Json(Value::Array(dirs)).into_response())
}

/// `ScanPhotosView`: `{status: true, job_id}`, or 500 when the job could not
/// be queued.
pub async fn scanphotos(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> ApiResult<Response> {
    nextcloud_enabled(&state)?;
    if let Err(m) = validate_server_address(&user.nextcloud_server_address).await {
        return Ok(rejected(m));
    }
    match lp_jobs::enqueue(
        &state,
        lp_tasks::nextcloud::KIND,
        json!({"user_id": user.id}),
        EnqueueOptions::tracked(JobType::ScanPhotos, user.id),
    )
    .await
    {
        Ok(e) => Ok(Json(json!({"status": true, "job_id": e.lrj_id})).into_response()),
        Err(err) => {
            tracing::error!(error = %err, "could not start the Nextcloud scan");
            Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"status": false, "message": "Could not start the Nextcloud scan."})),
            )
                .into_response())
        }
    }
}

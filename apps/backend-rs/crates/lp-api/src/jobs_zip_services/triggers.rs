//! Buttons that start background jobs (`api/views/scan_triggers.py`):
//! each enqueues a job kind from the cross-area contract and answers
//! `{status, job_id}` with the LongRunningJob id the UI polls.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::{ApiJson, ApiResult, AppState};
use lp_db::users::User;
use lp_jobs::{EnqueueOptions, JobType};
use serde_json::{Value, json};

fn refuse(message: String) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"status": false, "message": message})),
    )
        .into_response()
}

/// `_validate_scan_directory`.
async fn validate_scan_directory(user: &User) -> Option<Response> {
    let dir = user.scan_directory.as_str();
    if dir.trim().is_empty() {
        return Some(refuse(
            "Scan failed: No scan directory configured. Please contact your administrator \
             to set up a scan directory for your account."
                .into(),
        ));
    }
    if !tokio::fs::try_exists(dir).await.unwrap_or(false) {
        return Some(refuse(format!(
            "Scan failed: Scan directory '{dir}' does not exist. Please contact your administrator."
        )));
    }
    None
}

/// `start_job`: 200 `{status: true, job_id}`, or 500 when enqueueing failed.
async fn start_job(
    state: &AppState,
    kind: &str,
    payload: Value,
    job_type: JobType,
    user_id: i32,
    description: &str,
) -> Response {
    match lp_jobs::enqueue(
        state,
        kind,
        payload,
        EnqueueOptions::tracked(job_type, user_id),
    )
    .await
    {
        Ok(e) => Json(json!({"status": true, "job_id": e.lrj_id})).into_response(),
        Err(err) => {
            tracing::error!(error = %err, kind, "could not start {description}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    json!({"status": false, "message": format!("Could not start {description}.")}),
                ),
            )
                .into_response()
        }
    }
}

async fn scan(state: &AppState, user: &User, full_scan: bool) -> Response {
    if let Some(refused) = validate_scan_directory(user).await {
        return refused;
    }
    lp_tasks::models::queue_if_missing(state, user.id).await;
    start_job(
        state,
        "scan.user",
        json!({
            "user_id": user.id,
            "full_scan": full_scan,
            "scan_missing": false,
            "uploaded_only": false,
        }),
        JobType::ScanPhotos,
        user.id,
        "the photo scan",
    )
    .await
}

pub async fn scan_photos(State(state): State<AppState>, user: AuthUser) -> Response {
    scan(&state, &user, false).await
}

pub async fn full_scan_photos(State(state): State<AppState>, user: AuthUser) -> Response {
    scan(&state, &user, true).await
}

pub async fn delete_missing_photos(State(state): State<AppState>, user: AuthUser) -> Response {
    start_job(
        &state,
        "delete.missing_photos",
        json!({"user_id": user.id}),
        JobType::DeleteMissingPhotos,
        user.id,
        "the missing-photo cleanup",
    )
    .await
}

/// `{full_scan}`: without it only photos with no OCR result are processed.
pub async fn generate_ocr(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let full_scan = body.get("full_scan").is_some_and(py_truthy);
    Ok(start_job(
        &state,
        "ocr.generate",
        json!({"user_id": user.id, "full_scan": full_scan}),
        JobType::GenerateOcr,
        user.id,
        "text recognition",
    )
    .await)
}

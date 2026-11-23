//! `LongRunningJobViewSet` (list, retrieve, destroy, cancel) and
//! `QueueAvailabilityView` (`/api/rqavailable/`, polled every 2 s).

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use lp_auth::AuthUser;
use lp_core::time::{ser_drf, ser_drf_opt};
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::jobs_zip_services::{self as db, JobRow};
use lp_db::users::{SimpleUser, User};
use lp_jobs::JobType;
use serde::Serialize;
use serde_json::{Value, json};

use crate::common::{DrfPage, PageRequest};

/// `LongRunningJob.STUCK_JOB_HOURS`.
const STUCK_JOB_HOURS: i32 = 24;

/// `LongRunningJobSerializer`, in its field order.
#[derive(Debug, Serialize)]
pub struct JobDto {
    pub job_id: String,
    #[serde(serialize_with = "ser_drf")]
    pub queued_at: DateTime<Utc>,
    pub finished: bool,
    #[serde(serialize_with = "ser_drf_opt")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "ser_drf_opt")]
    pub started_at: Option<DateTime<Utc>>,
    pub failed: bool,
    pub cancelled: bool,
    pub job_type_str: &'static str,
    pub job_type: i32,
    pub started_by: SimpleUser,
    pub progress_current: i32,
    pub progress_target: i32,
    pub progress_step: Option<String>,
    pub result: Option<Value>,
    pub id: i32,
}

impl From<JobRow> for JobDto {
    fn from(r: JobRow) -> Self {
        JobDto {
            job_id: r.job_id,
            queued_at: r.queued_at,
            finished: r.finished,
            finished_at: r.finished_at,
            started_at: r.started_at,
            failed: r.failed,
            cancelled: r.cancelled,
            job_type_str: JobType::from_i32(r.job_type)
                .map(JobType::label)
                .unwrap_or(""),
            job_type: r.job_type,
            started_by: SimpleUser {
                id: r.user_id,
                username: r.username,
                first_name: r.first_name,
                last_name: r.last_name,
            },
            progress_current: r.progress_current,
            progress_target: r.progress_target,
            progress_step: r.progress_step,
            result: r.result,
            id: r.id,
        }
    }
}

fn is_staff(user: &User) -> bool {
    user.is_staff || user.is_superuser
}

/// `get_queryset`: non-staff see only their own jobs; staff see everything
/// unless they narrow with `?mine=true`. None = every job.
fn scope(user: &User, q: &QueryMap) -> Option<i32> {
    if !is_staff(user) {
        return Some(user.id);
    }
    match q.get("mine") {
        Some(v) if v.eq_ignore_ascii_case("true") => Some(user.id),
        _ => None,
    }
}

/// `TinyResultsSetPagination`: page size 20, `page_size` up to 50.
pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<JobDto>>> {
    let owner = scope(&user, &q);
    let req = PageRequest::from_query(&q, "page_size", 20, 50)?;
    let count = db::count_jobs(&state.db, owner).await?;
    let req = req.valid_for(count)?;
    let rows = db::list_jobs(&state.db, owner, req.page_size, req.offset()).await?;
    // The router path is `api/jobs/`; the trailing slash was stripped before routing.
    let canonical: Uri = match uri.query() {
        Some(query) => format!("/api/jobs/?{query}"),
        None => "/api/jobs/".to_string(),
    }
    .parse()
    .unwrap_or(uri);
    Ok(Json(DrfPage::new(
        &headers,
        &canonical,
        req,
        count,
        rows.into_iter().map(JobDto::from).collect(),
    )))
}

fn parse_pk(id: &str) -> ApiResult<i32> {
    id.parse().map_err(|_| ApiError::not_found())
}

/// DRF `get_object_or_404`'s message for a well-formed id that matches nothing.
fn no_match() -> ApiError {
    ApiError::not_found_msg("No LongRunningJob matches the given query.")
}

async fn scoped_job(state: &AppState, user: &User, q: &QueryMap, id: &str) -> ApiResult<JobRow> {
    let pk = parse_pk(id)?;
    db::job_by_pk(&state.db, pk, scope(user, q))
        .await?
        .ok_or_else(no_match)
}

pub async fn detail(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
    Path(id): Path<String>,
) -> ApiResult<Json<JobDto>> {
    Ok(Json(scoped_job(&state, &user, &q, &id).await?.into()))
}

pub async fn destroy(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let pk = parse_pk(&id)?;
    if lp_db::write::jobs_zip_services::delete_job(&state.db, pk, scope(&user, &q)).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(no_match())
    }
}

/// `POST /api/jobs/{id}/cancel/`: cooperative; the queue rows are cancelled
/// too, so a job that has not started never will.
pub async fn cancel(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let job = scoped_job(&state, &user, &q, &id).await?;
    if job.finished {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({"status": false, "message": "Job is already finished"})),
        )
            .into_response());
    }
    lp_jobs::lrj::cancel_with_queue(&state.db, &job.job_id).await?;
    let job = db::job_by_pk(&state.db, job.id, None)
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(Json(json!({"status": true, "job": JobDto::from(job)})).into_response())
}

#[derive(Debug, Serialize)]
pub struct QueueAvailability {
    pub status: bool,
    pub queue_can_accept_job: bool,
    pub job_detail: Option<JobDto>,
}

/// Whether the (shared) queue is busy is a global answer; the blocking job
/// itself is shown only to its starter and to staff (GHSA-975v-mx44-9jxq).
pub async fn rq_available(
    State(state): State<AppState>,
    user: AuthUser,
) -> ApiResult<Json<QueueAvailability>> {
    let running = db::blocking_job(&state.db, STUCK_JOB_HOURS).await?;
    let busy = running.is_some();
    let job_detail = running
        .filter(|j| j.user_id == user.id || is_staff(&user))
        .map(JobDto::from);
    Ok(Json(QueueAvailability {
        status: true,
        queue_can_accept_job: !busy,
        job_detail,
    }))
}

//! `job_queue` (04 §1): enqueue, claim, complete.

use chrono::{DateTime, Utc};
use lp_core::AppState;
use serde_json::Value;
use sqlx::{FromRow, PgConnection};

use crate::lrj::{self, JobType};

pub const NOTIFY_CHANNEL: &str = "job_queue";

/// Create an `api_longrunningjob` row (queued) and link it to the queue row.
#[derive(Debug, Clone, Copy)]
pub struct LrjSpec {
    pub job_type: JobType,
    pub user_id: i32,
}

#[derive(Debug, Clone)]
pub struct EnqueueOptions {
    pub run_after: Option<DateTime<Utc>>,
    pub max_attempts: i32,
    pub group_id: Option<String>,
    pub lrj: Option<LrjSpec>,
    /// Reuse an existing LongRunningJob (e.g. fan-out children of a scan).
    pub lrj_id: Option<String>,
}

impl Default for EnqueueOptions {
    fn default() -> Self {
        EnqueueOptions {
            run_after: None,
            max_attempts: 1,
            group_id: None,
            lrj: None,
            lrj_id: None,
        }
    }
}

impl EnqueueOptions {
    /// Shorthand: a job the UI tracks as a new LongRunningJob of `job_type`.
    pub fn tracked(job_type: JobType, user_id: i32) -> Self {
        EnqueueOptions {
            lrj: Some(LrjSpec { job_type, user_id }),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enqueued {
    pub id: i64,
    /// `api_longrunningjob.job_id` the frontend polls, if any.
    pub lrj_id: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub struct QueuedJob {
    pub id: i64,
    pub kind: String,
    pub payload: Value,
    pub status: String,
    pub lrj_id: Option<String>,
    pub group_id: Option<String>,
    pub run_after: DateTime<Utc>,
    pub attempts: i32,
    pub max_attempts: i32,
    pub locked_by: Option<String>,
    pub heartbeat_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

const JOB_COLUMNS: &str = "id, kind, payload, status, lrj_id, group_id, run_after, attempts, \
    max_attempts, locked_by, heartbeat_at, last_error, created_at, started_at, finished_at";

/// Enqueue inside the caller's transaction. The job becomes visible at
/// commit (the NOTIFY is transactional too); call [`wake`] after commit to
/// poke an in-process worker.
pub async fn enqueue_in(
    conn: &mut PgConnection,
    kind: &str,
    payload: Value,
    opts: &EnqueueOptions,
) -> sqlx::Result<Enqueued> {
    let lrj_id = match (&opts.lrj_id, opts.lrj) {
        (Some(id), _) => Some(id.clone()),
        (None, Some(spec)) => Some(lrj::create(&mut *conn, spec.job_type, spec.user_id).await?),
        (None, None) => None,
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO job_queue (kind, payload, lrj_id, group_id, run_after, max_attempts) \
         VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6) RETURNING id",
    )
    .bind(kind)
    .bind(&payload)
    .bind(&lrj_id)
    .bind(&opts.group_id)
    .bind(opts.run_after)
    .bind(opts.max_attempts.max(1))
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(NOTIFY_CHANNEL)
        .bind(kind)
        .execute(&mut *conn)
        .await?;
    Ok(Enqueued { id, lrj_id })
}

/// Enqueue as its own transaction and wake the local worker.
pub async fn enqueue(
    state: &AppState,
    kind: &str,
    payload: Value,
    opts: EnqueueOptions,
) -> sqlx::Result<Enqueued> {
    let mut tx = state.db.begin().await?;
    let out = enqueue_in(&mut tx, kind, payload, &opts).await?;
    tx.commit().await?;
    wake(state);
    Ok(out)
}

pub fn wake(state: &AppState) {
    state.job_wakeup.notify_one();
}

/// Claim the next due job (`FOR UPDATE SKIP LOCKED`), marking it running.
pub async fn claim_next(
    conn: &mut PgConnection,
    worker_id: &str,
    kinds: &[String],
) -> sqlx::Result<Option<QueuedJob>> {
    sqlx::query_as::<_, QueuedJob>(&format!(
        "UPDATE job_queue SET status = 'running', locked_by = $1, heartbeat_at = now(), \
           started_at = COALESCE(started_at, now()), attempts = attempts + 1 \
         WHERE id = (SELECT id FROM job_queue WHERE status = 'queued' AND run_after <= now() \
                       AND kind = ANY($2) ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1) \
         RETURNING {JOB_COLUMNS}"
    ))
    .bind(worker_id)
    .bind(kinds)
    .fetch_optional(conn)
    .await
}

pub async fn heartbeat(conn: &mut PgConnection, id: i64) -> sqlx::Result<()> {
    sqlx::query("UPDATE job_queue SET heartbeat_at = now() WHERE id = $1 AND status = 'running'")
        .bind(id)
        .execute(conn)
        .await?;
    Ok(())
}

pub async fn mark_done(conn: &mut PgConnection, id: i64) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE job_queue SET status = 'done', finished_at = now(), locked_by = NULL WHERE id = $1",
    )
    .bind(id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Record a failure: re-queue with `retry_after` if attempts remain, else `failed`.
pub async fn mark_failed(
    conn: &mut PgConnection,
    id: i64,
    error: &str,
    retry_after: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE job_queue SET \
           status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END, \
           run_after = CASE WHEN attempts < max_attempts THEN COALESCE($3, now()) ELSE run_after END, \
           finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END, \
           locked_by = NULL, last_error = $2 \
         WHERE id = $1",
    )
    .bind(id)
    .bind(error)
    .bind(retry_after)
    .execute(conn)
    .await?;
    Ok(())
}

/// Cancel queued/running rows of a LongRunningJob (the cancel endpoint).
pub async fn cancel_for_lrj(conn: &mut PgConnection, lrj_id: &str) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        "UPDATE job_queue SET status = 'cancelled', finished_at = now(), locked_by = NULL \
         WHERE lrj_id = $1 AND status IN ('queued', 'running')",
    )
    .bind(lrj_id)
    .execute(conn)
    .await?
    .rows_affected())
}

/// Crash recovery: running rows whose heartbeat is older than `stale_secs` go back to queued.
pub async fn requeue_stale(conn: &mut PgConnection, stale_secs: i64) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        "UPDATE job_queue SET status = 'queued', locked_by = NULL \
         WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1)",
    )
    .bind(stale_secs as f64)
    .execute(conn)
    .await?
    .rows_affected())
}

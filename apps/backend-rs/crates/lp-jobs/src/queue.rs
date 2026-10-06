//! `job_queue` (04 §1): enqueue, claim, complete.

use chrono::{DateTime, Utc};
use lp_core::AppState;
use lp_db::db::Conn;
use serde_json::Value;
use sqlx::FromRow;

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
    /// Queue ids that must finish first (any terminal state counts, as in a
    /// django-q `Chain`); see [`claim_next`].
    pub depends_on: Vec<i64>,
}

impl Default for EnqueueOptions {
    fn default() -> Self {
        EnqueueOptions {
            run_after: None,
            max_attempts: 1,
            group_id: None,
            lrj: None,
            lrj_id: None,
            depends_on: Vec::new(),
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

    /// Run only after the job `id` finished (`Chain.append`).
    pub fn after(mut self, id: i64) -> Self {
        self.depends_on.push(id);
        self
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
    conn: &mut Conn,
    kind: &str,
    payload: Value,
    opts: &EnqueueOptions,
) -> sqlx::Result<Enqueued> {
    let lrj_id = match (&opts.lrj_id, opts.lrj) {
        (Some(id), _) => Some(id.clone()),
        (None, Some(spec)) => Some(lrj::create(&mut *conn, spec.job_type, spec.user_id).await?),
        (None, None) => None,
    };
    let id: i64 = lp_db::sql::query_scalar(
        "INSERT INTO job_queue (kind, payload, lrj_id, group_id, run_after, max_attempts, depends_on) \
         VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6, $7) RETURNING id",
    )
    .bind(kind)
    .bind(&payload)
    .bind(&lrj_id)
    .bind(&opts.group_id)
    .bind(opts.run_after)
    .bind(opts.max_attempts.max(1))
    .bind(&opts.depends_on)
    .fetch_one(&mut *conn)
    .await?;
    notify(&mut *conn, kind).await?;
    Ok(Enqueued { id, lrj_id })
}

/// Enqueue one untracked job of `kind` per payload in a single INSERT (and
/// one NOTIFY), inside the caller's transaction. Returns the number queued.
pub async fn enqueue_many_in(conn: &mut Conn, kind: &str, payloads: &[Value]) -> sqlx::Result<u64> {
    if payloads.is_empty() {
        return Ok(0);
    }
    let n = lp_db::sql::query(
        "INSERT INTO job_queue (kind, payload, run_after, max_attempts) \
         SELECT $1, p, now(), 1 FROM unnest($2::jsonb[]) AS p",
    )
    .bind(kind)
    .bind(payloads)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    notify(&mut *conn, kind).await?;
    Ok(n)
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

/// `NOTIFY job_queue, kind`: wakes the `LISTEN`ing workers once the
/// transaction commits.
async fn notify(conn: &mut Conn, kind: &str) -> sqlx::Result<()> {
    // SQLITE(P2): no NOTIFY there; workers poll `PRAGMA data_version` (design §3).
    if conn.dialect().is_pg() {
        lp_db::sql::query("SELECT pg_notify($1, $2)")
            .bind(NOTIFY_CHANNEL)
            .bind(kind)
            .execute(conn)
            .await?;
    }
    Ok(())
}

/// Claim the next due job (`FOR UPDATE SKIP LOCKED`), marking it running.
/// A job whose `depends_on` still has a queued or running row waits; a
/// dependency that ended in any way (or was deleted) releases it.
pub async fn claim_next(
    conn: &mut Conn,
    worker_id: &str,
    kinds: &[String],
) -> sqlx::Result<Option<QueuedJob>> {
    lp_db::sql::query_as::<_, QueuedJob>(&format!(
        "UPDATE job_queue SET status = 'running', locked_by = $1, heartbeat_at = now(), \
           started_at = COALESCE(started_at, now()), attempts = attempts + 1 \
         WHERE id = (SELECT j.id FROM job_queue j \
                     WHERE j.status = 'queued' AND j.run_after <= now() AND j.kind = ANY($2) \
                       AND (cardinality(j.depends_on) = 0 OR NOT EXISTS ( \
                         SELECT 1 FROM job_queue d WHERE d.id = ANY(j.depends_on) \
                           AND d.status IN ('queued', 'running'))) \
                     ORDER BY j.run_after, j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1) \
         RETURNING {JOB_COLUMNS}"
    ))
    .bind(worker_id)
    .bind(kinds)
    .fetch_optional(conn)
    .await
}

/// NOTIFY the workers when a queued job waits on `id`, which just finished.
pub async fn notify_dependents(conn: &mut Conn, id: i64) -> sqlx::Result<bool> {
    let kind: Option<String> = lp_db::sql::query_scalar(
        "SELECT kind FROM job_queue \
         WHERE status = 'queued' AND depends_on @> ARRAY[$1::bigint] LIMIT 1",
    )
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(kind) = kind else {
        return Ok(false);
    };
    notify(&mut *conn, &kind).await?;
    Ok(true)
}

pub async fn heartbeat(conn: &mut Conn, id: i64) -> sqlx::Result<()> {
    lp_db::sql::query(
        "UPDATE job_queue SET heartbeat_at = now() WHERE id = $1 AND status = 'running'",
    )
    .bind(id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Only a row still `running` moves, so a cancelled row stays cancelled.
pub async fn mark_done(conn: &mut Conn, id: i64) -> sqlx::Result<()> {
    lp_db::sql::query(
        "UPDATE job_queue SET status = 'done', finished_at = now(), locked_by = NULL \
         WHERE id = $1 AND status = 'running'",
    )
    .bind(id)
    .execute(conn)
    .await?;
    Ok(())
}

/// Record a failure: re-queue with `retry_after` if attempts remain, else
/// `failed`. Returns true when the row is now finally `failed`.
pub async fn mark_failed(
    conn: &mut Conn,
    id: i64,
    error: &str,
    retry_after: Option<DateTime<Utc>>,
) -> sqlx::Result<bool> {
    let status: Option<String> = lp_db::sql::query_scalar(
        "UPDATE job_queue SET \
           status = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END, \
           run_after = CASE WHEN attempts < max_attempts THEN COALESCE($3, now()) ELSE run_after END, \
           finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END, \
           locked_by = NULL, last_error = $2 \
         WHERE id = $1 AND status = 'running' RETURNING status",
    )
    .bind(id)
    .bind(error)
    .bind(retry_after)
    .fetch_optional(conn)
    .await?;
    Ok(status.as_deref() == Some("failed"))
}

/// Cancel queued/running rows of a LongRunningJob (the cancel endpoint).
pub async fn cancel_for_lrj(conn: &mut Conn, lrj_id: &str) -> sqlx::Result<u64> {
    Ok(lp_db::sql::query(
        "UPDATE job_queue SET status = 'cancelled', finished_at = now(), locked_by = NULL \
         WHERE lrj_id = $1 AND status IN ('queued', 'running')",
    )
    .bind(lrj_id)
    .execute(conn)
    .await?
    .rows_affected())
}

/// Extra claims a job gets beyond `max_attempts` when its worker dies.
pub const STALE_EXTRA_ATTEMPTS: i32 = 2;

/// Crash recovery: running rows whose heartbeat is older than `stale_secs`
/// go back to queued. A row that already lost its worker
/// `max_attempts + STALE_EXTRA_ATTEMPTS` times is failed instead, so a job
/// that kills its worker cannot loop forever. Returns `(requeued, failed)`.
pub async fn requeue_stale(conn: &mut Conn, stale_secs: i64) -> sqlx::Result<(u64, u64)> {
    // Like a final failed attempt, a lost job fails its LongRunningJob
    // (except fan-out children), or the UI would show it running for 24 h.
    let failed: i64 = lp_db::sql::query_scalar(
        "WITH lost AS ( \
           UPDATE job_queue SET status = 'failed', finished_at = now(), locked_by = NULL, \
             last_error = 'worker lost (stale heartbeat)' \
           WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1) \
             AND attempts >= max_attempts + $2 \
           RETURNING lrj_id, group_id), \
         lrj AS ( \
           UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(), \
             result = '{\"status\": \"failed\", \"error\": \"worker lost (stale heartbeat)\"}'::jsonb \
           WHERE NOT finished AND job_id IN \
             (SELECT lrj_id FROM lost WHERE lrj_id IS NOT NULL AND group_id IS NULL) \
           RETURNING 1) \
         SELECT count(*) FROM lost",
    )
    .bind(stale_secs as f64)
    .bind(STALE_EXTRA_ATTEMPTS)
    .fetch_one(&mut *conn)
    .await?;
    let failed = failed as u64;
    let requeued = lp_db::sql::query(
        "UPDATE job_queue SET status = 'queued', locked_by = NULL \
         WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1)",
    )
    .bind(stale_secs as f64)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok((requeued, failed))
}

/// Graceful shutdown: hand unfinished rows back to the queue without
/// counting the interrupted attempt.
pub async fn release(conn: &mut Conn, ids: &[i64]) -> sqlx::Result<u64> {
    Ok(lp_db::sql::query(
        "UPDATE job_queue SET status = 'queued', locked_by = NULL, \
           attempts = GREATEST(attempts - 1, 0) \
         WHERE id = ANY($1) AND status = 'running'",
    )
    .bind(ids)
    .execute(conn)
    .await?
    .rows_affected())
}

pub async fn get(conn: &mut Conn, id: i64) -> sqlx::Result<Option<QueuedJob>> {
    lp_db::sql::query_as::<_, QueuedJob>(&format!(
        "SELECT {JOB_COLUMNS} FROM job_queue WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(conn)
    .await
}

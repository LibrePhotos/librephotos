//! LongRunningJob bookkeeping shared by the task handlers: Django's
//! `get_or_create_job`, `update_scan_counter` and `finish_job_if_complete`
//! (directory_watcher/utils.py), with the per-item increments batched.

use std::time::{Duration, Instant};

use lp_jobs::{JobErrors, JobType, lrj};
use sqlx::PgPool;
use uuid::Uuid;

/// `CANCELLATION_CHECK_INTERVAL`: items between two cancellation polls.
pub const CANCEL_CHECK_EVERY: usize = 100;

/// `LongRunningJob.get_or_create_job`: the queued row the enqueuer made (if
/// any), marked started; otherwise a new, started row. Returns its `job_id`.
pub async fn begin(
    db: &PgPool,
    lrj_id: Option<&str>,
    job_type: JobType,
    user_id: i32,
) -> sqlx::Result<String> {
    let job_id = match lrj_id {
        Some(id) if lrj::get(db, id).await?.is_some() => id.to_string(),
        Some(id) => {
            create_with_id(db, id, job_type, user_id).await?;
            id.to_string()
        }
        None => {
            let id = Uuid::new_v4().to_string();
            create_with_id(db, &id, job_type, user_id).await?;
            id
        }
    };
    sqlx::query("UPDATE api_longrunningjob SET started_at = now() WHERE job_id = $1")
        .bind(&job_id)
        .execute(db)
        .await?;
    Ok(job_id)
}

async fn create_with_id(
    db: &PgPool,
    id: &str,
    job_type: JobType,
    user_id: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO api_longrunningjob (job_type, finished, failed, cancelled, job_id, queued_at, \
           started_at, started_by_id, progress_current, progress_target) \
         VALUES ($1, FALSE, FALSE, FALSE, $2, now(), now(), $3, 0, 0)",
    )
    .bind(job_type.as_i32())
    .bind(id)
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(())
}

/// `lrj.update_progress(current, target)`.
pub async fn set_progress(
    db: &PgPool,
    job_id: &str,
    current: i32,
    target: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE api_longrunningjob SET progress_current = $2, progress_target = $3 WHERE job_id = $1",
    )
    .bind(job_id)
    .bind(current)
    .bind(target.max(0))
    .execute(db)
    .await?;
    Ok(())
}

/// `lrj.complete()`: finished now, result untouched.
pub async fn complete(db: &PgPool, job_id: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() WHERE job_id = $1",
    )
    .bind(job_id)
    .execute(db)
    .await?;
    Ok(())
}

/// `lrj.fail(error)`: `{"status": "failed", "error": ...}`.
pub async fn fail(db: &PgPool, job_id: &str, error: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(), \
           result = $2 WHERE job_id = $1",
    )
    .bind(job_id)
    .bind(serde_json::json!({"status": "failed", "error": error}))
    .execute(db)
    .await?;
    Ok(())
}

pub async fn is_cancelled(db: &PgPool, job_id: &str) -> sqlx::Result<bool> {
    lrj::is_cancelled(db, job_id).await
}

/// `lrj.update_progress(0, target)`; with nothing to do the job completes
/// at once (`_begin_photo_scan`). Returns whether there is work.
pub async fn start_items(db: &PgPool, job_id: &str, target: i64) -> sqlx::Result<bool> {
    let target = i32::try_from(target).unwrap_or(i32::MAX);
    set_progress(db, job_id, 0, target).await?;
    if target == 0 {
        complete(db, job_id).await?;
        return Ok(false);
    }
    Ok(true)
}

/// `update_scan_counter` for a job whose items are processed here: counts
/// done items (flushed every 250 ms), keeps the per-item errors in `result`
/// and finishes the job once the counter reaches the target, exactly once
/// and never after a cancel.
pub struct ItemCounter {
    db: PgPool,
    job_id: String,
    target: usize,
    pending: i32,
    errors: JobErrors,
    errors_dirty: bool,
    last_flush: Instant,
}

impl ItemCounter {
    pub fn new(db: PgPool, job_id: impl Into<String>, target: usize) -> Self {
        ItemCounter {
            db,
            job_id: job_id.into(),
            target,
            pending: 0,
            errors: JobErrors::default(),
            errors_dirty: false,
            last_flush: Instant::now(),
        }
    }

    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn error_count(&self) -> usize {
        self.errors.count()
    }

    pub async fn done(&mut self, error: Option<String>) -> sqlx::Result<()> {
        self.pending += 1;
        if let Some(e) = error {
            self.errors.add(e);
            self.errors_dirty = true;
        }
        if self.last_flush.elapsed() >= Duration::from_millis(250) {
            self.flush().await?;
        }
        Ok(())
    }

    pub async fn flush(&mut self) -> sqlx::Result<()> {
        if self.pending == 0 && !self.errors_dirty {
            self.last_flush = Instant::now();
            return Ok(());
        }
        let result = if self.errors_dirty {
            self.errors.to_result(self.target)
        } else {
            None
        };
        sqlx::query(
            "UPDATE api_longrunningjob SET progress_current = progress_current + $2, \
               result = COALESCE($3, result), failed = failed OR $4 \
             WHERE job_id = $1 AND NOT cancelled",
        )
        .bind(&self.job_id)
        .bind(self.pending)
        .bind(&result)
        .bind(self.errors.is_failure(self.target))
        .execute(&self.db)
        .await?;
        self.pending = 0;
        self.errors_dirty = false;
        self.last_flush = Instant::now();
        Ok(())
    }

    /// Flush, then `finish_job_if_complete`. Returns whether this call finished it.
    pub async fn finish(mut self) -> sqlx::Result<bool> {
        self.flush().await?;
        finish_if_complete(&self.db, &self.job_id).await
    }
}

/// `finish_job_if_complete`: the guarded transition, once.
pub async fn finish_if_complete(db: &PgPool, job_id: &str) -> sqlx::Result<bool> {
    let n = sqlx::query(
        "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() \
         WHERE job_id = $1 AND NOT finished AND NOT cancelled \
           AND progress_current >= progress_target",
    )
    .bind(job_id)
    .execute(db)
    .await?
    .rows_affected();
    Ok(n > 0)
}

/// `_limit_to_photos_added_since_last_scan`'s baseline: `started_at` of the
/// user's most recently finished job of this type (Postgres puts NULL
/// `finished_at` first, as Django's `order_by("-finished_at")` does).
/// `Some(None)` means such a job exists but never started, which Django
/// turns into `added_on > NULL`: nothing.
pub async fn last_finished_start(
    db: &PgPool,
    user_id: i32,
    job_type: JobType,
    exclude_zero_target: bool,
) -> sqlx::Result<Option<Option<chrono::DateTime<chrono::Utc>>>> {
    let sql = format!(
        "SELECT started_at FROM api_longrunningjob \
         WHERE finished AND job_type = $1 AND started_by_id = $2 {} \
         ORDER BY finished_at DESC LIMIT 1",
        if exclude_zero_target {
            "AND progress_target <> 0"
        } else {
            ""
        }
    );
    sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(&sql)
        .bind(job_type.as_i32())
        .bind(user_id)
        .fetch_optional(db)
        .await
}

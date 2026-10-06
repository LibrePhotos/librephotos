//! Write services for the `jobs_zip_services` area. Conventions: see `lp_db::write`.
//!
//! Interval cutoffs are computed in Rust and bound (portable; SQLite has no
//! `make_interval`).

use std::path::Path;

use chrono::{DateTime, Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use crate::db::{Db, sql};

use super::AfterCommit;

fn ago(d: Duration) -> DateTime<Utc> {
    Utc::now() - d
}

/// `DELETE /api/jobs/{id}/`: the row goes; queue rows still waiting for it
/// are cancelled so a deleted job never starts. Returns false when no row
/// matched.
pub async fn delete_job(db: &Db, id: i32, scope_user: Option<i32>) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    let job_id: Option<String> = sql::query_scalar(
        "DELETE FROM api_longrunningjob WHERE id = $1 AND ($2 IS NULL OR started_by_id = $2) \
         RETURNING job_id",
    )
    .bind(id)
    .bind(scope_user)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(job_id) = job_id else {
        return Ok(false);
    };
    sql::query(
        "UPDATE job_queue SET status = 'cancelled', finished_at = now(), locked_by = NULL \
         WHERE lrj_id = $1 AND status = 'queued'",
    )
    .bind(&job_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// `api.services.cleanup_deleted_photos`: photos `removed` for more than
/// `days` days are deleted for good. Returns how many.
pub async fn cleanup_deleted_photos(db: &Db, media_root: &Path, days: i32) -> sqlx::Result<usize> {
    let cutoff = ago(Duration::days(days.into()));
    let mut tx = db.begin().await?;
    let ids: Vec<Uuid> =
        sql::query_scalar("SELECT id FROM api_photo WHERE removed AND last_modified <= $1")
            .bind(cutoff)
            .fetch_all(&mut *tx)
            .await?;
    let mut after = AfterCommit::new();
    super::photo_delete::hard_delete(&mut tx, &ids, media_root, &mut after).await?;
    tx.commit().await?;
    after.run().await;
    Ok(ids.len())
}

/// `LongRunningJob.cleanup_stuck_jobs`: unfinished jobs older than `hours`
/// (by `started_at`, or `queued_at` if never started) are failed; their
/// queue rows that never started are cancelled.
pub async fn cleanup_stuck_jobs(db: &Db, hours: i32) -> sqlx::Result<u64> {
    let cutoff = ago(Duration::hours(hours.into()));
    let result = json!({"status": "failed", "error": format!("Job timed out after {hours} hours")});
    let mut tx = db.begin().await?;
    let ids: Vec<String> = sql::query_scalar(
        "UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(), \
           result = $2 \
         WHERE NOT finished AND ( \
           (started_at IS NOT NULL AND started_at < $1) \
           OR (started_at IS NULL AND queued_at < $1)) \
         RETURNING job_id",
    )
    .bind(cutoff)
    .bind(result)
    .fetch_all(&mut *tx)
    .await?;
    if !ids.is_empty() {
        let d = tx.dialect();
        sql::query(format!(
            "UPDATE job_queue SET status = 'cancelled', finished_at = now() \
             WHERE {} AND status = 'queued'",
            sql::any_sql(d, "lrj_id", 1)
        ))
        .bind(&ids)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(ids.len() as u64)
}

/// `LongRunningJob.cleanup_old_jobs`: finished jobs older than `days` go,
/// except the latest finished one per (user, job type), which is the
/// incremental-scan baseline. Finished `job_queue` rows of that age go too.
pub async fn cleanup_old_jobs(db: &Db, days: i32) -> sqlx::Result<u64> {
    let cutoff = ago(Duration::days(days.into()));
    let deleted = sql::query(
        "DELETE FROM api_longrunningjob WHERE finished AND finished_at < $1 \
           AND id NOT IN ( \
             SELECT id FROM (SELECT id, ROW_NUMBER() OVER ( \
                 PARTITION BY started_by_id, job_type ORDER BY finished_at DESC, id DESC) AS rn \
               FROM api_longrunningjob WHERE finished AND finished_at IS NOT NULL) latest \
             WHERE rn = 1)",
    )
    .bind(cutoff)
    .execute(db)
    .await?
    .rows_affected();
    sql::query(
        "DELETE FROM job_queue WHERE status IN ('done', 'failed', 'cancelled') \
           AND COALESCE(finished_at, created_at) < $1",
    )
    .bind(cutoff)
    .execute(db)
    .await?;
    Ok(deleted)
}

/// Expired rows of the Rust refresh-token store.
pub async fn prune_refresh_tokens(db: &Db) -> sqlx::Result<u64> {
    Ok(
        sql::query("DELETE FROM refresh_token WHERE expires_at < $1")
            .bind(Utc::now())
            .execute(db)
            .await?
            .rows_affected(),
    )
}

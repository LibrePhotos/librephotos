//! Write services for the `jobs_zip_services` area. Conventions: see `lp_db::write`.

use std::path::Path;

use sqlx::PgPool;
use uuid::Uuid;

use super::AfterCommit;

/// `DELETE /api/jobs/{id}/`: the row goes; queue rows still waiting for it
/// are cancelled so a deleted job never starts. Returns false when no row
/// matched.
pub async fn delete_job(db: &PgPool, id: i32, scope_user: Option<i32>) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    let job_id: Option<String> = sqlx::query_scalar(
        "DELETE FROM api_longrunningjob WHERE id = $1 AND ($2::int IS NULL OR started_by_id = $2) \
         RETURNING job_id",
    )
    .bind(id)
    .bind(scope_user)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(job_id) = job_id else {
        return Ok(false);
    };
    sqlx::query(
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
pub async fn cleanup_deleted_photos(
    db: &PgPool,
    media_root: &Path,
    days: i32,
) -> sqlx::Result<usize> {
    let mut tx = db.begin().await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM api_photo WHERE removed \
           AND last_modified <= now() - make_interval(days => $1)",
    )
    .bind(days)
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
pub async fn cleanup_stuck_jobs(db: &PgPool, hours: i32) -> sqlx::Result<u64> {
    let mut tx = db.begin().await?;
    let ids: Vec<String> = sqlx::query_scalar(
        "UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(), \
           result = jsonb_build_object('status', 'failed', 'error', \
                      format('Job timed out after %s hours', $1::int)) \
         WHERE NOT finished AND ( \
           (started_at IS NOT NULL AND started_at < now() - make_interval(hours => $1)) \
           OR (started_at IS NULL AND queued_at < now() - make_interval(hours => $1))) \
         RETURNING job_id",
    )
    .bind(hours)
    .fetch_all(&mut *tx)
    .await?;
    if !ids.is_empty() {
        sqlx::query(
            "UPDATE job_queue SET status = 'cancelled', finished_at = now() \
             WHERE lrj_id = ANY($1) AND status = 'queued'",
        )
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
pub async fn cleanup_old_jobs(db: &PgPool, days: i32) -> sqlx::Result<u64> {
    let deleted = sqlx::query(
        "DELETE FROM api_longrunningjob WHERE finished \
           AND finished_at < now() - make_interval(days => $1) \
           AND id NOT IN ( \
             SELECT DISTINCT ON (started_by_id, job_type) id FROM api_longrunningjob \
             WHERE finished AND finished_at IS NOT NULL \
             ORDER BY started_by_id, job_type, finished_at DESC, id DESC)",
    )
    .bind(days)
    .execute(db)
    .await?
    .rows_affected();
    sqlx::query(
        "DELETE FROM job_queue WHERE status IN ('done', 'failed', 'cancelled') \
           AND COALESCE(finished_at, created_at) < now() - make_interval(days => $1)",
    )
    .bind(days)
    .execute(db)
    .await?;
    Ok(deleted)
}

/// Expired rows of the Rust refresh-token store.
pub async fn prune_refresh_tokens(db: &PgPool) -> sqlx::Result<u64> {
    Ok(
        sqlx::query("DELETE FROM refresh_token WHERE expires_at < now()")
            .execute(db)
            .await?
            .rows_affected(),
    )
}

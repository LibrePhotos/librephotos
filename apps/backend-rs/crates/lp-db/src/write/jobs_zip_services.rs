//! Write services for the `jobs_zip_services` area. Conventions: see `lp_db::write`.

use std::collections::BTreeSet;
use std::path::Path;

use sqlx::{PgConnection, PgPool};
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

/// `Photo.delete()` for many photos, as Django's collector does it (02 §5
/// "Hard deletes"): the relations without a DB cascade are deleted or
/// nulled explicitly, the rest cascades. Face crops (S4) and thumbnails no
/// other photo still uses (S5) are returned for deletion after commit.
pub async fn hard_delete_photos(
    conn: &mut PgConnection,
    ids: &[Uuid],
    media_root: &Path,
) -> sqlx::Result<AfterCommit> {
    let mut after = AfterCommit::new();
    if ids.is_empty() {
        return Ok(after);
    }
    let faces: Vec<String> = sqlx::query_scalar(
        "SELECT image FROM api_face WHERE photo_id = ANY($1) AND image IS NOT NULL AND image <> ''",
    )
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let thumbs: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT thumbnail_big, square_thumbnail, square_thumbnail_small \
         FROM api_thumbnail WHERE photo_id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;

    for table in [
        "api_photometadata",
        "api_metadatafile",
        "api_metadataedit",
        "api_photo_ocr",
        "api_photoshare",
        "api_tag_photos",
        "api_photo_stacks",
        "api_photo_duplicates",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE photo_id = ANY($1)"))
            .bind(ids)
            .execute(&mut *conn)
            .await?;
    }
    // Faces cascade with the photo; `Person.cover_face` is SET_NULL in Django only.
    sqlx::query(
        "UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN \
         (SELECT id FROM api_face WHERE photo_id = ANY($1))",
    )
    .bind(ids)
    .execute(&mut *conn)
    .await?;
    for table in ["api_duplicate", "api_stackreview"] {
        sqlx::query(&format!(
            "UPDATE {table} SET kept_photo_id = NULL WHERE kept_photo_id = ANY($1)"
        ))
        .bind(ids)
        .execute(&mut *conn)
        .await?;
    }
    sqlx::query("DELETE FROM api_photo WHERE id = ANY($1)")
        .bind(ids)
        .execute(&mut *conn)
        .await?;

    for f in faces {
        after.delete_file(media_root.join(f));
    }
    let hashes: BTreeSet<String> = thumbs
        .iter()
        .flat_map(|(a, b, c)| [a, b, c])
        .filter(|n| !n.is_empty())
        .filter_map(|n| {
            Path::new(n.as_str())
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
        })
        .collect();
    if !hashes.is_empty() {
        let hashes: Vec<String> = hashes.into_iter().collect();
        let still_used: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT image_hash FROM api_photo WHERE image_hash = ANY($1)",
        )
        .bind(&hashes)
        .fetch_all(&mut *conn)
        .await?;
        for h in hashes.iter().filter(|h| !still_used.contains(h)) {
            for (dir, ext) in [
                ("thumbnails_big", "webp"),
                ("square_thumbnails", "webp"),
                ("square_thumbnails_small", "webp"),
                ("square_thumbnails", "mp4"),
                ("square_thumbnails_small", "mp4"),
            ] {
                after.delete_file(media_root.join(dir).join(format!("{h}.{ext}")));
            }
        }
    }
    Ok(after)
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
    let after = hard_delete_photos(&mut tx, &ids, media_root).await?;
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

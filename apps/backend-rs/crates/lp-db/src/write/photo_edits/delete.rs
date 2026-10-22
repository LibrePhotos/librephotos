//! `DELETE /photosedit/delete/`: `photo_files.remove_photo` for many photos
//! in one transaction. Despite the name the photo row stays: it is marked
//! `removed`, loses its files (a file row and its bytes go only when no
//! other photo uses them), its cached transcode, and its stack/duplicate
//! memberships; stacks and duplicate groups left with one live photo or none
//! are dissolved.

use std::path::Path;

use sqlx::PgConnection;
use uuid::Uuid;

use crate::write::AfterCommit;

/// Photos of `user_id` in the trash carrying one of `hashes` (the
/// individual-hash mode's eligibility rule), as `(id, image_hash)`.
pub async fn trashed_by_hashes(
    conn: &mut PgConnection,
    user_id: i32,
    hashes: &[String],
) -> sqlx::Result<Vec<(Uuid, String)>> {
    sqlx::query_as(
        "SELECT id, image_hash FROM api_photo \
         WHERE owner_id = $1 AND in_trashcan AND image_hash = ANY($2) ORDER BY id",
    )
    .bind(user_id)
    .bind(hashes)
    .fetch_all(&mut *conn)
    .await
}

/// Remove `ids` (already authorized). Returns the files to unlink after commit.
pub async fn remove_photos(
    conn: &mut PgConnection,
    ids: &[Uuid],
    transcoded_dir: &Path,
) -> sqlx::Result<AfterCommit> {
    let mut after = AfterCommit::new();
    if ids.is_empty() {
        return Ok(after);
    }
    let hashes: Vec<String> =
        sqlx::query_scalar("SELECT image_hash FROM api_photo WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(&mut *conn)
            .await?;
    let stacks: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT photostack_id FROM api_photo_stacks WHERE photo_id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let duplicates: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT duplicate_id FROM api_photo_duplicates WHERE photo_id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;

    // Files only the removed photos use (via `files` or as a main file).
    let doomed: Vec<(String, String)> = sqlx::query_as(
        "SELECT f.hash, f.path FROM api_file f \
         WHERE f.hash IN (SELECT file_id FROM api_photo_files WHERE photo_id = ANY($1)) \
         AND NOT EXISTS (SELECT 1 FROM api_photo_files o JOIN api_photo op ON op.id = o.photo_id \
                         WHERE o.file_id = f.hash AND NOT (o.photo_id = ANY($1))) \
         AND NOT EXISTS (SELECT 1 FROM api_photo op WHERE op.main_file_id = f.hash \
                         AND NOT (op.id = ANY($1)))",
    )
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let doomed_hashes: Vec<String> = doomed.iter().map(|(h, _)| h.clone()).collect();

    sqlx::query("DELETE FROM api_photo_files WHERE photo_id = ANY($1) OR file_id = ANY($2)")
        .bind(ids)
        .bind(&doomed_hashes)
        .execute(&mut *conn)
        .await?;
    if !doomed_hashes.is_empty() {
        sqlx::query(
            "DELETE FROM api_file_embedded_media WHERE from_file_id = ANY($1) OR to_file_id = ANY($1)",
        )
        .bind(&doomed_hashes)
        .execute(&mut *conn)
        .await?;
        sqlx::query("DELETE FROM api_metadatafile WHERE file_id = ANY($1)")
            .bind(&doomed_hashes)
            .execute(&mut *conn)
            .await?;
        sqlx::query("UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = ANY($1)")
            .bind(&doomed_hashes)
            .execute(&mut *conn)
            .await?;
        sqlx::query("DELETE FROM api_file WHERE hash = ANY($1)")
            .bind(&doomed_hashes)
            .execute(&mut *conn)
            .await?;
    }

    sqlx::query(
        "UPDATE api_photo SET main_file_id = NULL, removed = TRUE, last_modified = now() \
         WHERE id = ANY($1)",
    )
    .bind(ids)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM api_photo_stacks WHERE photo_id = ANY($1)")
        .bind(ids)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM api_photo_duplicates WHERE photo_id = ANY($1)")
        .bind(ids)
        .execute(&mut *conn)
        .await?;

    if !stacks.is_empty() {
        let dead: Vec<Uuid> = sqlx::query_scalar(
            "SELECT s FROM unnest($1::uuid[]) s WHERE (SELECT COUNT(*) FROM api_photo_stacks ps \
             JOIN api_photo p ON p.id = ps.photo_id WHERE ps.photostack_id = s AND NOT p.removed) <= 1",
        )
        .bind(&stacks)
        .fetch_all(&mut *conn)
        .await?;
        if !dead.is_empty() {
            sqlx::query("DELETE FROM api_photo_stacks WHERE photostack_id = ANY($1)")
                .bind(&dead)
                .execute(&mut *conn)
                .await?;
            sqlx::query("DELETE FROM api_stackreview WHERE stack_id = ANY($1)")
                .bind(&dead)
                .execute(&mut *conn)
                .await?;
            sqlx::query("DELETE FROM api_photostack WHERE id = ANY($1)")
                .bind(&dead)
                .execute(&mut *conn)
                .await?;
        }
    }
    if !duplicates.is_empty() {
        let dead: Vec<Uuid> = sqlx::query_scalar(
            "SELECT d FROM unnest($1::uuid[]) d WHERE (SELECT COUNT(*) FROM api_photo_duplicates pd \
             JOIN api_photo p ON p.id = pd.photo_id WHERE pd.duplicate_id = d AND NOT p.removed) <= 1",
        )
        .bind(&duplicates)
        .fetch_all(&mut *conn)
        .await?;
        if !dead.is_empty() {
            sqlx::query("DELETE FROM api_photo_duplicates WHERE duplicate_id = ANY($1)")
                .bind(&dead)
                .execute(&mut *conn)
                .await?;
            sqlx::query("DELETE FROM api_duplicate WHERE id = ANY($1)")
                .bind(&dead)
                .execute(&mut *conn)
                .await?;
        }
    }

    for (_, path) in doomed {
        if !path.is_empty() {
            after.delete_file(path);
        }
    }
    for h in hashes {
        if h.is_empty() {
            continue;
        }
        let mp4 = transcoded_dir.join(format!("{h}.mp4"));
        after.delete_file(mp4.with_extension("mp4.part"));
        after.delete_file(mp4);
    }
    Ok(after)
}

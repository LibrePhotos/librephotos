//! `DELETE /photosedit/delete/`: `photo_files.remove_photo` for many photos
//! in one transaction. Despite the name the photo row stays: it is marked
//! `removed`, loses its files (a file row and its bytes go only when no
//! other photo uses them), its cached transcode, and its stack/duplicate
//! memberships; stacks and duplicate groups left with one live photo or none
//! are dissolved. Every dependent row is deleted explicitly (Django's SQLite
//! tables have no `ON DELETE`).

use std::path::Path;

use uuid::Uuid;

use crate::db::{Conn, DjUuid};
use crate::sql;
use crate::write::AfterCommit;

/// Photos of `user_id` in the trash carrying one of `hashes` (the
/// individual-hash mode's eligibility rule), as `(id, image_hash)`.
pub async fn trashed_by_hashes(
    conn: &mut Conn,
    user_id: i32,
    hashes: &[String],
) -> sqlx::Result<Vec<(Uuid, String)>> {
    let d = conn.dialect();
    let rows: Vec<(DjUuid, String)> = crate::sql::query_as(format!(
        "SELECT id, image_hash FROM api_photo \
         WHERE owner_id = $1 AND in_trashcan AND {} ORDER BY id",
        sql::any_sql(d, "image_hash", 2)
    ))
    .bind(user_id)
    .bind(hashes)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows.into_iter().map(|(id, h)| (id.0, h)).collect())
}

/// Remove `ids` (already authorized). Returns the files to unlink after commit.
pub async fn remove_photos(
    conn: &mut Conn,
    ids: &[Uuid],
    transcoded_dir: &Path,
) -> sqlx::Result<AfterCommit> {
    let mut after = AfterCommit::new();
    if ids.is_empty() {
        return Ok(after);
    }
    let d = conn.dialect();
    let any = |expr: &str, n: usize| sql::any_sql(d, expr, n);
    let not_any = |expr: &str, n: usize| sql::not_any_sql(d, expr, n);

    let hashes: Vec<String> = crate::sql::query_scalar(format!(
        "SELECT image_hash FROM api_photo WHERE {}",
        any("id", 1)
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let stacks: Vec<Uuid> = crate::sql::query_scalar(format!(
        "SELECT DISTINCT photostack_id FROM api_photo_stacks WHERE {}",
        any("photo_id", 1)
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let duplicates: Vec<Uuid> = crate::sql::query_scalar(format!(
        "SELECT DISTINCT duplicate_id FROM api_photo_duplicates WHERE {}",
        any("photo_id", 1)
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;

    // Files only the removed photos use (via `files` or as a main file).
    let doomed: Vec<(String, String)> = crate::sql::query_as(format!(
        "SELECT f.hash, f.path FROM api_file f \
         WHERE f.hash IN (SELECT file_id FROM api_photo_files WHERE {}) \
         AND NOT EXISTS (SELECT 1 FROM api_photo_files o JOIN api_photo op ON op.id = o.photo_id \
                         WHERE o.file_id = f.hash AND {}) \
         AND NOT EXISTS (SELECT 1 FROM api_photo op WHERE op.main_file_id = f.hash \
                         AND {})",
        any("photo_id", 1),
        not_any("o.photo_id", 1),
        not_any("op.id", 1)
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let doomed_hashes: Vec<String> = doomed.iter().map(|(h, _)| h.clone()).collect();

    crate::sql::query(format!(
        "DELETE FROM api_photo_files WHERE {} OR {}",
        any("photo_id", 1),
        any("file_id", 2)
    ))
    .bind(ids)
    .bind(&doomed_hashes)
    .execute(&mut *conn)
    .await?;
    if !doomed_hashes.is_empty() {
        crate::sql::query(format!(
            "DELETE FROM api_file_embedded_media WHERE {} OR {}",
            any("from_file_id", 1),
            any("to_file_id", 1)
        ))
        .bind(&doomed_hashes)
        .execute(&mut *conn)
        .await?;
        crate::sql::query(format!(
            "DELETE FROM api_metadatafile WHERE {}",
            any("file_id", 1)
        ))
        .bind(&doomed_hashes)
        .execute(&mut *conn)
        .await?;
        crate::sql::query(format!(
            "UPDATE api_photo SET main_file_id = NULL WHERE {}",
            any("main_file_id", 1)
        ))
        .bind(&doomed_hashes)
        .execute(&mut *conn)
        .await?;
        crate::sql::query(format!("DELETE FROM api_file WHERE {}", any("hash", 1)))
            .bind(&doomed_hashes)
            .execute(&mut *conn)
            .await?;
    }

    crate::sql::query(format!(
        "UPDATE api_photo SET main_file_id = NULL, removed = TRUE, last_modified = now() \
         WHERE {}",
        any("id", 1)
    ))
    .bind(ids)
    .execute(&mut *conn)
    .await?;
    crate::sql::query(format!(
        "DELETE FROM api_photo_stacks WHERE {}",
        any("photo_id", 1)
    ))
    .bind(ids)
    .execute(&mut *conn)
    .await?;
    crate::sql::query(format!(
        "DELETE FROM api_photo_duplicates WHERE {}",
        any("photo_id", 1)
    ))
    .bind(ids)
    .execute(&mut *conn)
    .await?;

    if !stacks.is_empty() {
        let dead: Vec<Uuid> = crate::sql::query_scalar(format!(
            "SELECT s.value FROM {} WHERE (SELECT COUNT(*) FROM api_photo_stacks ps \
             JOIN api_photo p ON p.id = ps.photo_id WHERE ps.photostack_id = s.value \
             AND NOT p.removed) <= 1",
            sql::list_rows(d, 1, "s")
        ))
        .bind(&stacks)
        .fetch_all(&mut *conn)
        .await?;
        if !dead.is_empty() {
            crate::sql::query(format!(
                "DELETE FROM api_photo_stacks WHERE {}",
                any("photostack_id", 1)
            ))
            .bind(&dead)
            .execute(&mut *conn)
            .await?;
            crate::sql::query(format!(
                "DELETE FROM api_stackreview WHERE {}",
                any("stack_id", 1)
            ))
            .bind(&dead)
            .execute(&mut *conn)
            .await?;
            crate::sql::query(format!("DELETE FROM api_photostack WHERE {}", any("id", 1)))
                .bind(&dead)
                .execute(&mut *conn)
                .await?;
        }
    }
    if !duplicates.is_empty() {
        let dead: Vec<Uuid> = crate::sql::query_scalar(format!(
            "SELECT d.value FROM {} WHERE (SELECT COUNT(*) FROM api_photo_duplicates pd \
             JOIN api_photo p ON p.id = pd.photo_id WHERE pd.duplicate_id = d.value \
             AND NOT p.removed) <= 1",
            sql::list_rows(d, 1, "d")
        ))
        .bind(&duplicates)
        .fetch_all(&mut *conn)
        .await?;
        if !dead.is_empty() {
            crate::sql::query(format!(
                "DELETE FROM api_photo_duplicates WHERE {}",
                any("duplicate_id", 1)
            ))
            .bind(&dead)
            .execute(&mut *conn)
            .await?;
            crate::sql::query(format!("DELETE FROM api_duplicate WHERE {}", any("id", 1)))
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

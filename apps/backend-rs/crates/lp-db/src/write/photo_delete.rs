//! `Photo.delete()` for many photos, as Django's collector does it (02 §5
//! "Hard deletes"). The one write service behind every hard delete: the
//! `cleanup_deleted_photos` schedule, `delete_missing_photos` and the RAW
//! variant repair. Each deleted photo leaves a mobile-sync `DeletionLog`
//! tombstone for its owner and every `shared_to` user (`post_delete`).

use std::collections::BTreeSet;
use std::path::Path;

use sqlx::PgConnection;
use uuid::Uuid;

use super::AfterCommit;

/// Relations whose foreign key has no database-level cascade: Django's
/// collector deletes or nulls them before the photo row. The rest (files,
/// faces, thumbnail, albums, search, captions, shared_to) cascade in the
/// database; the SET NULL covers are repeated so a schema without them
/// behaves the same.
const BEFORE_PHOTO: [&str; 15] = [
    // `Person.cover_face` is SET_NULL in Django only; faces cascade below.
    "UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN \
       (SELECT id FROM api_face WHERE photo_id = ANY($1))",
    "UPDATE api_person SET cover_photo_id = NULL WHERE cover_photo_id = ANY($1)",
    "UPDATE api_albumuser SET cover_photo_id = NULL WHERE cover_photo_id = ANY($1)",
    "UPDATE api_photostack SET primary_photo_id = NULL WHERE primary_photo_id = ANY($1)",
    "UPDATE api_duplicate SET kept_photo_id = NULL WHERE kept_photo_id = ANY($1)",
    "UPDATE api_stackreview SET kept_photo_id = NULL WHERE kept_photo_id = ANY($1)",
    "DELETE FROM api_tag_photos WHERE photo_id = ANY($1)",
    "DELETE FROM api_photo_stacks WHERE photo_id = ANY($1)",
    "DELETE FROM api_photo_duplicates WHERE photo_id = ANY($1)",
    "DELETE FROM api_metadataedit WHERE photo_id = ANY($1)",
    "DELETE FROM api_metadatafile WHERE photo_id = ANY($1)",
    "DELETE FROM api_photometadata WHERE photo_id = ANY($1)",
    "DELETE FROM api_photo_ocr WHERE photo_id = ANY($1)",
    "DELETE FROM api_photoshare WHERE photo_id = ANY($1)",
    "DELETE FROM api_photo WHERE id = ANY($1)",
];

/// Thumbnail files named after a hash (`delete_thumbnail_files`).
const THUMBNAIL_FILES: [(&str, &str); 5] = [
    ("thumbnails_big", "webp"),
    ("square_thumbnails", "webp"),
    ("square_thumbnails_small", "webp"),
    ("square_thumbnails", "mp4"),
    ("square_thumbnails_small", "mp4"),
];

/// Delete `ids` for good inside the caller's transaction. Face crops (S4)
/// and orphaned thumbnail files (S5) are queued on `after`.
pub async fn hard_delete(
    conn: &mut PgConnection,
    ids: &[Uuid],
    media_root: &Path,
    after: &mut AfterCommit,
) -> sqlx::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    super::deletion_log::photos_deleted(conn, ids).await?;
    let crops: Vec<String> = sqlx::query_scalar(
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
    for sql in BEFORE_PHOTO {
        sqlx::query(sql).bind(ids).execute(&mut *conn).await?;
    }

    for c in crops {
        after.delete_file(media_root.join(c));
    }
    // `delete_orphaned_thumbnail_files`, per deleted Thumbnail row: its files
    // stay while another Thumbnail row names one of them, and a hash's files
    // stay while a photo still carries that hash.
    let rows: Vec<Vec<String>> = thumbs
        .into_iter()
        .map(|(a, b, c)| [a, b, c].into_iter().filter(|n| !n.is_empty()).collect())
        .filter(|names: &Vec<String>| !names.is_empty())
        .collect();
    if rows.is_empty() {
        return Ok(());
    }
    let names: Vec<String> = rows
        .iter()
        .flatten()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let still_named: BTreeSet<String> = sqlx::query_scalar(
        "SELECT n FROM api_thumbnail t, \
         unnest(ARRAY[t.thumbnail_big, t.square_thumbnail, t.square_thumbnail_small]) AS n \
         WHERE (t.thumbnail_big = ANY($1) OR t.square_thumbnail = ANY($1) \
         OR t.square_thumbnail_small = ANY($1)) AND n = ANY($1)",
    )
    .bind(&names)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .collect();
    let stems: Vec<String> = rows
        .iter()
        .filter(|names| !names.iter().any(|n| still_named.contains(n)))
        .flatten()
        .filter_map(|n| {
            Path::new(n.as_str())
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if stems.is_empty() {
        return Ok(());
    }
    let still_used: BTreeSet<String> =
        sqlx::query_scalar("SELECT DISTINCT image_hash FROM api_photo WHERE image_hash = ANY($1)")
            .bind(&stems)
            .fetch_all(&mut *conn)
            .await?
            .into_iter()
            .collect();
    for h in stems.iter().filter(|h| !still_used.contains(*h)) {
        for (dir, ext) in THUMBNAIL_FILES {
            after.delete_file(media_root.join(dir).join(format!("{h}.{ext}")));
        }
    }
    Ok(())
}

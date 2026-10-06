//! `Photo.delete()` for many photos, as Django's collector does it (02 §5
//! "Hard deletes"). The one write service behind every hard delete: the
//! `cleanup_deleted_photos` schedule, `delete_missing_photos` and the RAW
//! variant repair. Each deleted photo leaves a mobile-sync `DeletionLog`
//! tombstone for its owner and every `shared_to` user (`post_delete`).
//!
//! Every dependent row is deleted or nulled explicitly, on both dialects:
//! Django's SQLite tables have foreign keys with no `ON DELETE` (deferred, so
//! a row left behind fails the COMMIT), and the Postgres cascades then find
//! nothing left to do.

use std::collections::BTreeSet;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::db::{Conn, Dialect, DjUuid, Qb};
use crate::sql::any_sql;

use super::AfterCommit;

/// `on_delete=SET_NULL` relations of `Photo` and of its cascaded `Face`
/// rows: `(table, column, the photo-id expression it is nulled for)`.
/// `Person.cover_face` must go before the faces themselves.
const SET_NULL: [(&str, &str, &str); 6] = [
    (
        "api_person",
        "cover_face_id",
        "(SELECT f.id FROM api_face f WHERE {any_f})",
    ),
    ("api_person", "cover_photo_id", ""),
    ("api_albumuser", "cover_photo_id", ""),
    ("api_photostack", "primary_photo_id", ""),
    ("api_duplicate", "kept_photo_id", ""),
    ("api_stackreview", "kept_photo_id", ""),
];

/// `on_delete=CASCADE` relations, the `Face` / `Thumbnail` / `PhotoSearch`
/// / `PhotoCaption` / `PhotoOCR` / metadata rows and every many-to-many
/// through table holding `photo_id`: `(table, photo-id column)`. Rust's own
/// side tables (`lp_photo_faces_scanned`, SQLite's `lp_photo_clip_model`)
/// declare `ON DELETE CASCADE` themselves.
const CASCADE: [(&str, &str); 20] = [
    ("api_tag_photos", "photo_id"),
    ("api_photo_stacks", "photo_id"),
    ("api_photo_duplicates", "photo_id"),
    ("api_metadataedit", "photo_id"),
    ("api_metadatafile", "photo_id"),
    ("api_photometadata", "photo_id"),
    ("api_photo_ocr", "photo_id"),
    ("api_photoshare", "photo_id"),
    ("api_photo_shared_to", "photo_id"),
    ("api_photo_files", "photo_id"),
    ("api_face", "photo_id"),
    ("api_thumbnail", "photo_id"),
    ("api_photo_search", "photo_id"),
    ("api_photo_caption", "photo_id"),
    ("api_albumdate_photos", "photo_id"),
    ("api_albumuser_photos", "photo_id"),
    ("api_albumauto_photos", "photo_id"),
    ("api_albumplace_photos", "photo_id"),
    ("api_albumthing_photos", "photo_id"),
    ("api_albumthing_cover_photos", "photo_id"),
];

/// The statements that remove the photos `$1` and everything pointing at
/// them, in order.
fn delete_statements(d: Dialect) -> Vec<String> {
    let mut out = Vec::with_capacity(SET_NULL.len() + CASCADE.len() + 1);
    for (table, col, of) in SET_NULL {
        let cond = if of.is_empty() {
            any_sql(d, col, 1)
        } else {
            format!(
                "{col} IN {}",
                of.replace("{any_f}", &any_sql(d, "f.photo_id", 1))
            )
        };
        out.push(format!("UPDATE {table} SET {col} = NULL WHERE {cond}"));
    }
    for (table, col) in CASCADE {
        out.push(format!("DELETE FROM {table} WHERE {}", any_sql(d, col, 1)));
    }
    out.push(format!(
        "DELETE FROM api_photo WHERE {}",
        any_sql(d, "id", 1)
    ));
    out
}

/// Thumbnail files named after a hash (`delete_thumbnail_files`).
const THUMBNAIL_FILES: [(&str, &str); 5] = [
    ("thumbnails_big", "webp"),
    ("square_thumbnails", "webp"),
    ("square_thumbnails_small", "webp"),
    ("square_thumbnails", "mp4"),
    ("square_thumbnails_small", "mp4"),
];

/// Rows per tombstone INSERT on SQLite (4 binds each, under its 32766 limit).
const TOMBSTONE_CHUNK: usize = 1000;

/// `post_delete` tombstones of the photos (owner and `shared_to` users that
/// exist). Postgres: [`super::deletion_log::photos_deleted`]. SQLite: the
/// same pairs, read first and inserted with Django's dashed `str(uuid)` and
/// a Rust timestamp (`clock_timestamp()` has no SQLite twin; `now()` is fixed
/// for the transaction, which would tie the tombstones with the bumps before
/// them).
async fn tombstones(conn: &mut Conn, ids: &[Uuid]) -> sqlx::Result<()> {
    let d = conn.dialect();
    if d == Dialect::Pg {
        super::deletion_log::photos_deleted(conn, ids).await?;
        return Ok(());
    }
    let pairs: Vec<(DjUuid, i32)> = crate::sql::query_as(format!(
        "SELECT v.eid, v.uid FROM (SELECT p.id AS eid, p.owner_id AS uid FROM api_photo p WHERE {} \
         UNION SELECT s.photo_id, s.user_id FROM api_photo_shared_to s WHERE {}) v \
         WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) ORDER BY v.eid, v.uid",
        any_sql(d, "p.id", 1),
        any_sql(d, "s.photo_id", 1)
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    for chunk in pairs.chunks(TOMBSTONE_CHUNK) {
        let at = Utc::now();
        let mut qb =
            Qb::new("INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) ");
        qb.push_values(chunk, |mut b, (id, uid)| {
            b.push_bind(super::deletion_log::entity::PHOTO)
                .push_bind(id.0.hyphenated().to_string())
                .push_bind(*uid)
                .push_bind(at);
        });
        qb.build().execute(&mut *conn).await?;
    }
    Ok(())
}

/// Delete `ids` for good inside the caller's transaction. Face crops (S4)
/// and orphaned thumbnail files (S5) are queued on `after`.
pub async fn hard_delete(
    conn: &mut Conn,
    ids: &[Uuid],
    media_root: &Path,
    after: &mut AfterCommit,
) -> sqlx::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let d = conn.dialect();
    tombstones(conn, ids).await?;
    let crops: Vec<String> = crate::sql::query_scalar(format!(
        "SELECT image FROM api_face WHERE {} AND image IS NOT NULL AND image <> ''",
        any_sql(d, "photo_id", 1)
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let thumbs: Vec<(String, String, String)> = crate::sql::query_as(format!(
        "SELECT thumbnail_big, square_thumbnail, square_thumbnail_small \
         FROM api_thumbnail WHERE {}",
        any_sql(d, "photo_id", 1)
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    for sql in delete_statements(d) {
        crate::sql::query(sql).bind(ids).execute(&mut *conn).await?;
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
    let still_named: BTreeSet<String> = crate::sql::query_scalar(format!(
        "SELECT thumbnail_big FROM api_thumbnail WHERE {} \
         UNION SELECT square_thumbnail FROM api_thumbnail WHERE {} \
         UNION SELECT square_thumbnail_small FROM api_thumbnail WHERE {}",
        any_sql(d, "thumbnail_big", 1),
        any_sql(d, "square_thumbnail", 1),
        any_sql(d, "square_thumbnail_small", 1)
    ))
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
    let still_used: BTreeSet<String> = crate::sql::query_scalar(format!(
        "SELECT DISTINCT image_hash FROM api_photo WHERE {}",
        any_sql(d, "image_hash", 1)
    ))
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

//! Write services for the `photo_edits` area. Conventions: see `lp_db::write`.
//!
//! Every service takes `&mut Conn` so the handler can compose it with
//! `lp_jobs::enqueue_in` in one transaction.

pub mod bulk;
pub mod caption;
pub mod delete;
pub mod edit;
pub mod sharing;
pub mod tombstones;

use crate::db::Conn;
use crate::sql;

/// `refresh_tag_photo_counts`: recount `photo_count` of `tag_ids` over the
/// photos a tag shows (not hidden, trashed or removed). No `last_modified`
/// bump: Django does this with a queryset UPDATE.
pub async fn refresh_tag_photo_counts(conn: &mut Conn, tag_ids: &[i32]) -> sqlx::Result<()> {
    if tag_ids.is_empty() {
        return Ok(());
    }
    let d = conn.dialect();
    crate::sql::query(format!(
        "UPDATE api_tag AS t SET photo_count = COALESCE((\
            SELECT COUNT(tp.id) FROM api_tag_photos tp JOIN api_photo p ON p.id = tp.photo_id \
            WHERE tp.tag_id = t.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), 0) \
         WHERE {}",
        sql::any_sql(d, "t.id", 1)
    ))
    .bind(tag_ids)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `tag_ids_for_photos`: snapshot before the photos change.
pub async fn tag_ids_for_photos(
    conn: &mut Conn,
    photo_ids: &[uuid::Uuid],
) -> sqlx::Result<Vec<i32>> {
    let d = conn.dialect();
    crate::sql::query_scalar::<_, i32>(format!(
        "SELECT DISTINCT tag_id FROM api_tag_photos WHERE {}",
        sql::any_sql(d, "photo_id", 1)
    ))
    .bind(photo_ids)
    .fetch_all(&mut *conn)
    .await
}

/// The `AlbumThing.photos` m2m receiver after an add or remove: recount the
/// non-hidden photos, top the covers up to 4, and bump `last_modified` (the
/// sync bump plus the `save()` Django does right after). The LIMIT is
/// clamped by `CASE` (no `GREATEST`; a negative LIMIT is "no limit" on SQLite).
pub(crate) async fn album_thing_changed(conn: &mut Conn, album_id: i32) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE api_albumthing AS a SET photo_count = (\
            SELECT COUNT(*) FROM api_albumthing_photos ap JOIN api_photo p ON p.id = ap.photo_id \
            WHERE ap.albumthing_id = a.id AND NOT p.hidden), last_modified = now() \
         WHERE a.id = $1",
    )
    .bind(album_id)
    .execute(&mut *conn)
    .await?;
    crate::sql::query(
        "INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id) \
         SELECT $1, x.photo_id FROM ( \
            SELECT ap.photo_id, MIN(ap.id) AS ord FROM api_albumthing_photos ap \
            JOIN api_photo p ON p.id = ap.photo_id \
            WHERE ap.albumthing_id = $1 AND NOT p.hidden AND ap.photo_id NOT IN ( \
                SELECT c.photo_id FROM api_albumthing_cover_photos c \
                WHERE c.albumthing_id = $1 AND c.photo_id IS NOT NULL) \
            GROUP BY ap.photo_id ORDER BY ord \
            LIMIT (SELECT CASE WHEN COUNT(*) < 4 THEN 4 - COUNT(*) ELSE 0 END \
                   FROM api_albumthing_cover_photos c WHERE c.albumthing_id = $1)) x",
    )
    .bind(album_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

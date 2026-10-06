//! The area's `DeletionLog` writes on both dialects. Postgres goes through
//! [`crate::write::deletion_log`] unchanged; SQLite inserts the rows with a
//! Rust timestamp: `clock_timestamp()` has no SQLite twin, and `now()` is
//! fixed for the transaction, which would tie a tombstone with the
//! `last_modified` bumps before it (`deleted_at > cursor` would miss it).

use chrono::Utc;
use uuid::Uuid;

use crate::db::{Conn, Dialect, Qb};
use crate::write::deletion_log as dl;

/// Rows per INSERT (4 binds each, far under SQLite's 32766).
const CHUNK: usize = 1000;

/// [`dl::photos_unshared_bulk`]: one photo tombstone per selected photo for
/// `user_id`, in selection order (Django's `bulk_create`).
pub async fn photos_unshared_bulk(
    conn: &mut Conn,
    photo_ids: &[Uuid],
    user_id: i32,
) -> sqlx::Result<u64> {
    if conn.dialect() == Dialect::Pg || photo_ids.is_empty() {
        return dl::photos_unshared_bulk(conn, photo_ids, user_id).await;
    }
    let mut n = 0;
    for chunk in photo_ids.chunks(CHUNK) {
        let at = Utc::now();
        let mut qb =
            Qb::new("INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) ");
        qb.push_values(chunk, |mut b, id| {
            b.push_bind(dl::entity::PHOTO)
                .push_bind(id.to_string())
                .push_bind(user_id)
                .push_bind(at);
        });
        n += qb.build().execute(&mut *conn).await?.rows_affected();
    }
    Ok(n)
}

/// [`dl::clear`] on both dialects (the portable form lives with the
/// albums_tags tombstones).
pub async fn clear(
    conn: &mut Conn,
    entity: &str,
    entity_ids: &[String],
    user_ids: &[i32],
) -> sqlx::Result<u64> {
    crate::write::albums_tags::tombstones::clear(conn, entity, entity_ids, user_ids).await
}

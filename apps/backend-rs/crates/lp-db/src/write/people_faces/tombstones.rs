//! The area's `DeletionLog` writes on both dialects. Postgres goes through
//! [`crate::write::deletion_log`] unchanged; SQLite reads the
//! `(person, owner)` pairs first and inserts them with a Rust timestamp:
//! `clock_timestamp()` has no SQLite twin, and `now()` is fixed for the
//! transaction, which would tie a tombstone with the `last_modified` bumps
//! before it (`deleted_at > cursor` would then miss it).

use chrono::Utc;

use crate::db::{Conn, Dialect, Qb, sql};
use crate::write::deletion_log as dl;

/// Rows per INSERT (4 binds each, far under SQLite's 32766).
const CHUNK: usize = 1000;

/// [`dl::persons_deleted`]: one tombstone for each `USER` person with an
/// existing `cluster_owner` (`_person_tombstone`), in person id order (the
/// collector sends `post_delete` sorted by pk). Call before deleting.
pub async fn persons_deleted(conn: &mut Conn, ids: &[i32]) -> sqlx::Result<u64> {
    let d = conn.dialect();
    if d == Dialect::Pg || ids.is_empty() {
        return dl::persons_deleted(conn, ids).await;
    }
    let pairs: Vec<(i32, i32)> = sql::query_as(format!(
        "SELECT p.id, p.cluster_owner_id FROM api_person p WHERE {} \
           AND p.kind = 'USER' AND p.cluster_owner_id IS NOT NULL \
           AND EXISTS (SELECT 1 FROM api_user u WHERE u.id = p.cluster_owner_id) \
         ORDER BY p.id",
        sql::any_sql(d, "p.id", 1),
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let mut n = 0;
    for chunk in pairs.chunks(CHUNK) {
        let at = Utc::now();
        let mut qb =
            Qb::new("INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) ");
        qb.push_values(chunk, |mut b, (id, owner)| {
            b.push_bind(dl::entity::PERSON)
                .push_bind(id.to_string())
                .push_bind(*owner)
                .push_bind(at);
        });
        n += qb.build().execute(&mut *conn).await?.rows_affected();
    }
    Ok(n)
}

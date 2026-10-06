//! The area's `DeletionLog` writes on both dialects. Postgres goes through
//! [`crate::write::deletion_log`] unchanged; SQLite reads the
//! `(entity_id, user)` pairs first and inserts them with a Rust timestamp:
//! `clock_timestamp()` has no SQLite twin, and `now()` is fixed for the
//! transaction, which would tie a tombstone with the `last_modified` bumps
//! before it (`deleted_at > cursor` would then miss it).

use chrono::Utc;

use crate::db::{Conn, Dialect, Qb, sql};
use crate::write::deletion_log::{self as dl, AlbumKind};

/// Rows per INSERT (4 binds each, far under SQLite's 32766).
const CHUNK: usize = 1000;

async fn insert_pairs(conn: &mut Conn, entity: &str, pairs: &[(String, i32)]) -> sqlx::Result<u64> {
    let mut n = 0;
    for chunk in pairs.chunks(CHUNK) {
        let at = Utc::now();
        let mut qb =
            Qb::new("INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) ");
        qb.push_values(chunk, |mut b, (eid, uid)| {
            b.push_bind(entity.to_string())
                .push_bind(eid.clone())
                .push_bind(*uid)
                .push_bind(at);
        });
        n += qb.build().execute(&mut *conn).await?.rows_affected();
    }
    Ok(n)
}

/// [`dl::albums_deleted`]: owner and `shared_to` users of each album. On
/// SQLite in album id order, as Django's collector sends `post_delete`
/// (instances sorted by pk), each album's users ascending.
pub async fn albums_deleted(conn: &mut Conn, kind: AlbumKind, ids: &[i32]) -> sqlx::Result<u64> {
    let d = conn.dialect();
    if d == Dialect::Pg || ids.is_empty() {
        return dl::albums_deleted(conn, kind, ids).await;
    }
    let (album, through, fk) = kind.tables();
    let pairs: Vec<(i32, i32)> = sql::query_as(format!(
        "SELECT v.eid, v.uid FROM ( \
           SELECT a.id AS eid, a.owner_id AS uid FROM {album} a WHERE {} \
           UNION SELECT s.{fk}, s.user_id FROM {through} s WHERE {}) v \
         WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) ORDER BY v.eid, v.uid",
        sql::any_sql(d, "a.id", 1),
        sql::any_sql(d, &format!("s.{fk}"), 1),
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let pairs: Vec<(String, i32)> = pairs.into_iter().map(|(e, u)| (e.to_string(), u)).collect();
    insert_pairs(conn, kind.entity(), &pairs).await
}

/// [`dl::tags_deleted`]: one tombstone for each tag's owner.
pub async fn tags_deleted(conn: &mut Conn, ids: &[i32]) -> sqlx::Result<u64> {
    let d = conn.dialect();
    if d == Dialect::Pg || ids.is_empty() {
        return dl::tags_deleted(conn, ids).await;
    }
    let pairs: Vec<(i32, i32)> = sql::query_as(format!(
        "SELECT t.id, t.owner_id FROM api_tag t WHERE {} \
           AND EXISTS (SELECT 1 FROM api_user u WHERE u.id = t.owner_id) ORDER BY t.id",
        sql::any_sql(d, "t.id", 1),
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    let pairs: Vec<(String, i32)> = pairs.into_iter().map(|(e, u)| (e.to_string(), u)).collect();
    insert_pairs(conn, dl::entity::TAG, &pairs).await
}

/// [`dl::unshared`]: one tombstone per `(entity_id, existing user)`.
pub async fn unshared(
    conn: &mut Conn,
    entity: &str,
    entity_ids: &[String],
    user_ids: &[i32],
) -> sqlx::Result<u64> {
    let d = conn.dialect();
    if d == Dialect::Pg || entity_ids.is_empty() || user_ids.is_empty() {
        return dl::unshared(conn, entity, entity_ids, user_ids).await;
    }
    let users: Vec<i32> = sql::query_scalar(format!(
        "SELECT id FROM api_user WHERE {} ORDER BY id",
        sql::any_sql(d, "id", 1)
    ))
    .bind(user_ids)
    .fetch_all(&mut *conn)
    .await?;
    let mut eids = entity_ids.to_vec();
    eids.sort();
    eids.dedup();
    let pairs: Vec<(String, i32)> = eids
        .iter()
        .flat_map(|e| users.iter().map(move |u| (e.clone(), *u)))
        .collect();
    insert_pairs(conn, entity, &pairs).await
}

/// [`dl::clear`]: drop stale tombstones of rows visible again to `user_ids`.
pub async fn clear(
    conn: &mut Conn,
    entity: &str,
    entity_ids: &[String],
    user_ids: &[i32],
) -> sqlx::Result<u64> {
    let d = conn.dialect();
    if d == Dialect::Pg || entity_ids.is_empty() || user_ids.is_empty() {
        return dl::clear(conn, entity, entity_ids, user_ids).await;
    }
    Ok(sql::query(format!(
        "DELETE FROM api_deletionlog WHERE entity = $1 AND {} AND {}",
        sql::any_sql(d, "entity_id", 2),
        sql::any_sql(d, "owner_id", 3)
    ))
    .bind(entity)
    .bind(entity_ids)
    .bind(user_ids)
    .execute(&mut *conn)
    .await?
    .rows_affected())
}

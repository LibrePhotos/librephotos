//! Mobile-sync bookkeeping (Django `api/sync_signals.py` and the explicit
//! writes in `SetPhotosShared`): `DeletionLog` tombstones for events that
//! leave no `last_modified` trace (hard deletes, visibility losses), and
//! cancelling them when a row becomes visible again.
//!
//! Django writes these from `post_delete` / `m2m_changed` receivers; here the
//! write service that deletes or un-shares calls the matching helper in the
//! same transaction. A delete helper runs *before* the rows go, because it
//! reads the owner and the `shared_to` viewers Django captures in
//! `pre_delete`.
//!
//! `deleted_at` is `clock_timestamp()` on Postgres, not `now()`: Django
//! stamps each row with `timezone.now()` when it is inserted, after any
//! `last_modified` bump of the same request, so a tombstone always sorts after
//! the bumps it goes with. `now()` (transaction start) would tie with them,
//! and a client whose cursor is that bump would never see the tombstone
//! (`deleted_at > cursor`).
//!
//! SQLite has no `clock_timestamp()` (and its `now()` is fixed for the
//! transaction too): there the `(entity_id, owner)` pairs are read first and
//! inserted with a Rust timestamp taken after the read, in the same order and
//! with the same `entity_id` text (`str(pk)`; dashed `str(uuid)` for photos)
//! Django-on-SQLite writes.
//!
//! Like `_write_tombstones`, rows are only written for users that exist.

use chrono::{Duration, Utc};
use uuid::Uuid;

use crate::db::{Conn, Db, Dialect, DjUuid, Q, Qb, sql};

/// `DeletionLog.ENTITY_*`.
pub mod entity {
    pub const PHOTO: &str = "photo";
    pub const PERSON: &str = "person";
    pub const ALBUM_USER: &str = "album_user";
    pub const ALBUM_AUTO: &str = "album_auto";
    pub const ALBUM_THING: &str = "album_thing";
    pub const ALBUM_PLACE: &str = "album_place";
    pub const TAG: &str = "tag";
}

/// `DeletionLog.PRUNE_HORIZON_DAYS`: older tombstones are pruned, and a
/// cursor older than this answers 410.
pub const PRUNE_HORIZON_DAYS: i64 = 90;

/// The four album models that carry a `shared_to` relation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlbumKind {
    User,
    Auto,
    Thing,
    Place,
}

impl AlbumKind {
    pub fn entity(self) -> &'static str {
        match self {
            AlbumKind::User => entity::ALBUM_USER,
            AlbumKind::Auto => entity::ALBUM_AUTO,
            AlbumKind::Thing => entity::ALBUM_THING,
            AlbumKind::Place => entity::ALBUM_PLACE,
        }
    }

    /// `(album table, shared_to through table, through FK column)`.
    pub fn tables(self) -> (&'static str, &'static str, &'static str) {
        match self {
            AlbumKind::User => ("api_albumuser", "api_albumuser_shared_to", "albumuser_id"),
            AlbumKind::Auto => ("api_albumauto", "api_albumauto_shared_to", "albumauto_id"),
            AlbumKind::Thing => (
                "api_albumthing",
                "api_albumthing_shared_to",
                "albumthing_id",
            ),
            AlbumKind::Place => (
                "api_albumplace",
                "api_albumplace_shared_to",
                "albumplace_id",
            ),
        }
    }
}

/// Postgres: INSERT of the `(entity_id, owner_id)` pairs `pairs_sql` selects
/// (columns `eid text, uid int`; `$1` is the entity), skipping users that do
/// not exist.
fn insert_sql_pg(pairs_sql: &str) -> String {
    format!(
        "INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) \
         SELECT $1, v.eid, v.uid, clock_timestamp() FROM ({pairs_sql}) v \
         WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) \
         ORDER BY v.eid, v.uid"
    )
}

async fn run(conn: &mut Conn, q: Q<'_>) -> sqlx::Result<u64> {
    Ok(q.execute(&mut *conn).await?.rows_affected())
}

/// Rows per tombstone INSERT on SQLite (4 binds each, far under its 32766).
const SQLITE_CHUNK: usize = 1000;

/// SQLite: insert `(entity_id, owner_id)` tombstones in the given order,
/// stamped with the Rust clock (Django's `timezone.now()` at insert time).
async fn insert_pairs(conn: &mut Conn, entity: &str, pairs: &[(String, i32)]) -> sqlx::Result<u64> {
    let mut n = 0;
    for chunk in pairs.chunks(SQLITE_CHUNK) {
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

/// SQLite: the integer-keyed `(eid, uid)` pairs `pairs_sql` selects (`$1` =
/// `ids`) of users that exist, in `(eid, uid)` order: Django's collector sends
/// `post_delete` in pk order, and `_write_tombstones` walks a set of small
/// ints (ascending).
async fn int_pairs(
    conn: &mut Conn,
    pairs_sql: &str,
    ids: &[i32],
) -> sqlx::Result<Vec<(String, i32)>> {
    let rows: Vec<(i64, i32)> = sql::query_as(format!(
        "SELECT v.eid, v.uid FROM ({pairs_sql}) v \
         WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) ORDER BY v.eid, v.uid"
    ))
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows.into_iter().map(|(e, u)| (e.to_string(), u)).collect())
}

/// Hard delete of photos `ids` (`post_delete` on `Photo`): one tombstone for
/// the owner and one for every `shared_to` user. Call before deleting.
pub async fn photos_deleted(conn: &mut Conn, ids: &[Uuid]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    match conn.dialect() {
        Dialect::Pg => {
            let sql = insert_sql_pg(
                "SELECT p.id::text AS eid, p.owner_id AS uid FROM api_photo p WHERE p.id = ANY($2) \
                 UNION SELECT s.photo_id::text, s.user_id FROM api_photo_shared_to s \
                 WHERE s.photo_id = ANY($2)",
            );
            run(conn, sql::query(&sql).bind(entity::PHOTO).bind(ids)).await
        }
        Dialect::Sqlite => {
            let d = Dialect::Sqlite;
            // char(32) hex sorts like the dashed text Postgres orders by.
            let rows: Vec<(DjUuid, i32)> = sql::query_as(format!(
                "SELECT v.eid, v.uid FROM ( \
                   SELECT p.id AS eid, p.owner_id AS uid FROM api_photo p WHERE {} \
                   UNION SELECT s.photo_id, s.user_id FROM api_photo_shared_to s WHERE {}) v \
                 WHERE EXISTS (SELECT 1 FROM api_user u WHERE u.id = v.uid) \
                 ORDER BY v.eid, v.uid",
                sql::any_sql(d, "p.id", 1),
                sql::any_sql(d, "s.photo_id", 1),
            ))
            .bind(ids)
            .fetch_all(&mut *conn)
            .await?;
            let pairs: Vec<(String, i32)> = rows
                .into_iter()
                .map(|(id, u)| (id.0.hyphenated().to_string(), u))
                .collect();
            insert_pairs(conn, entity::PHOTO, &pairs).await
        }
    }
}

/// Hard delete of albums `ids` of one kind (`post_delete` on the album
/// model): tombstones for the owner and every `shared_to` user. Call before
/// deleting.
pub async fn albums_deleted(conn: &mut Conn, kind: AlbumKind, ids: &[i32]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let (album, through, fk) = kind.tables();
    match conn.dialect() {
        Dialect::Pg => {
            let sql = insert_sql_pg(&format!(
                "SELECT a.id::text AS eid, a.owner_id AS uid FROM {album} a WHERE a.id = ANY($2) \
                 UNION SELECT s.{fk}::text, s.user_id FROM {through} s WHERE s.{fk} = ANY($2)"
            ));
            run(conn, sql::query(&sql).bind(kind.entity()).bind(ids)).await
        }
        Dialect::Sqlite => {
            let d = Dialect::Sqlite;
            let pairs_sql = format!(
                "SELECT a.id AS eid, a.owner_id AS uid FROM {album} a WHERE {} \
                 UNION SELECT s.{fk}, s.user_id FROM {through} s WHERE {}",
                sql::any_sql(d, "a.id", 1),
                sql::any_sql(d, &format!("s.{fk}"), 1),
            );
            let pairs = int_pairs(conn, &pairs_sql, ids).await?;
            insert_pairs(conn, kind.entity(), &pairs).await
        }
    }
}

/// Hard delete of persons `ids` (`_person_tombstone`): only `USER`-kind
/// persons with a `cluster_owner` are mirrored, so only they get one. Call
/// before deleting.
pub async fn persons_deleted(conn: &mut Conn, ids: &[i32]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    match conn.dialect() {
        Dialect::Pg => {
            let sql = insert_sql_pg(
                "SELECT p.id::text AS eid, p.cluster_owner_id AS uid FROM api_person p \
                 WHERE p.id = ANY($2) AND p.kind = 'USER' AND p.cluster_owner_id IS NOT NULL",
            );
            run(conn, sql::query(&sql).bind(entity::PERSON).bind(ids)).await
        }
        Dialect::Sqlite => {
            let pairs_sql = format!(
                "SELECT p.id AS eid, p.cluster_owner_id AS uid FROM api_person p \
                 WHERE {} AND p.kind = 'USER' AND p.cluster_owner_id IS NOT NULL",
                sql::any_sql(Dialect::Sqlite, "p.id", 1),
            );
            let pairs = int_pairs(conn, &pairs_sql, ids).await?;
            insert_pairs(conn, entity::PERSON, &pairs).await
        }
    }
}

/// Hard delete of tags `ids`: one tombstone for the owner. Call before
/// deleting.
pub async fn tags_deleted(conn: &mut Conn, ids: &[i32]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    match conn.dialect() {
        Dialect::Pg => {
            let sql = insert_sql_pg(
                "SELECT t.id::text AS eid, t.owner_id AS uid FROM api_tag t WHERE t.id = ANY($2)",
            );
            run(conn, sql::query(&sql).bind(entity::TAG).bind(ids)).await
        }
        Dialect::Sqlite => {
            let pairs_sql = format!(
                "SELECT t.id AS eid, t.owner_id AS uid FROM api_tag t WHERE {}",
                sql::any_sql(Dialect::Sqlite, "t.id", 1),
            );
            let pairs = int_pairs(conn, &pairs_sql, ids).await?;
            insert_pairs(conn, entity::TAG, &pairs).await
        }
    }
}

/// Visibility loss (un-share, `m2m_changed` `post_remove` / `post_clear`):
/// one tombstone per `(entity_id, user)`.
pub async fn unshared(
    conn: &mut Conn,
    entity: &str,
    entity_ids: &[String],
    user_ids: &[i32],
) -> sqlx::Result<u64> {
    if entity_ids.is_empty() || user_ids.is_empty() {
        return Ok(0);
    }
    match conn.dialect() {
        Dialect::Pg => {
            let sql = insert_sql_pg(
                "SELECT e AS eid, u AS uid FROM unnest($2::text[]) e, unnest($3::int[]) u",
            );
            run(
                conn,
                sql::query(&sql)
                    .bind(entity)
                    .bind(entity_ids)
                    .bind(user_ids),
            )
            .await
        }
        Dialect::Sqlite => {
            let users: Vec<i32> = sql::query_scalar(format!(
                "SELECT id FROM api_user WHERE {} ORDER BY id",
                sql::any_sql(Dialect::Sqlite, "id", 1)
            ))
            .bind(user_ids)
            .fetch_all(&mut *conn)
            .await?;
            // The Postgres `ORDER BY v.eid, v.uid` over the cross product.
            let mut eids = entity_ids.to_vec();
            eids.sort();
            let pairs: Vec<(String, i32)> = eids
                .iter()
                .flat_map(|e| users.iter().map(move |u| (e.clone(), *u)))
                .collect();
            insert_pairs(conn, entity, &pairs).await
        }
    }
}

/// `SetPhotosShared` un-share: `DeletionLog.objects.bulk_create` for every
/// selected photo, with no user-existence filter (an unknown
/// `target_user_id` fails the deferred foreign key at commit, as on Django).
pub async fn photos_unshared_bulk(
    conn: &mut Conn,
    photo_ids: &[Uuid],
    user_id: i32,
) -> sqlx::Result<u64> {
    if photo_ids.is_empty() {
        return Ok(0);
    }
    match conn.dialect() {
        Dialect::Pg => {
            run(
                conn,
                sql::query(
                    "INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) \
                     SELECT $1, x::text, $3, clock_timestamp() \
                     FROM unnest($2::uuid[]) WITH ORDINALITY AS t(x, n) ORDER BY n",
                )
                .bind(entity::PHOTO)
                .bind(photo_ids)
                .bind(user_id),
            )
            .await
        }
        Dialect::Sqlite => {
            let pairs: Vec<(String, i32)> = photo_ids
                .iter()
                .map(|id| (id.hyphenated().to_string(), user_id))
                .collect();
            insert_pairs(conn, entity::PHOTO, &pairs).await
        }
    }
}

/// `clear_tombstones`: a row just became visible again to `user_ids`, so a
/// stale tombstone must not shadow it on the next pull.
pub async fn clear(
    conn: &mut Conn,
    entity: &str,
    entity_ids: &[String],
    user_ids: &[i32],
) -> sqlx::Result<u64> {
    if entity_ids.is_empty() || user_ids.is_empty() {
        return Ok(0);
    }
    let d = conn.dialect();
    run(
        conn,
        sql::query(format!(
            "DELETE FROM api_deletionlog WHERE entity = $1 AND {} AND {}",
            sql::any_sql(d, "entity_id", 2),
            sql::any_sql(d, "owner_id", 3)
        ))
        .bind(entity)
        .bind(entity_ids)
        .bind(user_ids),
    )
    .await
}

/// `prune_deletion_log`: drop tombstones past the horizon; returns how many.
pub async fn prune(db: &Db) -> sqlx::Result<u64> {
    let cutoff = Utc::now() - Duration::days(PRUNE_HORIZON_DAYS);
    Ok(
        sql::query("DELETE FROM api_deletionlog WHERE deleted_at < $1")
            .bind(cutoff)
            .execute(db)
            .await?
            .rows_affected(),
    )
}

/// `str(uuid)` for each id: the `entity_id` of a photo tombstone.
pub fn uuid_ids(ids: &[Uuid]) -> Vec<String> {
    ids.iter().map(Uuid::to_string).collect()
}

/// `str(pk)` for integer primary keys.
pub fn int_ids(ids: &[i32]) -> Vec<String> {
    ids.iter().map(i32::to_string).collect()
}

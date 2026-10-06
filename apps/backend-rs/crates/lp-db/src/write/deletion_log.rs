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
//! `deleted_at` is `clock_timestamp()`, not `now()`: Django stamps each row
//! with `timezone.now()` when it is inserted, after any `last_modified` bump
//! of the same request, so a tombstone always sorts after the bumps it goes
//! with. `now()` (transaction start) would tie with them, and a client whose
//! cursor is that bump would never see the tombstone (`deleted_at > cursor`).
//!
//! Like `_write_tombstones`, rows are only written for users that exist.

use crate::db::{Conn, Db, Q};
use uuid::Uuid;

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

/// INSERT of the `(entity_id, owner_id)` pairs `pairs_sql` selects (columns
/// `eid text, uid int`; `$1` is the entity), skipping users that do not exist.
fn insert_sql(pairs_sql: &str) -> String {
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

/// Hard delete of photos `ids` (`post_delete` on `Photo`): one tombstone for
/// the owner and one for every `shared_to` user. Call before deleting.
pub async fn photos_deleted(conn: &mut Conn, ids: &[Uuid]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let sql = insert_sql(
        "SELECT p.id::text AS eid, p.owner_id AS uid FROM api_photo p WHERE p.id = ANY($2) \
         UNION SELECT s.photo_id::text, s.user_id FROM api_photo_shared_to s \
         WHERE s.photo_id = ANY($2)",
    );
    run(conn, crate::sql::query(&sql).bind(entity::PHOTO).bind(ids)).await
}

/// Hard delete of albums `ids` of one kind (`post_delete` on the album
/// model): tombstones for the owner and every `shared_to` user. Call before
/// deleting.
pub async fn albums_deleted(conn: &mut Conn, kind: AlbumKind, ids: &[i32]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let (album, through, fk) = kind.tables();
    let sql = insert_sql(&format!(
        "SELECT a.id::text AS eid, a.owner_id AS uid FROM {album} a WHERE a.id = ANY($2) \
         UNION SELECT s.{fk}::text, s.user_id FROM {through} s WHERE s.{fk} = ANY($2)"
    ));
    run(conn, crate::sql::query(&sql).bind(kind.entity()).bind(ids)).await
}

/// Hard delete of persons `ids` (`_person_tombstone`): only `USER`-kind
/// persons with a `cluster_owner` are mirrored, so only they get one. Call
/// before deleting.
pub async fn persons_deleted(conn: &mut Conn, ids: &[i32]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let sql = insert_sql(
        "SELECT p.id::text AS eid, p.cluster_owner_id AS uid FROM api_person p \
         WHERE p.id = ANY($2) AND p.kind = 'USER' AND p.cluster_owner_id IS NOT NULL",
    );
    run(conn, crate::sql::query(&sql).bind(entity::PERSON).bind(ids)).await
}

/// Hard delete of tags `ids`: one tombstone for the owner. Call before
/// deleting.
pub async fn tags_deleted(conn: &mut Conn, ids: &[i32]) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let sql = insert_sql(
        "SELECT t.id::text AS eid, t.owner_id AS uid FROM api_tag t WHERE t.id = ANY($2)",
    );
    run(conn, crate::sql::query(&sql).bind(entity::TAG).bind(ids)).await
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
    let sql =
        insert_sql("SELECT e AS eid, u AS uid FROM unnest($2::text[]) e, unnest($3::int[]) u");
    run(
        conn,
        crate::sql::query(&sql)
            .bind(entity)
            .bind(entity_ids)
            .bind(user_ids),
    )
    .await
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
    run(
        conn,
        crate::sql::query(
            "INSERT INTO api_deletionlog (entity, entity_id, owner_id, deleted_at) \
             SELECT $1, x::text, $3, clock_timestamp() FROM unnest($2::uuid[]) WITH ORDINALITY AS t(x, n) \
             ORDER BY n",
        )
        .bind(entity::PHOTO)
        .bind(photo_ids)
        .bind(user_id),
    )
    .await
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
    run(
        conn,
        crate::sql::query(
            "DELETE FROM api_deletionlog \
             WHERE entity = $1 AND entity_id = ANY($2) AND owner_id = ANY($3)",
        )
        .bind(entity)
        .bind(entity_ids)
        .bind(user_ids),
    )
    .await
}

/// `prune_deletion_log`: drop tombstones past the horizon; returns how many.
pub async fn prune(db: &Db) -> sqlx::Result<u64> {
    Ok(crate::sql::query(
        "DELETE FROM api_deletionlog WHERE deleted_at < now() - make_interval(days => $1)",
    )
    .bind(PRUNE_HORIZON_DAYS as i32)
    .execute(db)
    .await?
    .rows_affected())
}

/// `str(uuid)` for each id: the `entity_id` of a photo tombstone.
pub fn uuid_ids(ids: &[Uuid]) -> Vec<String> {
    ids.iter().map(Uuid::to_string).collect()
}

/// `str(pk)` for integer primary keys.
pub fn int_ids(ids: &[i32]) -> Vec<String> {
    ids.iter().map(i32::to_string).collect()
}

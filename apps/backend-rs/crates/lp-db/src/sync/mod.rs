//! Read queries of the mobile delta-sync feeds (`/api/sync/*`, Django
//! `api/views/sync.py`): keyset pages ordered by `(last_modified, id)`, the
//! seed totals, the per-page relations (album membership, covers, place
//! counts), the `DeletionLog` tombstones and the integrity counts.
//!
//! Scopes are Django's: photos and the four album kinds are
//! `Q(owner=user) | Q(shared_to=user)`, persons are the user's `USER`-kind
//! persons, tags are owned, and the sharing feed is every user on the other
//! side of a share with the viewer.
//!
//! Relations that Django reads without an `ORDER BY` (album membership, thing
//! covers) come back in Django's scan order: through-row id order on
//! Postgres (the heap order of a table that has not had rows deleted), and
//! `(album, photo_id)` on SQLite, where Django's `album_id IN (..)` reads
//! the covering unique `(album_id, photo_id)` index ([`through_order`]).

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::db::{Db, Dialect, DjUuid, DjUuidOpt, Qb, sql};
use crate::scope::owned_or_shared;
use crate::write::deletion_log::AlbumKind;

/// The id half of a keyset cursor, typed like the feed's primary key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorPk {
    Uuid(Uuid),
    Int(i64),
}

/// `(last_modified, id)` of the last row a client applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Keyset {
    pub last_modified: DateTime<Utc>,
    pub pk: CursorPk,
}

/// ` AND (a.last_modified > dt OR (a.last_modified = dt AND a.id > pk))`.
fn push_keyset(qb: &mut Qb<'_>, a: &str, keyset: Option<Keyset>) {
    let Some(k) = keyset else { return };
    qb.push(format!(" AND ({a}.last_modified > "));
    qb.push_bind(k.last_modified);
    qb.push(format!(" OR ({a}.last_modified = "));
    qb.push_bind(k.last_modified);
    qb.push(format!(" AND {a}.id > "));
    match k.pk {
        CursorPk::Uuid(u) => qb.push_bind(u),
        CursorPk::Int(i) => qb.push_bind(i),
    };
    qb.push("))");
}

fn push_page(qb: &mut Qb<'_>, a: &str, limit: i64) {
    qb.push(format!(" ORDER BY {a}.last_modified, {a}.id LIMIT "));
    qb.push_bind(limit);
}

// --------------------------------------------------------------------------
// Photos
// --------------------------------------------------------------------------

/// `PHOTO_VALUES` + `has_motion`.
#[derive(Debug, Clone, FromRow)]
pub struct PhotoRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub image_hash: String,
    pub owner_id: i32,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub timestamp: Option<DateTime<Utc>>,
    pub added_on: DateTime<Utc>,
    pub last_modified: DateTime<Utc>,
    pub video: bool,
    pub video_length: Option<String>,
    pub rating: i32,
    pub hidden: bool,
    pub in_trashcan: bool,
    pub removed: bool,
    pub public: bool,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub aspect_ratio: Option<f64>,
    pub dominant_color: Option<String>,
    pub search_location: Option<String>,
    pub favorite_min_rating: i32,
    pub has_motion: bool,
}

pub async fn photos_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<PhotoRow>> {
    let mut qb = Qb::new(
        "SELECT p.id, p.image_hash, p.owner_id, p.exif_timestamp, p.timestamp, p.added_on, \
         p.last_modified, p.video, p.video_length, p.rating, p.hidden, p.in_trashcan, \
         p.removed, p.public, p.exif_gps_lat, p.exif_gps_lon, t.aspect_ratio, \
         t.dominant_color, s.search_location, u.favorite_min_rating, \
         EXISTS (SELECT 1 FROM api_file_embedded_media em \
                 WHERE em.from_file_id = p.main_file_id) AS has_motion \
         FROM api_photo p \
         JOIN api_user u ON u.id = p.owner_id \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
         LEFT JOIN api_photo_search s ON s.photo_id = p.id \
         WHERE ",
    );
    owned_or_shared(&mut qb, "p", "api_photo_shared_to", "photo_id", user_id);
    push_keyset(&mut qb, "p", keyset);
    push_page(&mut qb, "p", limit);
    qb.build_query_as().fetch_all(db).await
}

pub async fn photos_total(db: &Db, user_id: i32) -> sqlx::Result<i64> {
    let mut qb = Qb::new("SELECT count(*) FROM api_photo p WHERE ");
    owned_or_shared(&mut qb, "p", "api_photo_shared_to", "photo_id", user_id);
    qb.build_query_scalar().fetch_one(db).await
}

// --------------------------------------------------------------------------
// Persons
// --------------------------------------------------------------------------

#[derive(Debug, Clone, FromRow)]
pub struct PersonRow {
    pub id: i32,
    pub name: String,
    pub kind: String,
    pub face_count: i32,
    pub cover_photo_hash: Option<String>,
    pub last_modified: DateTime<Utc>,
}

pub async fn persons_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<PersonRow>> {
    let mut qb = Qb::new(
        "SELECT pe.id, pe.name, pe.kind, pe.face_count, cp.image_hash AS cover_photo_hash, \
         pe.last_modified FROM api_person pe \
         LEFT JOIN api_photo cp ON cp.id = pe.cover_photo_id \
         WHERE pe.kind = 'USER' AND pe.cluster_owner_id = ",
    );
    qb.push_bind(user_id);
    push_keyset(&mut qb, "pe", keyset);
    push_page(&mut qb, "pe", limit);
    qb.build_query_as().fetch_all(db).await
}

pub async fn persons_total(db: &Db, user_id: i32) -> sqlx::Result<i64> {
    crate::sql::query_scalar(
        "SELECT count(*) FROM api_person WHERE kind = 'USER' AND cluster_owner_id = $1",
    )
    .bind(user_id)
    .fetch_one(db)
    .await
}

// --------------------------------------------------------------------------
// Albums
// --------------------------------------------------------------------------

#[derive(Debug, Clone, FromRow)]
pub struct UserAlbumRow {
    pub id: i32,
    pub title: String,
    pub owner_id: i32,
    pub favorited: bool,
    pub cover_photo_hash: Option<String>,
    pub created_on: DateTime<Utc>,
    pub last_modified: DateTime<Utc>,
}

pub async fn user_albums_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<UserAlbumRow>> {
    let mut qb = Qb::new(
        "SELECT a.id, a.title, a.owner_id, a.favorited, cp.image_hash AS cover_photo_hash, \
         a.created_on, a.last_modified FROM api_albumuser a \
         LEFT JOIN api_photo cp ON cp.id = a.cover_photo_id WHERE ",
    );
    owned_or_shared(
        &mut qb,
        "a",
        "api_albumuser_shared_to",
        "albumuser_id",
        user_id,
    );
    push_keyset(&mut qb, "a", keyset);
    push_page(&mut qb, "a", limit);
    qb.build_query_as().fetch_all(db).await
}

#[derive(Debug, Clone, FromRow)]
pub struct AutoAlbumRow {
    pub id: i32,
    pub title: String,
    pub timestamp: DateTime<Utc>,
    pub favorited: bool,
    pub last_modified: DateTime<Utc>,
}

pub async fn auto_albums_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<AutoAlbumRow>> {
    let mut qb = Qb::new(
        "SELECT a.id, a.title, a.timestamp, a.favorited, a.last_modified \
         FROM api_albumauto a WHERE ",
    );
    owned_or_shared(
        &mut qb,
        "a",
        "api_albumauto_shared_to",
        "albumauto_id",
        user_id,
    );
    push_keyset(&mut qb, "a", keyset);
    push_page(&mut qb, "a", limit);
    qb.build_query_as().fetch_all(db).await
}

/// A thing album (`photo_count` stored), a place album (`photo_count` filled
/// from membership, `geolocation_level` set) or a tag (`name` as `title`).
#[derive(Debug, Clone, FromRow)]
pub struct NamedAlbumRow {
    pub id: i32,
    pub title: String,
    pub photo_count: i64,
    pub geolocation_level: Option<i32>,
    pub last_modified: DateTime<Utc>,
}

pub async fn thing_albums_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<NamedAlbumRow>> {
    let mut qb = Qb::new(
        "SELECT a.id, a.title, CAST(a.photo_count AS bigint) AS photo_count, \
         CAST(NULL AS integer) AS geolocation_level, a.last_modified FROM api_albumthing a WHERE ",
    );
    owned_or_shared(
        &mut qb,
        "a",
        "api_albumthing_shared_to",
        "albumthing_id",
        user_id,
    );
    push_keyset(&mut qb, "a", keyset);
    push_page(&mut qb, "a", limit);
    qb.build_query_as().fetch_all(db).await
}

pub async fn place_albums_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<NamedAlbumRow>> {
    let mut qb = Qb::new(
        "SELECT a.id, a.title, \
         (SELECT count(m.photo_id) FROM api_albumplace_photos m WHERE m.albumplace_id = a.id) \
           AS photo_count, \
         a.geolocation_level, a.last_modified FROM api_albumplace a WHERE ",
    );
    owned_or_shared(
        &mut qb,
        "a",
        "api_albumplace_shared_to",
        "albumplace_id",
        user_id,
    );
    push_keyset(&mut qb, "a", keyset);
    push_page(&mut qb, "a", limit);
    qb.build_query_as().fetch_all(db).await
}

pub async fn tags_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<NamedAlbumRow>> {
    let mut qb = Qb::new(
        "SELECT t.id, t.name AS title, CAST(t.photo_count AS bigint) AS photo_count, \
         CAST(NULL AS integer) AS geolocation_level, t.last_modified FROM api_tag t WHERE t.owner_id = ",
    );
    qb.push_bind(user_id);
    push_keyset(&mut qb, "t", keyset);
    push_page(&mut qb, "t", limit);
    qb.build_query_as().fetch_all(db).await
}

pub async fn albums_total(db: &Db, kind: AlbumKind, user_id: i32) -> sqlx::Result<i64> {
    let (album, through, fk) = kind.tables();
    let mut qb = Qb::new(format!("SELECT count(*) FROM {album} a WHERE "));
    owned_or_shared(&mut qb, "a", through, fk, user_id);
    qb.build_query_scalar().fetch_one(db).await
}

pub async fn tags_total(db: &Db, user_id: i32) -> sqlx::Result<i64> {
    crate::sql::query_scalar("SELECT count(*) FROM api_tag WHERE owner_id = $1")
        .bind(user_id)
        .fetch_one(db)
        .await
}

/// Django's scan order of an M2M through table read with `fk IN (..)` and
/// no `ORDER BY`: row id (heap) order on Postgres, the covering unique
/// `(fk, photo_id)` index on SQLite. `t` is the table alias prefix (`"c."`).
fn through_order(d: Dialect, t: &str, fk: &str) -> String {
    match d {
        Dialect::Pg => format!("{t}id"),
        Dialect::Sqlite => format!("{t}{fk}, {t}photo_id"),
    }
}

/// `(album_id, photo_id)` membership rows of `album_ids` (user or auto
/// albums), in Django's scan order ([`through_order`]).
pub async fn album_members(
    db: &Db,
    kind: AlbumKind,
    album_ids: &[i32],
) -> sqlx::Result<Vec<(i32, Option<Uuid>)>> {
    let (table, fk) = match kind {
        AlbumKind::User => ("api_albumuser_photos", "albumuser_id"),
        AlbumKind::Auto => ("api_albumauto_photos", "albumauto_id"),
        AlbumKind::Thing => ("api_albumthing_photos", "albumthing_id"),
        AlbumKind::Place => ("api_albumplace_photos", "albumplace_id"),
    };
    if album_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(i32, DjUuidOpt)> = crate::sql::query_as(format!(
        "SELECT {fk}, photo_id FROM {table} WHERE {} ORDER BY {}",
        sql::any_sql(db.dialect(), fk, 1),
        through_order(db.dialect(), "", fk)
    ))
    .bind(album_ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|(a, p)| (a, p.0)).collect())
}

/// User albums among `album_ids` that are shared with anyone.
pub async fn user_albums_shared(db: &Db, album_ids: &[i32]) -> sqlx::Result<Vec<i32>> {
    if album_ids.is_empty() {
        return Ok(Vec::new());
    }
    crate::sql::query_scalar(format!(
        "SELECT DISTINCT albumuser_id FROM api_albumuser_shared_to WHERE {}",
        sql::any_sql(db.dialect(), "albumuser_id", 1)
    ))
    .bind(album_ids)
    .fetch_all(db)
    .await
}

/// `image_hash` of each photo in `ids`.
pub async fn photo_hashes(db: &Db, ids: &[Uuid]) -> sqlx::Result<Vec<(Uuid, String)>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(DjUuid, String)> = crate::sql::query_as(format!(
        "SELECT id, image_hash FROM api_photo WHERE {}",
        sql::any_sql(db.dialect(), "id", 1)
    ))
    .bind(ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|(id, h)| (id.0, h)).collect())
}

/// `(album_id, image_hash)` of the thing albums' cover photos, non-empty
/// hashes only, in Django's scan order ([`through_order`]).
pub async fn thing_covers(db: &Db, album_ids: &[i32]) -> sqlx::Result<Vec<(i32, String)>> {
    if album_ids.is_empty() {
        return Ok(Vec::new());
    }
    crate::sql::query_as(format!(
        "SELECT c.albumthing_id, p.image_hash FROM api_albumthing_cover_photos c \
         JOIN api_photo p ON p.id = c.photo_id \
         WHERE {} AND p.image_hash <> '' ORDER BY {}",
        sql::any_sql(db.dialect(), "c.albumthing_id", 1),
        through_order(db.dialect(), "c.", "albumthing_id")
    ))
    .bind(album_ids)
    .fetch_all(db)
    .await
}

// --------------------------------------------------------------------------
// Sharing surface
// --------------------------------------------------------------------------

/// Every user on the other side of a share with `$1`, either direction.
const RELEVANT_USERS: &str = "\
    SELECT st.user_id AS id FROM api_photo_shared_to st \
      JOIN api_photo p ON p.id = st.photo_id WHERE p.owner_id = $1 \
    UNION SELECT s.user_id FROM api_albumuser_shared_to s \
      JOIN api_albumuser a ON a.id = s.albumuser_id WHERE a.owner_id = $1 \
    UNION SELECT s.user_id FROM api_albumauto_shared_to s \
      JOIN api_albumauto a ON a.id = s.albumauto_id WHERE a.owner_id = $1 \
    UNION SELECT s.user_id FROM api_albumthing_shared_to s \
      JOIN api_albumthing a ON a.id = s.albumthing_id WHERE a.owner_id = $1 \
    UNION SELECT s.user_id FROM api_albumplace_shared_to s \
      JOIN api_albumplace a ON a.id = s.albumplace_id WHERE a.owner_id = $1 \
    UNION SELECT p.owner_id FROM api_photo p \
      JOIN api_photo_shared_to st ON st.photo_id = p.id WHERE st.user_id = $1 \
    UNION SELECT a.owner_id FROM api_albumuser a \
      JOIN api_albumuser_shared_to s ON s.albumuser_id = a.id WHERE s.user_id = $1 \
    UNION SELECT a.owner_id FROM api_albumauto a \
      JOIN api_albumauto_shared_to s ON s.albumauto_id = a.id WHERE s.user_id = $1 \
    UNION SELECT a.owner_id FROM api_albumthing a \
      JOIN api_albumthing_shared_to s ON s.albumthing_id = a.id WHERE s.user_id = $1 \
    UNION SELECT a.owner_id FROM api_albumplace a \
      JOIN api_albumplace_shared_to s ON s.albumplace_id = a.id WHERE s.user_id = $1";

#[derive(Debug, Clone, FromRow)]
pub struct SharedUserRow {
    pub id: i32,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
    pub avatar: Option<String>,
    pub last_modified: DateTime<Utc>,
}

pub async fn shared_users_page(
    db: &Db,
    user_id: i32,
    keyset: Option<Keyset>,
    limit: i64,
) -> sqlx::Result<Vec<SharedUserRow>> {
    let mut qb = Qb::new("WITH rel AS (");
    // RELEVANT_USERS binds `$1`: the first bind below.
    qb.push(RELEVANT_USERS);
    qb.push(
        ") SELECT u.id, u.username, u.first_name, u.last_name, u.avatar, u.last_modified \
         FROM api_user u WHERE u.id IN (SELECT id FROM rel) AND u.id <> ",
    );
    qb.push_bind(user_id);
    push_keyset(&mut qb, "u", keyset);
    push_page(&mut qb, "u", limit);
    qb.build_query_as().fetch_all(db).await
}

pub async fn shared_users_total(db: &Db, user_id: i32) -> sqlx::Result<i64> {
    crate::sql::query_scalar(format!(
        "WITH rel AS ({RELEVANT_USERS}) SELECT count(*) FROM api_user u \
         WHERE u.id IN (SELECT id FROM rel) AND u.id <> $1"
    ))
    .bind(user_id)
    .fetch_one(db)
    .await
}

// --------------------------------------------------------------------------
// Tombstones and counts
// --------------------------------------------------------------------------

/// `DeletionLog` entity ids for `user` written after `since`.
pub async fn tombstones(
    db: &Db,
    user_id: i32,
    entity: &str,
    since: DateTime<Utc>,
) -> sqlx::Result<Vec<String>> {
    crate::sql::query_scalar(
        "SELECT entity_id FROM api_deletionlog \
         WHERE owner_id = $1 AND entity = $2 AND deleted_at > $3",
    )
    .bind(user_id)
    .bind(entity)
    .bind(since)
    .fetch_all(db)
    .await
}

/// `SyncCountsView`.
#[derive(Debug, Clone, FromRow)]
pub struct Counts {
    pub photos: i64,
    pub persons: i64,
    pub user_albums: i64,
    pub auto_albums: i64,
    pub thing_albums: i64,
    pub place_albums: i64,
    pub tags: i64,
}

pub async fn counts(db: &Db, user_id: i32) -> sqlx::Result<Counts> {
    let mut qb = Qb::new("SELECT (SELECT count(*) FROM api_photo p WHERE ");
    owned_or_shared(&mut qb, "p", "api_photo_shared_to", "photo_id", user_id);
    qb.push(
        ") AS photos, (SELECT count(*) FROM api_person pe \
         WHERE pe.kind = 'USER' AND pe.cluster_owner_id = ",
    );
    qb.push_bind(user_id);
    qb.push(") AS persons");
    for (kind, name) in [
        (AlbumKind::User, "user_albums"),
        (AlbumKind::Auto, "auto_albums"),
        (AlbumKind::Thing, "thing_albums"),
        (AlbumKind::Place, "place_albums"),
    ] {
        let (album, through, fk) = kind.tables();
        qb.push(format!(", (SELECT count(*) FROM {album} a WHERE "));
        owned_or_shared(&mut qb, "a", through, fk, user_id);
        qb.push(format!(") AS {name}"));
    }
    qb.push(", (SELECT count(*) FROM api_tag t WHERE t.owner_id = ");
    qb.push_bind(user_id);
    qb.push(") AS tags");
    qb.build_query_as().fetch_one(db).await
}

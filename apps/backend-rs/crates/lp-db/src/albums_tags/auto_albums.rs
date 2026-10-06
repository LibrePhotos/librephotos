//! `AlbumAuto` (event album) reads.

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use sqlx::types::Json;
use uuid::Uuid;

use super::things_places::{HasTotal, fetch_paged};
use super::{Paged, photo_hash_json};
use crate::db::{DjUuid, Exec, Qb};
use crate::scope;

/// `AlbumAutoListSerializer` row.
#[derive(Debug, Clone, FromRow)]
pub struct AutoAlbumListRow {
    pub id: i32,
    pub title: String,
    pub timestamp: DateTime<Utc>,
    /// `{image_hash, video}` of one non-hidden photo.
    pub cover: Option<Json<serde_json::Value>>,
    pub photo_count: i64,
    pub favorited: bool,
    pub total_count: i64,
}

impl HasTotal for AutoAlbumListRow {
    fn total(&self) -> i64 {
        self.total_count
    }
}

pub async fn list<'e, E>(
    db: E,
    owner_id: i32,
    search: &[String],
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<AutoAlbumListRow>>
where
    E: Exec<'e> + Copy,
{
    let build = |limit: i64, offset: i64| {
        let mut qb = Qb::new(format!(
            "SELECT *, count(*) OVER () AS total_count FROM ( \
               SELECT a.id, a.title, a.timestamp, a.favorited, \
                 (SELECT count(DISTINCT p.id) FROM api_albumauto_photos l \
                    JOIN api_photo p ON p.id = l.photo_id \
                    WHERE l.albumauto_id = a.id AND NOT p.hidden) AS photo_count, \
                 (SELECT {ph} FROM api_albumauto_photos l JOIN api_photo cp ON cp.id = l.photo_id \
                    WHERE l.albumauto_id = a.id AND NOT cp.hidden ORDER BY l.id LIMIT 1) AS cover \
               FROM api_albumauto a WHERE a.owner_id = ",
            ph = photo_hash_json("cp"),
        ));
        qb.push_bind(owner_id);
        // `photos__search_instance__search_captions/location`, `photos__faces__person__name`.
        for term in search {
            let pattern = format!("%{}%", scope::like_escape(term));
            qb.push(
                " AND EXISTS (SELECT 1 FROM api_albumauto_photos sl \
                       LEFT JOIN api_photo_search ss ON ss.photo_id = sl.photo_id \
                       WHERE sl.albumauto_id = a.id AND (ss.search_captions ILIKE ",
            );
            qb.push_bind(pattern.clone());
            qb.push(" OR ss.search_location ILIKE ");
            qb.push_bind(pattern.clone());
            qb.push(
                " OR EXISTS (SELECT 1 FROM api_face sf JOIN api_person sp ON sp.id = sf.person_id \
                       WHERE sf.photo_id = sl.photo_id AND sp.name ILIKE ",
            );
            qb.push_bind(pattern);
            qb.push(")))");
        }
        qb.push(") x WHERE x.photo_count > 0 ORDER BY x.timestamp DESC, x.id LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);
        qb
    };
    fetch_paged(db, build, limit, offset).await
}

/// `AlbumAutoSerializer` header.
#[derive(Debug, Clone, FromRow)]
pub struct AutoAlbumRow {
    pub id: i32,
    pub title: String,
    pub favorited: bool,
    pub timestamp: DateTime<Utc>,
    pub created_on: DateTime<Utc>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
}

/// The owner's auto album `id` if it holds any photo (the viewset's queryset).
pub async fn detail<'e>(
    db: impl Exec<'e>,
    id: i32,
    owner_id: i32,
) -> sqlx::Result<Option<AutoAlbumRow>> {
    crate::sql::query_as(
        "SELECT a.id, a.title, a.favorited, a.timestamp, a.created_on, a.gps_lat, a.gps_lon \
         FROM api_albumauto a WHERE a.id = $1 AND a.owner_id = $2 \
           AND EXISTS (SELECT 1 FROM api_albumauto_photos l \
             JOIN api_photo p ON p.id = l.photo_id WHERE l.albumauto_id = a.id)",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
}

/// `PhotoSimpleSerializer` row.
#[derive(Debug, Clone, FromRow)]
pub struct PhotoSimpleRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub square_thumbnail: Option<String>,
    pub image_hash: String,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub rating: i32,
    pub geolocation_json: Option<serde_json::Value>,
    pub public: bool,
    pub video: bool,
}

/// The album's `Photo.visible` members, oldest first (Django's prefetch is
/// unordered: whatever its join plan yields).
pub async fn photos<'e>(db: impl Exec<'e>, album_id: i32) -> sqlx::Result<Vec<PhotoSimpleRow>> {
    crate::sql::query_as(format!(
        "SELECT p.id, t.square_thumbnail, p.image_hash, p.exif_timestamp, p.exif_gps_lat, \
           p.exif_gps_lon, p.rating, p.geolocation_json, p.public, p.video \
         FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
         WHERE l.albumauto_id = $1 AND {} ORDER BY p.exif_timestamp, p.id",
        visible_manager_sql()
    ))
    .bind(album_id)
    .fetch_all(db)
    .await
}

fn visible_manager_sql() -> String {
    let mut qb = Qb::new("");
    scope::visible_manager(&mut qb, "p");
    qb.sql().to_string()
}

/// `PersonSerializer` for the people on the album's visible photos, first
/// appearance first (photos, then their faces, in heap order like Django's
/// unordered prefetches).
#[derive(Debug, Clone, FromRow)]
pub struct AlbumPersonRow {
    pub id: i32,
    pub name: String,
    pub face_count: i32,
    pub cover_face_image: Option<String>,
    pub cover_photo_hash: Option<String>,
    pub cover_photo_video: Option<bool>,
    pub first_face_image: Option<String>,
    pub first_face_photo_hash: Option<String>,
    pub first_face_photo_video: Option<bool>,
    pub has_cover_face: bool,
    pub has_cover_photo: bool,
    pub has_first_face: bool,
}

pub async fn people<'e>(db: impl Exec<'e>, album_id: i32) -> sqlx::Result<Vec<AlbumPersonRow>> {
    crate::sql::query_as(format!(
        "WITH seen AS ( \
           SELECT o.person_id, min(o.rn) AS ord FROM ( \
             SELECT f.person_id, row_number() OVER (ORDER BY p.ctid, f.ctid) AS rn \
           FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id \
           JOIN api_face f ON f.photo_id = p.id \
           WHERE l.albumauto_id = $1 AND {vis} AND NOT f.deleted AND f.person_id IS NOT NULL) o \
           GROUP BY o.person_id) \
         SELECT pe.id, pe.name, pe.face_count, \
           cf.image AS cover_face_image, cph.image_hash AS cover_photo_hash, cph.video AS cover_photo_video, \
           ff.image AS first_face_image, ffp.image_hash AS first_face_photo_hash, \
           ffp.video AS first_face_photo_video, \
           (cf.id IS NOT NULL) AS has_cover_face, (cph.id IS NOT NULL) AS has_cover_photo, \
           (ff.id IS NOT NULL) AS has_first_face \
         FROM seen JOIN api_person pe ON pe.id = seen.person_id \
         LEFT JOIN api_face cf ON cf.id = pe.cover_face_id \
         LEFT JOIN api_photo cph ON cph.id = pe.cover_photo_id \
         LEFT JOIN LATERAL (SELECT f2.id, f2.image, f2.photo_id FROM api_face f2 \
           WHERE f2.person_id = pe.id ORDER BY f2.id LIMIT 1) ff ON TRUE \
         LEFT JOIN api_photo ffp ON ffp.id = ff.photo_id \
         ORDER BY seen.ord",
        vis = visible_manager_sql()
    ))
    .bind(album_id)
    .fetch_all(db)
    .await
}

/// Owner's auto album ids holding at least one photo (what DELETE may hit).
pub async fn deletable<'e>(db: impl Exec<'e>, id: i32, owner_id: i32) -> sqlx::Result<bool> {
    Ok(detail(db, id, owner_id).await?.is_some())
}

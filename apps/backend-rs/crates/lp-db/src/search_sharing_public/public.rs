//! Anonymous public reads: album shares by slug (api/views/public_albums.py)
//! and photo shares by slug (api/views/public_photos.py).

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::types::Json;
use sqlx::{FromRow, PgExecutor};
use uuid::Uuid;

use crate::pig::{self, PigPhoto};

/// An enabled, unexpired album share with its album and owner.
#[derive(Debug, Clone, FromRow)]
pub struct PublicAlbum {
    pub id: i32,
    pub title: String,
    pub owner_id: i32,
    pub owner_username: String,
    pub owner_first_name: String,
    pub owner_last_name: String,
    pub owner_sharing_defaults: Option<Json<Value>>,
    pub share_location: Option<bool>,
    pub share_camera_info: Option<bool>,
    pub share_timestamps: Option<bool>,
    pub share_captions: Option<bool>,
    pub share_faces: Option<bool>,
}

pub async fn active_album<'e>(
    db: impl PgExecutor<'e>,
    slug: &str,
) -> sqlx::Result<Option<PublicAlbum>> {
    sqlx::query_as(
        "SELECT a.id, a.title, u.id AS owner_id, u.username AS owner_username, \
         u.first_name AS owner_first_name, u.last_name AS owner_last_name, \
         u.public_sharing_defaults AS owner_sharing_defaults, \
         s.share_location, s.share_camera_info, s.share_timestamps, s.share_captions, s.share_faces \
         FROM api_albumusershare s JOIN api_albumuser a ON a.id = s.album_id \
         JOIN api_user u ON u.id = a.owner_id \
         WHERE s.enabled AND s.slug = $1 AND (s.expires_at IS NULL OR s.expires_at >= now()) \
         ORDER BY a.id LIMIT 1",
    )
    .bind(slug)
    .fetch_optional(db)
    .await
}

/// The album's photos a visitor may see (not hidden, not in the trash; Django
/// does not check `removed` or the owner here), newest first.
pub async fn album_photos<'e>(
    db: impl PgExecutor<'e>,
    album_id: i32,
) -> sqlx::Result<Vec<PigPhoto>> {
    let mut qb = pig::query();
    qb.push(
        " WHERE EXISTS (SELECT 1 FROM api_albumuser_photos ap WHERE ap.photo_id = p.id AND ap.albumuser_id = ",
    );
    qb.push_bind(album_id);
    qb.push(") AND NOT p.hidden AND NOT p.in_trashcan ORDER BY p.exif_timestamp DESC, p.id");
    pig::fetch(&mut qb, db).await
}

/// `album.photos.filter(pk=… | image_hash=…, hidden=False, in_trashcan=False).first()`.
pub async fn album_photo<'e>(
    db: impl PgExecutor<'e>,
    album_id: i32,
    id: Option<Uuid>,
    image_hash: Option<&str>,
) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(
        "SELECT p.id FROM api_albumuser_photos ap JOIN api_photo p ON p.id = ap.photo_id \
         WHERE ap.albumuser_id = $1 AND NOT p.hidden AND NOT p.in_trashcan \
         AND (p.id = $2 OR p.image_hash = $3) ORDER BY p.id LIMIT 1",
    )
    .bind(album_id)
    .bind(id)
    .bind(image_hash)
    .fetch_optional(db)
    .await
}

/// An enabled photo share whose photo is not hidden, trashed or removed.
#[derive(Debug, Clone, FromRow)]
pub struct ActivePhotoShare {
    pub slug: String,
    pub photo_id: Uuid,
    pub owner_sharing_defaults: Option<Json<Value>>,
}

pub async fn active_photo_share<'e>(
    db: impl PgExecutor<'e>,
    slug: &str,
) -> sqlx::Result<Option<ActivePhotoShare>> {
    sqlx::query_as(
        "SELECT s.slug, s.photo_id, u.public_sharing_defaults AS owner_sharing_defaults \
         FROM api_photoshare s JOIN api_photo p ON p.id = s.photo_id JOIN api_user u ON u.id = p.owner_id \
         WHERE s.enabled AND s.slug = $1 AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed \
         ORDER BY s.id LIMIT 1",
    )
    .bind(slug)
    .fetch_optional(db)
    .await
}

/// Everything `PublicPhotoDetailSerializer` reads, in one row.
#[derive(Debug, Clone, FromRow)]
pub struct PublicPhotoRow {
    pub id: Uuid,
    pub image_hash: String,
    pub video: bool,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub geolocation_json: Option<Json<Value>>,
    pub has_thumbnail: bool,
    pub thumbnail_big: Option<String>,
    pub square_thumbnail: Option<String>,
    pub square_thumbnail_small: Option<String>,
    pub has_search: bool,
    pub search_location: Option<String>,
    pub search_captions: Option<String>,
    pub captions_json: Option<Json<Value>>,
    pub has_metadata: bool,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub focal_length: Option<f64>,
    pub aperture: Option<f64>,
    pub iso: Option<i32>,
    pub shutter_speed: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

pub async fn public_photo<'e>(
    db: impl PgExecutor<'e>,
    id: Uuid,
) -> sqlx::Result<Option<PublicPhotoRow>> {
    sqlx::query_as(
        "SELECT p.id, p.image_hash, p.video, p.exif_timestamp, p.exif_gps_lat, p.exif_gps_lon, \
         p.geolocation_json, \
         (t.photo_id IS NOT NULL) AS has_thumbnail, t.thumbnail_big, t.square_thumbnail, t.square_thumbnail_small, \
         (s.photo_id IS NOT NULL) AS has_search, s.search_location, s.search_captions, \
         c.captions_json, \
         (m.photo_id IS NOT NULL) AS has_metadata, m.camera_make, m.camera_model, m.lens_make, m.lens_model, \
         m.focal_length, m.aperture, m.iso, m.shutter_speed, m.width, m.height \
         FROM api_photo p \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
         LEFT JOIN api_photo_search s ON s.photo_id = p.id \
         LEFT JOIN api_photo_caption c ON c.photo_id = p.id \
         LEFT JOIN api_photometadata m ON m.photo_id = p.id \
         WHERE p.id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await
}

/// A face of a public photo: not deleted, with a person or a cluster person.
#[derive(Debug, Clone, FromRow)]
pub struct PublicFace {
    pub id: i32,
    pub image: Option<String>,
    pub name: String,
}

pub async fn public_faces<'e>(
    db: impl PgExecutor<'e>,
    photo_id: Uuid,
) -> sqlx::Result<Vec<PublicFace>> {
    sqlx::query_as(
        "SELECT f.id, f.image, COALESCE(pp.name, cp.name) AS name FROM api_face f \
         LEFT JOIN api_person pp ON pp.id = f.person_id \
         LEFT JOIN api_person cp ON cp.id = f.cluster_person_id \
         WHERE f.photo_id = $1 AND NOT f.deleted AND (pp.id IS NOT NULL OR cp.id IS NOT NULL) \
         ORDER BY f.id",
    )
    .bind(photo_id)
    .fetch_all(db)
    .await
}

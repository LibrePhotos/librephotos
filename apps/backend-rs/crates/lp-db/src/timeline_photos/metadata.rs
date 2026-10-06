//! `PhotoMetadataViewSet`: the photo lookup and `PhotoMetadataSerializer`'s rows.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use super::PhotoLookup;
use crate::db::{DjUuid, Exec, Qb};
use crate::scope;

#[derive(Debug, Clone, FromRow)]
pub struct MetadataPhoto {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub owner_id: i32,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub rating: i32,
}

/// `_get_photo`: staff look among all photos, everyone else among their own.
/// With several matches (a hash shared by photos) the first by id.
pub async fn find_photo<'e>(
    db: impl Exec<'e>,
    lookup: &PhotoLookup,
    user_id: i32,
    is_staff: bool,
) -> sqlx::Result<Option<MetadataPhoto>> {
    let mut qb: Qb<'_> = Qb::new(
        "SELECT p.id, p.owner_id, p.exif_timestamp, p.exif_gps_lat, p.exif_gps_lon, p.rating \
         FROM api_photo p WHERE ",
    );
    lookup.push(&mut qb, "p");
    if !is_staff {
        qb.push(" AND ");
        scope::owned_by(&mut qb, "p", user_id);
    }
    qb.push(" ORDER BY p.id LIMIT 1");
    qb.build_query_as().fetch_optional(db).await
}

/// Every column `PhotoMetadataSerializer` renders.
#[derive(Debug, Clone, FromRow)]
pub struct MetadataRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    #[sqlx(try_from = "DjUuid")]
    pub photo_id: Uuid,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub shutter_speed_seconds: Option<f64>,
    pub iso: Option<i32>,
    pub focal_length: Option<f64>,
    pub focal_length_35mm: Option<i32>,
    pub exposure_compensation: Option<f64>,
    pub flash_fired: Option<bool>,
    pub metering_mode: Option<String>,
    pub white_balance: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub serial_number: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub orientation: Option<i32>,
    pub color_space: Option<String>,
    pub bit_depth: Option<i32>,
    pub date_taken: Option<DateTime<Utc>>,
    pub date_taken_subsec: Option<String>,
    pub date_modified: Option<DateTime<Utc>>,
    pub timezone_offset: Option<String>,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub gps_altitude: Option<f64>,
    pub location_country: Option<String>,
    pub location_state: Option<String>,
    pub location_city: Option<String>,
    pub location_address: Option<String>,
    pub title: Option<String>,
    pub caption: Option<String>,
    pub keywords: Option<Value>,
    pub rating: Option<i32>,
    pub copyright: Option<String>,
    pub creator: Option<String>,
    pub source: String,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub const METADATA_COLUMNS: &str = "id, photo_id, aperture, shutter_speed, shutter_speed_seconds, iso, \
    focal_length, focal_length_35mm, exposure_compensation, flash_fired, metering_mode, white_balance, \
    camera_make, camera_model, lens_make, lens_model, serial_number, width, height, orientation, \
    color_space, bit_depth, date_taken, date_taken_subsec, date_modified, timezone_offset, \
    gps_latitude, gps_longitude, gps_altitude, location_country, location_state, location_city, \
    location_address, title, caption, keywords, rating, copyright, creator, source, version, \
    created_at, updated_at";

pub async fn by_photo<'e>(db: impl Exec<'e>, photo_id: Uuid) -> sqlx::Result<Option<MetadataRow>> {
    crate::sql::query_as(format!(
        "SELECT {METADATA_COLUMNS} FROM api_photometadata WHERE photo_id = $1"
    ))
    .bind(photo_id)
    .fetch_optional(db)
    .await
}

#[derive(Debug, Clone, FromRow)]
pub struct EditRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub field_name: String,
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
    pub user_id: i32,
    pub user_name: Option<String>,
    pub synced_to_file: bool,
    pub synced_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// The 10 most recent edits (`-created_at, -id`).
pub async fn recent_edits<'e>(db: impl Exec<'e>, photo_id: Uuid) -> sqlx::Result<Vec<EditRow>> {
    crate::sql::query_as(
        "SELECT e.id, e.field_name, e.old_value, e.new_value, e.user_id, u.username AS user_name, \
         e.synced_to_file, e.synced_at, e.created_at \
         FROM api_metadataedit e LEFT JOIN api_user u ON u.id = e.user_id \
         WHERE e.photo_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 10",
    )
    .bind(photo_id)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow)]
pub struct SidecarRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub file_type: String,
    pub source: String,
    pub priority: i32,
    pub creator_software: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `MetadataFile` rows of the photo (`-priority, -updated_at`).
pub async fn sidecar_files<'e>(db: impl Exec<'e>, photo_id: Uuid) -> sqlx::Result<Vec<SidecarRow>> {
    crate::sql::query_as(
        "SELECT id, file_type, source, priority, creator_software, created_at, updated_at \
         FROM api_metadatafile WHERE photo_id = $1 ORDER BY priority DESC, updated_at DESC, id",
    )
    .bind(photo_id)
    .fetch_all(db)
    .await
}

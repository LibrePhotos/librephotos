//! `api_user` reads. Creation/updates live in [`crate::write::users`].

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;

use crate::db::Exec;

/// Every `api_user` column except the encrypted `nextcloud_app_password`
/// (decrypt that with `lp_core::django_crypto` when needed).
#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: i32,
    pub password: String,
    pub last_login: Option<DateTime<Utc>>,
    pub is_superuser: bool,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub is_staff: bool,
    pub is_active: bool,
    pub date_joined: DateTime<Utc>,
    pub scan_directory: String,
    pub avatar: Option<String>,
    pub nextcloud_server_address: String,
    pub nextcloud_username: String,
    pub nextcloud_scan_directory: String,
    pub confidence: f64,
    pub semantic_search_topk: i32,
    pub favorite_min_rating: i32,
    pub image_scale: f64,
    pub save_metadata_to_disk: String,
    pub transcode_videos: bool,
    /// Stored double-encoded by Django (a JSON string holding a JSON list).
    pub datetime_rules: serde_json::Value,
    pub default_timezone: String,
    pub confidence_person: f64,
    pub public_sharing: bool,
    pub confidence_unknown_face: f64,
    pub face_recognition_model: String,
    pub min_cluster_size: i32,
    pub cluster_selection_epsilon: f64,
    pub min_samples: i32,
    pub llm_settings: serde_json::Value,
    pub text_alignment: String,
    pub header_size: String,
    pub skip_raw_files: bool,
    pub slideshow_interval: i32,
    pub duplicate_clear_existing: bool,
    pub duplicate_sensitivity: String,
    pub burst_detection_rules: serde_json::Value,
    pub stack_raw_jpeg: bool,
    pub public_sharing_defaults: serde_json::Value,
    pub save_face_tags_to_disk: bool,
    pub last_modified: DateTime<Utc>,
}

pub const USER_COLUMNS: &str = "id, password, last_login, is_superuser, username, first_name, \
    last_name, email, is_staff, is_active, date_joined, scan_directory, avatar, \
    nextcloud_server_address, nextcloud_username, nextcloud_scan_directory, confidence, \
    semantic_search_topk, favorite_min_rating, image_scale, save_metadata_to_disk, \
    transcode_videos, datetime_rules, default_timezone, confidence_person, public_sharing, \
    confidence_unknown_face, face_recognition_model, min_cluster_size, cluster_selection_epsilon, \
    min_samples, llm_settings, text_alignment, header_size, skip_raw_files, slideshow_interval, \
    duplicate_clear_existing, duplicate_sensitivity, burst_detection_rules, stack_raw_jpeg, \
    public_sharing_defaults, save_face_tags_to_disk, last_modified";

impl User {
    /// DRF `IsAdminUser` checks `is_staff`; the JWT `is_admin` claim is `is_superuser`.
    pub fn is_admin(&self) -> bool {
        self.is_staff
    }

    /// Django's `get_username()`.
    pub fn simple(&self) -> SimpleUser {
        SimpleUser {
            id: self.id,
            username: self.username.clone(),
            first_name: self.first_name.clone(),
            last_name: self.last_name.clone(),
        }
    }
}

/// `SimpleUserSerializer` (`api/serializers/simple.py`), zod `SimpleUser`.
#[derive(Debug, Clone, Serialize, FromRow, PartialEq, Eq)]
pub struct SimpleUser {
    pub id: i32,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
}

pub async fn by_id<'e>(db: impl Exec<'e>, id: i32) -> sqlx::Result<Option<User>> {
    crate::sql::query_as::<_, User>(&format!(
        "SELECT {USER_COLUMNS} FROM api_user WHERE id = $1"
    ))
    .bind(id)
    .fetch_optional(db)
    .await
}

/// Active user by id (what simplejwt's `JWTAuthentication.get_user` accepts).
pub async fn active_by_id<'e>(db: impl Exec<'e>, id: i32) -> sqlx::Result<Option<User>> {
    crate::sql::query_as::<_, User>(&format!(
        "SELECT {USER_COLUMNS} FROM api_user WHERE id = $1 AND is_active"
    ))
    .bind(id)
    .fetch_optional(db)
    .await
}

/// Exact, case-sensitive username match (Django `get_by_natural_key`).
pub async fn by_username<'e>(db: impl Exec<'e>, username: &str) -> sqlx::Result<Option<User>> {
    crate::sql::query_as::<_, User>(&format!(
        "SELECT {USER_COLUMNS} FROM api_user WHERE username = $1"
    ))
    .bind(username)
    .fetch_optional(db)
    .await
}

pub async fn is_active<'e>(db: impl Exec<'e>, id: i32) -> sqlx::Result<bool> {
    crate::sql::query_scalar("SELECT EXISTS (SELECT 1 FROM api_user WHERE id = $1 AND is_active)")
        .bind(id)
        .fetch_one(db)
        .await
}

pub async fn count<'e>(db: impl Exec<'e>) -> sqlx::Result<i64> {
    crate::sql::query_scalar("SELECT count(*) FROM api_user")
        .fetch_one(db)
        .await
}

/// Whether a refresh token id was blacklisted (Rust's `refresh_token` table).
pub async fn refresh_revoked<'e>(db: impl Exec<'e>, jti: &str) -> sqlx::Result<bool> {
    crate::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM refresh_token WHERE jti = $1 AND revoked_at IS NOT NULL)",
    )
    .bind(jti)
    .fetch_one(db)
    .await
}

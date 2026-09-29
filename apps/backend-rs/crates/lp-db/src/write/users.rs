//! User creation with Django's model defaults.

use chrono::Utc;
use lp_core::django_crypto::DjangoCrypto;
use sqlx::PgExecutor;

/// `settings.DEFAULT_FAVORITE_MIN_RATING`.
pub const DEFAULT_FAVORITE_MIN_RATING: i32 = 4;

pub struct NewUser<'a> {
    pub username: &'a str,
    pub email: &'a str,
    /// Already hashed in Django format (`lp_auth::password::hash`).
    pub password_hash: &'a str,
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub is_superuser: bool,
    pub is_staff: bool,
    pub scan_directory: &'a str,
}

fn json_default(text: &str) -> serde_json::Value {
    serde_json::from_str(text).expect("bundled default JSON is valid")
}

/// The JSON-field defaults exactly as Django writes them (captured from a
/// Django-created user; `datetime_rules` really is a double-encoded string).
pub fn default_datetime_rules() -> serde_json::Value {
    json_default(include_str!("../users_defaults/datetime_rules.json"))
}
pub fn default_llm_settings() -> serde_json::Value {
    json_default(include_str!("../users_defaults/llm_settings.json"))
}
pub fn default_burst_detection_rules() -> serde_json::Value {
    json_default(include_str!("../users_defaults/burst_detection_rules.json"))
}
pub fn default_public_sharing_defaults() -> serde_json::Value {
    json_default(include_str!(
        "../users_defaults/public_sharing_defaults.json"
    ))
}

/// Insert a user with every Django default filled in; returns the new id.
/// `nextcloud_app_password` gets a Django-decryptable encryption of "".
pub async fn create_user<'e>(
    db: impl PgExecutor<'e>,
    crypto: &DjangoCrypto,
    new: &NewUser<'_>,
) -> sqlx::Result<i32> {
    let now = Utc::now();
    sqlx::query_scalar(
        "INSERT INTO api_user (password, last_login, is_superuser, username, first_name, last_name, \
           email, is_staff, is_active, date_joined, scan_directory, avatar, nextcloud_server_address, \
           nextcloud_username, nextcloud_app_password, nextcloud_scan_directory, confidence, \
           semantic_search_topk, favorite_min_rating, image_scale, save_metadata_to_disk, \
           transcode_videos, datetime_rules, default_timezone, confidence_person, public_sharing, \
           confidence_unknown_face, face_recognition_model, min_cluster_size, \
           cluster_selection_epsilon, min_samples, llm_settings, text_alignment, header_size, \
           skip_raw_files, slideshow_interval, duplicate_clear_existing, duplicate_sensitivity, \
           burst_detection_rules, stack_raw_jpeg, public_sharing_defaults, save_face_tags_to_disk, \
           last_modified) \
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, NULL, '', '', $10, '', 0.1, 0, $11, \
           1, 'OFF', FALSE, $12, 'UTC', 0.9, FALSE, 0.5, 'HOG', 0, 0.05, 1, $13, 'right', 'large', \
           FALSE, 5, FALSE, 'normal', $14, TRUE, $15, FALSE, $8) \
         RETURNING id",
    )
    .bind(new.password_hash)
    .bind(new.is_superuser)
    .bind(new.username)
    .bind(new.first_name)
    .bind(new.last_name)
    .bind(new.email)
    .bind(new.is_staff)
    .bind(now)
    .bind(new.scan_directory)
    .bind(crypto.encrypt_str(""))
    .bind(DEFAULT_FAVORITE_MIN_RATING)
    .bind(default_datetime_rules())
    .bind(default_llm_settings())
    .bind(default_burst_detection_rules())
    .bind(default_public_sharing_defaults())
    .fetch_one(db)
    .await
}

pub async fn set_password<'e>(
    db: impl PgExecutor<'e>,
    user_id: i32,
    password_hash: &str,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE api_user SET password = $2, last_modified = now() WHERE id = $1")
        .bind(user_id)
        .bind(password_hash)
        .execute(db)
        .await?;
    Ok(())
}

//! `UserSerializer`, `PublicUserSerializer`, `ManageUserSerializer` and
//! `SignupUserSerializer` output, in their `Meta.fields` order.

use axum::http::HeaderMap;
use lp_core::time::drf_datetime;
use lp_db::users::User;
use lp_db::users_settings::{PublicPhotoSample, UserPhotoStats};
use serde_json::{Value, json};

const MEDIA_URL: &str = "/media/";

/// `urllib.parse.quote(path, safe="/~!*()'")` (Django `filepath_to_uri`).
const URI_SET: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'/')
    .remove(b'~')
    .remove(b'!')
    .remove(b'*')
    .remove(b'(')
    .remove(b')')
    .remove(b'\'')
    .remove(b'_')
    .remove(b'.')
    .remove(b'-');

/// `obj.avatar.url`, or None without an avatar.
pub fn avatar_url(avatar: Option<&str>) -> Option<String> {
    let name = avatar.filter(|a| !a.is_empty())?;
    Some(format!(
        "{MEDIA_URL}{}",
        percent_encoding::utf8_percent_encode(&name.replace('\\', "/"), URI_SET)
    ))
}

/// `request.build_absolute_uri("")` origin, as DRF's `ImageField` uses it.
pub fn request_origin(headers: &HeaderMap) -> String {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost");
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|h| h.to_str().ok())
        .filter(|s| *s == "https")
        .unwrap_or("http");
    format!("{scheme}://{host}")
}

fn samples(s: &[PublicPhotoSample]) -> Value {
    Value::Array(
        s.iter()
            .map(|p| {
                json!({
                    "image_hash": p.image_hash,
                    "rating": p.rating,
                    "hidden": p.hidden,
                    "exif_timestamp": p.exif_timestamp.as_ref().map(drf_datetime),
                    "public": p.public,
                    "video": p.video,
                })
            })
            .collect(),
    )
}

/// `UserSerializer` (the full profile: admins and the user themself).
pub fn full(u: &User, stats: &UserPhotoStats, origin: &str) -> Value {
    let url = avatar_url(u.avatar.as_deref());
    json!({
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "scan_directory": u.scan_directory,
        "confidence": u.confidence,
        "confidence_person": u.confidence_person,
        "transcode_videos": u.transcode_videos,
        "semantic_search_topk": u.semantic_search_topk,
        "first_name": u.first_name,
        "public_photo_samples": samples(&stats.public_photo_samples),
        "last_name": u.last_name,
        "public_photo_count": stats.public_photo_count,
        "date_joined": drf_datetime(&u.date_joined),
        "avatar": url.as_ref().map(|p| format!("{origin}{p}")),
        "is_superuser": u.is_superuser,
        "photo_count": stats.photo_count,
        "nextcloud_server_address": u.nextcloud_server_address,
        "nextcloud_username": u.nextcloud_username,
        "nextcloud_scan_directory": u.nextcloud_scan_directory,
        "avatar_url": url,
        "favorite_min_rating": u.favorite_min_rating,
        "image_scale": u.image_scale,
        "text_alignment": u.text_alignment,
        "header_size": u.header_size,
        "save_metadata_to_disk": u.save_metadata_to_disk,
        "save_face_tags_to_disk": u.save_face_tags_to_disk,
        "datetime_rules": u.datetime_rules,
        "burst_detection_rules": u.burst_detection_rules,
        "llm_settings": u.llm_settings,
        "default_timezone": u.default_timezone,
        "public_sharing": u.public_sharing,
        "public_sharing_defaults": u.public_sharing_defaults,
        "min_cluster_size": u.min_cluster_size,
        "confidence_unknown_face": u.confidence_unknown_face,
        "min_samples": u.min_samples,
        "cluster_selection_epsilon": u.cluster_selection_epsilon,
        "skip_raw_files": u.skip_raw_files,
        "stack_raw_jpeg": u.stack_raw_jpeg,
        "slideshow_interval": u.slideshow_interval,
        "duplicate_sensitivity": u.duplicate_sensitivity,
        "duplicate_clear_existing": u.duplicate_clear_existing,
    })
}

/// `PublicUserSerializer` (everyone else).
pub fn public(u: &User, stats: &UserPhotoStats) -> Value {
    json!({
        "id": u.id,
        "avatar_url": avatar_url(u.avatar.as_deref()),
        "username": u.username,
        "first_name": u.first_name,
        "last_name": u.last_name,
        "public_photo_count": stats.public_photo_count,
        "public_photo_samples": samples(&stats.public_photo_samples),
        "public_sharing": u.public_sharing,
    })
}

/// `ManageUserSerializer`.
pub fn manage(u: &User, photo_count: i64) -> Value {
    json!({
        "username": u.username,
        "scan_directory": u.scan_directory,
        "skip_raw_files": u.skip_raw_files,
        "stack_raw_jpeg": u.stack_raw_jpeg,
        "confidence": u.confidence,
        "semantic_search_topk": u.semantic_search_topk,
        "last_login": u.last_login.as_ref().map(drf_datetime),
        "date_joined": drf_datetime(&u.date_joined),
        "photo_count": photo_count,
        "id": u.id,
        "favorite_min_rating": u.favorite_min_rating,
        "image_scale": u.image_scale,
        "save_metadata_to_disk": u.save_metadata_to_disk,
        "email": u.email,
        "first_name": u.first_name,
        "last_name": u.last_name,
    })
}

/// `SignupUserSerializer` (password and is_superuser are write-only).
pub fn signup(u: &User) -> Value {
    json!({
        "username": u.username,
        "email": u.email,
        "first_name": u.first_name,
        "last_name": u.last_name,
    })
}

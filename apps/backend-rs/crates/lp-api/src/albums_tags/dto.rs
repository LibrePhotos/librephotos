//! Response shapes, in Django serializer field order.

use chrono::{DateTime, Utc};
use lp_core::QueryMap;
use lp_core::time::drf_datetime;
use lp_db::albums_tags::things_places::MediaFilter;
use lp_db::albums_tags::user_albums::UserAlbumListRow;
use lp_db::pig::{self, PigPhoto};
use serde::Serialize;
use serde_json::{Value, json};

/// `filter_photos_by_media_type` reads `video`, then `photo` (not
/// `is_screenshot`, which album details ignore).
pub fn media_filter(q: &QueryMap) -> MediaFilter {
    if q.flag("video") {
        MediaFilter::Videos
    } else if q.flag("photo") {
        MediaFilter::Photos
    } else {
        MediaFilter::All
    }
}

/// `GroupedPhotosSerializer`: `{date, location, items}`; `date` is null for
/// the single undated group of a public album without timestamps.
#[derive(Debug, Serialize)]
pub struct Group {
    pub date: Option<String>,
    pub location: String,
    pub items: Vec<PigPhoto>,
}

pub fn grouped(photos: Vec<PigPhoto>) -> Vec<Group> {
    pig::group_by_date(photos)
        .into_iter()
        .map(|g| Group {
            date: Some(g.date),
            location: g.location,
            items: g.items,
        })
        .collect()
}

/// `PhotoSuperSimpleSerializer`, or its `get_initial()` dict for no photo.
pub fn photo_super_simple(r: &UserAlbumListRow) -> Value {
    match &r.cover_image_hash {
        Some(hash) => json!({
            "image_hash": hash,
            "rating": r.cover_rating,
            "hidden": r.cover_hidden.unwrap_or(false),
            "exif_timestamp": r.cover_exif_timestamp.as_ref().map(drf_datetime),
            "public": r.cover_public.unwrap_or(false),
            "video": r.cover_video.unwrap_or(false),
        }),
        None => json!({
            "image_hash": "",
            "rating": null,
            "hidden": false,
            "exif_timestamp": null,
            "public": false,
            "video": false,
        }),
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SharingOptions {
    pub share_location: Option<bool>,
    pub share_camera_info: Option<bool>,
    pub share_timestamps: Option<bool>,
    pub share_captions: Option<bool>,
    pub share_faces: Option<bool>,
}

/// `AlbumUserListSerializer`.
#[derive(Debug, Serialize)]
pub struct UserAlbumListItem {
    pub id: i32,
    pub cover_photo: Value,
    #[serde(serialize_with = "lp_core::time::ser_drf")]
    pub created_on: DateTime<Utc>,
    pub favorited: bool,
    pub title: String,
    pub shared_to: Value,
    pub owner: Value,
    pub photo_count: i64,
    pub public: bool,
    pub public_slug: String,
    #[serde(serialize_with = "lp_core::time::ser_drf_opt")]
    pub public_expires_at: Option<DateTime<Utc>>,
    pub public_sharing_options: Option<SharingOptions>,
}

impl From<UserAlbumListRow> for UserAlbumListItem {
    fn from(r: UserAlbumListRow) -> Self {
        let cover_photo = photo_super_simple(&r);
        let has_share = r.share_id.is_some();
        UserAlbumListItem {
            id: r.id,
            cover_photo,
            created_on: r.created_on,
            favorited: r.favorited,
            title: r.title,
            shared_to: r.shared_to.0,
            owner: r.owner.0,
            photo_count: r.photo_count,
            public: has_share && r.share_enabled.unwrap_or(false),
            public_slug: r.share_slug.unwrap_or_default(),
            public_expires_at: r.share_expires_at,
            public_sharing_options: has_share.then_some(SharingOptions {
                share_location: r.share_location,
                share_camera_info: r.share_camera_info,
                share_timestamps: r.share_timestamps,
                share_captions: r.share_captions,
                share_faces: r.share_faces,
            }),
        }
    }
}

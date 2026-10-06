//! Reads for media serving (`lp-media`): the photo a media URL names, with
//! every grant `api/views/media.py` checks, in one query per request.

use sqlx::FromRow;
use uuid::Uuid;

use crate::db::{DjUuid, Exec};
use crate::scope::{PhotoGrants, has_thumbnail_sql, photo_grants_select};

/// A photo as the media views need it, plus the requester's grants on it.
#[derive(Debug, Clone, FromRow)]
pub struct MediaPhoto {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub owner_id: i32,
    pub image_hash: String,
    pub video: bool,
    pub video_length: Option<String>,
    /// `photo.main_file.path` (absolute, as the scanner stored it).
    pub main_file_path: Option<String>,
    /// `Thumbnail` FileField names relative to `MEDIA_ROOT`; NULL without a
    /// thumbnail row, `""` when the field was never populated.
    pub thumbnail_big: Option<String>,
    pub square_thumbnail: Option<String>,
    pub square_thumbnail_small: Option<String>,
    /// The owner's scan directory: one of the roots originals may be served from.
    pub owner_scan_directory: String,
    pub is_owner: bool,
    pub shared_directly: bool,
    pub album_shared_to_user: bool,
    pub in_public_album: bool,
    pub is_public_photo: bool,
}

impl MediaPhoto {
    pub fn grants(&self) -> PhotoGrants {
        PhotoGrants {
            is_owner: self.is_owner,
            shared_directly: self.shared_directly,
            album_shared_to_user: self.album_shared_to_user,
            in_public_album: self.in_public_album,
            is_public_photo: self.is_public_photo,
        }
    }
}

const COLUMNS: &str = "p.id, p.owner_id, p.image_hash, p.video, p.video_length, \
    f.path AS main_file_path, th.thumbnail_big, th.square_thumbnail, th.square_thumbnail_small, \
    u.scan_directory AS owner_scan_directory";

const FROM: &str = "FROM api_photo p \
    JOIN api_user u ON u.id = p.owner_id \
    LEFT JOIN api_file f ON f.hash = p.main_file_id \
    LEFT JOIN api_thumbnail th ON th.photo_id = p.id";

fn select_with_grants(user_param: &str) -> String {
    format!(
        "SELECT {COLUMNS}, {} {FROM}",
        photo_grants_select("p", user_param)
    )
}

/// Every photo carrying `image_hash` (two users scanning the same file can
/// share one), each with `user`'s grants. Unordered, like Django's
/// `Photo.objects.filter(image_hash=...)`.
pub async fn photos_by_hash<'e>(
    db: impl Exec<'e>,
    image_hash: &str,
    user_id: Option<i32>,
) -> sqlx::Result<Vec<MediaPhoto>> {
    crate::sql::query_as::<_, MediaPhoto>(&format!(
        "{} WHERE p.image_hash = $1",
        select_with_grants("$2")
    ))
    .bind(image_hash)
    .bind(user_id)
    .fetch_all(db)
    .await
}

/// The photo with primary key `id`, with `user`'s grants.
pub async fn photo_by_id<'e>(
    db: impl Exec<'e>,
    id: Uuid,
    user_id: Option<i32>,
) -> sqlx::Result<Option<MediaPhoto>> {
    crate::sql::query_as::<_, MediaPhoto>(&format!("{} WHERE p.id = $1", select_with_grants("$2")))
        .bind(id)
        .bind(user_id)
        .fetch_optional(db)
        .await
}

/// How `embedded_media` addresses its photo.
#[derive(Debug, Clone, Copy)]
pub enum PhotoKey<'a> {
    Id(Uuid),
    Hash(&'a str),
}

#[derive(FromRow)]
struct PathRow {
    path: Option<String>,
}

/// Path of the first embedded file (by `File` pk) of the first photo (by
/// pk) matching `key` among the owner's photos, or among public photos for
/// an anonymous requester. `Some(None)` = the photo exists but embeds nothing.
///
/// "Public" is `Photo.visible.visible_to(None)`, as for every other media
/// kind; Django's bare `public=True` here kept serving the motion video of a
/// public photo after it was hidden, trashed or removed.
pub async fn embedded_media_path<'e>(
    db: impl Exec<'e>,
    key: PhotoKey<'_>,
    user_id: Option<i32>,
) -> sqlx::Result<Option<Option<String>>> {
    let scope = match user_id {
        None => format!(
            "(p.public AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed AND {})",
            has_thumbnail_sql("p")
        ),
        Some(_) => "p.owner_id = $2".to_string(),
    };
    let key_sql = match key {
        PhotoKey::Id(_) => "p.id = $1",
        PhotoKey::Hash(_) => "p.image_hash = $1",
    };
    let sql = format!(
        "SELECT (SELECT ef.path FROM api_file_embedded_media em \
           JOIN api_file ef ON ef.hash = em.to_file_id \
           WHERE em.from_file_id = p.main_file_id ORDER BY ef.hash LIMIT 1) AS path \
         FROM api_photo p WHERE {key_sql} AND {scope} ORDER BY p.id LIMIT 1"
    );
    let q = crate::sql::query_as::<_, PathRow>(&sql);
    let q = match key {
        PhotoKey::Id(id) => q.bind(id),
        PhotoKey::Hash(h) => q.bind(h.to_string()),
    };
    let q = match user_id {
        Some(uid) => q.bind(uid),
        None => q,
    };
    Ok(q.fetch_optional(db).await?.map(|r| r.path))
}

/// The photo behind an enabled photo share `slug` (`active_photo_share`):
/// NULL once the photo is hidden, trashed or removed. No grants apply; the
/// slug is the grant.
pub async fn photo_for_share<'e>(
    db: impl Exec<'e>,
    slug: &str,
) -> sqlx::Result<Option<MediaPhoto>> {
    crate::sql::query_as::<_, MediaPhoto>(&format!(
        "SELECT {COLUMNS}, FALSE AS is_owner, FALSE AS shared_directly, \
           FALSE AS album_shared_to_user, FALSE AS in_public_album, FALSE AS is_public_photo \
         FROM api_photoshare s JOIN api_photo p ON p.id = s.photo_id \
           JOIN api_user u ON u.id = p.owner_id \
           LEFT JOIN api_file f ON f.hash = p.main_file_id \
           LEFT JOIN api_thumbnail th ON th.photo_id = p.id \
         WHERE s.enabled AND s.slug = $1 \
           AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed \
         ORDER BY s.id LIMIT 1"
    ))
    .bind(slug)
    .fetch_optional(db)
    .await
}

/// `main_file.path` of the first photo (by pk) matching `key`, for the
/// admin diagnostics view. `Some(None)` = a photo whose file was detached.
pub async fn main_file_path<'e>(
    db: impl Exec<'e>,
    key: PhotoKey<'_>,
) -> sqlx::Result<Option<Option<String>>> {
    let q = match key {
        PhotoKey::Id(id) => crate::sql::query_as::<_, PathRow>(
            "SELECT f.path FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id \
             WHERE p.id = $1 ORDER BY p.id LIMIT 1",
        )
        .bind(id),
        PhotoKey::Hash(h) => crate::sql::query_as::<_, PathRow>(
            "SELECT f.path FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id \
             WHERE p.image_hash = $1 ORDER BY p.id LIMIT 1",
        )
        .bind(h.to_string()),
    };
    Ok(q.fetch_optional(db).await?.map(|r| r.path))
}

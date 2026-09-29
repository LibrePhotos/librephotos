//! Read queries and row types for the `photo_edits` area (owned by that area).

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgExecutor, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::scope;

/// `_get_photo_filter_kwargs`: a 36-char, 4-hyphen UUID is a pk, anything
/// else an `image_hash`.
pub fn lookup_uuid(lookup: &str) -> Option<Uuid> {
    if lookup.len() == 36 && lookup.matches('-').count() == 4 {
        Uuid::parse_str(lookup).ok()
    } else {
        None
    }
}

/// The `PhotoEditSerializer` columns plus what the edit services need.
#[derive(Debug, Clone, FromRow)]
pub struct EditPhoto {
    pub id: Uuid,
    pub image_hash: String,
    pub owner_id: i32,
    pub hidden: bool,
    pub rating: i32,
    pub in_trashcan: bool,
    pub removed: bool,
    pub video: bool,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub timestamp: Option<DateTime<Utc>>,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub is_screenshot: bool,
    pub is_document: bool,
    pub category_source: String,
    pub main_file_path: Option<String>,
}

const EDIT_COLUMNS: &str = "p.id, p.image_hash, p.owner_id, p.hidden, p.rating, p.in_trashcan, \
    p.removed, p.video, p.exif_timestamp, p.\"timestamp\", p.exif_gps_lat, p.exif_gps_lon, \
    p.is_screenshot, p.is_document, p.category_source, mf.path AS main_file_path";

fn push_lookup(qb: &mut QueryBuilder<'_, Postgres>, lookup: &str) {
    match lookup_uuid(lookup) {
        Some(id) => {
            qb.push("p.id = ");
            qb.push_bind(id);
        }
        None => {
            qb.push("p.image_hash = ");
            qb.push_bind(lookup.to_string());
        }
    }
}

/// `PhotoEditViewSet.get_object`: `Photo.visible.owned_by(user)` by pk or
/// hash, `.first()` (= lowest pk).
pub async fn edit_target<'e>(
    db: impl PgExecutor<'e>,
    user_id: i32,
    lookup: &str,
) -> sqlx::Result<Option<EditPhoto>> {
    let mut qb = QueryBuilder::new(format!(
        "SELECT {EDIT_COLUMNS} FROM api_photo p LEFT JOIN api_file mf ON mf.hash = p.main_file_id WHERE "
    ));
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(" AND ");
    scope::visible_manager(&mut qb, "p");
    qb.push(" AND ");
    push_lookup(&mut qb, lookup);
    qb.push(" ORDER BY p.id LIMIT 1");
    qb.build_query_as::<EditPhoto>().fetch_optional(db).await
}

pub async fn edit_photo_by_id<'e>(
    db: impl PgExecutor<'e>,
    id: Uuid,
) -> sqlx::Result<Option<EditPhoto>> {
    sqlx::query_as::<_, EditPhoto>(&format!(
        "SELECT {EDIT_COLUMNS} FROM api_photo p LEFT JOIN api_file mf ON mf.hash = p.main_file_id \
         WHERE p.id = $1"
    ))
    .bind(id)
    .fetch_optional(db)
    .await
}

/// A photo of the requester's, as the caption/rotate/share views find it.
#[derive(Debug, Clone, FromRow)]
pub struct OwnedPhoto {
    pub id: Uuid,
    pub image_hash: String,
    pub video: bool,
    pub local_orientation: i32,
    pub last_modified: DateTime<Utc>,
    /// `None` when the photo has no thumbnail row at all.
    pub thumbnail_big: Option<String>,
    pub has_thumbnail_row: bool,
}

const OWNED_COLUMNS: &str = "p.id, p.image_hash, p.video, p.local_orientation, p.last_modified, \
    t.thumbnail_big, (t.photo_id IS NOT NULL) AS has_thumbnail_row";

/// `Photo.objects.owned_by(user).filter(image_hash=h).first()`.
pub async fn owned_by_hash<'e>(
    db: impl PgExecutor<'e>,
    user_id: i32,
    image_hash: &str,
) -> sqlx::Result<Option<OwnedPhoto>> {
    sqlx::query_as::<_, OwnedPhoto>(&format!(
        "SELECT {OWNED_COLUMNS} FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
         WHERE p.owner_id = $1 AND p.image_hash = $2 ORDER BY p.id LIMIT 1"
    ))
    .bind(user_id)
    .bind(image_hash)
    .fetch_optional(db)
    .await
}

/// `public_photos._owned_photo`: a UUID pk first, then an image hash.
pub async fn owned_by_id_or_hash<'e>(
    db: impl PgExecutor<'e> + Copy,
    user_id: i32,
    photo_id: &str,
) -> sqlx::Result<Option<OwnedPhoto>> {
    if let Ok(pk) = Uuid::parse_str(photo_id) {
        let found = sqlx::query_as::<_, OwnedPhoto>(&format!(
            "SELECT {OWNED_COLUMNS} FROM api_photo p LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
             WHERE p.owner_id = $1 AND p.id = $2"
        ))
        .bind(user_id)
        .bind(pk)
        .fetch_optional(db)
        .await?;
        if found.is_some() {
            return Ok(found);
        }
    }
    owned_by_hash(db, user_id, photo_id).await
}

/// One `PhotoShare` row joined to its photo's hash.
#[derive(Debug, Clone, FromRow)]
pub struct ShareRow {
    pub id: i32,
    pub enabled: bool,
    pub slug: Option<String>,
    pub created_at: DateTime<Utc>,
    pub photo_id: Uuid,
    pub image_hash: String,
}

/// `PhotoShareList`: the requester's active photo shares, newest first.
pub async fn active_shares<'e>(
    db: impl PgExecutor<'e>,
    user_id: i32,
) -> sqlx::Result<Vec<ShareRow>> {
    sqlx::query_as::<_, ShareRow>(
        "SELECT s.id, s.enabled, s.slug, s.created_at, s.photo_id, p.image_hash \
         FROM api_photoshare s JOIN api_photo p ON p.id = s.photo_id \
         WHERE p.owner_id = $1 AND s.enabled AND s.slug IS NOT NULL \
         ORDER BY s.created_at DESC, s.id DESC",
    )
    .bind(user_id)
    .fetch_all(db)
    .await
}

pub async fn share_for_photo<'e>(
    db: impl PgExecutor<'e>,
    photo_id: Uuid,
) -> sqlx::Result<Option<ShareRow>> {
    sqlx::query_as::<_, ShareRow>(
        "SELECT s.id, s.enabled, s.slug, s.created_at, s.photo_id, p.image_hash \
         FROM api_photoshare s JOIN api_photo p ON p.id = s.photo_id WHERE s.photo_id = $1",
    )
    .bind(photo_id)
    .fetch_optional(db)
    .await
}

/// What the captioning prompt may know about a photo (`_caption_context`).
#[derive(Debug, Clone, FromRow)]
pub struct CaptionContext {
    pub person_name: Option<String>,
    pub search_location: Option<String>,
}

pub async fn caption_context<'e>(
    db: impl PgExecutor<'e>,
    photo_id: Uuid,
) -> sqlx::Result<CaptionContext> {
    sqlx::query_as::<_, CaptionContext>(
        "SELECT (SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id \
                  WHERE f.photo_id = $1 ORDER BY f.id LIMIT 1) AS person_name, \
                (SELECT s.search_location FROM api_photo_search s WHERE s.photo_id = $1) AS search_location",
    )
    .bind(photo_id)
    .fetch_one(db)
    .await
}

/// Raw `captions_json` of a photo (None = no row or SQL NULL).
pub async fn captions_json<'e>(
    db: impl PgExecutor<'e>,
    photo_id: Uuid,
) -> sqlx::Result<Option<Value>> {
    Ok(sqlx::query_scalar::<_, Option<Value>>(
        "SELECT captions_json FROM api_photo_caption WHERE photo_id = $1",
    )
    .bind(photo_id)
    .fetch_optional(db)
    .await?
    .flatten())
}

/// Ids of `build_photo_queryset(user, query)` minus `excluded_hashes`.
pub async fn select_all_ids(
    conn: &mut sqlx::PgConnection,
    user_id: i32,
    favorite_min_rating: i32,
    params: &scope::PhotoFilterParams,
    excluded_hashes: &[String],
) -> sqlx::Result<Vec<Uuid>> {
    let mut qb = QueryBuilder::new("SELECT p.id FROM api_photo p WHERE ");
    crate::write::photo_edits::bulk::push_select_all(
        &mut qb,
        user_id,
        favorite_min_rating,
        params,
        excluded_hashes,
    );
    qb.push(" ORDER BY p.id");
    qb.build_query_scalar().fetch_all(&mut *conn).await
}

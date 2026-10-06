//! `PhotoViewSet.retrieve` (`PhotoSerializer`) and `PhotoViewSet.albums`.
//!
//! The detail is one row: scalar columns plus JSON aggregates for faces,
//! files, direct shares, embedded media and stacks (with their photos).

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use sqlx::FromRow;
use sqlx::types::Json;
use uuid::Uuid;

use super::PhotoLookup;
use crate::db::{DjUuid, Exec, Qb};
use crate::pig::VALID_STACK_TYPES_SQL;
use crate::scope;

#[derive(Debug, Clone, Deserialize)]
pub struct FaceJson {
    pub id: i32,
    pub image: Option<String>,
    pub person: Option<String>,
    pub cluster_person: Option<String>,
    pub classification_person: Option<String>,
    pub cluster_probability: f64,
    pub classification_probability: f64,
    pub top: i32,
    pub bottom: i32,
    pub left: i32,
    pub right: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileJson {
    pub hash: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EmbeddedJson {
    pub hash: String,
    #[serde(rename = "type")]
    pub kind: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StackPhotoJson {
    pub id: Uuid,
    pub image_hash: String,
    pub has_thumbnail: bool,
    pub size: i64,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StackJson {
    pub id: Uuid,
    pub stack_type: String,
    pub primary_photo_id: Option<Uuid>,
    pub photos: Option<Vec<StackPhotoJson>>,
}

#[derive(Debug, Clone, FromRow)]
pub struct PhotoDetailRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub geolocation_json: Option<Value>,
    pub image_hash: String,
    pub rating: i32,
    pub hidden: bool,
    pub public: bool,
    pub removed: bool,
    pub in_trashcan: bool,
    pub video: bool,
    pub size: i64,
    pub local_orientation: i32,
    pub main_file_id: Option<String>,
    pub clip_embeddings: Option<Value>,
    /// The model of `clip_embeddings` (NULL = ViT-B/32, see
    /// `lp_ml::clip::SemanticModel::stored`).
    pub clip_embeddings_model: Option<String>,
    pub owner_id: i32,
    pub owner_username: String,
    pub owner_first_name: String,
    pub owner_last_name: String,
    pub captions_json: Option<Value>,
    pub search_captions: String,
    pub search_location: String,
    pub thumbnail_big: String,
    pub square_thumbnail: String,
    pub square_thumbnail_small: String,
    pub has_metadata: bool,
    pub md_width: Option<i32>,
    pub md_height: Option<i32>,
    pub md_focal_length: Option<f64>,
    pub md_aperture: Option<f64>,
    pub md_iso: Option<i32>,
    pub md_shutter_speed: Option<String>,
    pub md_camera_make: Option<String>,
    pub md_camera_model: Option<String>,
    pub md_lens_make: Option<String>,
    pub md_lens_model: Option<String>,
    pub md_focal_length_35mm: Option<i32>,
    pub md_date_taken: Option<DateTime<Utc>>,
    pub md_gps_latitude: Option<f64>,
    pub md_gps_longitude: Option<f64>,
    pub md_rating: Option<i32>,
    pub md_source: Option<String>,
    pub md_version: Option<i32>,
    pub has_edits: bool,
    pub has_ocr: bool,
    pub ocr_text: Option<String>,
    pub ocr_blocks: Option<Value>,
    pub ocr_source_width: Option<i32>,
    pub ocr_source_height: Option<i32>,
    pub people: Option<Json<Vec<FaceJson>>>,
    pub files: Option<Json<Vec<FileJson>>>,
    pub shared_to: Option<Json<Vec<i32>>>,
    pub embedded: Option<Json<Vec<EmbeddedJson>>>,
    pub stacks: Option<Json<Vec<StackJson>>>,
}

const DETAIL_SELECT: &str = "SELECT p.id, p.exif_gps_lat, p.exif_gps_lon, p.exif_timestamp, p.geolocation_json, \
    p.image_hash, p.rating, p.hidden, p.public, p.removed, p.in_trashcan, p.video, p.size, \
    p.local_orientation, p.main_file_id, p.clip_embeddings, p.clip_embeddings_model, \
    u.id AS owner_id, u.username AS owner_username, u.first_name AS owner_first_name, \
    u.last_name AS owner_last_name, \
    cap.captions_json, COALESCE(s.search_captions, '') AS search_captions, \
    COALESCE(s.search_location, '') AS search_location, \
    t.thumbnail_big, t.square_thumbnail, t.square_thumbnail_small, \
    (md.id IS NOT NULL) AS has_metadata, md.width AS md_width, md.height AS md_height, \
    md.focal_length AS md_focal_length, md.aperture AS md_aperture, md.iso AS md_iso, \
    md.shutter_speed AS md_shutter_speed, md.camera_make AS md_camera_make, \
    md.camera_model AS md_camera_model, md.lens_make AS md_lens_make, md.lens_model AS md_lens_model, \
    md.focal_length_35mm AS md_focal_length_35mm, md.date_taken AS md_date_taken, \
    md.gps_latitude AS md_gps_latitude, md.gps_longitude AS md_gps_longitude, md.rating AS md_rating, \
    md.source AS md_source, md.version AS md_version, \
    EXISTS (SELECT 1 FROM api_metadataedit me WHERE me.photo_id = p.id) AS has_edits, \
    (o.photo_id IS NOT NULL) AS has_ocr, o.text AS ocr_text, o.blocks AS ocr_blocks, \
    o.source_width AS ocr_source_width, o.source_height AS ocr_source_height, \
    (SELECT json_agg(json_build_object('id', f.id, 'image', f.image, \
        'person', CASE WHEN f.person_id IS NOT NULL THEN COALESCE(fp.name, '') END, \
        'cluster_person', CASE WHEN f.cluster_person_id IS NOT NULL THEN COALESCE(fc.name, '') END, \
        'classification_person', CASE WHEN f.classification_person_id IS NOT NULL THEN COALESCE(fl.name, '') END, \
        'cluster_probability', f.cluster_probability, \
        'classification_probability', f.classification_probability, \
        'top', f.location_top, 'bottom', f.location_bottom, 'left', f.location_left, \
        'right', f.location_right) ORDER BY f.id) \
      FROM api_face f LEFT JOIN api_person fp ON fp.id = f.person_id \
      LEFT JOIN api_person fc ON fc.id = f.cluster_person_id \
      LEFT JOIN api_person fl ON fl.id = f.classification_person_id \
      WHERE f.photo_id = p.id AND NOT f.deleted) AS people, \
    (SELECT json_agg(json_build_object('hash', fi.hash, 'path', fi.path, 'type', fi.type) ORDER BY pf.id) \
      FROM api_photo_files pf JOIN api_file fi ON fi.hash = pf.file_id WHERE pf.photo_id = p.id) AS files, \
    (SELECT json_agg(st.user_id ORDER BY st.id) FROM api_photo_shared_to st WHERE st.photo_id = p.id) AS shared_to, \
    (SELECT json_agg(json_build_object('hash', ef.hash, 'type', ef.type) ORDER BY em.id) \
      FROM api_file_embedded_media em JOIN api_file ef ON ef.hash = em.to_file_id \
      WHERE em.from_file_id = p.main_file_id AND ef.type IN (1, 2)) AS embedded, ";

fn stacks_sql() -> String {
    format!(
        "(SELECT json_agg(json_build_object('id', sk.id, 'stack_type', sk.stack_type, \
            'primary_photo_id', sk.primary_photo_id, \
            'photos', (SELECT json_agg(json_build_object('id', sp.id, 'image_hash', sp.image_hash, \
                  'has_thumbnail', COALESCE(sth.square_thumbnail_small, '') <> '', 'size', sp.size, \
                  'width', COALESCE(smd.width, 0), 'height', COALESCE(smd.height, 0)) ORDER BY sps.id) \
                FROM api_photo_stacks sps JOIN api_photo sp ON sp.id = sps.photo_id \
                LEFT JOIN api_thumbnail sth ON sth.photo_id = sp.id \
                LEFT JOIN api_photometadata smd ON smd.photo_id = sp.id \
                WHERE sps.photostack_id = sk.id)) ORDER BY sk.created_at DESC, sk.id) \
          FROM api_photo_stacks ps JOIN api_photostack sk ON sk.id = ps.photostack_id \
          WHERE ps.photo_id = p.id AND sk.stack_type IN {VALID_STACK_TYPES_SQL}) AS stacks"
    )
}

/// `Photo.visible.visible_to(viewer)` looked up by id or hash; the first by
/// `-exif_timestamp` when several photos share a hash.
pub async fn photo_detail<'e>(
    db: impl Exec<'e>,
    lookup: &PhotoLookup,
    viewer: Option<i32>,
) -> sqlx::Result<Option<PhotoDetailRow>> {
    let mut qb: Qb<'_> = Qb::new(DETAIL_SELECT);
    qb.push(stacks_sql());
    qb.push(
        " FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         JOIN api_thumbnail t ON t.photo_id = p.id \
         LEFT JOIN api_photo_caption cap ON cap.photo_id = p.id \
         LEFT JOIN api_photo_search s ON s.photo_id = p.id \
         LEFT JOIN api_photometadata md ON md.photo_id = p.id \
         LEFT JOIN api_photo_ocr o ON o.photo_id = p.id WHERE ",
    );
    lookup.push(&mut qb, "p");
    qb.push(" AND ");
    scope::visible_manager(&mut qb, "p");
    qb.push(" AND ");
    scope::visible_to(&mut qb, "p", viewer);
    qb.push(" ORDER BY p.exif_timestamp DESC, p.id LIMIT 1");
    qb.build_query_as().fetch_optional(db).await
}

#[derive(Debug, Clone, FromRow)]
pub struct SimilarRow {
    pub image_hash: String,
    pub video: bool,
}

/// Of `owner`'s photos with one of `hashes`, those `viewer` may see.
pub async fn visible_owner_photos_by_hash<'e>(
    db: impl Exec<'e>,
    owner_id: i32,
    viewer: Option<i32>,
    hashes: &[String],
) -> sqlx::Result<Vec<SimilarRow>> {
    let mut qb: Qb<'_> = Qb::new("SELECT p.image_hash, p.video FROM api_photo p WHERE ");
    scope::owned_by(&mut qb, "p", owner_id);
    qb.push(" AND ");
    scope::visible_to(&mut qb, "p", viewer);
    qb.push(" AND p.image_hash = ANY(");
    qb.push_bind(hashes.to_vec());
    qb.push(") ORDER BY p.exif_timestamp DESC, p.id");
    qb.build_query_as().fetch_all(db).await
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoverJson {
    pub image_hash: String,
    pub rating: i32,
    pub hidden: bool,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub public: bool,
    pub video: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimpleUserJson {
    pub id: i32,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ShareJson {
    pub enabled: bool,
    pub slug: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub share_location: Option<bool>,
    pub share_camera_info: Option<bool>,
    pub share_timestamps: Option<bool>,
    pub share_captions: Option<bool>,
    pub share_faces: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PhotoAlbumJson {
    pub id: i32,
    pub title: String,
    pub created_on: DateTime<Utc>,
    pub favorited: bool,
    pub cover: Option<CoverJson>,
    pub owner: SimpleUserJson,
    pub shared_to: Option<Vec<SimpleUserJson>>,
    pub photo_count: i64,
    pub share: Option<ShareJson>,
}

#[derive(Debug, FromRow)]
struct PhotoAlbumsRow {
    albums: Option<Json<Vec<PhotoAlbumJson>>>,
}

fn user_json(alias: &str) -> String {
    format!(
        "json_build_object('id', {alias}.id, 'username', {alias}.username, \
         'first_name', {alias}.first_name, 'last_name', {alias}.last_name)"
    )
}

/// `PhotoViewSet.albums`: `None` when the photo is not visible to the
/// requester (own, shared, public, or in one of their own or shared-to-them
/// albums); else the requester's own and shared-to-them albums holding it.
pub async fn photo_albums<'e>(
    db: impl Exec<'e>,
    lookup: &PhotoLookup,
    viewer: Option<i32>,
) -> sqlx::Result<Option<Vec<PhotoAlbumJson>>> {
    let v = viewer.unwrap_or(-1);
    let in_user_album = |alias: &str| {
        format!(
            "({alias}.owner_id = {v} OR EXISTS (SELECT 1 FROM api_albumuser_shared_to ust \
             WHERE ust.albumuser_id = {alias}.id AND ust.user_id = {v}))"
        )
    };
    let mut qb: Qb<'_> = Qb::new("WITH ph AS (SELECT p.id FROM api_photo p WHERE ");
    lookup.push(&mut qb, "p");
    qb.push(" AND (");
    scope::visible_to(&mut qb, "p", viewer);
    if viewer.is_some() {
        qb.push(format!(
            " OR EXISTS (SELECT 1 FROM api_albumuser_photos cap JOIN api_albumuser ca ON ca.id = cap.albumuser_id \
             WHERE cap.photo_id = p.id AND {})",
            in_user_album("ca")
        ));
    }
    qb.push(") ORDER BY p.id LIMIT 1) SELECT ");
    if viewer.is_some() {
        qb.push(format!(
            "(SELECT json_agg(json_build_object('id', a.id, 'title', a.title, 'created_on', a.created_on, \
                'favorited', a.favorited, \
                'cover', (SELECT json_build_object('image_hash', cp.image_hash, 'rating', cp.rating, \
                    'hidden', cp.hidden, 'exif_timestamp', cp.exif_timestamp, 'public', cp.public, \
                    'video', cp.video) FROM api_photo cp WHERE cp.id = COALESCE(a.cover_photo_id, \
                    (SELECT fap.photo_id FROM api_albumuser_photos fap WHERE fap.albumuser_id = a.id \
                     AND fap.photo_id IS NOT NULL ORDER BY fap.photo_id LIMIT 1))), \
                'owner', {owner}, \
                'shared_to', (SELECT json_agg({shared} ORDER BY sst.id) FROM api_albumuser_shared_to sst \
                    JOIN api_user su ON su.id = sst.user_id WHERE sst.albumuser_id = a.id), \
                'photo_count', (SELECT count(*) FROM api_albumuser_photos cnt JOIN api_photo cph ON cph.id = cnt.photo_id \
                    WHERE cnt.albumuser_id = a.id), \
                'share', (SELECT json_build_object('enabled', sh.enabled, 'slug', sh.slug, \
                    'expires_at', sh.expires_at, 'share_location', sh.share_location, \
                    'share_camera_info', sh.share_camera_info, 'share_timestamps', sh.share_timestamps, \
                    'share_captions', sh.share_captions, 'share_faces', sh.share_faces) \
                    FROM api_albumusershare sh WHERE sh.album_id = a.id)) ORDER BY a.id) \
              FROM api_albumuser a JOIN api_user au ON au.id = a.owner_id \
              WHERE {mine} AND EXISTS (SELECT 1 FROM api_albumuser_photos aap \
                WHERE aap.albumuser_id = a.id AND aap.photo_id = ph.id))",
            owner = user_json("au"),
            shared = user_json("su"),
            mine = in_user_album("a"),
        ));
    } else {
        qb.push("NULL::json");
    }
    qb.push(" AS albums FROM ph");
    let row: Option<PhotoAlbumsRow> = qb.build_query_as().fetch_optional(db).await?;
    Ok(row.map(|r| r.albums.map(|j| j.0).unwrap_or_default()))
}

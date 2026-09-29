//! `GET /api/photos/{hash|uuid}/` (`PhotoSerializer`, 03 §6) and
//! `GET /api/photos/{hash|uuid}/albums/`.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::OptionalUser;
use lp_core::codecs::ClipEmbedding;
use lp_core::extract::py_truthy;
use lp_core::time::{drf_datetime, ser_drf_opt};
use lp_core::{ApiError, ApiResult, AppState};
use lp_db::timeline_photos::detail::{self as db, PhotoDetailRow};
use lp_db::timeline_photos::{PhotoLookup, media_url};
use lp_db::users::SimpleUser;
use serde::Serialize;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::metadata::{MetadataSummary, display_name, megapixels, resolution};
use super::similar;

#[derive(Serialize)]
struct FaceLocation {
    top: i32,
    bottom: i32,
    left: i32,
    right: i32,
}

#[derive(Serialize)]
struct PersonOnPhoto {
    name: String,
    #[serde(rename = "type")]
    kind: &'static str,
    probability: Value,
    location: FaceLocation,
    face_url: String,
    face_id: i32,
}

#[derive(Serialize)]
struct SimilarPhoto {
    image_hash: String,
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Serialize)]
struct EmbeddedMedia {
    id: String,
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Serialize)]
struct FileVariant {
    hash: String,
    path: String,
    #[serde(rename = "type")]
    kind: &'static str,
    type_id: i32,
    is_main: bool,
    filename: Option<String>,
}

#[derive(Serialize)]
struct StackPhoto {
    id: Uuid,
    image_hash: String,
    is_primary: bool,
    thumbnail_url: Option<String>,
    size: i64,
    width: i32,
    height: i32,
}

#[derive(Serialize)]
struct StackDetail {
    id: Uuid,
    #[serde(rename = "type")]
    kind: String,
    type_display: &'static str,
    photo_count: usize,
    is_primary: bool,
    photos: Vec<StackPhoto>,
}

#[derive(Serialize)]
struct Ocr {
    text: String,
    blocks: Vec<Value>,
}

/// `PhotoSerializer.Meta.fields` minus `exif_json` (never read, 03 §1.3).
#[derive(Serialize)]
struct PhotoDetail {
    id: Uuid,
    exif_gps_lat: Option<f64>,
    exif_gps_lon: Option<f64>,
    #[serde(serialize_with = "ser_drf_opt")]
    exif_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    captions_json: Value,
    search_captions: String,
    search_location: String,
    big_thumbnail_url: String,
    square_thumbnail_url: String,
    small_square_thumbnail_url: String,
    geolocation_json: Option<Value>,
    people: Vec<PersonOnPhoto>,
    image_hash: String,
    image_path: Vec<String>,
    rating: i32,
    hidden: bool,
    public: bool,
    removed: bool,
    in_trashcan: bool,
    shared_to: Vec<i32>,
    similar_photos: Vec<SimilarPhoto>,
    video: bool,
    owner: SimpleUser,
    size: i64,
    height: Option<i32>,
    width: Option<i32>,
    focal_length: Option<f64>,
    fstop: Option<f64>,
    iso: Option<i32>,
    shutter_speed: Option<String>,
    lens: Option<String>,
    camera: Option<String>,
    #[serde(rename = "focalLength35Equivalent")]
    focal_length_35_equivalent: Option<i32>,
    #[serde(rename = "digitalZoomRatio")]
    digital_zoom_ratio: Option<f64>,
    #[serde(rename = "subjectDistance")]
    subject_distance: Option<f64>,
    embedded_media: Vec<EmbeddedMedia>,
    file_variants: Option<Vec<FileVariant>>,
    stacks: Option<Vec<StackDetail>>,
    metadata: Option<MetadataSummary>,
    ocr: Option<Ocr>,
    local_orientation: i32,
}

/// `get_captions_json`: the stored captions when non-empty, else `{"im2txt": ""}`.
fn captions(v: Option<Value>) -> Value {
    match v {
        Some(v) if py_truthy(&v) && !v.is_number() && !v.is_boolean() => v,
        _ => json!({"im2txt": ""}),
    }
}

/// Python `float(x)` on a JSON value.
fn py_float(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// `min(1.0, max(0.0, v))` with Python's argument-order semantics.
fn unit(v: f64) -> f64 {
    let v = if v > 0.0 { v } else { 0.0 };
    if v < 1.0 { v } else { 1.0 }
}

/// `get_ocr`'s block normalization: pixel quads to [0, 1] fractions of the
/// OCR source; malformed blocks are skipped.
fn ocr_blocks(blocks: Option<&Value>, width: i32, height: i32) -> Vec<Value> {
    let mut out = Vec::new();
    let (Some(Value::Array(blocks)), true) = (blocks, width > 0 && height > 0) else {
        return out;
    };
    let (w, h) = (f64::from(width), f64::from(height));
    'blocks: for block in blocks {
        let Some(obj) = block.as_object() else {
            continue;
        };
        let text = obj.get("text").cloned().unwrap_or(Value::Null);
        let Some(Value::Array(quad)) = obj.get("box") else {
            continue;
        };
        if !py_truthy(&text) || quad.len() != 4 {
            continue;
        }
        let mut normalized = Vec::with_capacity(4);
        for pt in quad {
            let Some([x, y]) = pt
                .as_array()
                .and_then(|a| <&[Value; 2]>::try_from(a.as_slice()).ok())
            else {
                continue 'blocks;
            };
            let (Some(x), Some(y)) = (py_float(x), py_float(y)) else {
                continue 'blocks;
            };
            normalized.push(json!([unit(x / w), unit(y / h)]));
        }
        let mut m = Map::new();
        m.insert("text".into(), text);
        m.insert("box".into(), Value::Array(normalized));
        m.insert(
            "confidence".into(),
            obj.get("confidence").cloned().unwrap_or(Value::Null),
        );
        out.push(Value::Object(m));
    }
    out
}

fn file_type_label(t: i32) -> &'static str {
    match t {
        1 => "image",
        2 => "video",
        4 => "raw",
        3 => "metadata",
        _ => "unknown",
    }
}

fn stack_type_display(t: &str) -> &'static str {
    match t {
        "burst" => "Burst Sequence",
        "bracket" => "Exposure Bracket",
        "manual" => "Manual Stack",
        "raw_jpeg" => "RAW + JPEG Pair (Deprecated)",
        "live_photo" => "Live Photo (Deprecated)",
        _ => "",
    }
}

fn people(row: &PhotoDetailRow) -> Vec<PersonOnPhoto> {
    let Some(faces) = &row.people else {
        return Vec::new();
    };
    faces
        .0
        .iter()
        .map(|f| {
            let (name, kind, probability) = if let Some(n) = &f.person {
                (n.clone(), "user", json!(1))
            } else if let Some(n) = &f.cluster_person {
                (n.clone(), "cluster", json!(f.cluster_probability))
            } else if let Some(n) = &f.classification_person {
                (
                    n.clone(),
                    "classification",
                    json!(f.classification_probability),
                )
            } else {
                (String::new(), "", json!(0))
            };
            PersonOnPhoto {
                name,
                kind,
                probability,
                location: FaceLocation {
                    top: f.top,
                    bottom: f.bottom,
                    left: f.left,
                    right: f.right,
                },
                face_url: f
                    .image
                    .as_deref()
                    .filter(|i| !i.is_empty())
                    .map(media_url)
                    .unwrap_or_default(),
                face_id: f.id,
            }
        })
        .collect()
}

async fn similar_photos(
    state: &AppState,
    row: &PhotoDetailRow,
    viewer: Option<i32>,
) -> ApiResult<Vec<SimilarPhoto>> {
    let Some(embedding) = row
        .clip_embeddings
        .as_ref()
        .filter(|v| py_truthy(v))
        .and_then(ClipEmbedding::decode)
    else {
        return Ok(Vec::new());
    };
    let hashes = similar::similar_hashes(state, row.owner_id, &embedding).await;
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    let rows = db::visible_owner_photos_by_hash(&state.db, row.owner_id, viewer, &hashes).await?;
    Ok(rows
        .into_iter()
        .map(|r| SimilarPhoto {
            image_hash: r.image_hash,
            kind: if r.video { "video" } else { "image" },
        })
        .collect())
}

pub async fn photo_detail(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let viewer = user.as_ref().map(|u| u.id);
    let lookup = PhotoLookup::parse(&id);
    let row = db::photo_detail(&state.db, &lookup, viewer)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let similar_photos = similar_photos(&state, &row, viewer).await?;
    let people = people(&row);

    let files = row.files.as_ref().map(|f| f.0.as_slice()).unwrap_or(&[]);
    let image_path = files.iter().map(|f| f.path.clone()).collect();
    let file_variants = (files.len() > 1).then(|| {
        files
            .iter()
            .map(|f| FileVariant {
                hash: f.hash.clone(),
                path: f.path.clone(),
                kind: file_type_label(f.kind),
                type_id: f.kind,
                is_main: row.main_file_id.as_deref() == Some(f.hash.as_str()),
                filename: (!f.path.is_empty())
                    .then(|| f.path.rsplit('/').next().unwrap_or_default().to_string()),
            })
            .collect()
    });
    let embedded_media = if row.main_file_id.is_some() {
        row.embedded
            .as_ref()
            .map(|e| {
                e.0.iter()
                    .map(|m| EmbeddedMedia {
                        id: m.hash.clone(),
                        kind: if m.kind == 2 { "video" } else { "image" },
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let stacks = row
        .stacks
        .as_ref()
        .map(|s| {
            s.0.iter()
                .map(|st| {
                    let photos: Vec<StackPhoto> = st
                        .photos
                        .iter()
                        .flatten()
                        .map(|sp| StackPhoto {
                            id: sp.id,
                            image_hash: sp.image_hash.clone(),
                            is_primary: Some(sp.id) == st.primary_photo_id,
                            thumbnail_url: sp.has_thumbnail.then(|| {
                                format!("/media/square_thumbnails_small/{}", sp.image_hash)
                            }),
                            size: sp.size,
                            width: sp.width,
                            height: sp.height,
                        })
                        .collect();
                    StackDetail {
                        id: st.id,
                        kind: st.stack_type.clone(),
                        type_display: stack_type_display(&st.stack_type),
                        photo_count: photos.len(),
                        is_primary: st.primary_photo_id == Some(row.id),
                        photos,
                    }
                })
                .collect::<Vec<_>>()
        })
        .filter(|s| !s.is_empty());
    let metadata = row.has_metadata.then(|| MetadataSummary {
        camera_display: display_name(
            row.md_camera_make.as_deref(),
            row.md_camera_model.as_deref(),
        ),
        lens_display: display_name(row.md_lens_make.as_deref(), row.md_lens_model.as_deref()),
        aperture: row.md_aperture,
        shutter_speed: row.md_shutter_speed.clone(),
        iso: row.md_iso,
        focal_length: row.md_focal_length,
        focal_length_35mm: row.md_focal_length_35mm,
        resolution: resolution(row.md_width, row.md_height),
        megapixels: megapixels(row.md_width, row.md_height),
        date_taken: row.md_date_taken.as_ref().map(drf_datetime),
        has_location: row.md_gps_latitude.is_some() && row.md_gps_longitude.is_some(),
        rating: row.md_rating,
        source: row.md_source.clone().unwrap_or_default(),
        version: row.md_version.unwrap_or(1),
        has_edits: row.has_edits,
    });
    let is_owner = viewer == Some(row.owner_id);
    let ocr = (is_owner && row.has_ocr).then(|| Ocr {
        text: row.ocr_text.clone().unwrap_or_default(),
        blocks: ocr_blocks(
            row.ocr_blocks.as_ref(),
            row.ocr_source_width.unwrap_or(0),
            row.ocr_source_height.unwrap_or(0),
        ),
    });
    let md = row.has_metadata;
    let detail = PhotoDetail {
        id: row.id,
        exif_gps_lat: row.exif_gps_lat,
        exif_gps_lon: row.exif_gps_lon,
        exif_timestamp: row.exif_timestamp,
        captions_json: captions(row.captions_json.clone()),
        search_captions: row.search_captions.clone(),
        search_location: row.search_location.clone(),
        big_thumbnail_url: file_url(&row.thumbnail_big),
        square_thumbnail_url: file_url(&row.square_thumbnail),
        small_square_thumbnail_url: file_url(&row.square_thumbnail_small),
        geolocation_json: row.geolocation_json.clone(),
        people,
        image_hash: row.image_hash.clone(),
        image_path,
        rating: row.rating,
        hidden: row.hidden,
        public: row.public,
        removed: row.removed,
        in_trashcan: row.in_trashcan,
        shared_to: row
            .shared_to
            .as_ref()
            .map(|s| s.0.clone())
            .unwrap_or_default(),
        similar_photos,
        video: row.video,
        owner: SimpleUser {
            id: row.owner_id,
            username: row.owner_username.clone(),
            first_name: row.owner_first_name.clone(),
            last_name: row.owner_last_name.clone(),
        },
        size: row.size,
        height: if md { row.md_height } else { Some(0) },
        width: if md { row.md_width } else { Some(0) },
        focal_length: row.md_focal_length,
        fstop: row.md_aperture,
        iso: row.md_iso,
        shutter_speed: row.md_shutter_speed.clone(),
        lens: display_name(row.md_lens_make.as_deref(), row.md_lens_model.as_deref()),
        camera: display_name(
            row.md_camera_make.as_deref(),
            row.md_camera_model.as_deref(),
        ),
        focal_length_35_equivalent: row.md_focal_length_35mm,
        digital_zoom_ratio: None,
        subject_distance: None,
        embedded_media,
        file_variants,
        stacks,
        metadata,
        ocr,
        local_orientation: row.local_orientation,
    };
    Ok(Json(detail).into_response())
}

/// `FieldFile.url`, or `""` for an empty field.
fn file_url(name: &str) -> String {
    if name.is_empty() {
        String::new()
    } else {
        media_url(name)
    }
}

#[derive(Serialize)]
struct CoverPhoto {
    image_hash: String,
    rating: i32,
    hidden: bool,
    #[serde(serialize_with = "ser_drf_opt")]
    exif_timestamp: Option<chrono::DateTime<chrono::Utc>>,
    public: bool,
    video: bool,
}

#[derive(Serialize)]
struct SharingOptions {
    share_location: Option<bool>,
    share_camera_info: Option<bool>,
    share_timestamps: Option<bool>,
    share_captions: Option<bool>,
    share_faces: Option<bool>,
}

/// `AlbumUserListSerializer`.
#[derive(Serialize)]
struct AlbumListItem {
    id: i32,
    cover_photo: Option<CoverPhoto>,
    #[serde(serialize_with = "lp_core::time::ser_drf")]
    created_on: chrono::DateTime<chrono::Utc>,
    favorited: bool,
    title: String,
    shared_to: Vec<SimpleUser>,
    owner: SimpleUser,
    photo_count: i64,
    public: bool,
    public_slug: String,
    public_expires_at: Option<String>,
    public_sharing_options: Option<SharingOptions>,
}

#[derive(Serialize)]
struct AlbumsResponse {
    results: Vec<AlbumListItem>,
}

fn simple(u: db::SimpleUserJson) -> SimpleUser {
    SimpleUser {
        id: u.id,
        username: u.username,
        first_name: u.first_name,
        last_name: u.last_name,
    }
}

pub async fn photo_albums(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let viewer = user.as_ref().map(|u| u.id);
    let lookup = PhotoLookup::parse(&id);
    let Some(albums) = db::photo_albums(&state.db, &lookup, viewer).await? else {
        // Django answers `Response(status=404)`: no body.
        return Ok(StatusCode::NOT_FOUND.into_response());
    };
    let results = albums
        .into_iter()
        .map(|a| AlbumListItem {
            id: a.id,
            cover_photo: a.cover.map(|c| CoverPhoto {
                image_hash: c.image_hash,
                rating: c.rating,
                hidden: c.hidden,
                exif_timestamp: c.exif_timestamp,
                public: c.public,
                video: c.video,
            }),
            created_on: a.created_on,
            favorited: a.favorited,
            title: a.title,
            shared_to: a
                .shared_to
                .unwrap_or_default()
                .into_iter()
                .map(simple)
                .collect(),
            owner: simple(a.owner),
            photo_count: a.photo_count,
            public: a.share.as_ref().is_some_and(|s| s.enabled),
            public_slug: a
                .share
                .as_ref()
                .and_then(|s| s.slug.clone())
                .unwrap_or_default(),
            public_expires_at: a
                .share
                .as_ref()
                .and_then(|s| s.expires_at.as_ref())
                .map(drf_datetime),
            public_sharing_options: a.share.map(|s| SharingOptions {
                share_location: s.share_location,
                share_camera_info: s.share_camera_info,
                share_timestamps: s.share_timestamps,
                share_captions: s.share_captions,
                share_faces: s.share_faces,
            }),
        })
        .collect();
    Ok(Json(AlbumsResponse { results }).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ocr_normalization() {
        let blocks = json!([
            {"text": "Hi", "box": [[100, 200], [500, 200], [500, 260], [2000, -5]], "confidence": 0.9},
            {"text": "", "box": [[0, 0], [1, 0], [1, 1], [0, 1]]},
            {"text": "bad", "box": [[0, 0], [1, 0], [1, 1]]},
            {"text": "bad2", "box": [[0, 0], [1, 0], [1, 1], ["x", 1]]},
            "junk"
        ]);
        let out = ocr_blocks(Some(&blocks), 1000, 1000);
        assert_eq!(out.len(), 1);
        assert_eq!(
            out[0]["box"],
            json!([[0.1, 0.2], [0.5, 0.2], [0.5, 0.26], [1.0, 0.0]])
        );
        assert_eq!(out[0]["confidence"], json!(0.9));
        assert!(ocr_blocks(Some(&blocks), 0, 10).is_empty());
    }

    #[test]
    fn captions_default() {
        assert_eq!(captions(None), json!({"im2txt": ""}));
        assert_eq!(captions(Some(json!({}))), json!({"im2txt": ""}));
        assert_eq!(captions(Some(json!({"a": 1}))), json!({"a": 1}));
    }
}

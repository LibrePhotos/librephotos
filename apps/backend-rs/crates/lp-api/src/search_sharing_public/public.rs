//! Anonymous public pages: `GET /api/public/albums/s/{slug}/`,
//! `/api/public/albums/s/{slug}/photos/{photo_id}/` (api/views/public_albums.py)
//! and `/api/public/photo/{slug}/` (api/views/public_photos.py).
//!
//! `OptionalUser` is extracted only for DRF's behaviour on `AllowAny` views: a
//! bad `Authorization` header is still a 401.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::OptionalUser;
use lp_core::extract::py_truthy;
use lp_core::time::drf_datetime;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::pig::{self, PigPhoto};
use lp_db::search_sharing_public::public::{self as db, PublicAlbum, PublicPhotoRow};
use lp_db::users::SimpleUser;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;
use serde_json::{Map, Value, json};
use sqlx::types::Json as SqlJson;
use uuid::Uuid;

const SHARING_KEYS: [&str; 5] = [
    "share_location",
    "share_camera_info",
    "share_timestamps",
    "share_captions",
    "share_faces",
];

/// `Share.get_effective_sharing_settings`: system defaults (all false), then
/// the owner's `public_sharing_defaults`, then the non-null per-share overrides.
fn effective_settings(
    owner_defaults: Option<&SqlJson<Value>>,
    overrides: [Option<bool>; 5],
) -> Map<String, Value> {
    let mut settings: Map<String, Value> = SHARING_KEYS
        .iter()
        .map(|k| (k.to_string(), Value::Bool(false)))
        .collect();
    if let Some(SqlJson(Value::Object(defaults))) = owner_defaults {
        for (k, v) in defaults {
            settings.insert(k.clone(), v.clone());
        }
    }
    for (k, v) in SHARING_KEYS.iter().zip(overrides) {
        if let Some(v) = v {
            settings.insert(k.to_string(), Value::Bool(v));
        }
    }
    settings
}

fn setting(settings: &Map<String, Value>, key: &str) -> bool {
    settings.get(key).is_some_and(py_truthy)
}

fn album_settings(album: &PublicAlbum) -> Map<String, Value> {
    effective_settings(
        album.owner_sharing_defaults.as_ref(),
        [
            album.share_location,
            album.share_camera_info,
            album.share_timestamps,
            album.share_captions,
            album.share_faces,
        ],
    )
}

/// Characters Python's `urllib.parse.quote(path, safe="/~!*()'")` leaves alone.
const MEDIA_PATH: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'_')
    .remove(b'.')
    .remove(b'-')
    .remove(b'~')
    .remove(b'/')
    .remove(b'!')
    .remove(b'*')
    .remove(b'(')
    .remove(b')')
    .remove(b'\'');

/// `FieldFile.url` for the default storage (`MEDIA_URL = "/media/"`).
fn media_url(name: &str) -> String {
    let path = name.replace('\\', "/");
    let quoted = utf8_percent_encode(&path, MEDIA_PATH).to_string();
    format!("/media/{}", quoted.trim_start_matches('/'))
}

fn file_url(name: Option<&str>) -> String {
    name.filter(|n| !n.is_empty())
        .map(media_url)
        .unwrap_or_default()
}

// ---- album share -----------------------------------------------------------

/// `GroupedPhotosSerializer` group of a public album; `date` is null when the
/// owner does not share timestamps (one undated group).
#[derive(Serialize)]
struct PublicGroup {
    date: Option<String>,
    location: String,
    items: Vec<PigPhoto>,
}

/// `AlbumUserPublicSerializer` (its `public_slug` / `public_expires_at`
/// fields are skipped by DRF: `AlbumUser` has no such attributes).
#[derive(Serialize)]
struct PublicAlbumOut {
    id: String,
    title: String,
    owner: SimpleUser,
    date: String,
    location: String,
    grouped_photos: Vec<PublicGroup>,
}

#[derive(Serialize)]
struct WithSettings<T: Serialize> {
    results: T,
    sharing_settings: Map<String, Value>,
}

pub(super) async fn album_by_slug(
    State(state): State<AppState>,
    _user: OptionalUser,
    Path(slug): Path<String>,
    q: QueryMap,
) -> ApiResult<Response> {
    let Some(album) = db::active_album(&state.db, &slug).await? else {
        return Err(ApiError::status_only(StatusCode::NOT_FOUND));
    };
    let settings = album_settings(&album);
    let share_location = setting(&settings, "share_location");
    let share_timestamps = setting(&settings, "share_timestamps");

    let photos = db::album_photos(&state.db, album.id).await?;
    let date = if share_timestamps {
        photos
            .iter()
            .find_map(|p| p.exif_timestamp.as_ref())
            .map(drf_datetime)
            .unwrap_or_default()
    } else {
        String::new()
    };
    let location = if share_location {
        photos
            .iter()
            .find(|p| !p.location.is_empty())
            .map(|p| p.location.clone())
            .unwrap_or_default()
    } else {
        String::new()
    };

    let mut photos = photos;
    if q.flag("video") {
        photos.retain(|p| p.video);
    } else if q.flag("photo") {
        photos.retain(|p| !p.video);
    }
    let mut groups: Vec<PublicGroup> = if share_timestamps {
        pig::group_by_date(photos)
            .into_iter()
            .map(|g| PublicGroup {
                date: Some(g.date),
                location: g.location,
                items: g.items,
            })
            .collect()
    } else if photos.is_empty() {
        Vec::new()
    } else {
        vec![PublicGroup {
            date: None,
            location: String::new(),
            items: photos,
        }]
    };
    for item in groups.iter_mut().flat_map(|g| g.items.iter_mut()) {
        if !share_location {
            item.exif_gps_lat = None;
            item.exif_gps_lon = None;
            item.location.clear();
        }
        if !share_timestamps {
            item.date.clear();
            item.birth_time.clear();
        }
    }

    let out = PublicAlbumOut {
        id: album.id.to_string(),
        title: album.title,
        owner: SimpleUser {
            id: album.owner_id,
            username: album.owner_username,
            first_name: album.owner_first_name,
            last_name: album.owner_last_name,
        },
        date,
        location,
        grouped_photos: groups,
    };
    Ok(Json(WithSettings {
        results: out,
        sharing_settings: settings,
    })
    .into_response())
}

fn not_found_json(message: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
}

pub(super) async fn album_photo_by_slug(
    State(state): State<AppState>,
    _user: OptionalUser,
    Path((slug, photo_id)): Path<(String, String)>,
) -> ApiResult<Response> {
    let Some(album) = db::active_album(&state.db, &slug).await? else {
        return Ok(not_found_json("Album not found or not public"));
    };
    // Django tells a UUID from an image hash by shape (36 chars, 4 dashes).
    let is_uuid_format = photo_id.chars().count() == 36 && photo_id.matches('-').count() == 4;
    let found = if is_uuid_format {
        // Django's `pk=` lookup of a malformed UUID is a 500; nothing matches here.
        match Uuid::try_parse(&photo_id.replace('-', "")) {
            Ok(id) => db::album_photo(&state.db, album.id, Some(id), None).await?,
            Err(_) => None,
        }
    } else {
        db::album_photo(&state.db, album.id, None, Some(&photo_id)).await?
    };
    let Some(id) = found else {
        return Ok(not_found_json("Photo not found in album"));
    };
    let Some(photo) = db::public_photo(&state.db, id).await? else {
        return Ok(not_found_json("Photo not found in album"));
    };
    let settings = album_settings(&album);
    let detail = photo_detail(&state, &photo, &settings).await?;
    Ok(Json(WithSettings {
        results: detail,
        sharing_settings: settings,
    })
    .into_response())
}

// ---- photo detail ----------------------------------------------------------

#[derive(Serialize)]
struct PublicPerson {
    name: String,
    face_url: Option<String>,
    face_id: i32,
}

/// `PublicPhotoDetailSerializer`, fields in its `Meta.fields` order.
#[derive(Serialize)]
struct PublicPhotoDetail {
    image_hash: String,
    video: bool,
    square_thumbnail_url: String,
    big_thumbnail_url: String,
    small_square_thumbnail_url: String,
    exif_timestamp: Option<String>,
    exif_gps_lat: Option<f64>,
    exif_gps_lon: Option<f64>,
    geolocation_json: Option<Value>,
    search_location: String,
    camera: Option<String>,
    lens: Option<String>,
    focal_length: Option<f64>,
    fstop: Option<f64>,
    iso: Option<i32>,
    shutter_speed: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    search_captions: String,
    captions_json: Value,
    people: Vec<PublicPerson>,
}

/// `PhotoMetadata.camera_display` / `lens_display`: Python `and`/`or` on
/// optional strings (an empty string is falsy).
fn display_name(make: Option<&str>, model: Option<&str>) -> Option<String> {
    match (
        make.filter(|s| !s.is_empty()),
        model.filter(|s| !s.is_empty()),
    ) {
        (Some(make), Some(model)) => Some(if model.starts_with(make) {
            model.to_string()
        } else {
            format!("{make} {model}")
        }),
        (_, Some(model)) => Some(model.to_string()),
        _ => make.map(str::to_string),
    }
}

fn captions_truthy(v: &Value) -> bool {
    match v {
        Value::Object(m) => !m.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::String(s) => !s.is_empty(),
        _ => false,
    }
}

async fn photo_detail(
    state: &AppState,
    photo: &PublicPhotoRow,
    settings: &Map<String, Value>,
) -> ApiResult<PublicPhotoDetail> {
    let share_location = setting(settings, "share_location");
    let share_camera = setting(settings, "share_camera_info");
    let share_timestamps = setting(settings, "share_timestamps");
    let share_captions = setting(settings, "share_captions");
    let share_faces = setting(settings, "share_faces");

    let people = if share_faces {
        db::public_faces(&state.db, photo.id)
            .await?
            .into_iter()
            .map(|f| PublicPerson {
                name: f.name,
                face_url: f.image.as_deref().filter(|i| !i.is_empty()).map(media_url),
                face_id: f.id,
            })
            .collect()
    } else {
        Vec::new()
    };
    let camera_meta = share_camera && photo.has_metadata;
    let captions = photo
        .captions_json
        .as_ref()
        .map(|j| &j.0)
        .filter(|v| share_captions && captions_truthy(v));

    Ok(PublicPhotoDetail {
        image_hash: photo.image_hash.clone(),
        video: photo.video,
        square_thumbnail_url: file_url(photo.square_thumbnail.as_deref()),
        big_thumbnail_url: file_url(photo.thumbnail_big.as_deref()),
        small_square_thumbnail_url: file_url(photo.square_thumbnail_small.as_deref()),
        exif_timestamp: share_timestamps
            .then(|| photo.exif_timestamp.as_ref().map(drf_datetime))
            .flatten(),
        exif_gps_lat: share_location.then_some(photo.exif_gps_lat).flatten(),
        exif_gps_lon: share_location.then_some(photo.exif_gps_lon).flatten(),
        geolocation_json: share_location
            .then(|| photo.geolocation_json.as_ref().map(|j| j.0.clone()))
            .flatten(),
        search_location: if share_location && photo.has_search {
            photo.search_location.clone().unwrap_or_default()
        } else {
            String::new()
        },
        camera: camera_meta
            .then(|| display_name(photo.camera_make.as_deref(), photo.camera_model.as_deref()))
            .flatten(),
        lens: camera_meta
            .then(|| display_name(photo.lens_make.as_deref(), photo.lens_model.as_deref()))
            .flatten(),
        focal_length: camera_meta.then_some(photo.focal_length).flatten(),
        fstop: camera_meta.then_some(photo.aperture).flatten(),
        iso: camera_meta.then_some(photo.iso).flatten(),
        shutter_speed: camera_meta.then(|| photo.shutter_speed.clone()).flatten(),
        width: if camera_meta { photo.width } else { Some(0) },
        height: if camera_meta { photo.height } else { Some(0) },
        search_captions: if share_captions && photo.has_search {
            photo.search_captions.clone().unwrap_or_default()
        } else {
            String::new()
        },
        captions_json: captions.cloned().unwrap_or_else(|| json!({"im2txt": ""})),
        people,
    })
}

// ---- photo share -----------------------------------------------------------

/// Fields a photo link must not hand out (content hash and hash-addressed URLs).
const HASH_DERIVED_FIELDS: [&str; 4] = [
    "image_hash",
    "square_thumbnail_url",
    "big_thumbnail_url",
    "small_square_thumbnail_url",
];

fn shared_photo_media_url(slug: &str, kind: &str) -> String {
    format!("/api/public/photo/{slug}/media/{kind}/")
}

pub(super) async fn photo_by_slug(
    State(state): State<AppState>,
    _user: OptionalUser,
    Path(slug): Path<String>,
) -> ApiResult<Response> {
    let Some(share) = db::active_photo_share(&state.db, &slug).await? else {
        return Err(ApiError::status_only(StatusCode::NOT_FOUND));
    };
    let Some(photo) = db::public_photo(&state.db, share.photo_id).await? else {
        return Err(ApiError::status_only(StatusCode::NOT_FOUND));
    };
    let settings = effective_settings(share.owner_sharing_defaults.as_ref(), [None; 5]);
    let detail = photo_detail(&state, &photo, &settings).await?;
    let Value::Object(mut data) = serde_json::to_value(&detail)? else {
        return Err(ApiError::internal("photo detail is not an object"));
    };
    for field in HASH_DERIVED_FIELDS {
        data.shift_remove(field);
    }
    let names: Vec<Value> = detail
        .people
        .iter()
        .map(|p| json!({ "name": p.name }))
        .collect();
    data.insert("people".into(), Value::Array(names));
    data.insert(
        "thumbnail_url".into(),
        Value::String(shared_photo_media_url(&share.slug, "thumbnail")),
    );
    data.insert(
        "video_url".into(),
        if photo.video {
            Value::String(shared_photo_media_url(&share.slug, "video"))
        } else {
            Value::Null
        },
    );
    Ok(Json(WithSettings {
        results: data,
        sharing_settings: settings,
    })
    .into_response())
}

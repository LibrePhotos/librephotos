//! `GET` / `PATCH /api/photos/{id}/metadata` (`PhotoMetadataViewSet`),
//! plus the display helpers `PhotoMetadata` computes as properties.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use lp_auth::AuthUser;
use lp_core::codecs::py_round;
use lp_core::time::{ser_drf, ser_drf_opt};
use lp_core::{ApiError, ApiJson, ApiResult, AppState, FieldError};
use lp_db::timeline_photos::PhotoLookup;
use lp_db::timeline_photos::metadata::{self as db, MetadataPhoto};
use lp_db::users::User;
use lp_db::write::timeline_photos::{self as write, MetaValue};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

/// `camera_display` / `lens_display`.
pub(crate) fn display_name(make: Option<&str>, model: Option<&str>) -> Option<String> {
    fn truthy(s: Option<&str>) -> Option<&str> {
        s.filter(|x| !x.is_empty())
    }
    match (truthy(make), truthy(model)) {
        (Some(mk), Some(md)) => Some(if md.starts_with(mk) {
            md.to_string()
        } else {
            format!("{mk} {md}")
        }),
        (_, Some(md)) => Some(md.to_string()),
        _ => make.map(str::to_string),
    }
}

pub(crate) fn resolution(width: Option<i32>, height: Option<i32>) -> Option<String> {
    match (width, height) {
        (Some(w), Some(h)) if w != 0 && h != 0 => Some(format!("{w}x{h}")),
        _ => None,
    }
}

pub(crate) fn megapixels(width: Option<i32>, height: Option<i32>) -> Option<f64> {
    match (width, height) {
        (Some(w), Some(h)) if w != 0 && h != 0 => {
            Some(py_round(f64::from(w) * f64::from(h) / 1_000_000.0, 1))
        }
        _ => None,
    }
}

/// `PhotoMetadataSummarySerializer` (the photo detail's `metadata`).
#[derive(Serialize)]
pub(crate) struct MetadataSummary {
    pub camera_display: Option<String>,
    pub lens_display: Option<String>,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub iso: Option<i32>,
    pub focal_length: Option<f64>,
    pub focal_length_35mm: Option<i32>,
    pub resolution: Option<String>,
    pub megapixels: Option<f64>,
    pub date_taken: Option<String>,
    pub has_location: bool,
    pub rating: Option<i32>,
    pub source: String,
    pub version: i32,
    pub has_edits: bool,
}

#[derive(Serialize)]
struct EditOut {
    id: Uuid,
    field_name: String,
    old_value: Option<Value>,
    new_value: Option<Value>,
    user: i32,
    user_name: String,
    synced_to_file: bool,
    #[serde(serialize_with = "ser_drf_opt")]
    synced_at: Option<DateTime<Utc>>,
    #[serde(serialize_with = "ser_drf")]
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct SidecarOut {
    id: Uuid,
    file_type: String,
    source: String,
    priority: i32,
    creator_software: Option<String>,
    #[serde(serialize_with = "ser_drf")]
    created_at: DateTime<Utc>,
    #[serde(serialize_with = "ser_drf")]
    updated_at: DateTime<Utc>,
}

/// `PhotoMetadataSerializer.Meta.fields`.
#[derive(Serialize)]
struct MetadataOut {
    id: Uuid,
    aperture: Option<f64>,
    shutter_speed: Option<String>,
    shutter_speed_seconds: Option<f64>,
    iso: Option<i32>,
    focal_length: Option<f64>,
    focal_length_35mm: Option<i32>,
    exposure_compensation: Option<f64>,
    flash_fired: Option<bool>,
    metering_mode: Option<String>,
    white_balance: Option<String>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens_make: Option<String>,
    lens_model: Option<String>,
    serial_number: Option<String>,
    camera_display: Option<String>,
    lens_display: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    orientation: Option<i32>,
    color_space: Option<String>,
    bit_depth: Option<i32>,
    resolution: Option<String>,
    megapixels: Option<f64>,
    #[serde(serialize_with = "ser_drf_opt")]
    date_taken: Option<DateTime<Utc>>,
    date_taken_subsec: Option<String>,
    #[serde(serialize_with = "ser_drf_opt")]
    date_modified: Option<DateTime<Utc>>,
    timezone_offset: Option<String>,
    gps_latitude: Option<f64>,
    gps_longitude: Option<f64>,
    gps_altitude: Option<f64>,
    location_country: Option<String>,
    location_state: Option<String>,
    location_city: Option<String>,
    location_address: Option<String>,
    has_location: bool,
    title: Option<String>,
    caption: Option<String>,
    keywords: Option<Value>,
    rating: Option<i32>,
    copyright: Option<String>,
    creator: Option<String>,
    source: String,
    version: i32,
    #[serde(serialize_with = "ser_drf")]
    created_at: DateTime<Utc>,
    #[serde(serialize_with = "ser_drf")]
    updated_at: DateTime<Utc>,
    edit_history: Vec<EditOut>,
    sidecar_files: Vec<SidecarOut>,
}

/// `_get_photo`: the id must look like Django's `[0-9a-f-]+|[a-f0-9]{64}`;
/// staff see every photo, others only their own (a foreign photo is a 404).
async fn find_photo(state: &AppState, user: &User, id: &str) -> ApiResult<MetadataPhoto> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
    {
        return Err(ApiError::not_found());
    }
    let missing = || ApiError::not_found_msg("No Photo matches the given query.");
    db::find_photo(&state.db, &PhotoLookup::parse(id), user.id, user.is_staff)
        .await?
        .ok_or_else(missing)
}

async fn render(state: &AppState, photo: &MetadataPhoto) -> ApiResult<Response> {
    let mut conn = state.db.acquire().await?;
    let m = write::get_or_create_metadata(&mut conn, photo).await?;
    drop(conn);
    let (edits, sidecars) = tokio::try_join!(
        db::recent_edits(&state.db, photo.id),
        db::sidecar_files(&state.db, photo.id)
    )?;
    let out = MetadataOut {
        id: m.id,
        aperture: m.aperture,
        shutter_speed: m.shutter_speed,
        shutter_speed_seconds: m.shutter_speed_seconds,
        iso: m.iso,
        focal_length: m.focal_length,
        focal_length_35mm: m.focal_length_35mm,
        exposure_compensation: m.exposure_compensation,
        flash_fired: m.flash_fired,
        metering_mode: m.metering_mode,
        white_balance: m.white_balance,
        camera_display: display_name(m.camera_make.as_deref(), m.camera_model.as_deref()),
        lens_display: display_name(m.lens_make.as_deref(), m.lens_model.as_deref()),
        camera_make: m.camera_make,
        camera_model: m.camera_model,
        lens_make: m.lens_make,
        lens_model: m.lens_model,
        serial_number: m.serial_number,
        width: m.width,
        height: m.height,
        orientation: m.orientation,
        color_space: m.color_space,
        bit_depth: m.bit_depth,
        resolution: resolution(m.width, m.height),
        megapixels: megapixels(m.width, m.height),
        date_taken: m.date_taken,
        date_taken_subsec: m.date_taken_subsec,
        date_modified: m.date_modified,
        timezone_offset: m.timezone_offset,
        has_location: m.gps_latitude.is_some() && m.gps_longitude.is_some(),
        gps_latitude: m.gps_latitude,
        gps_longitude: m.gps_longitude,
        gps_altitude: m.gps_altitude,
        location_country: m.location_country,
        location_state: m.location_state,
        location_city: m.location_city,
        location_address: m.location_address,
        title: m.title,
        caption: m.caption,
        keywords: m.keywords,
        rating: m.rating,
        copyright: m.copyright,
        creator: m.creator,
        source: m.source,
        version: m.version,
        created_at: m.created_at,
        updated_at: m.updated_at,
        edit_history: edits
            .into_iter()
            .map(|e| EditOut {
                id: e.id,
                field_name: e.field_name,
                old_value: e.old_value,
                new_value: e.new_value,
                user: e.user_id,
                user_name: e.user_name.unwrap_or_else(|| "Unknown".into()),
                synced_to_file: e.synced_to_file,
                synced_at: e.synced_at,
                created_at: e.created_at,
            })
            .collect(),
        sidecar_files: sidecars
            .into_iter()
            .map(|s| SidecarOut {
                id: s.id,
                file_type: s.file_type,
                source: s.source,
                priority: s.priority,
                creator_software: s.creator_software,
                created_at: s.created_at,
                updated_at: s.updated_at,
            })
            .collect(),
    };
    Ok(Json(out).into_response())
}

pub async fn get_metadata(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let photo = find_photo(&state, &user, &id).await?;
    render(&state, &photo).await
}

#[derive(Clone, Copy)]
enum Kind {
    /// `CharField`, with `max_length` for `CharField`s, none for `TextField`s.
    Text(Option<usize>),
    Int,
    Float,
    Json,
    Time,
}

/// `PhotoMetadataUpdateSerializer.Meta.fields`, in order.
const EDITABLE: [(&str, Kind); 14] = [
    ("title", Kind::Text(Some(500))),
    ("caption", Kind::Text(None)),
    ("keywords", Kind::Json),
    ("rating", Kind::Int),
    ("copyright", Kind::Text(None)),
    ("creator", Kind::Text(Some(200))),
    ("gps_latitude", Kind::Float),
    ("gps_longitude", Kind::Float),
    ("location_country", Kind::Text(Some(100))),
    ("location_state", Kind::Text(Some(100))),
    ("location_city", Kind::Text(Some(100))),
    ("location_address", Kind::Text(None)),
    ("date_taken", Kind::Time),
    ("timezone_offset", Kind::Text(Some(10))),
];

fn py_number_str(n: &serde_json::Number) -> String {
    match n.as_f64() {
        Some(f) if n.is_f64() && f.fract() == 0.0 && f.abs() < 1e16 => format!("{f:.1}"),
        _ => n.to_string(),
    }
}

/// DRF field validation of one value (`allow_null` everywhere).
fn validate(kind: Kind, v: &Value) -> Result<MetaValue, String> {
    if v.is_null() {
        return Ok(match kind {
            Kind::Text(_) => MetaValue::Text(None),
            Kind::Int => MetaValue::Int(None),
            Kind::Float => MetaValue::Float(None),
            Kind::Json => MetaValue::Json(None),
            Kind::Time => MetaValue::Time(None),
        });
    }
    match kind {
        Kind::Text(max) => {
            let s = match v {
                Value::String(s) => s.trim().to_string(),
                Value::Number(n) => py_number_str(n),
                _ => return Err("Not a valid string.".into()),
            };
            if let Some(max) = max
                && s.chars().count() > max
            {
                return Err(format!(
                    "Ensure this field has no more than {max} characters."
                ));
            }
            Ok(MetaValue::Text(Some(s)))
        }
        Kind::Int => {
            const INVALID: &str = "A valid integer is required.";
            let n: i64 = match v {
                Value::Number(n) => match (n.as_i64(), n.as_f64()) {
                    (Some(i), _) => i,
                    (None, Some(f)) if f.fract() == 0.0 && f.abs() < 9.2e18 => f as i64,
                    _ => return Err(INVALID.into()),
                },
                Value::String(s) => {
                    let t = s.trim();
                    let t = t
                        .find('.')
                        .filter(|i| t[i + 1..].bytes().all(|b| b == b'0'))
                        .map_or(t, |i| &t[..i]);
                    t.trim().parse().map_err(|_| INVALID.to_string())?
                }
                _ => return Err(INVALID.into()),
            };
            if n > i64::from(i32::MAX) {
                return Err("Ensure this value is less than or equal to 2147483647.".into());
            }
            if n < i64::from(i32::MIN) {
                return Err("Ensure this value is greater than or equal to -2147483648.".into());
            }
            Ok(MetaValue::Int(Some(n as i32)))
        }
        Kind::Float => {
            let f = match v {
                Value::Number(n) => n.as_f64(),
                Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
                Value::String(s) => s.trim().parse::<f64>().ok(),
                _ => None,
            };
            f.filter(|f| f.is_finite())
                .map(|f| MetaValue::Float(Some(f)))
                .ok_or_else(|| "A valid number is required.".into())
        }
        Kind::Json => Ok(MetaValue::Json(Some(v.clone()))),
        Kind::Time => v
            .as_str()
            .filter(|s| s.contains('T') || s.trim().contains(' '))
            .and_then(lp_core::time::parse_client_datetime)
            .map(|t| MetaValue::Time(Some(t)))
            .ok_or_else(|| {
                "Datetime has wrong format. Use one of these formats instead: \
                 YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z]."
                    .into()
            }),
    }
}

pub async fn patch_metadata(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let photo = find_photo(&state, &user, &id).await?;
    let Value::Object(body) = body else {
        let got = match body {
            Value::Array(_) => "list",
            Value::String(_) => "str",
            Value::Bool(_) => "bool",
            Value::Number(ref n) if n.is_f64() => "float",
            Value::Number(_) => "int",
            _ => "NoneType",
        };
        return Err(ApiError::validation(format!(
            "Invalid data. Expected a dictionary, but got {got}."
        )));
    };
    let mut changes: Vec<(&'static str, MetaValue)> = Vec::new();
    let mut errors = Vec::new();
    for (field, kind) in EDITABLE {
        let Some(v) = body.get(field) else {
            continue;
        };
        match validate(kind, v) {
            Ok(mv) => changes.push((field, mv)),
            Err(message) => errors.push(FieldError {
                field: field.to_string(),
                message,
            }),
        }
    }
    if !errors.is_empty() {
        return Err(ApiError::fields(StatusCode::BAD_REQUEST, errors));
    }
    write::patch_metadata(&state.db, &photo, user.id, &changes).await?;
    render(&state, &photo).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn displays() {
        assert_eq!(
            display_name(Some("Canon"), Some("Canon EOS R5")).as_deref(),
            Some("Canon EOS R5")
        );
        assert_eq!(
            display_name(Some("NIKON"), Some("Z6")).as_deref(),
            Some("NIKON Z6")
        );
        assert_eq!(display_name(None, Some("")), None);
        assert_eq!(display_name(Some(""), None).as_deref(), Some(""));
        assert_eq!(
            resolution(Some(4000), Some(3000)).as_deref(),
            Some("4000x3000")
        );
        assert_eq!(megapixels(Some(4000), Some(3000)), Some(12.0));
        assert_eq!(megapixels(Some(0), Some(3000)), None);
    }

    #[test]
    fn validation_like_drf() {
        assert_eq!(
            validate(Kind::Int, &json!("5.0")).unwrap(),
            MetaValue::Int(Some(5))
        );
        assert_eq!(
            validate(Kind::Int, &json!(4.0)).unwrap(),
            MetaValue::Int(Some(4))
        );
        assert!(validate(Kind::Int, &json!(4.5)).is_err());
        assert!(validate(Kind::Int, &json!(true)).is_err());
        assert!(validate(Kind::Int, &json!(3_000_000_000i64)).is_err());
        assert_eq!(
            validate(Kind::Text(Some(5)), &json!("  ab  ")).unwrap(),
            MetaValue::Text(Some("ab".into()))
        );
        assert!(validate(Kind::Text(Some(2)), &json!("abc")).is_err());
        assert!(validate(Kind::Text(None), &json!(true)).is_err());
        assert_eq!(
            validate(Kind::Text(None), &json!(null)).unwrap(),
            MetaValue::Text(None)
        );
        assert!(validate(Kind::Time, &json!("2024-01-01")).is_err());
        assert!(validate(Kind::Time, &json!("2024-01-01T10:00:00Z")).is_ok());
        assert_eq!(
            validate(Kind::Float, &json!("1.5")).unwrap(),
            MetaValue::Float(Some(1.5))
        );
    }
}

//! `PATCH /api/photos/edit/{hash|uuid}/` (`PhotoEditViewSet.partial_update`).
//!
//! `PhotoEditSerializer.update` only honours the media-category flags, the
//! capture time and the GPS position; every other field is validated and
//! ignored.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use lp_auth::AuthUser;
use lp_core::time::{parse_client_datetime, ser_drf_opt};
use lp_core::{ApiError, ApiJson, ApiResult, AppState, FieldError};
use lp_db::photo_edits::{self as reads, EditPhoto};
use lp_db::write::photo_edits::edit as svc;
use lp_jobs::EnqueueOptions;
use serde::Serialize;
use serde_json::{Map, Value, json};

use super::bulk::object;
use super::datetime_rules::{RuleInput, extract_local_date_time, parse_rules};
use super::{django_bool, metadata_to_disk};

/// `PhotoEditSerializer` fields, in order.
#[derive(Serialize)]
pub struct EditResponse {
    image_hash: String,
    hidden: bool,
    rating: i32,
    in_trashcan: bool,
    removed: bool,
    video: bool,
    #[serde(serialize_with = "ser_drf_opt")]
    exif_timestamp: Option<DateTime<Utc>>,
    #[serde(serialize_with = "ser_drf_opt")]
    timestamp: Option<DateTime<Utc>>,
    exif_gps_lat: Option<f64>,
    exif_gps_lon: Option<f64>,
    is_screenshot: bool,
    is_document: bool,
    category_source: String,
}

impl From<EditPhoto> for EditResponse {
    fn from(p: EditPhoto) -> Self {
        EditResponse {
            image_hash: p.image_hash,
            hidden: p.hidden,
            rating: p.rating,
            in_trashcan: p.in_trashcan,
            removed: p.removed,
            video: p.video,
            exif_timestamp: p.exif_timestamp,
            timestamp: p.timestamp,
            exif_gps_lat: p.exif_gps_lat,
            exif_gps_lon: p.exif_gps_lon,
            is_screenshot: p.is_screenshot,
            is_document: p.is_document,
            category_source: p.category_source,
        }
    }
}

/// The validated fields `update()` acts on. `Some(None)` = explicit null.
#[derive(Debug, Default)]
struct EditInput {
    exif_timestamp: Option<Option<DateTime<Utc>>>,
    gps_lat: Option<Option<f64>>,
    gps_lon: Option<Option<f64>>,
    is_screenshot: Option<bool>,
    is_document: Option<bool>,
}

const DATETIME_FORMAT_ERR: &str = "Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].";

fn field_err(field: &str, message: &str) -> FieldError {
    FieldError {
        field: field.into(),
        message: message.into(),
    }
}

fn float_field(v: &Value) -> Result<Option<f64>, &'static str> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => n.as_f64().map(Some).ok_or("A valid number is required."),
        Value::String(s) => s
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|f| f.is_finite())
            .map(Some)
            .ok_or("A valid number is required."),
        _ => Err("A valid number is required."),
    }
}

fn datetime_field(v: &Value) -> Result<Option<DateTime<Utc>>, &'static str> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) => parse_client_datetime(s)
            .map(Some)
            .ok_or(DATETIME_FORMAT_ERR),
        _ => Err(DATETIME_FORMAT_ERR),
    }
}

/// DRF validation of the `PhotoEditSerializer` fields present in the body.
fn validate(body: &Map<String, Value>) -> ApiResult<EditInput> {
    let mut input = EditInput::default();
    let mut errors = Vec::new();
    let mut check = |field: &str, res: Result<(), &str>| {
        if let Err(m) = res {
            errors.push(field_err(field, m));
        }
    };
    for (field, v) in body {
        match field.as_str() {
            "exif_timestamp" => check(
                field,
                datetime_field(v).map(|d| input.exif_timestamp = Some(d)),
            ),
            "timestamp" => check(field, datetime_field(v).map(|_| ())),
            "exif_gps_lat" => check(field, float_field(v).map(|f| input.gps_lat = Some(f))),
            "exif_gps_lon" => check(field, float_field(v).map(|f| input.gps_lon = Some(f))),
            "is_screenshot" | "is_document" | "hidden" | "in_trashcan" | "removed" | "video" => {
                let parsed = match v {
                    Value::Null => Err("This field may not be null."),
                    other => django_bool(other).ok_or("Must be a valid boolean."),
                };
                check(
                    field,
                    parsed.map(|b| match field.as_str() {
                        "is_screenshot" => input.is_screenshot = Some(b),
                        "is_document" => input.is_document = Some(b),
                        _ => {}
                    }),
                )
            }
            "rating" => {
                let ok = match v {
                    Value::Number(n) => {
                        n.as_i64().is_some() || n.as_f64().is_some_and(|f| f.fract() == 0.0)
                    }
                    Value::String(s) => s.trim().parse::<i64>().is_ok(),
                    _ => false,
                };
                check(
                    field,
                    if ok {
                        Ok(())
                    } else {
                        Err("A valid integer is required.")
                    },
                )
            }
            "image_hash" => {
                let res = match v {
                    Value::Null => Err("This field may not be null."),
                    Value::String(s) if s.trim().is_empty() => Err("This field may not be blank."),
                    Value::String(s) if s.chars().count() > 64 => {
                        Err("Ensure this field has no more than 64 characters.")
                    }
                    Value::String(_) | Value::Number(_) | Value::Bool(_) => Ok(()),
                    _ => Err("Not a valid string."),
                };
                check(field, res)
            }
            _ => {}
        }
    }
    if errors.is_empty() {
        Ok(input)
    } else {
        Err(ApiError::fields(StatusCode::BAD_REQUEST, errors))
    }
}

pub(super) async fn patch_photo(
    State(state): State<AppState>,
    user: AuthUser,
    Path(lookup): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<EditResponse>> {
    let photo = reads::edit_target(&state.db, user.id, &lookup)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let body = object(body)?;
    let input = validate(&body)?;

    if input.is_screenshot.is_some() || input.is_document.is_some() {
        let mut conn = state.db.acquire().await?;
        svc::set_category(&mut conn, photo.id, input.is_screenshot, input.is_document).await?;
    }

    if let Some(timestamp) = input.exif_timestamp {
        apply_timestamp(&state, &user, &photo, timestamp).await?;
    }

    if let (Some(Some(lat)), Some(Some(lon))) = (input.gps_lat, input.gps_lon)
        && let Err(e) = apply_gps(&state, &photo, lat, lon).await
    {
        tracing::warn!(error = %e, "Failed to update GPS location for photo");
    }

    let fresh = reads::edit_photo_by_id(&state.db, photo.id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(Json(fresh.into()))
}

/// `_apply_exif_timestamp`: save the user's `timestamp`, then
/// `extract_date_time` (rules + day album). Like Django, the saved timestamp
/// stays when the extraction fails afterwards.
async fn apply_timestamp(
    state: &AppState,
    user: &lp_db::users::User,
    photo: &EditPhoto,
    timestamp: Option<DateTime<Utc>>,
) -> ApiResult<()> {
    {
        let mut conn = state.db.acquire().await?;
        svc::set_timestamp(&mut conn, photo.id, timestamp).await?;
    }
    let path = photo
        .main_file_path
        .clone()
        .ok_or_else(|| ApiError::internal("photo has no main file"))?;
    let rules = parse_rules(&user.datetime_rules);
    let input = RuleInput {
        path: &path,
        gps_lat: photo.exif_gps_lat,
        gps_lon: photo.exif_gps_lon,
        user_default_tz: &user.default_timezone,
        user_defined: timestamp,
    };
    let exiftool = state.config.binaries.exiftool.clone();
    let extracted = extract_local_date_time(&rules, &input, |tags| {
        let path = path.clone();
        async move { super::exif::get_metadata(&exiftool, &path, &tags).await }
    })
    .await
    .map_err(ApiError::internal)?;

    let mut tx = state.db.begin().await?;
    svc::set_exif_timestamp(
        &mut tx,
        photo.id,
        photo.owner_id,
        &photo.image_hash,
        photo.exif_timestamp,
        extracted,
    )
    .await?;
    let queued = metadata_to_disk(user) && timestamp != photo.timestamp;
    if queued {
        lp_jobs::enqueue_in(
            &mut tx,
            "metadata.write",
            json!({"photo_id": photo.id, "fields": ["timestamp"]}),
            &EnqueueOptions::default(),
        )
        .await?;
    }
    tx.commit().await?;
    if queued {
        lp_jobs::wake(state);
    }
    Ok(())
}

/// `_apply_gps_location`: the coordinates are saved before the geocoder
/// runs, so a geocoder failure still leaves them persisted.
async fn apply_gps(state: &AppState, photo: &EditPhoto, lat: f64, lon: f64) -> anyhow::Result<()> {
    let old_places = {
        let mut tx = state.db.begin().await?;
        let old = svc::album_places_of(&mut tx, photo.id).await?;
        svc::set_gps(&mut tx, photo.id, lat, lon).await?;
        tx.commit().await?;
        old
    };
    let Some(geo) = super::geocode::reverse_geocode(state, lat, lon).await else {
        tracing::warn!("Reverse geocoding returned no result for provided coordinates");
        return Ok(());
    };
    let mut tx = state.db.begin().await?;
    svc::apply_geocode(
        &mut tx,
        photo.id,
        photo.owner_id,
        &photo.image_hash,
        &geo,
        &old_places,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_errors() {
        let body = json!({"rating": "x", "hidden": "maybe", "exif_timestamp": "nope", "exif_gps_lat": "1.5"});
        let err = validate(body.as_object().unwrap()).unwrap_err();
        let fields: Vec<_> = err.errors.iter().map(|e| e.field.as_str()).collect();
        assert_eq!(fields, vec!["rating", "hidden", "exif_timestamp"]);

        let body = json!({"exif_timestamp": null, "exif_gps_lat": "1.5", "exif_gps_lon": 2, "is_document": true});
        let ok = validate(body.as_object().unwrap()).unwrap();
        assert_eq!(ok.exif_timestamp, Some(None));
        assert_eq!(ok.gps_lat, Some(Some(1.5)));
        assert_eq!(ok.gps_lon, Some(Some(2.0)));
        assert_eq!(ok.is_document, Some(true));
    }
}

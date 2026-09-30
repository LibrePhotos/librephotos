//! `AddFaceView` (`POST /api/addface`): a face box drawn by hand becomes a
//! labelled face. The box arrives as fractions of the displayed image and is
//! stored in big-thumbnail pixels; the crop is cut from the big thumbnail.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use image::codecs::jpeg::JpegEncoder;
use lp_auth::AuthUser;
use lp_core::codecs::FaceEncoding;
use lp_core::{ApiError, ApiJson, ApiResult, AppState};
use lp_db::people_faces::{self as db, UNKNOWN_PERSON_NAME};
use lp_db::write::people_faces::{self as write, NewManualFace};
use serde_json::{Value, json};

use super::{media_url, status_message, stripped_str};

/// A box smaller than this in big-thumbnail pixels is a stray drag.
const MIN_SIDE_PIXELS: i64 = 12;
/// `api.util.FACE_OVERLAP_IOU_THRESHOLD`.
const FACE_OVERLAP_IOU_THRESHOLD: f64 = 0.3;

fn bad(message: impl Into<String>) -> Response {
    status_message(StatusCode::BAD_REQUEST, message)
}

/// Python `float(v)` of a JSON value.
fn py_float(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Value::String(s) => s.trim().replace('_', "").parse::<f64>().ok(),
        _ => None,
    }
}

/// `AddFaceView._box_in_pixels`: `(top, right, bottom, left)` or the message.
fn box_in_pixels(b: Option<&Value>, width: u32, height: u32) -> Result<[i64; 4], String> {
    let Some(Value::Object(b)) = b else {
        return Err("box is required, with top, right, bottom and left".into());
    };
    let mut sides = [0.0f64; 4];
    for (i, side) in ["top", "right", "bottom", "left"].iter().enumerate() {
        let v = b
            .get(*side)
            .and_then(py_float)
            .ok_or_else(|| format!("box.{side} must be a number between 0 and 1"))?;
        if !(0.0..=1.0).contains(&v) {
            return Err(format!("box.{side} must be between 0 and 1"));
        }
        sides[i] = v;
    }
    let [top, right, bottom, left] = sides;
    if right <= left || bottom <= top {
        return Err("box must have a positive width and height".into());
    }
    let (w, h) = (width as f64, height as f64);
    let px = |x: f64| x.round_ties_even() as i64;
    let (w_i, h_i) = (width as i64, height as i64);
    let top = px(top * h).min(h_i - 1).max(0);
    let left = px(left * w).min(w_i - 1).max(0);
    let bottom = px(bottom * h).min(h_i).max(top + 1);
    let right = px(right * w).min(w_i).max(left + 1);
    if right - left < MIN_SIDE_PIXELS || bottom - top < MIN_SIDE_PIXELS {
        return Err(format!(
            "the box is too small; each side has to be at least {MIN_SIDE_PIXELS} pixels of the \
             photo's big thumbnail"
        ));
    }
    Ok([top, right, bottom, left])
}

/// `api.util.calculate_iou` on (top, right, bottom, left) boxes.
fn iou(a: [i64; 4], b: [i64; 4]) -> f64 {
    let inter_w = (a[1].min(b[1]) - a[3].max(b[3])).max(0);
    let inter_h = (a[2].min(b[2]) - a[0].max(b[0])).max(0);
    let inter = inter_w * inter_h;
    let area = |x: [i64; 4]| (x[2] - x[0]) * (x[1] - x[3]);
    let union = area(a) + area(b) - inter;
    if union <= 0 {
        0.0
    } else {
        inter as f64 / union as f64
    }
}

/// The face service's encoding of one box of an image, `None` when the
/// service is down, errors or detects no face there (Django then keeps the
/// face without an encoding).
async fn face_encoding(
    state: &AppState,
    image_path: &Path,
    location: [i64; 4],
) -> Option<Vec<f64>> {
    let model = state.settings().face_recognition_model.clone();
    let location = location.map(|v| v as i32);
    match state
        .ml()
        .face()
        .face_encodings(&image_path.to_string_lossy(), &[location], &model)
        .await
    {
        Ok(encodings) => encodings.into_iter().next().flatten(),
        Err(e) => {
            tracing::warn!(error = %e, "face service failed; face kept without encoding");
            None
        }
    }
}

fn thumbnail_size(path: &Path) -> Option<(u32, u32)> {
    image::ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

/// Crop `(top, right, bottom, left)` out of the image and encode it as a
/// JPEG (PIL's default quality 75).
fn crop_jpeg(path: &Path, b: [i64; 4]) -> anyhow::Result<Vec<u8>> {
    let img = image::ImageReader::open(path)?
        .with_guessed_format()?
        .decode()?;
    let [top, right, bottom, left] = b.map(|v| v as u32);
    let crop = img
        .crop_imm(left, top, right - left, bottom - top)
        .to_rgb8();
    let mut out = Cursor::new(Vec::new());
    JpegEncoder::new_with_quality(&mut out, 75).encode_image(&crop)?;
    Ok(out.into_inner())
}

fn media_path(root: &Path, name: &str) -> PathBuf {
    name.split(['/', '\\'])
        .filter(|s| !s.is_empty())
        .fold(root.to_path_buf(), |p, s| p.join(s))
}

/// `POST /api/addface` `{photo, person_name, box: {top, right, bottom, left}}`.
pub async fn add_face(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    if !body.is_object() {
        return Err(ApiError::internal("addface body is not an object"));
    }
    let person_name = stripped_str(&body, "person_name")?;
    if person_name.is_empty() {
        return Ok(bad("person_name must not be empty"));
    }
    if person_name == UNKNOWN_PERSON_NAME {
        return Ok(bad(format!(
            "a face drawn by hand has to name someone; '{UNKNOWN_PERSON_NAME}' is what the \
             algorithms use"
        )));
    }
    let photo_ref = match body.get("photo") {
        Some(v) if lp_core::extract::py_truthy(v) => match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        },
        _ => return Ok(bad("photo is required")),
    };
    let Some(photo) = db::add_face_photo(&state.db, user.id, &photo_ref).await? else {
        return Ok(status_message(StatusCode::NOT_FOUND, "photo not found"));
    };
    let Some(thumb_name) = photo.thumbnail_big.filter(|t| !t.is_empty()) else {
        return Ok(bad(
            "this photo has no big thumbnail yet, so there is nothing to measure the box against",
        ));
    };
    let thumb = media_path(&state.config.media_root, &thumb_name);
    let size = {
        let thumb = thumb.clone();
        state.blocking(move || thumbnail_size(&thumb)).await?
    };
    let Some((width, height)) = size else {
        tracing::error!(path = %thumb.display(), "cannot open thumbnail");
        return Ok(bad("this photo's thumbnail cannot be read"));
    };
    let bx = match box_in_pixels(body.get("box"), width, height) {
        Ok(b) => b,
        Err(message) => return Ok(bad(message)),
    };
    let overlaps = photo.boxes.iter().any(|e| {
        e.len() == 4
            && iou(bx, [e[0] as i64, e[1] as i64, e[2] as i64, e[3] as i64])
                >= FACE_OVERLAP_IOU_THRESHOLD
    });
    if overlaps {
        return Ok(status_message(
            StatusCode::CONFLICT,
            "there is already a face here; label that one instead of adding a second face over it",
        ));
    }

    let jpeg = {
        let thumb = thumb.clone();
        state
            .blocking(move || crop_jpeg(&thumb, bx))
            .await?
            .map_err(ApiError::internal)?
    };
    let faces_dir = state.config.faces_dir();
    tokio::fs::create_dir_all(&faces_dir).await?;
    let file_name = format!(
        "{}_manual_{}.jpg",
        photo.image_hash,
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    );
    let file_path = faces_dir.join(&file_name);
    tokio::fs::write(&file_path, &jpeg).await?;

    let encoding = face_encoding(&state, &thumb, bx)
        .await
        .map(|e| FaceEncoding::encode(&e))
        .unwrap_or_default();
    let image = format!("faces/{file_name}");
    let [top, right, bottom, left] = bx.map(|v| v as i32);
    let tagging_model = state.settings().tagging_model.clone();
    let created = write::add_manual_face(
        &state.db,
        user.id,
        &person_name,
        &NewManualFace {
            photo_id: photo.id,
            image: &image,
            top,
            right,
            bottom,
            left,
            encoding: &encoding,
        },
        &tagging_model,
    )
    .await;
    let (face_id, person_id) = match created {
        Ok(ids) => ids,
        Err(e) => {
            let _ = tokio::fs::remove_file(&file_path).await;
            return Err(e.into());
        }
    };
    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": true,
            "face": {
                "face_id": face_id,
                "face_url": media_url(&image),
                "person": person_id,
                "person_name": person_name,
                "location": {"top": top, "right": right, "bottom": bottom, "left": left},
            },
        })),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_rules() {
        let b = json!({"top": 0.25, "right": 0.6, "bottom": 0.75, "left": 0.4});
        assert_eq!(
            box_in_pixels(Some(&b), 400, 300).unwrap(),
            [75, 240, 225, 160]
        );
        // Python rounds half to even: 0.5 * 25 = 12.5 -> 12.
        let b = json!({"top": 0.5, "right": 1, "bottom": 1, "left": 0});
        assert_eq!(box_in_pixels(Some(&b), 100, 25).unwrap(), [12, 100, 25, 0]);
        let b = json!({"top": 0.5, "right": 0.55, "bottom": 1, "left": 0.5});
        assert!(
            box_in_pixels(Some(&b), 100, 100)
                .unwrap_err()
                .contains("too small")
        );
        let b = json!({"top": 0.5, "right": 0.1, "bottom": 1, "left": 0.2});
        assert!(
            box_in_pixels(Some(&b), 100, 100)
                .unwrap_err()
                .contains("positive")
        );
        let b = json!({"top": "x", "right": 0.1, "bottom": 1, "left": 0.2});
        assert_eq!(
            box_in_pixels(Some(&b), 100, 100).unwrap_err(),
            "box.top must be a number between 0 and 1"
        );
        let b = json!({"top": 1.5});
        assert_eq!(
            box_in_pixels(Some(&b), 100, 100).unwrap_err(),
            "box.top must be between 0 and 1"
        );
        assert!(
            box_in_pixels(None, 1, 1)
                .unwrap_err()
                .starts_with("box is required")
        );
    }

    #[test]
    fn overlap() {
        assert_eq!(iou([0, 10, 10, 0], [0, 10, 10, 0]), 1.0);
        assert_eq!(iou([0, 10, 10, 0], [20, 30, 30, 20]), 0.0);
    }
}

//! `POST /photosedit/rotate/` (`RotatePhotoView`): non-destructive rotation.
//! The thumbnails are rebuilt by the `thumbnails.rerender` job instead of
//! inside the request.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::time::py_isoformat;
use lp_core::{ApiJson, ApiResult, AppState};
use lp_db::photo_edits as reads;
use lp_db::write::photo_edits::edit as svc;
use lp_jobs::EnqueueOptions;
use serde_json::{Value, json};

use super::bulk::object;
use super::{py_str, status_message};

/// EXIF orientation 1-8 as `(n, m)`: `n` 90° CW steps, then `m` horizontal flips.
const ORIENTATION_TO_PARAMS: [(i32, (i32, i32)); 8] = [
    (1, (0, 0)),
    (2, (0, 1)),
    (3, (2, 0)),
    (4, (2, 1)),
    (5, (3, 1)),
    (6, (1, 0)),
    (7, (1, 1)),
    (8, (3, 0)),
];

/// `api.util.compose_orientation` (D4 group multiplication).
pub fn compose_orientation(current: i32, delta_angle_cw: i32, flip_h: bool) -> i32 {
    let (n_a, m_a) = ORIENTATION_TO_PARAMS
        .iter()
        .find(|(o, _)| *o == current)
        .map(|(_, p)| *p)
        .unwrap_or((0, 0));
    let n_b = (delta_angle_cw as f64 / 90.0).round() as i32;
    let n_b = n_b.rem_euclid(4);
    let m_b = i32::from(flip_h);
    let result_n = (n_b + if m_b == 0 { n_a } else { -n_a }).rem_euclid(4);
    let result_m = (m_b + m_a).rem_euclid(2);
    ORIENTATION_TO_PARAMS
        .iter()
        .find(|(_, p)| *p == (result_n, result_m))
        .map(|(o, _)| *o)
        .unwrap_or(1)
}

/// `_parse_rotation_angle`: Python `int(raw)`.
fn parse_angle(raw: Option<&Value>) -> Result<i64, &'static str> {
    let angle = match raw {
        None => Ok(0),
        Some(Value::Bool(b)) => Ok(i64::from(*b)),
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| {
                n.as_f64()
                    .filter(|f| f.is_finite())
                    .map(|f| f.trunc() as i64)
            })
            .ok_or("angle must be an integer"),
        Some(Value::String(s)) => s
            .trim()
            .replace('_', "")
            .parse::<i64>()
            .map_err(|_| "angle must be an integer"),
        Some(_) => Err("angle must be an integer"),
    }?;
    if angle % 90 != 0 {
        return Err("angle must be a multiple of 90 degrees");
    }
    Ok(angle)
}

pub(super) async fn rotate(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let body = object(body)?;
    let flip = body.get("flip_horizontal").is_some_and(py_truthy);
    let Some(image_hash) = body.get("image_hash").filter(|v| py_truthy(v)).map(py_str) else {
        return Ok(status_message(
            StatusCode::BAD_REQUEST,
            "image_hash is required",
        ));
    };
    let angle = match parse_angle(body.get("angle")) {
        Ok(a) => a,
        Err(m) => return Ok(status_message(StatusCode::BAD_REQUEST, m)),
    };
    let Some(photo) = reads::owned_by_hash(&state.db, user.id, &image_hash).await? else {
        return Ok(status_message(StatusCode::NOT_FOUND, "photo not found"));
    };
    if photo.video {
        return Ok(status_message(
            StatusCode::BAD_REQUEST,
            "rotation is not supported for videos",
        ));
    }

    let angle = angle.rem_euclid(360) as i32;
    let (orientation, last_modified) = if angle == 0 && !flip {
        (photo.local_orientation, photo.last_modified)
    } else {
        let orientation = compose_orientation(photo.local_orientation, angle, flip);
        let mut tx = state.db.begin().await?;
        let last_modified = svc::set_local_orientation(&mut tx, photo.id, orientation).await?;
        if photo.has_thumbnail_row {
            lp_jobs::enqueue_in(
                &mut tx,
                "thumbnails.rerender",
                json!({"photo_id": photo.id}),
                &EnqueueOptions::default(),
            )
            .await?;
        }
        tx.commit().await?;
        if !photo.has_thumbnail_row {
            // Django saved the orientation, then failed regenerating thumbnails.
            return Ok(status_message(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to rotate photo",
            ));
        }
        lp_jobs::wake(&state);
        (orientation, last_modified)
    };
    Ok(Json(json!({
        "status": true,
        "image_hash": photo.image_hash,
        "local_orientation": orientation,
        "last_modified": py_isoformat(&last_modified),
    }))
    .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orientation_group() {
        assert_eq!(compose_orientation(1, 90, false), 6);
        assert_eq!(compose_orientation(6, 90, false), 3);
        assert_eq!(compose_orientation(1, 270, false), 8);
        assert_eq!(compose_orientation(1, -90, false), 8);
        assert_eq!(compose_orientation(1, 0, true), 2);
        assert_eq!(compose_orientation(6, 0, true), 5);
        assert_eq!(compose_orientation(9, 90, false), 6);
        // Every (orientation, angle, flip) against Python's compose_orientation.
        let python = [
            1, 2, 6, 7, 3, 4, 8, 5, 8, 5, 2, 1, 7, 6, 4, 3, 5, 8, 5, 8, 3, 4, 8, 5, 1, 2, 6, 7, 6,
            7, 4, 3, 5, 8, 2, 1, 7, 6, 7, 6, 5, 6, 2, 3, 7, 8, 4, 1, 4, 1, 6, 5, 3, 2, 8, 7, 1, 4,
            1, 4, 7, 8, 4, 1, 5, 6, 2, 3, 2, 3, 8, 7, 1, 4, 6, 5, 3, 2, 3, 2,
        ];
        let mut i = 0;
        for o in 1..=8 {
            for a in [0, 90, 180, 270, -90] {
                for f in [false, true] {
                    assert_eq!(compose_orientation(o, a, f), python[i], "{o} {a} {f}");
                    i += 1;
                }
            }
        }
        for o in 1..=8 {
            assert_eq!(
                compose_orientation(compose_orientation(o, 0, true), 0, true),
                o
            );
            assert_eq!(compose_orientation(o, 360, false), o);
        }
    }

    #[test]
    fn angles() {
        assert_eq!(parse_angle(None), Ok(0));
        assert_eq!(parse_angle(Some(&json!(-90))), Ok(-90));
        assert_eq!(parse_angle(Some(&json!("180"))), Ok(180));
        assert_eq!(parse_angle(Some(&json!(90.7))), Ok(90));
        assert_eq!(
            parse_angle(Some(&json!(45))),
            Err("angle must be a multiple of 90 degrees")
        );
        assert_eq!(
            parse_angle(Some(&json!("abc"))),
            Err("angle must be an integer")
        );
        assert_eq!(
            parse_angle(Some(&json!(null))),
            Err("angle must be an integer")
        );
    }
}

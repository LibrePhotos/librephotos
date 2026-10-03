//! `POST /photosedit/rotate/` (`RotatePhotoView`): non-destructive rotation.
//! The thumbnails are rebuilt inside the request, as Django does, so the UI
//! reloads the rotated ones; a failed render falls back to the
//! `thumbnails.rerender` job. With `save_metadata_to_disk` on, the
//! orientation is written to the file or sidecar in the request.

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
use super::exif;
use super::{metadata_to_disk, py_str, status_message};

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

/// `api.thumbnails.exif_orientation_showing(exif, local)`, tabulated from
/// libvips: row = the file's EXIF orientation, column = `local_orientation`.
const EXIF_ORIENTATION_SHOWING: [[i32; 8]; 8] = [
    [1, 2, 3, 4, 5, 8, 7, 6],
    [2, 1, 4, 3, 8, 5, 6, 7],
    [3, 4, 1, 2, 7, 6, 5, 8],
    [4, 3, 2, 1, 6, 7, 8, 5],
    [5, 6, 7, 8, 1, 4, 3, 2],
    [6, 5, 8, 7, 4, 1, 2, 3],
    [7, 8, 5, 6, 3, 2, 1, 4],
    [8, 7, 6, 5, 2, 3, 4, 1],
];

/// libvips treats an orientation outside 1-8 as upright.
pub fn exif_orientation_showing(exif_orientation: i64, local_orientation: i32) -> i32 {
    let idx = |o: i64| {
        if (1..=8).contains(&o) {
            (o - 1) as usize
        } else {
            0
        }
    };
    EXIF_ORIENTATION_SHOWING[idx(exif_orientation)][idx(i64::from(local_orientation))]
}

/// `_EXIF_ORIENTED_EXTENSIONS` (none of them is a RAW extension).
fn renders_exif_orientation(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .is_some_and(|e| {
            matches!(
                e.as_str(),
                "jpg" | "jpeg" | "jpe" | "jfif" | "tif" | "tiff" | "png" | "webp"
            )
        })
}

/// `_fold_rotation_into_file`: `None` when the file cannot take the rotation
/// (nothing written), else the `local_orientation` to report.
async fn fold_rotation_into_file(
    state: &AppState,
    conn: &mut sqlx::PgConnection,
    photo_id: uuid::Uuid,
    path: &str,
    local: i32,
) -> anyhow::Result<Option<i32>> {
    let exiftool = &state.exif;
    if !renders_exif_orientation(path) {
        return Ok(None);
    }
    let Some(on_disk) = exif::read_orientation(exiftool, path).await else {
        return Ok(None);
    };
    let combined = exif_orientation_showing(on_disk, local);
    exif::write_tag(exiftool, path, "EXIF:Orientation", combined.into(), false).await?;
    let written = exif::read_orientation(exiftool, path).await;
    if written != Some(i64::from(combined)) {
        tracing::warn!(
            path,
            combined,
            ?written,
            "orientation was not written; keeping the rotation in the database"
        );
        return Ok(Some(local));
    }
    svc::adopt_written_orientation(conn, photo_id, combined).await?;
    Ok(Some(1))
}

/// `write_orientation_to_disk` for an owner with `save_metadata_to_disk` on.
/// Returns the `local_orientation` the photo ends up with.
async fn write_orientation_to_disk(
    state: &AppState,
    conn: &mut sqlx::PgConnection,
    user: &lp_db::users::User,
    photo: &reads::OwnedPhoto,
    angle: i32,
    flip: bool,
    local: i32,
) -> anyhow::Result<i32> {
    let use_sidecar = user.save_metadata_to_disk == "SIDECAR_FILE";
    let path = photo
        .main_file_path
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("photo has no main file"))?;
    if !use_sidecar
        && let Some(shown) = fold_rotation_into_file(state, conn, photo.id, path, local).await?
    {
        return Ok(shown);
    }
    let exif_orientation = reads::metadata_orientation(&mut *conn, photo.id)
        .await?
        .flatten()
        .filter(|o| *o != 0)
        .unwrap_or(1);
    let combined = compose_orientation(exif_orientation, angle, flip);
    exif::write_tag(
        &state.exif,
        path,
        "EXIF:Orientation",
        combined.into(),
        use_sidecar,
    )
    .await?;
    Ok(local)
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
        let mut tx = state.db.begin().await?;
        let current = svc::lock_local_orientation(&mut tx, photo.id).await?;
        let orientation = compose_orientation(current, angle, flip);
        let last_modified = svc::set_local_orientation(&mut tx, photo.id, orientation).await?;
        let mut shown = orientation;
        let mut disk_failed = false;
        if photo.has_thumbnail_row {
            // Before the commit: the render must not see the file rotated
            // while `local_orientation` still carries the turn.
            if metadata_to_disk(&user) {
                match write_orientation_to_disk(
                    &state,
                    &mut tx,
                    &user,
                    &photo,
                    angle,
                    flip,
                    orientation,
                )
                .await
                {
                    Ok(o) => shown = o,
                    Err(e) => {
                        tracing::warn!(error = %e, image_hash, "Failed to rotate photo");
                        disk_failed = true;
                    }
                }
            }
        }
        tx.commit().await?;
        if photo.has_thumbnail_row {
            regenerate_thumbnails(&state, photo.id).await?;
        }
        if !photo.has_thumbnail_row || disk_failed {
            // Django saved the orientation, then failed regenerating the
            // thumbnails or writing the file.
            return Ok(status_message(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to rotate photo",
            ));
        }
        (shown, last_modified)
    };
    Ok(Json(json!({
        "status": true,
        "image_hash": photo.image_hash,
        "local_orientation": orientation,
        "last_modified": py_isoformat(&last_modified),
    }))
    .into_response())
}

async fn regenerate_thumbnails(state: &AppState, photo_id: uuid::Uuid) -> ApiResult<()> {
    let Err(e) = lp_ingest::Pipeline::new(state.clone())
        .regenerate_thumbnails(photo_id)
        .await
    else {
        return Ok(());
    };
    tracing::warn!(error = %e, %photo_id, "thumbnail render failed, queueing thumbnails.rerender");
    lp_jobs::enqueue(
        state,
        "thumbnails.rerender",
        json!({"photo_id": photo_id}),
        EnqueueOptions::default(),
    )
    .await?;
    Ok(())
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
    fn orientation_shown_by_file() {
        for o in 1..=8 {
            assert_eq!(exif_orientation_showing(o, 1), o as i32);
            assert_eq!(
                exif_orientation_showing(1, o as i32),
                [1, 2, 3, 4, 5, 8, 7, 6][o as usize - 1]
            );
        }
        assert_eq!(exif_orientation_showing(0, 6), 8);
        assert_eq!(exif_orientation_showing(6, 6), 1);
        assert!(renders_exif_orientation("C:\\x\\a.JPG"));
        assert!(!renders_exif_orientation("/x/a.heic"));
        assert!(!renders_exif_orientation("/x/a.dng"));
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

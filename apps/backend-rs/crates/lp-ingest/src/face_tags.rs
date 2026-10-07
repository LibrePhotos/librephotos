//! Face regions written back to the photo's file or XMP sidecar after a
//! face is labelled or drawn by hand, when the owner turned on
//! `save_face_tags_to_disk` (`api/metadata/face_regions.py` through
//! `write_photo_metadata(metadata_types=["face_tags"])`).
//!
//! Like Django the target is the XMP sidecar when `save_metadata_to_disk` is
//! `SIDECAR_FILE` and the media file otherwise (also when it is `OFF`: the
//! face-tag switch is the opt-in). One difference: Django reads the
//! orientation with `-n` and compares it to the printed names, so it never
//! undoes the rotation and rotated photos get regions in display space. The
//! orientation is read printed here, as the read path (`face_extractor`)
//! does, so a written region reads back onto the same face.

use std::path::Path;

use anyhow::anyhow;
use lp_core::AppState;
use lp_jobs::{EnqueueOptions, JobCtx};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::FromRow;
use uuid::Uuid;

pub const KIND: &str = "metadata.face_tags";

pub const REGION_INFO_WRITE: &str = "XMP-mwg-rs:RegionInfo";
pub const SUBJECT: &str = "XMP:Subject";

#[derive(Debug, Deserialize)]
struct Payload {
    photo_ids: Vec<Uuid>,
}

/// Queue the write for `photo_ids` when `user` opted in. Never fails the
/// caller: Django logs a failed write and answers the request anyway.
pub async fn queue(state: &AppState, user: &lp_db::users::User, photo_ids: &[Uuid]) {
    if !user.save_face_tags_to_disk || photo_ids.is_empty() {
        return;
    }
    let mut ids = photo_ids.to_vec();
    ids.sort();
    ids.dedup();
    if let Err(e) = lp_jobs::enqueue(
        state,
        KIND,
        json!({ "photo_ids": ids }),
        EnqueueOptions::default(),
    )
    .await
    {
        tracing::error!(error = %e, "could not queue the face tag write");
    }
}

pub async fn run(ctx: JobCtx) -> anyhow::Result<()> {
    let p: Payload = serde_json::from_value(ctx.job.payload.clone())
        .map_err(|e| anyhow!("bad {KIND} payload: {e}"))?;
    // Two label requests in a row queue two jobs for the same photo; run
    // concurrently, both ExifTool writes race on one file (and its temp
    // file) and the stale one can win. One at a time, each reading the
    // faces when it starts, the file ends with the latest labels.
    static WRITES: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    for id in p.photo_ids {
        let _one_at_a_time = WRITES.lock().await;
        if let Err(e) = write_face_tags(&ctx.state, id).await {
            tracing::error!(photo = %id, error = %format!("{e:#}"), "Failed to write face tags");
        }
    }
    Ok(())
}

#[derive(Debug, FromRow)]
struct PhotoRow {
    image_hash: String,
    path: Option<String>,
    thumbnail_big: Option<String>,
    save_metadata_to_disk: String,
}

#[derive(Debug, FromRow)]
struct FaceRow {
    location_top: i32,
    location_right: i32,
    location_bottom: i32,
    location_left: i32,
    person_kind: Option<String>,
    person_name: Option<String>,
}

/// One MWG region, normalized and centre-based.
#[derive(Debug, Clone, PartialEq)]
pub struct Region {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// What [`region_tags`] found for one photo: its main file and the tags.
pub struct RegionTags {
    pub image_hash: String,
    pub path: String,
    pub save_metadata_to_disk: String,
    pub tags: Vec<(String, Value)>,
}

/// Write the photo's face regions; false when there was nothing to write.
pub async fn write_face_tags(state: &AppState, photo_id: Uuid) -> anyhow::Result<bool> {
    let Some(found) = region_tags(state, photo_id).await? else {
        return Ok(false);
    };
    let use_sidecar = found.save_metadata_to_disk == "SIDECAR_FILE";
    tracing::info!(photo = %found.image_hash, sidecar = use_sidecar, "writing face regions");
    state
        .exif
        .write_metadata(Path::new(&found.path), &found.tags, use_sidecar)
        .await
        .map_err(|e| anyhow!("{e}"))?;
    Ok(true)
}

/// `get_face_region_tags`: the RegionInfo (+ `XMP:Subject`) tags of the
/// photo's non-deleted faces; None when it has no main file, no faces or no
/// readable thumbnail (Django's `{}`).
pub async fn region_tags(state: &AppState, photo_id: Uuid) -> anyhow::Result<Option<RegionTags>> {
    let photo: Option<PhotoRow> = lp_db::sql::query_as(
        "SELECT p.image_hash, f.path, t.thumbnail_big, u.save_metadata_to_disk \
         FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         LEFT JOIN api_file f ON f.hash = p.main_file_id \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id WHERE p.id = $1",
    )
    .bind(photo_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(photo) = photo else {
        return Ok(None);
    };
    let Some(path) = photo.path.filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    let faces: Vec<FaceRow> = lp_db::sql::query_as(
        "SELECT f.location_top, f.location_right, f.location_bottom, f.location_left, \
           pe.kind AS person_kind, pe.name AS person_name \
         FROM api_face f LEFT JOIN api_person pe ON pe.id = f.person_id \
         WHERE f.photo_id = $1 AND NOT f.deleted ORDER BY f.id",
    )
    .bind(photo_id)
    .fetch_all(&state.db)
    .await?;
    if faces.is_empty() {
        return Ok(None);
    }
    let thumb = photo
        .thumbnail_big
        .filter(|t| !t.is_empty())
        .map(|t| state.config.media_root.join(t));
    let Some((tw, th)) = thumb.as_deref().and_then(crate::render::image_size) else {
        tracing::error!(
            "Cannot open thumbnail for photo {}, skipping face tags",
            photo.image_hash
        );
        return Ok(None);
    };
    let media = Path::new(&path);
    let orientation = state
        .exif
        .get_metadata(media, &["EXIF:Orientation".to_string()], true, true)
        .await
        .map_err(|e| anyhow!("{e}"))?
        .into_iter()
        .next()
        .flatten();
    let dims = state
        .exif
        .get_metadata(
            media,
            &["ImageWidth".to_string(), "ImageHeight".to_string()],
            true,
            false,
        )
        .await
        .map_err(|e| anyhow!("{e}"))?;
    let orientation = orientation.as_ref().and_then(Value::as_str).unwrap_or("");
    let regions: Vec<Region> = faces
        .iter()
        .map(|f| {
            let (x, y, w, h) = thumbnail_coords_to_normalized(
                f.location_top,
                f.location_right,
                f.location_bottom,
                f.location_left,
                tw,
                th,
            );
            let (x, y, w, h) = reverse_orientation_transform(x, y, w, h, orientation);
            let name = match (f.person_kind.as_deref(), &f.person_name) {
                (Some("USER"), Some(n)) => n.clone(),
                _ => String::new(),
            };
            Region { name, x, y, w, h }
        })
        .collect();
    let tags = build_face_region_args(
        &regions,
        dims.first().cloned().flatten(),
        dims.get(1).cloned().flatten(),
    );
    Ok(Some(RegionTags {
        image_hash: photo.image_hash,
        path,
        save_metadata_to_disk: photo.save_metadata_to_disk,
        tags,
    }))
}

/// `thumbnail_coords_to_normalized`.
pub fn thumbnail_coords_to_normalized(
    top: i32,
    right: i32,
    bottom: i32,
    left: i32,
    width: u32,
    height: u32,
) -> (f64, f64, f64, f64) {
    let (w, h) = (width as f64, height as f64);
    (
        (left + right) as f64 / 2.0 / w,
        (top + bottom) as f64 / 2.0 / h,
        (right - left) as f64 / w,
        (bottom - top) as f64 / h,
    )
}

/// `reverse_orientation_transform` (inverse of `face_extractor`'s transforms).
pub fn reverse_orientation_transform(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    orientation: &str,
) -> (f64, f64, f64, f64) {
    match orientation {
        "Rotate 90 CW" | "Mirror horizontal and rotate 270 CW" => (y, 1.0 - x, h, w),
        "Mirror horizontal" => (1.0 - x, y, w, h),
        "Rotate 180" => (1.0 - x, 1.0 - y, w, h),
        "Mirror vertical" => (x, 1.0 - y, w, h),
        "Mirror horizontal and rotate 90 CW" | "Rotate 270 CW" => (1.0 - y, x, h, w),
        _ => (x, y, w, h),
    }
}

/// `_escape_exiftool_value`.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        if matches!(c, '\\' | '{' | '}' | '=' | ',') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn truthy_dim(v: &Option<Value>) -> Option<String> {
    match v {
        Some(Value::Number(n)) if n.as_f64().is_some_and(|f| f != 0.0) => Some(n.to_string()),
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// `build_face_region_exiftool_args`: the structured RegionInfo value plus
/// the labelled names as `XMP:Subject` keywords.
pub fn build_face_region_args(
    regions: &[Region],
    image_width: Option<Value>,
    image_height: Option<Value>,
) -> Vec<(String, Value)> {
    let parts: Vec<String> = regions
        .iter()
        .map(|r| {
            format!(
                "{{Area={{X={:.6},Y={:.6},W={:.6},H={:.6},Unit=normalized}},Name={},Type=Face}}",
                r.x,
                r.y,
                r.w,
                r.h,
                escape(&r.name)
            )
        })
        .collect();
    let applied_to = match (truthy_dim(&image_width), truthy_dim(&image_height)) {
        (Some(w), Some(h)) => format!("AppliedToDimensions={{W={w},H={h},Unit=pixel}},"),
        _ => String::new(),
    };
    let mut tags = vec![(
        REGION_INFO_WRITE.to_string(),
        Value::String(format!("{{{applied_to}RegionList=[{}]}}", parts.join(","))),
    )];
    let names: Vec<Value> = regions
        .iter()
        .filter(|r| !r.name.is_empty())
        .map(|r| Value::String(r.name.clone()))
        .collect();
    if !names.is_empty() {
        tags.push((SUBJECT.to_string(), Value::Array(names)));
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_match_django() {
        // Expected strings from api.metadata.face_regions.build_face_region_exiftool_args.
        let regions = vec![
            Region {
                name: "Ann, {x}=1\\".into(),
                x: 0.5,
                y: 0.25,
                w: 0.1,
                h: 1.0 / 3.0,
            },
            Region {
                name: String::new(),
                x: -0.0,
                y: 0.9999999,
                w: 0.2,
                h: 0.2,
            },
        ];
        let tags = build_face_region_args(&regions, Some(json!(4000)), Some(json!(3000)));
        assert_eq!(
            tags[0].1,
            json!(
                "{AppliedToDimensions={W=4000,H=3000,Unit=pixel},RegionList=[\
                 {Area={X=0.500000,Y=0.250000,W=0.100000,H=0.333333,Unit=normalized},\
                 Name=Ann\\, \\{x\\}\\=1\\\\,Type=Face},\
                 {Area={X=-0.000000,Y=1.000000,W=0.200000,H=0.200000,Unit=normalized},\
                 Name=,Type=Face}]}"
            )
        );
        assert_eq!(tags[1], (SUBJECT.into(), json!(["Ann, {x}=1\\"])));
        let bare = build_face_region_args(&regions[1..], None, Some(json!(3000)));
        assert_eq!(bare.len(), 1);
        assert!(bare[0].1.as_str().unwrap().starts_with("{RegionList=["));
    }

    #[test]
    fn reverse_undoes_the_read_transforms() {
        // face_extractor.ORIENTATION_TRANSFORMS, applied after the reverse.
        let forward = |o: &str, (x, y, w, h): (f64, f64, f64, f64)| match o {
            "Rotate 90 CW" | "Mirror horizontal and rotate 270 CW" => (1.0 - y, x, h, w),
            "Mirror horizontal" => (1.0 - x, y, w, h),
            "Rotate 180" => (1.0 - x, 1.0 - y, w, h),
            "Mirror vertical" => (x, 1.0 - y, w, h),
            "Mirror horizontal and rotate 90 CW" | "Rotate 270 CW" => (y, 1.0 - x, h, w),
            _ => (x, y, w, h),
        };
        for o in [
            "Horizontal (normal)",
            "Rotate 90 CW",
            "Mirror horizontal",
            "Rotate 180",
            "Mirror vertical",
            "Mirror horizontal and rotate 270 CW",
            "Mirror horizontal and rotate 90 CW",
            "Rotate 270 CW",
        ] {
            let v = (0.2, 0.7, 0.1, 0.3);
            let (x, y, w, h) = reverse_orientation_transform(v.0, v.1, v.2, v.3, o);
            let back = forward(o, (x, y, w, h));
            assert!(
                (back.0 - v.0).abs() < 1e-12
                    && (back.1 - v.1).abs() < 1e-12
                    && back.2 == v.2
                    && back.3 == v.3,
                "{o}"
            );
        }
        assert_eq!(
            thumbnail_coords_to_normalized(10, 60, 50, 20, 100, 200),
            (0.4, 0.15, 0.4, 0.2)
        );
    }
}

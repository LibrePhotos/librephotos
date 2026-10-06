//! Bulk metadata write-back: `manage.py save_metadata` and
//! `POST /api/savemetadata` (`SaveMetadataView`), both a loop of
//! `write_photo_metadata(photo, use_sidecar=..., metadata_types=...)` with
//! `modified_fields=None`: the current rating (`ratings`) and the face
//! regions (`face_tags`) of every selected photo, merged into one ExifTool
//! write per photo.

use std::path::Path;

use anyhow::anyhow;
use lp_core::AppState;
use serde_json::{Value, json};
use uuid::Uuid;

/// `--types` / `{"types": [...]}` values.
pub const RATINGS: &str = "ratings";
pub const FACE_TAGS: &str = "face_tags";

/// Which photos a face-tags-only run looks at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceFilter {
    /// The command: photos with any non-deleted face.
    AnyFace,
    /// The view: photos with a non-deleted face of a user-labelled person.
    LabelledFace,
}

/// The photos to write, in id order: all of them, or `owner`'s; only those
/// with faces when `types` is exactly `["face_tags"]`.
pub async fn select_photos(
    state: &AppState,
    owner: Option<i32>,
    types: &[String],
    face_filter: FaceFilter,
) -> sqlx::Result<Vec<Uuid>> {
    let faces_only = types.len() == 1 && types[0] == FACE_TAGS;
    let face_sql = match (faces_only, face_filter) {
        (false, _) => "",
        (true, FaceFilter::AnyFace) => {
            " AND EXISTS (SELECT 1 FROM api_face f WHERE f.photo_id = p.id AND NOT f.deleted)"
        }
        (true, FaceFilter::LabelledFace) => {
            " AND EXISTS (SELECT 1 FROM api_face f JOIN api_person pe ON pe.id = f.person_id \
               WHERE f.photo_id = p.id AND NOT f.deleted AND pe.kind = 'USER')"
        }
    };
    sqlx::query_scalar(&format!(
        "SELECT p.id FROM api_photo p WHERE ($1::int IS NULL OR p.owner_id = $1){face_sql} ORDER BY p.id"
    ))
    .bind(owner)
    .fetch_all(&state.db)
    .await
}

/// `write_photo_metadata(photo, use_sidecar, metadata_types)` with
/// `modified_fields=None`. Ok(false) when there was nothing to write (Django
/// still counts the photo as written); an error when the photo has no main
/// file or ExifTool failed.
pub async fn write_photo(
    state: &AppState,
    photo_id: Uuid,
    types: &[String],
    use_sidecar: bool,
) -> anyhow::Result<bool> {
    let row: Option<(i32, Option<String>)> = sqlx::query_as(
        "SELECT p.rating, f.path FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id \
         WHERE p.id = $1",
    )
    .bind(photo_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((rating, path)) = row else {
        return Ok(false);
    };
    let mut tags: Vec<(String, Value)> = Vec::new();
    if types.iter().any(|t| t == RATINGS) {
        tags.push(("Rating".into(), json!(rating)));
    }
    if types.iter().any(|t| t == FACE_TAGS)
        && let Some(found) = crate::face_tags::region_tags(state, photo_id).await?
    {
        tags.extend(found.tags);
    }
    if tags.is_empty() {
        return Ok(false);
    }
    // Django: `photo.main_file.path` on a photo without one raises.
    let path = path
        .filter(|p| !p.is_empty())
        .ok_or_else(|| anyhow!("'NoneType' object has no attribute 'path'"))?;
    state
        .exif
        .write_metadata(Path::new(&path), &tags, use_sidecar)
        .await
        .map_err(|e| anyhow!("{e}"))?;
    Ok(true)
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Outcome {
    pub written: usize,
    pub errors: usize,
}

/// Write every photo in `ids`; `on_error(image_hash or id, error)` and
/// `on_progress(i, written, errors)` (every 100 photos) report as it goes.
pub async fn write_all(
    state: &AppState,
    ids: &[Uuid],
    types: &[String],
    use_sidecar: bool,
    mut on_error: impl FnMut(&str, &anyhow::Error),
    mut on_progress: impl FnMut(usize, Outcome),
) -> Outcome {
    let mut out = Outcome::default();
    for (i, id) in ids.iter().enumerate() {
        match write_photo(state, *id, types, use_sidecar).await {
            Ok(_) => out.written += 1,
            Err(e) => {
                out.errors += 1;
                let hash: Option<String> =
                    sqlx::query_scalar("SELECT image_hash FROM api_photo WHERE id = $1")
                        .bind(id)
                        .fetch_optional(&state.db)
                        .await
                        .ok()
                        .flatten();
                on_error(&hash.unwrap_or_else(|| id.to_string()), &e);
            }
        }
        if (i + 1) % 100 == 0 {
            on_progress(i + 1, out);
        }
    }
    out
}

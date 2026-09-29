//! `ocr.generate` (`processing_jobs.generate_ocr` / `_run_ocr_for_photo`)
//! and `media.classify` (`processing_jobs.classify_media`).

use std::collections::HashMap;

use futures::TryStreamExt;
use lp_core::AppState;
use lp_jobs::JobType;
use lp_sidecars::SidecarError;
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::detect::{self, ScreenshotInput};
use crate::fanout::{PHOTO_CONCURRENCY, for_each_photo};
use crate::photos::{self, path_str};
use crate::run::{self, CANCEL_CHECK_EVERY, ItemCounter};
use crate::things;

/// `OCR_MIN_CONFIDENCE`: per-block confidence handed to the sidecar.
pub const OCR_MIN_CONFIDENCE: f64 = 0.6;
/// `PhotoOcr.MAX_TEXT_LENGTH` / `MAX_BLOCKS` (S18).
pub const MAX_TEXT_LENGTH: usize = 20_000;
pub const MAX_BLOCKS: usize = 500;

/// Originals cv2 can decode; anything else (RAW, HEIC) is read from the big thumbnail.
const CV2_DECODABLE: [&str; 7] = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"];

/// `ml_models._is_model_not_selected`.
pub fn model_not_selected(value: &str) -> bool {
    let v = value.trim();
    v.is_empty() || v.eq_ignore_ascii_case("none")
}

pub async fn generate(
    state: &AppState,
    user_id: i32,
    full_scan: bool,
    job_id: &str,
) -> anyhow::Result<()> {
    let model = state.settings().ocr_model.clone();
    if model_not_selected(&model) {
        run::set_progress(&state.db, job_id, 0, 0).await?;
        run::complete(&state.db, job_id).await?;
        return Ok(());
    }
    let last = run::last_finished_start(&state.db, user_id, JobType::GenerateOcr, true).await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM api_photo p LEFT JOIN api_photo_ocr o ON o.photo_id = p.id \
         WHERE p.owner_id = $1 AND NOT p.video \
           AND ($2 OR ( \
             (o.photo_id IS NULL OR o.engine <> $3) \
             AND ($4::boolean IS FALSE OR p.added_on > $5 OR o.photo_id IS NOT NULL))) \
         ORDER BY p.id",
    )
    .bind(user_id)
    .bind(full_scan)
    .bind(&model)
    .bind(last.is_some())
    .bind(last.flatten())
    .fetch_all(&state.db)
    .await?;
    if !run::start_items(&state.db, job_id, ids.len() as i64).await? {
        return Ok(());
    }
    for_each_photo(state, job_id, ids, PHOTO_CONCURRENCY, |id| async move {
        ocr_photo(state, id).await.map_err(|e| e.to_string())
    })
    .await?;
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum OcrError {
    #[error("Photo {hash}: OCR service returned status {status} for {path}: {detail}")]
    Status {
        hash: String,
        status: u16,
        path: String,
        detail: String,
    },
    #[error("Photo {hash}: {source}")]
    Sidecar {
        hash: String,
        #[source]
        source: SidecarError,
    },
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// `ocr_image_source`: the original when cv2 reads it, else the big thumbnail.
fn image_source(state: &AppState, photo: &photos::TaskPhoto) -> Option<String> {
    if let Some(main) = photo.main_path.as_deref().filter(|p| !p.is_empty())
        && CV2_DECODABLE.contains(&detect::extension_lower(main).as_str())
    {
        return Some(main.to_string());
    }
    photo
        .thumbnail_path(&state.config.media_root)
        .map(|p| path_str(&p))
}

pub async fn ocr_photo(state: &AppState, photo_id: Uuid) -> Result<(), OcrError> {
    let model = state.settings().ocr_model.clone();
    if model_not_selected(&model) {
        return Ok(());
    }
    let Some(photo) = photos::load_one(&state.db, photo_id).await? else {
        return Ok(());
    };
    let Some(image_path) = image_source(state, &photo) else {
        tracing::warn!(photo = %photo.image_hash, "no OCR image source");
        return Ok(());
    };
    let data = match state.sidecars.ocr(&image_path, OCR_MIN_CONFIDENCE).await {
        Ok(d) => d,
        Err(SidecarError::Status { status, detail, .. }) => {
            return Err(OcrError::Status {
                hash: photo.image_hash,
                status,
                path: image_path,
                detail,
            });
        }
        Err(source) => {
            return Err(OcrError::Sidecar {
                hash: photo.image_hash,
                source,
            });
        }
    };
    let text = data.text.clone().unwrap_or_default();
    let stored_text: String = text.chars().take(MAX_TEXT_LENGTH).collect();
    let blocks = match data.blocks.clone() {
        Some(Value::Array(mut items)) => {
            items.truncate(MAX_BLOCKS);
            Value::Array(items)
        }
        Some(Value::Null) | None => Value::Array(vec![]),
        Some(other) if is_falsy(&other) => Value::Array(vec![]),
        Some(other) => other,
    };

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO api_photo_ocr (photo_id, text, blocks, engine, mean_confidence, \
           text_area_fraction, created_at, updated_at, source_width, source_height) \
         VALUES ($1, $2, $3, $4, $5, $6, now(), now(), $7, $8) \
         ON CONFLICT (photo_id) DO UPDATE SET text = EXCLUDED.text, blocks = EXCLUDED.blocks, \
           engine = EXCLUDED.engine, mean_confidence = EXCLUDED.mean_confidence, \
           text_area_fraction = EXCLUDED.text_area_fraction, updated_at = now(), \
           source_width = EXCLUDED.source_width, source_height = EXCLUDED.source_height",
    )
    .bind(photo_id)
    .bind(&stored_text)
    .bind(&blocks)
    .bind(&model)
    .bind(data.mean_confidence)
    .bind(data.text_area_fraction)
    .bind(data.image_width.map(|w| w as i32))
    .bind(data.image_height.map(|h| h as i32))
    .execute(&mut *tx)
    .await?;
    let labels = things::siglip_labels(&mut tx, &[photo_id])
        .await?
        .remove(&photo_id)
        .unwrap_or_default();
    let is_document = detect::classify_document(Some(&text), data.text_area_fraction, &labels);
    // `_derive_is_document`: never over a manual correction; Django saves
    // with update_fields, so last_modified stays as it is.
    sqlx::query(
        "UPDATE api_photo SET is_document = $2 \
         WHERE id = $1 AND category_source <> 'user' AND is_document <> $2",
    )
    .bind(photo_id)
    .bind(is_document)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    tracing::info!(image = %image_path, model = %model, chars = text.chars().count(), "generated OCR");
    Ok(())
}

fn is_falsy(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::Bool(b) => !b,
        Value::Number(n) => n.as_f64() == Some(0.0),
        Value::String(s) => s.is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
    }
}

#[derive(Debug, FromRow)]
struct ClassifyRow {
    id: Uuid,
    is_screenshot: bool,
    is_document: bool,
    exif_gps_lat: Option<f64>,
    exif_gps_lon: Option<f64>,
    main_path: Option<String>,
    has_metadata: bool,
    camera_model: Option<String>,
    aperture: Option<f64>,
    iso: Option<i32>,
    focal_length: Option<f64>,
    gps_latitude: Option<f64>,
    gps_longitude: Option<f64>,
    has_ocr: bool,
    ocr_text: Option<String>,
    text_area_fraction: Option<f64>,
}

/// `classify_media`: re-derive `is_screenshot` for every photo not
/// corrected by hand, and `is_document` for those with OCR. DB only; writes
/// in batches of 200 without touching `last_modified` (Django's
/// `bulk_update`).
pub async fn classify_media(state: &AppState, user_id: i32, job_id: &str) -> anyhow::Result<()> {
    const BATCH: usize = 200;
    let target: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_photo WHERE owner_id = $1 AND category_source <> 'user'",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if !run::start_items(&state.db, job_id, target).await? {
        return Ok(());
    }
    let mut counter = ItemCounter::new(state.db.clone(), job_id, target as usize);
    let mut conn = state.db.acquire().await?;
    let mut rows = sqlx::query_as::<_, ClassifyRow>(
        "SELECT p.id, p.is_screenshot, p.is_document, p.exif_gps_lat, p.exif_gps_lon, \
           f.path AS main_path, (m.id IS NOT NULL) AS has_metadata, m.camera_model, m.aperture, \
           m.iso, m.focal_length, m.gps_latitude, m.gps_longitude, \
           (o.photo_id IS NOT NULL) AS has_ocr, o.text AS ocr_text, o.text_area_fraction \
         FROM api_photo p \
         LEFT JOIN api_file f ON f.hash = p.main_file_id \
         LEFT JOIN api_photometadata m ON m.photo_id = p.id \
         LEFT JOIN api_photo_ocr o ON o.photo_id = p.id \
         WHERE p.owner_id = $1 AND p.category_source <> 'user'",
    )
    .bind(user_id)
    .fetch(&mut *conn);

    let mut batch: Vec<ClassifyRow> = Vec::with_capacity(BATCH);
    let mut seen = 0usize;
    let mut cancelled = false;
    while let Some(row) = rows.try_next().await? {
        if seen.is_multiple_of(CANCEL_CHECK_EVERY) && run::is_cancelled(&state.db, job_id).await? {
            cancelled = true;
            break;
        }
        seen += 1;
        batch.push(row);
        if batch.len() >= BATCH {
            write_classified(state, std::mem::take(&mut batch), &mut counter).await?;
        }
    }
    drop(rows);
    drop(conn);
    if cancelled {
        counter.flush().await?;
        return Ok(());
    }
    write_classified(state, batch, &mut counter).await?;
    counter.finish().await?;
    Ok(())
}

async fn write_classified(
    state: &AppState,
    batch: Vec<ClassifyRow>,
    counter: &mut ItemCounter,
) -> anyhow::Result<()> {
    if batch.is_empty() {
        return Ok(());
    }
    let with_ocr: Vec<Uuid> = batch.iter().filter(|r| r.has_ocr).map(|r| r.id).collect();
    let labels: HashMap<Uuid, Vec<String>> = if with_ocr.is_empty() {
        HashMap::new()
    } else {
        let mut conn = state.db.acquire().await?;
        things::siglip_labels(&mut conn, &with_ocr).await?
    };
    let mut screenshot_ids = Vec::new();
    let mut screenshot_vals = Vec::new();
    let mut document_ids = Vec::new();
    let mut document_vals = Vec::new();
    for row in &batch {
        let shot = detect::is_screenshot(&ScreenshotInput {
            main_path: row.main_path.as_deref(),
            has_metadata: row.has_metadata,
            camera_model: row.camera_model.as_deref(),
            aperture: row.aperture,
            iso: row.iso,
            focal_length: row.focal_length,
            photo_gps: row.exif_gps_lat.is_some() || row.exif_gps_lon.is_some(),
            metadata_gps: row.gps_latitude.is_some() || row.gps_longitude.is_some(),
        });
        if shot != row.is_screenshot {
            screenshot_ids.push(row.id);
            screenshot_vals.push(shot);
        }
        if row.has_ocr {
            let empty = Vec::new();
            let doc = detect::classify_document(
                row.ocr_text.as_deref(),
                row.text_area_fraction,
                labels.get(&row.id).unwrap_or(&empty),
            );
            if doc != row.is_document {
                document_ids.push(row.id);
                document_vals.push(doc);
            }
        }
    }
    let mut tx = state.db.begin().await?;
    if !screenshot_ids.is_empty() {
        sqlx::query(
            "UPDATE api_photo p SET is_screenshot = u.v \
             FROM unnest($1::uuid[], $2::bool[]) AS u(id, v) WHERE p.id = u.id",
        )
        .bind(&screenshot_ids)
        .bind(&screenshot_vals)
        .execute(&mut *tx)
        .await?;
    }
    if !document_ids.is_empty() {
        sqlx::query(
            "UPDATE api_photo p SET is_document = u.v \
             FROM unnest($1::uuid[], $2::bool[]) AS u(id, v) WHERE p.id = u.id",
        )
        .bind(&document_ids)
        .bind(&document_vals)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    for _ in 0..batch.len() {
        counter.done(None).await?;
    }
    Ok(())
}

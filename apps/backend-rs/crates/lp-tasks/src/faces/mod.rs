//! Faces: `faces.scan` (`processing_jobs.scan_faces` + `photo_faces.extract_faces`),
//! the encoding back-fill (`generate_face_embeddings`) and, in [`cluster`],
//! `faces.cluster` / `faces.train` (`face_classify.py`).

pub mod cluster;
pub mod xmp;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures::StreamExt;
use image::RgbImage;
use lp_core::AppState;
use lp_core::codecs::FaceEncoding;
use lp_jobs::JobType;
use lp_sidecars::FaceBox;
use rand::Rng;
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::photos::{self, TaskPhoto, path_str};
use crate::run::{self, CANCEL_CHECK_EVERY, ItemCounter};

/// `FACE_OVERLAP_IOU_THRESHOLD`.
pub const FACE_OVERLAP_IOU: f64 = 0.3;
/// PIL's default JPEG quality, what `save_detected_face` writes crops with.
const CROP_JPEG_QUALITY: u8 = 75;

/// `calculate_iou` over `(top, right, bottom, left)` boxes.
pub fn iou(a: FaceBox, b: FaceBox) -> f64 {
    let [at, ar, ab, al] = a.map(i64::from);
    let [bt, br, bb, bl] = b.map(i64::from);
    let inter_w = (ar.min(br) - al.max(bl)).max(0);
    let inter_h = (ab.min(bb) - at.max(bt)).max(0);
    let inter = inter_w * inter_h;
    let area_a = (ab - at) * (ar - al);
    let area_b = (bb - bt) * (br - bl);
    let union = area_a + area_b - inter;
    if union <= 0 {
        return 0.0;
    }
    inter as f64 / union as f64
}

pub fn overlaps(existing: &[FaceBox], candidate: FaceBox) -> bool {
    existing
        .iter()
        .any(|e| iou(candidate, *e) >= FACE_OVERLAP_IOU)
}

/// `faces.scan`: detect faces on the user's photos with a big thumbnail
/// (all of them on a full scan, else those added since the last run), then
/// back-fill missing encodings and re-cluster, each as its own job.
pub async fn scan(
    state: &AppState,
    user_id: i32,
    full_scan: bool,
    job_id: &str,
) -> anyhow::Result<()> {
    scan_with(state, user_id, full_scan, false, job_id).await
}

/// [`scan`]; with `skip_inline` (the follow-up of a scan that ran ML inline,
/// round 3 #19) photos whose faces that scan already found with the current
/// pack are skipped.
pub async fn scan_with(
    state: &AppState,
    user_id: i32,
    full_scan: bool,
    skip_inline: bool,
    job_id: &str,
) -> anyhow::Result<()> {
    let since = if full_scan {
        None
    } else {
        run::last_finished_start(&state.db, user_id, JobType::ScanFaces, false).await?
    };
    let model = state.settings().face_recognition_model.clone();
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM api_photo p JOIN api_thumbnail t ON t.photo_id = p.id \
         WHERE p.owner_id = $1 AND ($2::boolean IS FALSE OR p.added_on > $3) \
           AND NOT ($4::boolean AND EXISTS (SELECT 1 FROM lp_photo_faces_scanned s \
                WHERE s.photo_id = p.id AND s.model = $5)) \
         ORDER BY p.id",
    )
    .bind(user_id)
    .bind(since.is_some())
    .bind(since.flatten())
    .bind(skip_inline)
    .bind(lp_ml::face::normalize_model_name(&model))
    .fetch_all(&state.db)
    .await?;
    if !run::start_items(&state.db, job_id, ids.len() as i64).await? {
        return Ok(());
    }
    let outcome: anyhow::Result<bool> = async {
        let mut counter = ItemCounter::new(state.db.clone(), job_id, ids.len());
        for chunk in ids.chunks(CANCEL_CHECK_EVERY) {
            if run::is_cancelled(&state.db, job_id).await? {
                counter.flush().await?;
                return Ok(false);
            }
            let batch = photos::load(&state.db, chunk).await?;
            if lp_ml::pipeline() {
                // Prepare (XMP regions, detection) a few photos ahead; store
                // strictly in order, as the serial loop does.
                type Prep<'a> = (
                    Option<&'a TaskPhoto>,
                    Option<Result<Option<PreparedFaces>, FaceError>>,
                );
                let futs: Vec<futures::future::BoxFuture<'_, Prep<'_>>> = chunk
                    .iter()
                    .map(|id| {
                        let photo = batch.get(id);
                        Box::pin(async move {
                            match photo {
                                Some(p) => (photo, Some(prepare_faces(state, p).await)),
                                None => (photo, None),
                            }
                        }) as futures::future::BoxFuture<'_, Prep<'_>>
                    })
                    .collect();
                let mut prepared = futures::stream::iter(futs).buffered(face_prefetch());
                while let Some((photo, prep)) = prepared.next().await {
                    let error = match (photo, prep) {
                        (Some(photo), Some(prep)) => {
                            let r = match prep {
                                Ok(Some(found)) => store_faces(state, photo, found).await,
                                Ok(None) => Ok(0),
                                Err(e) => Err(e),
                            };
                            r.err().map(|e| format!("Photo {}: {e}", photo.image_hash))
                        }
                        _ => None,
                    };
                    counter.done(error).await?;
                }
                continue;
            }
            for id in chunk {
                let error = match batch.get(id) {
                    Some(photo) => extract_faces(state, photo)
                        .await
                        .err()
                        .map(|e| format!("Photo {}: {e}", photo.image_hash)),
                    None => None,
                };
                counter.done(error).await?;
            }
        }
        counter.finish().await?;
        Ok(true)
    }
    .await;
    match outcome {
        Ok(false) => return Ok(()),
        Ok(true) => {}
        Err(e) => {
            tracing::error!(error = %e, "scan faces failed");
            run::fail(&state.db, job_id, &e.to_string()).await?;
        }
    }
    // XMP regions are read: stop the idle ExifTool processes now rather
    // than after the idle timeout (the next stage, e.g. OCR, needs none).
    state.exif.shutdown().await;
    generate_face_embeddings(state, user_id).await?;
    cluster::cluster_all_faces(state, user_id, None).await?;
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum FaceError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Metadata(#[from] crate::exif::MetadataError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

struct Found {
    location: FaceBox,
    name: Option<String>,
    encoding: Option<Vec<f64>>,
}

/// Photos the pipelined face scan prepares ahead of the one it stores.
pub const FACE_PREFETCH: usize = 3;

/// `LP_FACE_PREFETCH` (default [`FACE_PREFETCH`]): photos the face scan
/// prepares ahead (XMP region read, decode, detection).
pub fn face_prefetch() -> usize {
    static N: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *N.get_or_init(|| {
        std::env::var("LP_FACE_PREFETCH")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(FACE_PREFETCH)
    })
}

/// `extract_faces` for one photo: regions from the file's XMP, else the
/// face sidecar; new faces (IoU < 0.3 with the photo's faces) are cropped
/// to `faces/` and stored; a named XMP region names an unnamed face it overlaps.
pub async fn extract_faces(state: &AppState, photo: &TaskPhoto) -> Result<usize, FaceError> {
    if lp_ml::pipeline() {
        return match prepare_faces(state, photo).await? {
            Some(found) => store_faces(state, photo, found).await,
            None => Ok(0),
        };
    }
    extract_faces_serial(state, photo).await
}

/// The faces of a photo before anything is stored.
pub struct PreparedFaces {
    big: PathBuf,
    found: Vec<Found>,
}

/// The read-only half of [`extract_faces`]: XMP regions (scaled with the
/// thumbnail's header size, no decode), else detection. `None` when there
/// is nothing to store.
pub async fn prepare_faces(
    state: &AppState,
    photo: &TaskPhoto,
) -> Result<Option<PreparedFaces>, FaceError> {
    if !state.config.features.face_detection {
        return Ok(None);
    }
    let big = photo
        .thumbnail_path(&state.config.media_root)
        .ok_or_else(|| {
            FaceError::Message(
                "The 'thumbnail_big' attribute has no file associated with it.".into(),
            )
        })?;
    let (width, height) = {
        let path = big.clone();
        state
            .blocking(move || image::image_dimensions(&path))
            .await
            .map_err(|e| FaceError::Message(e.to_string()))?
            .map_err(|e| FaceError::Message(format!("{}: {e}", big.display())))?
    };
    let main = photo
        .main_path
        .clone()
        .ok_or_else(|| FaceError::Message("'NoneType' object has no attribute 'path'".into()))?;
    let found = find_faces(state, photo, &big, &main, width, height, None, None).await?;
    Ok((!found.is_empty()).then_some(PreparedFaces { big, found }))
}

/// The writing half of [`extract_faces`]: decode the thumbnail for the crops
/// and store the new faces.
pub async fn store_faces(
    state: &AppState,
    photo: &TaskPhoto,
    prepared: PreparedFaces,
) -> Result<usize, FaceError> {
    let PreparedFaces { big, found } = prepared;
    let image = {
        let path = big.clone();
        state
            .blocking(move || image::open(&path).map(|i| Arc::new(i.to_rgb8())))
            .await
            .map_err(|e| FaceError::Message(e.to_string()))?
            .map_err(|e| FaceError::Message(format!("{}: {e}", big.display())))?
    };
    write_faces(state, photo, image, found).await
}

/// XMP regions of the original, else the face service on the thumbnail.
#[allow(clippy::too_many_arguments)]
async fn find_faces(
    state: &AppState,
    photo: &TaskPhoto,
    big: &Path,
    main: &str,
    width: u32,
    height: u32,
    pixels: Option<Arc<RgbImage>>,
    xmp_regions: Option<bool>,
) -> Result<Vec<Found>, FaceError> {
    let mut found: Vec<Found> = Vec::new();
    // `Some(false)`: the scan's metadata read found no region areas, so the
    // structured read would find no usable region either.
    if xmp_regions != Some(false)
        && let Some((Some(region), orientation)) = lp_ingest::timers::time(
            "f xmp region read",
            xmp::read_region_info(&state.exif, main),
        )
        .await?
        && !is_falsy(&region)
    {
        found = xmp::faces_from_region_info(&region, orientation.as_ref(), width, height)
            .into_iter()
            .map(|r| Found {
                location: r.location,
                name: r.name,
                encoding: None,
            })
            .collect();
    }
    if found.is_empty() {
        let model = state.settings().face_recognition_model.clone();
        let t = std::time::Instant::now();
        let detected = match pixels {
            Some(image) => state.ml().face().detect_faces_rgb(image, &model).await,
            None => state.ml().face().detect_faces(&path_str(big), &model).await,
        };
        lp_ingest::timers::add("f detect", t);
        match detected {
            Ok(faces) => {
                found = faces
                    .into_iter()
                    .map(|f| Found {
                        location: f.location,
                        name: None,
                        encoding: f.encoding,
                    })
                    .collect();
            }
            Err(e) => {
                tracing::error!(photo = %photo.image_hash, error = %e, "can't extract face information");
            }
        }
    }
    Ok(found)
}

/// Faces of a photo the scan just rendered (round 3 #19): XMP regions of the
/// original, else detection on the big thumbnail's pixels in memory; the new
/// faces are stored as [`extract_faces`] does, and the photo is marked
/// (`lp_photo_faces_scanned`) so the scan's `faces.scan` follow-up skips it.
pub async fn extract_faces_from_pixels(
    state: &AppState,
    photo: &TaskPhoto,
    image: Arc<RgbImage>,
    xmp_regions: Option<bool>,
) -> Result<usize, FaceError> {
    if !state.config.features.face_detection {
        return Ok(0);
    }
    let big = photo
        .thumbnail_path(&state.config.media_root)
        .ok_or_else(|| {
            FaceError::Message(
                "The 'thumbnail_big' attribute has no file associated with it.".into(),
            )
        })?;
    let main = photo
        .main_path
        .clone()
        .ok_or_else(|| FaceError::Message("'NoneType' object has no attribute 'path'".into()))?;
    let (w, h) = (image.width(), image.height());
    let found = find_faces(
        state,
        photo,
        &big,
        &main,
        w,
        h,
        Some(image.clone()),
        xmp_regions,
    )
    .await?;
    let n = if found.is_empty() {
        0
    } else {
        write_faces(state, photo, image, found).await?
    };
    let model = state.settings().face_recognition_model.clone();
    sqlx::query(
        "INSERT INTO lp_photo_faces_scanned (photo_id, model, scanned_at) VALUES ($1, $2, now())          ON CONFLICT (photo_id) DO UPDATE SET model = EXCLUDED.model, scanned_at = now()",
    )
    .bind(photo.id)
    .bind(lp_ml::face::normalize_model_name(&model))
    .execute(&state.db)
    .await?;
    Ok(n)
}

/// The serial path (`LP_ML_PIPELINE=0`): decode first, then regions or
/// detection, then store.
async fn extract_faces_serial(state: &AppState, photo: &TaskPhoto) -> Result<usize, FaceError> {
    if !state.config.features.face_detection {
        return Ok(0);
    }
    let big = photo
        .thumbnail_path(&state.config.media_root)
        .ok_or_else(|| {
            FaceError::Message(
                "The 'thumbnail_big' attribute has no file associated with it.".into(),
            )
        })?;
    let image = {
        let path = big.clone();
        state
            .blocking(move || image::open(&path).map(|i| Arc::new(i.to_rgb8())))
            .await
            .map_err(|e| FaceError::Message(e.to_string()))?
            .map_err(|e| FaceError::Message(format!("{}: {e}", big.display())))?
    };
    let main = photo
        .main_path
        .clone()
        .ok_or_else(|| FaceError::Message("'NoneType' object has no attribute 'path'".into()))?;
    let found = find_faces(
        state,
        photo,
        &big,
        &main,
        image.width(),
        image.height(),
        None,
        None,
    )
    .await?;
    if found.is_empty() {
        return Ok(0);
    }
    write_faces(state, photo, image, found).await
}

/// Store the new faces of `found` (crops cut from `image`).
async fn write_faces(
    state: &AppState,
    photo: &TaskPhoto,
    image: Arc<RgbImage>,
    found: Vec<Found>,
) -> Result<usize, FaceError> {
    let mut tx = state.db.begin().await?;
    let unknown_cluster = unknown_cluster(&mut tx, photo.owner_id).await?;
    let mut existing: Vec<FaceBox> = sqlx::query_as::<_, (i32, i32, i32, i32)>(
        "SELECT location_top, location_right, location_bottom, location_left FROM api_face \
         WHERE photo_id = $1 ORDER BY id",
    )
    .bind(photo.id)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|(t, r, b, l)| [t, r, b, l])
    .collect();

    let mut written: Vec<PathBuf> = Vec::new();
    let result: Result<usize, FaceError> = async {
        let mut saved = 0;
        for (idx, face) in found.iter().enumerate() {
            let name = face.name.as_deref().filter(|n| !n.is_empty());
            let person = match name {
                Some(n) => Some(named_person(&mut tx, n, photo.owner_id).await?),
                None => None,
            };
            if overlaps(&existing, face.location) {
                if let Some(person_id) = person {
                    reconcile_name(&mut tx, photo.id, person_id, face.location).await?;
                }
                continue;
            }
            let jpeg = {
                let image = image.clone();
                let loc = face.location;
                state
                    .blocking(move || crop_jpeg(&image, loc))
                    .await
                    .map_err(|e| FaceError::Message(e.to_string()))??
            };
            let file_name = format!("{}_{idx}.jpg", photo.image_hash);
            let (stored, path) = available_face_name(&state.config.faces_dir(), &file_name);
            tokio::fs::create_dir_all(state.config.faces_dir()).await?;
            tokio::fs::write(&path, &jpeg).await?;
            written.push(path);
            let encoding = face
                .encoding
                .as_deref()
                .map(FaceEncoding::encode)
                .unwrap_or_default();
            let [top, right, bottom, left] = face.location;
            sqlx::query(
                "INSERT INTO api_face (image, cluster_probability, location_top, location_bottom, \
                   location_left, location_right, encoding, person_id, cluster_id, \
                   classification_probability, deleted, classification_person_id, \
                   cluster_person_id, photo_id) \
                 VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8, 0, FALSE, NULL, NULL, $9)",
            )
            .bind(&stored)
            .bind(top)
            .bind(bottom)
            .bind(left)
            .bind(right)
            .bind(&encoding)
            .bind(person)
            .bind(unknown_cluster)
            .bind(photo.id)
            .execute(&mut *tx)
            .await?;
            if let Some(person_id) = person {
                refresh_person(&mut tx, person_id).await?;
            }
            existing.push(face.location);
            saved += 1;
        }
        Ok(saved)
    }
    .await;
    match result {
        Ok(saved) => {
            tx.commit().await?;
            tracing::info!(photo = %photo.image_hash, faces = found.len(), saved, "faces scanned");
            Ok(saved)
        }
        Err(e) => {
            drop(tx);
            for p in written {
                let _ = tokio::fs::remove_file(p).await;
            }
            Err(e)
        }
    }
}

fn is_falsy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Null => true,
        serde_json::Value::Object(o) => o.is_empty(),
        serde_json::Value::Array(a) => a.is_empty(),
        serde_json::Value::String(s) => s.is_empty(),
        serde_json::Value::Bool(b) => !b,
        serde_json::Value::Number(n) => n.as_f64() == Some(0.0),
    }
}

/// Python slice bounds (`a[start:stop]` on an axis of `len`).
fn py_slice(start: i32, stop: i32, len: u32) -> (u32, u32) {
    let len = i64::from(len);
    let norm = |v: i32| {
        let v = i64::from(v);
        let v = if v < 0 { v + len } else { v };
        v.clamp(0, len)
    };
    let (s, e) = (norm(start), norm(stop));
    (s as u32, e.max(s) as u32)
}

/// `big_thumbnail_image[top:bottom, left:right]` as a JPEG (PIL defaults).
pub fn crop_jpeg(image: &RgbImage, loc: FaceBox) -> Result<Vec<u8>, FaceError> {
    let [top, right, bottom, left] = loc;
    let (y0, y1) = py_slice(top, bottom, image.height());
    let (x0, x1) = py_slice(left, right, image.width());
    if y1 == y0 || x1 == x0 {
        return Err(FaceError::Message(format!(
            "empty face crop {loc:?} on a {}x{} thumbnail",
            image.width(),
            image.height()
        )));
    }
    let crop = image::imageops::crop_imm(image, x0, y0, x1 - x0, y1 - y0).to_image();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, CROP_JPEG_QUALITY)
        .encode_image(&crop)
        .map_err(|e| FaceError::Message(e.to_string()))?;
    Ok(out)
}

/// Django's `FileSystemStorage.get_available_name`: `faces/<name>`, or with
/// a random 7-character suffix when taken. Returns (stored name, path).
fn available_face_name(dir: &Path, file_name: &str) -> (String, PathBuf) {
    let mut name = file_name.to_string();
    let (root, ext) = match file_name.rfind('.') {
        Some(i) => (&file_name[..i], &file_name[i..]),
        None => (file_name, ""),
    };
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    while dir.join(&name).exists() {
        let suffix: String = (0..7)
            .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
            .collect();
        name = format!("{root}_{suffix}{ext}");
    }
    (format!("faces/{name}"), dir.join(&name))
}

/// `get_unknown_cluster`: the user's `cluster_id = -1` cluster, created as
/// needed, with no person.
pub async fn unknown_cluster(conn: &mut PgConnection, owner_id: i32) -> sqlx::Result<i32> {
    let row: Option<(i32, Option<i32>)> = sqlx::query_as(
        "SELECT id, person_id FROM api_cluster WHERE owner_id = $1 AND cluster_id = -1 \
         ORDER BY id LIMIT 1",
    )
    .bind(owner_id)
    .fetch_optional(&mut *conn)
    .await?;
    match row {
        Some((id, None)) => Ok(id),
        Some((id, Some(_))) => {
            sqlx::query(
                "UPDATE api_cluster SET person_id = NULL, name = 'Other Unknown Cluster' WHERE id = $1",
            )
            .bind(id)
            .execute(&mut *conn)
            .await?;
            Ok(id)
        }
        None => sqlx::query_scalar(
            "INSERT INTO api_cluster (mean_face_encoding, cluster_id, name, person_id, owner_id) \
                 VALUES ('', -1, NULL, NULL, $1) RETURNING id",
        )
        .bind(owner_id)
        .fetch_one(&mut *conn)
        .await,
    }
}

/// `get_or_create_person(name, owner, KIND_USER)` + `save()`.
async fn named_person(conn: &mut PgConnection, name: &str, owner_id: i32) -> sqlx::Result<i32> {
    let existing: Option<i32> = sqlx::query_scalar(
        "UPDATE api_person SET last_modified = now() WHERE id = ( \
           SELECT id FROM api_person WHERE name = $1 AND cluster_owner_id = $2 AND kind = 'USER' \
           ORDER BY id LIMIT 1) RETURNING id",
    )
    .bind(name)
    .bind(owner_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    sqlx::query_scalar(
        "INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, \
           cover_photo_id, last_modified) VALUES ($1, 'USER', $2, 0, NULL, NULL, now()) RETURNING id",
    )
    .bind(name)
    .bind(owner_id)
    .fetch_one(&mut *conn)
    .await
}

/// `_calculate_face_count` + `_set_default_cover_photo` (S19).
pub async fn refresh_person(conn: &mut PgConnection, person_id: i32) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE api_person pe SET last_modified = now(), face_count = ( \
           SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
           WHERE f.person_id = pe.id AND NOT p.hidden AND NOT p.in_trashcan \
             AND p.owner_id = pe.cluster_owner_id) \
         WHERE pe.id = $1",
    )
    .bind(person_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE api_person pe SET cover_photo_id = f.photo_id, cover_face_id = f.id, \
           last_modified = now() \
         FROM (SELECT id, photo_id FROM api_face WHERE person_id = $1 ORDER BY id LIMIT 1) f \
         WHERE pe.id = $1 AND pe.cover_photo_id IS NULL",
    )
    .bind(person_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `_reconcile_xmp_face_name`: the first existing face the region overlaps
/// takes the name when it has none.
async fn reconcile_name(
    conn: &mut PgConnection,
    photo_id: Uuid,
    person_id: i32,
    location: FaceBox,
) -> sqlx::Result<()> {
    let faces: Vec<(i32, Option<i32>, i32, i32, i32, i32)> = sqlx::query_as(
        "SELECT id, person_id, location_top, location_right, location_bottom, location_left \
         FROM api_face WHERE photo_id = $1 ORDER BY id",
    )
    .bind(photo_id)
    .fetch_all(&mut *conn)
    .await?;
    for (id, current, t, r, b, l) in faces {
        if !overlaps(&[[t, r, b, l]], location) {
            continue;
        }
        if current.is_none() {
            sqlx::query("UPDATE api_face SET person_id = $2 WHERE id = $1")
                .bind(id)
                .bind(person_id)
                .execute(&mut *conn)
                .await?;
            refresh_person(conn, person_id).await?;
            tracing::warn!(
                face = id,
                person = person_id,
                "XMP face reconciliation assigned a name"
            );
        }
        break;
    }
    Ok(())
}

#[derive(Debug, FromRow)]
struct MissingEncoding {
    id: i32,
    location_top: i32,
    location_right: i32,
    location_bottom: i32,
    location_left: i32,
    thumbnail_big: Option<String>,
}

/// `generate_face_embeddings`: encodings for the user's faces stored
/// without one (XMP regions), as its own job; no job when there are none.
pub async fn generate_face_embeddings(state: &AppState, user_id: i32) -> anyhow::Result<()> {
    let faces = sqlx::query_as::<_, MissingEncoding>(
        "SELECT f.id, f.location_top, f.location_right, f.location_bottom, f.location_left, \
           t.thumbnail_big \
         FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
         WHERE p.owner_id = $1 AND f.encoding = '' ORDER BY f.id",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;
    if faces.is_empty() {
        return Ok(());
    }
    let job_id = run::begin(&state.db, None, JobType::GenerateFaceEmbeddings, user_id).await?;
    run::set_progress(&state.db, &job_id, 0, faces.len() as i32).await?;
    let model = state.settings().face_recognition_model.clone();
    let mut counter = ItemCounter::new(state.db.clone(), job_id.clone(), faces.len());
    for (idx, face) in faces.iter().enumerate() {
        if idx % CANCEL_CHECK_EVERY == 0 && run::is_cancelled(&state.db, &job_id).await? {
            counter.flush().await?;
            return Ok(());
        }
        let error = encode_face(state, face, &model)
            .await
            .err()
            .map(|e| format!("Face {}: {e}", face.id));
        counter.done(error).await?;
    }
    counter.finish().await?;
    run::complete(&state.db, &job_id).await?;
    Ok(())
}

async fn encode_face(state: &AppState, face: &MissingEncoding, model: &str) -> anyhow::Result<()> {
    let big = face
        .thumbnail_big
        .as_deref()
        .filter(|t| !t.is_empty())
        .map(|t| photos::media_path(&state.config.media_root, t))
        .ok_or_else(|| {
            anyhow::anyhow!("The 'thumbnail_big' attribute has no file associated with it.")
        })?;
    let location = [
        face.location_top,
        face.location_right,
        face.location_bottom,
        face.location_left,
    ];
    let encodings = state
        .ml()
        .face()
        .face_encodings(&path_str(&big), &[location], model)
        .await?;
    let encoding = match encodings.into_iter().next() {
        None => anyhow::bail!("Face service returned no encoding for face {}", face.id),
        Some(None) => anyhow::bail!("The face service detected no face in face {}", face.id),
        Some(Some(e)) => e,
    };
    sqlx::query("UPDATE api_face SET encoding = $2 WHERE id = $1")
        .bind(face.id)
        .bind(FaceEncoding::encode(&encoding))
        .execute(&state.db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iou_matches_util() {
        assert_eq!(iou([0, 10, 10, 0], [0, 10, 10, 0]), 1.0);
        assert_eq!(iou([0, 10, 10, 0], [20, 30, 30, 20]), 0.0);
        let v = iou([0, 10, 10, 0], [5, 15, 15, 5]);
        assert!((v - 25.0 / 175.0).abs() < 1e-12);
        assert!(!overlaps(&[[0, 10, 10, 0]], [5, 15, 15, 5]));
        assert!(overlaps(&[[0, 10, 10, 0]], [1, 10, 10, 1]));
    }

    #[test]
    fn slices_like_numpy() {
        assert_eq!(py_slice(-5, 10, 100), (95, 95));
        assert_eq!(py_slice(10, 500, 100), (10, 100));
        assert_eq!(py_slice(-10, -2, 100), (90, 98));
        let img = RgbImage::from_pixel(40, 30, image::Rgb([200, 10, 10]));
        let jpeg = crop_jpeg(&img, [5, 25, 20, 10]).unwrap();
        let back = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((back.width(), back.height()), (15, 15));
        assert!(crop_jpeg(&img, [20, 25, 5, 10]).is_err());
    }
}

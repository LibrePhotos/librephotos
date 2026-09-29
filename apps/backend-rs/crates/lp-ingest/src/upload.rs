//! Single-file import for uploads: `create_new_image` (in the request, as
//! Django does) and the queued rest of `import_photo`'s chain
//! (`handle_new_image`, the device-timestamp fallback, follow-ups).

use std::path::{Path, PathBuf};

use anyhow::anyhow;
use chrono::{DateTime, Utc};
use lp_jobs::{EnqueueOptions, JobType};
use serde_json::json;
use uuid::Uuid;

use crate::db;
use crate::fsutil::{self, VIDEO, path_str};
use crate::pipeline::{Owner, Pipeline};

const JPEG_EXTENSIONS: [&str; 7] = [".jpg", ".jpeg", ".heic", ".heif", ".png", ".tiff", ".tif"];

async fn owner(p: &Pipeline, user_id: i32) -> anyhow::Result<Owner> {
    let u = lp_db::users::by_id(&p.state.db, user_id)
        .await?
        .ok_or_else(|| anyhow!("user {user_id} not found"))?;
    Ok(Owner::from_user(&u))
}

/// The owner's photo whose main file is `<dir>/<stem><ext>` for one of `exts`.
async fn photo_by_sibling(
    p: &Pipeline,
    user_id: i32,
    path: &str,
    exts: &[&str],
) -> anyhow::Result<Option<Uuid>> {
    let base = fsutil::splitext(path).0;
    let mut candidates = Vec::new();
    for e in exts {
        candidates.push(format!("{base}{e}"));
        candidates.push(format!("{base}{}", e.to_uppercase()));
    }
    Ok(sqlx::query_scalar(
        "SELECT p.id FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
         WHERE p.owner_id = $1 AND f.path = ANY($2) ORDER BY array_position($2, f.path), p.id LIMIT 1",
    )
    .bind(user_id)
    .bind(&candidates)
    .fetch_optional(&p.state.db)
    .await?)
}

/// `create_new_image`: the Photo for an uploaded file (None when the file
/// is not media, is embedded content, or is a sidecar).
pub async fn create_new_image(
    p: &Pipeline,
    user_id: i32,
    path: &Path,
) -> anyhow::Result<Option<Uuid>> {
    let owner = owner(p, user_id).await?;
    let pstr = path_str(path);
    let rr = p.clone();
    let pp = path.to_path_buf();
    let (valid, is_video) = p
        .state
        .blocking(move || {
            let s = path_str(&pp);
            let is_video = fsutil::is_video(&pp);
            let valid = if is_video {
                rr.state.config.features.video
            } else {
                fsutil::is_metadata(&s) || fsutil::is_raw(&s) || rr.renderer.can_decode(&pp)
            };
            (valid, is_video)
        })
        .await
        .map_err(|e| anyhow!("{e}"))?;
    if !valid {
        return Ok(None);
    }
    let pp = path.to_path_buf();
    let hash = p
        .state
        .blocking(move || fsutil::calculate_hash(&pp, user_id))
        .await
        .map_err(|e| anyhow!("{e}"))??;
    {
        let mut conn = p.state.db.acquire().await?;
        if db::is_embedded_media(&mut conn, &hash).await? {
            tracing::warn!(path = %pstr, "embedded content file found");
            return Ok(None);
        }
    }
    if fsutil::is_metadata(&pstr) {
        crate::scan::attach_sidecar(p, &owner, path)
            .await
            .map_err(|e| anyhow!(e))?;
        return Ok(None);
    }
    if let Some(photo) = p.reindex_replaced(&owner, path, &hash).await? {
        return Ok(Some(photo));
    }
    // RAW files and Live Photo videos join the image they belong to.
    let sibling = if fsutil::is_raw(&pstr) {
        photo_by_sibling(p, user_id, &pstr, &JPEG_EXTENSIONS).await?
    } else if is_video && fsutil::splitext(&pstr).1.to_lowercase() == ".mov" {
        let mut exts: Vec<&str> = JPEG_EXTENSIONS.to_vec();
        exts.push(".heic");
        photo_by_sibling(p, user_id, &pstr, &exts).await?
    } else {
        None
    };
    let kind = if is_video {
        VIDEO
    } else {
        fsutil::detect_file_type(path)
    };
    if let Some(photo) = sibling {
        let mut tx = p.state.db.begin().await?;
        let linked: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id \
             WHERE pf.photo_id = $1 AND f.path = $2)",
        )
        .bind(photo)
        .bind(&pstr)
        .fetch_one(&mut *tx)
        .await?;
        if !linked {
            let f = db::file_create(&mut tx, &pstr, &hash, kind).await?;
            db::add_photo_file(&mut tx, photo, &f.hash).await?;
            if is_video {
                sqlx::query("UPDATE api_photo SET video = FALSE WHERE id = $1")
                    .bind(photo)
                    .execute(&mut *tx)
                    .await?;
            }
            db::touch_photo(&mut tx, photo).await?;
        }
        tx.commit().await?;
        return Ok(Some(photo));
    }
    let mut tx = p.state.db.begin().await?;
    let f = db::file_create(&mut tx, &pstr, &hash, kind).await?;
    let photo = db::insert_photo(&mut tx, user_id, &hash, Some(&f.hash), is_video).await?;
    db::add_photo_file(&mut tx, photo.id, &f.hash).await?;
    tx.commit().await?;
    p.attach_motion(&owner, photo.id, &f).await?;
    Ok(Some(photo.id))
}

/// `import_photo`'s chain after `create_new_image`.
pub async fn process_upload(
    p: &Pipeline,
    user_id: i32,
    photo_id: Uuid,
    device_created_at: Option<DateTime<Utc>>,
) -> anyhow::Result<()> {
    let owner = owner(p, user_id).await?;
    if let Err(e) = p.process_photo(&owner, photo_id).await {
        tracing::error!(photo = %photo_id, error = %format!("{e:#}"), "could not load uploaded image");
    }
    if let Some(ts) = device_created_at {
        apply_device_timestamp_fallback(p, &owner, photo_id, ts).await?;
    }
    let f = &p.state.config.features;
    let jobs: [(bool, &str, JobType); 3] = [
        (
            f.scene_classification,
            "tags.generate",
            JobType::GenerateTags,
        ),
        (f.reverse_geocoding, "geo.locate", JobType::AddGeolocation),
        (f.face_detection, "faces.scan", JobType::ScanFaces),
    ];
    for (on, kind, jt) in jobs {
        if on {
            lp_jobs::enqueue(
                &p.state,
                kind,
                json!({"user_id": user_id}),
                EnqueueOptions::tracked(jt, user_id),
            )
            .await?;
        }
    }
    Ok(())
}

/// `apply_device_timestamp_fallback`: an EXIF-less upload takes the
/// device's capture time through the user-defined datetime rule.
pub async fn apply_device_timestamp_fallback(
    p: &Pipeline,
    owner: &Owner,
    photo_id: Uuid,
    ts: DateTime<Utc>,
) -> anyhow::Result<()> {
    let mut tx = p.state.db.begin().await?;
    let Some(photo) = db::photo_by_id(&mut tx, photo_id).await? else {
        return Ok(());
    };
    if photo.exif_timestamp.is_some() {
        return Ok(());
    }
    let path: Option<String> = match &photo.main_file_id {
        Some(h) => db::file_by_hash(&mut tx, h).await?.map(|f| f.path),
        None => None,
    };
    let Some(path) = path else {
        return Ok(());
    };
    let tags = crate::dates::required_tags(&owner.rules);
    let values = p
        .state
        .exif
        .get_metadata(Path::new(&path), &tags, true, false)
        .await
        .map_err(|e| anyhow!("{e}"))?;
    let by_tag = tags.into_iter().zip(values).collect();
    let ctx = crate::dates::Inputs {
        gps_lat: photo.exif_gps_lat,
        gps_lon: photo.exif_gps_lon,
        user_default_tz: &owner.default_timezone,
        user_defined_timestamp: Some(ts),
    };
    let exif_ts =
        crate::dates::extract_local_date_time(Path::new(&path), &owner.rules, &by_tag, &ctx);
    db::move_to_album_date(
        &mut tx,
        owner.id,
        photo.id,
        &photo.image_hash,
        photo.exif_timestamp,
        exif_ts,
    )
    .await?;
    sqlx::query("UPDATE api_photo SET timestamp = $2, exif_timestamp = $3, last_modified = now() WHERE id = $1")
        .bind(photo.id)
        .bind(ts)
        .bind(exif_ts)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// `<scan_directory>/uploads/<device>/<name>`, or None for a known
/// duplicate (`UploadPhotosChunkedComplete.target_path`).
pub async fn target_path(
    p: &Pipeline,
    scan_directory: &str,
    user_id: i32,
    device: &str,
    filename: &str,
    image_hash: &str,
) -> anyhow::Result<Option<PathBuf>> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM api_photo WHERE image_hash = $1)")
            .bind(image_hash)
            .fetch_one(&p.state.db)
            .await?;
    if exists {
        return Ok(None);
    }
    let dir = Path::new(scan_directory).join("uploads").join(device);
    let photo_path = dir.join(filename);
    if !photo_path.exists() {
        return Ok(Some(photo_path));
    }
    let pp = photo_path.clone();
    let on_disk = p
        .state
        .blocking(move || fsutil::calculate_hash(&pp, user_id))
        .await
        .map_err(|e| anyhow!("{e}"))??;
    if on_disk == image_hash {
        return Ok(None);
    }
    let (stem, ext) = fsutil::splitext(filename);
    Ok(Some(dir.join(format!("{stem}_{image_hash}{ext}"))))
}

/// `is_valid_media` for a staged upload (no extension: sniffed only).
pub async fn is_valid_media(p: &Pipeline, path: &Path) -> bool {
    let rr = p.clone();
    let pp = path.to_path_buf();
    p.state
        .blocking(move || {
            let s = path_str(&pp);
            if fsutil::is_video(&pp) {
                return rr.state.config.features.video;
            }
            fsutil::is_metadata(&s) || fsutil::is_raw(&s) || rr.renderer.can_decode(&pp)
        })
        .await
        .unwrap_or(false)
}

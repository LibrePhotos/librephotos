//! Library maintenance jobs: `scan_missing_photos` (detach vanished files),
//! `repair_ungrouped_file_variants` and `delete_missing_photos`.

use std::path::Path;

use anyhow::anyhow;
use lp_db::write::AfterCommit;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::db;
use crate::fsutil::{IMAGE, RAW_FILE};
use crate::pipeline::Pipeline;
use crate::render::{BIG, SQUARE, SQUARE_SMALL};

const JOB_DELETE_MISSING_PHOTOS: i32 = 5;
const JOB_SCAN_MISSING_PHOTOS: i32 = 14;
const JOB_REPAIR_FILE_VARIANTS: i32 = 16;
const PAGE: i64 = 5000;
const DELETE_BATCH: usize = 1000;

/// `scan_missing_photos`: per page of 5000 photos, unlink files gone from
/// disk and flag them missing (`detach_missing_files`, whose `photo.save()`
/// bumps every photo's `last_modified`).
pub async fn scan_missing_photos(p: &Pipeline, user_id: i32, job_id: &str) -> anyhow::Result<()> {
    let db = &p.state.db;
    db::lrj_get_or_create(db, job_id, JOB_SCAN_MISSING_PHOTOS, user_id).await?;
    let run = async {
        let total: i64 = db::photo_count(db, user_id).await?;
        let pages = (total + PAGE - 1) / PAGE;
        db::lrj_progress(db, job_id, 0, pages as i32).await?;
        for page in 0..pages {
            if lp_jobs::lrj::is_cancelled(db, job_id).await? {
                return Ok::<_, anyhow::Error>(());
            }
            let ids: Vec<Uuid> = sqlx::query_scalar(
                "SELECT id FROM api_photo WHERE owner_id = $1 ORDER BY image_hash, id OFFSET $2 LIMIT $3",
            )
            .bind(user_id)
            .bind(page * PAGE)
            .bind(PAGE)
            .fetch_all(db)
            .await?;
            let links: Vec<(Uuid, String, String)> = sqlx::query_as(
                "SELECT pf.photo_id, f.hash, f.path FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id \
                 WHERE pf.photo_id = ANY($1)",
            )
            .bind(&ids)
            .fetch_all(db)
            .await?;
            let gone: Vec<(Uuid, String)> = p
                .state
                .blocking(move || {
                    links
                        .into_iter()
                        .filter(|(_, _, path)| path.is_empty() || !Path::new(path).exists())
                        .map(|(photo, hash, _)| (photo, hash))
                        .collect()
                })
                .await
                .map_err(|e| anyhow!("{e}"))?;
            let mut tx = db.begin().await?;
            for (photo, hash) in &gone {
                sqlx::query("DELETE FROM api_photo_files WHERE photo_id = $1 AND file_id = $2")
                    .bind(photo)
                    .bind(hash)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE api_file SET missing = TRUE WHERE hash = $1")
                    .bind(hash)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query("UPDATE api_photo SET last_modified = now() WHERE id = ANY($1)")
                .bind(&ids)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE api_longrunningjob SET progress_current = progress_current + 1 WHERE job_id = $1")
                .bind(job_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
        }
        db::lrj_finish(db, job_id).await?;
        Ok(())
    };
    if let Err(e) = run.await {
        lp_jobs::lrj::fail(db, job_id, &format!("{e:#}")).await?;
    }
    Ok(())
}

/// `find_matching_jpeg_photo`: the owner's photo whose main file is the
/// same basename with an image extension, in the same directory.
async fn matching_jpeg_photo(
    conn: &mut PgConnection,
    user_id: i32,
    raw_path: &str,
) -> sqlx::Result<Option<Uuid>> {
    let base = crate::fsutil::splitext(raw_path).0;
    let mut candidates = Vec::new();
    for ext in [".jpg", ".jpeg", ".heic", ".heif", ".png", ".tiff", ".tif"] {
        candidates.push(format!("{base}{ext}"));
        candidates.push(format!("{base}{}", ext.to_uppercase()));
    }
    sqlx::query_scalar(
        "SELECT p.id FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
         WHERE p.owner_id = $1 AND f.path = ANY($2) ORDER BY array_position($2, f.path), p.id LIMIT 1",
    )
    .bind(user_id)
    .bind(&candidates)
    .fetch_optional(conn)
    .await
}

/// `repair_ungrouped_file_variants`.
pub async fn repair_file_variants(p: &Pipeline, user_id: i32, job_id: &str) -> anyhow::Result<()> {
    let pool = &p.state.db;
    db::lrj_get_or_create(pool, job_id, JOB_REPAIR_FILE_VARIANTS, user_id).await?;
    let run = async {
        let raw_photos: Vec<(Uuid, String)> = sqlx::query_as(
            "SELECT p.id, f.path FROM api_photo p JOIN api_file f ON f.hash = p.main_file_id \
             WHERE p.owner_id = $1 AND f.type = $2 ORDER BY p.id",
        )
        .bind(user_id)
        .bind(RAW_FILE)
        .fetch_all(pool)
        .await?;
        db::lrj_progress(pool, job_id, 0, raw_photos.len() as i32).await?;
        let mut after = AfterCommit::new();
        let (mut merged, mut promoted) = (0, 0);
        for (photo, raw_path) in raw_photos {
            let mut tx = pool.begin().await?;
            let image: Option<String> = sqlx::query_scalar(
                "SELECT f.hash FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id \
                 WHERE pf.photo_id = $1 AND f.type = $2 ORDER BY f.hash LIMIT 1",
            )
            .bind(photo)
            .bind(IMAGE)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(img) = image {
                sqlx::query("UPDATE api_photo SET main_file_id = $2, video = FALSE WHERE id = $1")
                    .bind(photo)
                    .bind(img)
                    .execute(&mut *tx)
                    .await?;
                promoted += 1;
            } else if let Some(jpeg) = matching_jpeg_photo(&mut tx, user_id, &raw_path).await?
                && jpeg != photo
            {
                let hashes: Vec<String> = sqlx::query_scalar(
                    "SELECT file_id FROM api_photo_files WHERE photo_id = $1 ORDER BY id",
                )
                .bind(photo)
                .fetch_all(&mut *tx)
                .await?;
                for h in hashes {
                    db::add_photo_file(&mut tx, jpeg, &h).await?;
                }
                db::touch_photo(&mut tx, jpeg).await?;
                delete_photos(&mut tx, &[photo], &p.state.config.media_root, &mut after).await?;
                merged += 1;
            }
            tx.commit().await?;
        }
        after.run().await;
        tracing::info!(job_id, merged, promoted, "repaired file variants");
        db::lrj_complete(pool, job_id).await?;
        Ok::<_, anyhow::Error>(())
    };
    if let Err(e) = run.await {
        lp_jobs::lrj::fail(pool, job_id, &format!("{e:#}")).await?;
    }
    Ok(())
}

/// `delete_missing_photos`: photos without files or main file go, with
/// everything hanging off them; then the user's missing File rows.
pub async fn delete_missing_photos(p: &Pipeline, user_id: i32, job_id: &str) -> anyhow::Result<()> {
    let pool = &p.state.db;
    db::lrj_get_or_create(pool, job_id, JOB_DELETE_MISSING_PHOTOS, user_id).await?;
    let run = async {
        let missing: Vec<Uuid> = sqlx::query_scalar(
            "SELECT p.id FROM api_photo p WHERE p.owner_id = $1 AND (p.main_file_id IS NULL \
             OR NOT EXISTS (SELECT 1 FROM api_photo_files pf WHERE pf.photo_id = p.id)) ORDER BY p.id",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        let target = missing.len() as i32;
        db::lrj_progress(pool, job_id, 0, target).await?;
        let mut things: Vec<i32> = Vec::new();
        let mut tags: Vec<i32> = Vec::new();
        let mut after = AfterCommit::new();
        let mut done = 0;
        for batch in missing.chunks(DELETE_BATCH) {
            let mut tx = pool.begin().await?;
            things.extend(
                sqlx::query_scalar::<_, i32>(
                    "SELECT DISTINCT albumthing_id FROM api_albumthing_photos WHERE photo_id = ANY($1)",
                )
                .bind(batch)
                .fetch_all(&mut *tx)
                .await?,
            );
            tags.extend(
                sqlx::query_scalar::<_, i32>(
                    "SELECT DISTINCT tag_id FROM api_tag_photos WHERE photo_id = ANY($1)",
                )
                .bind(batch)
                .fetch_all(&mut *tx)
                .await?,
            );
            delete_photos(&mut tx, batch, &p.state.config.media_root, &mut after).await?;
            done += batch.len() as i32;
            sqlx::query("UPDATE api_longrunningjob SET progress_current = $2, progress_target = $3 WHERE job_id = $1")
                .bind(job_id)
                .bind(done)
                .bind(target)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
        }
        after.run().await;
        things.sort_unstable();
        things.dedup();
        tags.sort_unstable();
        tags.dedup();
        let mut tx = pool.begin().await?;
        for thing in things {
            sqlx::query(
                "UPDATE api_albumthing SET photo_count = (SELECT count(*) FROM api_albumthing_photos tp \
                   JOIN api_photo p ON p.id = tp.photo_id WHERE tp.albumthing_id = $1 AND NOT p.hidden) WHERE id = $1",
            )
            .bind(thing)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id) \
                 SELECT $1, p.id FROM api_albumthing_photos tp JOIN api_photo p ON p.id = tp.photo_id \
                 WHERE tp.albumthing_id = $1 AND NOT p.hidden AND p.id NOT IN \
                   (SELECT photo_id FROM api_albumthing_cover_photos WHERE albumthing_id = $1 AND photo_id IS NOT NULL) \
                 LIMIT GREATEST(0, 4 - (SELECT count(*) FROM api_albumthing_cover_photos WHERE albumthing_id = $1))",
            )
            .bind(thing)
            .execute(&mut *tx)
            .await?;
        }
        if !tags.is_empty() {
            sqlx::query(
                "UPDATE api_tag t SET photo_count = COALESCE((SELECT count(*) FROM api_tag_photos tp \
                   JOIN api_photo p ON p.id = tp.photo_id WHERE tp.tag_id = t.id AND NOT p.hidden \
                   AND NOT p.in_trashcan AND NOT p.removed), 0) WHERE t.id = ANY($1)",
            )
            .bind(&tags)
            .execute(&mut *tx)
            .await?;
        }
        // The hash is the 32-char md5 followed by the owner id. Django's
        // `hash__endswith=str(user.id)` also takes user 11's and 21's missing
        // files for user 1, which cost those users the re-adoption of files
        // that come back; match the whole suffix instead.
        let files: Vec<String> = sqlx::query_scalar(
            "SELECT hash FROM api_file WHERE missing AND length(hash) > 32 AND substr(hash, 33) = $1",
        )
        .bind(user_id.to_string())
        .fetch_all(&mut *tx)
        .await?;
        delete_files(&mut tx, &files).await?;
        tx.commit().await?;
        db::lrj_complete(pool, job_id).await?;
        Ok::<_, anyhow::Error>(())
    };
    if let Err(e) = run.await {
        lp_jobs::lrj::fail(pool, job_id, &format!("{e:#}")).await?;
    }
    Ok(())
}

/// Delete File rows with Django's cascade (links, embedded media, sidecar
/// metadata records; photos pointing at them lose their main file).
pub async fn delete_files(tx: &mut PgConnection, hashes: &[String]) -> sqlx::Result<()> {
    if hashes.is_empty() {
        return Ok(());
    }
    sqlx::query("DELETE FROM api_photo_files WHERE file_id = ANY($1)")
        .bind(hashes)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM api_file_embedded_media WHERE from_file_id = ANY($1) OR to_file_id = ANY($1)",
    )
    .bind(hashes)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM api_metadatafile WHERE file_id = ANY($1)")
        .bind(hashes)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = ANY($1)")
        .bind(hashes)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM api_file WHERE hash = ANY($1)")
        .bind(hashes)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

/// `Photo.delete()` with Django's collector: rows without a database-level
/// cascade are removed (or nulled) first; face crops and orphaned thumbnail
/// files go after commit.
pub async fn delete_photos(
    tx: &mut PgConnection,
    ids: &[Uuid],
    media_root: &Path,
    after: &mut AfterCommit,
) -> sqlx::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let crops: Vec<Option<String>> =
        sqlx::query_scalar("SELECT image FROM api_face WHERE photo_id = ANY($1)")
            .bind(ids)
            .fetch_all(&mut *tx)
            .await?;
    let hashes: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT image_hash FROM api_photo WHERE id = ANY($1)")
            .bind(ids)
            .fetch_all(&mut *tx)
            .await?;
    for sql in [
        "UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN (SELECT id FROM api_face WHERE photo_id = ANY($1))",
        "UPDATE api_person SET cover_photo_id = NULL WHERE cover_photo_id = ANY($1)",
        "UPDATE api_albumuser SET cover_photo_id = NULL WHERE cover_photo_id = ANY($1)",
        "UPDATE api_photostack SET primary_photo_id = NULL WHERE primary_photo_id = ANY($1)",
        "UPDATE api_duplicate SET kept_photo_id = NULL WHERE kept_photo_id = ANY($1)",
        "UPDATE api_stackreview SET kept_photo_id = NULL WHERE kept_photo_id = ANY($1)",
        "DELETE FROM api_tag_photos WHERE photo_id = ANY($1)",
        "DELETE FROM api_photo_stacks WHERE photo_id = ANY($1)",
        "DELETE FROM api_photo_duplicates WHERE photo_id = ANY($1)",
        "DELETE FROM api_metadataedit WHERE photo_id = ANY($1)",
        "DELETE FROM api_metadatafile WHERE photo_id = ANY($1)",
        "DELETE FROM api_photometadata WHERE photo_id = ANY($1)",
        "DELETE FROM api_photo_ocr WHERE photo_id = ANY($1)",
        "DELETE FROM api_photoshare WHERE photo_id = ANY($1)",
        "DELETE FROM api_photo WHERE id = ANY($1)",
    ] {
        sqlx::query(sql).bind(ids).execute(&mut *tx).await?;
    }
    for c in crops.into_iter().flatten().filter(|s| !s.is_empty()) {
        after.delete_file(media_root.join(c));
    }
    for h in hashes {
        let still: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM api_photo WHERE image_hash = $1)")
                .bind(&h)
                .fetch_one(&mut *tx)
                .await?;
        if still {
            continue;
        }
        for (dir, ext) in [
            (BIG, ".webp"),
            (SQUARE, ".webp"),
            (SQUARE_SMALL, ".webp"),
            (SQUARE, ".mp4"),
            (SQUARE_SMALL, ".mp4"),
        ] {
            after.delete_file(media_root.join(dir).join(format!("{h}{ext}")));
        }
    }
    Ok(())
}

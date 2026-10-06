//! One file group -> one Photo (`file_handlers.py`): File rows, grouping,
//! replaced-file re-keying, motion photos, then `_process_photo`
//! (thumbnails, aspect ratio, pHash, EXIF, screenshot flag, date + day
//! album, dominant colour, search text).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::db::{self, FileRow, PhotoRow};
use anyhow::{Context, anyhow};
use lp_core::AppState;
use lp_db::db::Conn;
use lp_db::users::User;
use lp_db::write::AfterCommit;
use serde_json::Value;
use uuid::Uuid;

use crate::fsutil::{self, METADATA_FILE, VIDEO, path_str, type_priority};
use crate::render::{self, BIG, Renderer, SQUARE, SQUARE_SMALL, STATIC_DIRS};
use crate::{color, dates, exifmap, phash, pyfmt};

/// What the pipeline needs about the owner, loaded once per job.
#[derive(Clone)]
pub struct Owner {
    pub id: i32,
    pub rules: Vec<dates::Rule>,
    pub default_timezone: String,
}

impl Owner {
    pub fn from_user(u: &User) -> Self {
        Owner {
            id: u.id,
            rules: dates::rules_from_user(&u.datetime_rules),
            default_timezone: u.default_timezone.clone(),
        }
    }
}

#[derive(Clone)]
pub struct Pipeline {
    pub state: AppState,
    pub renderer: Renderer,
    /// ML inside the scan ([`crate::inline`]), set per scan job.
    pub inline: Option<std::sync::Arc<crate::inline::InlineMl>>,
}

/// A file probed off the event loop: validity, type and content hash.
struct Probe {
    valid: bool,
    kind: i32,
    hash: String,
}

const MOTION_SIGNATURES: [&[u8]; 3] = [b"ftypmp42", b"ftypisom", b"ftypiso2"];
const SAMSUNG_MOTION: &[u8] = b"MotionPhoto_Data";

/// Where an embedded motion video starts (`_locate_google_embedded_video`
/// by signature priority, then Samsung's marker), streaming the file.
pub fn motion_video_offset(path: &Path) -> Option<u64> {
    let mut f = std::fs::File::open(path).ok()?;
    let patterns: Vec<&[u8]> = MOTION_SIGNATURES
        .iter()
        .copied()
        .chain(std::iter::once(SAMSUNG_MOTION))
        .collect();
    let finders: Vec<memchr::memmem::Finder<'_>> =
        patterns.iter().map(memchr::memmem::Finder::new).collect();
    let mut found: [Option<u64>; 4] = [None; 4];
    let keep = 16usize;
    let mut buf = vec![0u8; 1 << 20];
    let mut carry: Vec<u8> = Vec::new();
    let mut base: u64 = 0; // file offset of window[0]
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        let mut window = std::mem::take(&mut carry);
        window.extend_from_slice(&buf[..n]);
        for (i, fnd) in finders.iter().enumerate() {
            if found[i].is_none()
                && let Some(pos) = fnd.find(&window)
            {
                found[i] = Some(base + pos as u64);
            }
        }
        if found[..3].iter().all(Option::is_some) {
            break;
        }
        let tail = window.len().saturating_sub(keep);
        base += tail as u64;
        carry = window[tail..].to_vec();
    }
    if let Some(p) = found.iter().take(3).flatten().next() {
        return Some(p.saturating_sub(4));
    }
    found[3].map(|p| p + SAMSUNG_MOTION.len() as u64)
}

pub fn has_embedded_motion_video(path: &Path) -> bool {
    fsutil::mime_type(path) == "image/jpeg" && motion_video_offset(path).is_some()
}

impl Pipeline {
    pub fn new(state: AppState) -> Self {
        let renderer = Renderer::from_state(&state);
        Pipeline {
            state,
            renderer,
            inline: None,
        }
    }

    async fn blocking<F, R>(&self, f: F) -> anyhow::Result<R>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        let queued = std::time::Instant::now();
        self.state
            .blocking(move || {
                crate::timers::add("w blocking: permit + spawn wait", queued);
                f()
            })
            .await
            .map_err(|e| anyhow!("{e}"))
    }

    fn probe(&self, path: PathBuf, user_id: i32, want_hash: bool) -> Probe {
        let features = &self.state.config.features;
        let s = path_str(&path);
        let is_video = fsutil::is_video(&path);
        let valid = if is_video {
            features.video
        } else if fsutil::is_metadata(&s) || fsutil::is_raw(&s) {
            true
        } else {
            self.renderer.can_decode(&path)
        };
        let mut kind = fsutil::IMAGE;
        if fsutil::is_raw(&s) {
            kind = fsutil::RAW_FILE;
        }
        if is_video {
            kind = VIDEO;
        }
        if fsutil::is_metadata(&s) {
            kind = METADATA_FILE;
        }
        let hash = if valid && want_hash {
            fsutil::calculate_hash(&path, user_id).unwrap_or_default()
        } else {
            String::new()
        };
        Probe { valid, kind, hash }
    }

    /// `is_valid_media` + `calculate_hash` + `detect_file_type`, blocking.
    async fn probe_file(&self, path: &Path, user_id: i32) -> anyhow::Result<Probe> {
        let me = self.clone();
        let p = path.to_path_buf();
        let probe = self.blocking(move || me.probe(p, user_id, true)).await?;
        if probe.valid && probe.hash.is_empty() {
            return Err(anyhow!(
                "Could not calculate hash for file {}",
                path.display()
            ));
        }
        Ok(probe)
    }

    /// `create_file_record`.
    async fn create_file_record(
        &self,
        owner: &Owner,
        path: &Path,
    ) -> anyhow::Result<Option<FileRow>> {
        let probe = crate::timers::time("1a probe (md5)", self.probe_file(path, owner.id)).await?;
        if !probe.valid {
            tracing::info!(path = %path.display(), "not valid media");
            return Ok(None);
        }
        let mut conn = self.state.db.acquire().await?;
        if db::is_embedded_media(&mut conn, &probe.hash).await? {
            tracing::warn!(path = %path.display(), "embedded content file found");
            return Ok(None);
        }
        drop(conn);
        self.reindex_replaced(owner, path, &probe.hash).await?;
        let mut conn = self.state.db.acquire().await?;
        Ok(Some(
            db::file_create(&mut conn, &path_str(path), &probe.hash, probe.kind).await?,
        ))
    }

    /// `File.create(path, user)` for a path whose hash is not known yet.
    async fn file_create_path(
        &self,
        db_conn: &mut Conn,
        owner: i32,
        path: &Path,
    ) -> anyhow::Result<FileRow> {
        if let Some(f) = db::file_by_path(db_conn, &path_str(path)).await? {
            if f.missing && path.exists() {
                return Ok(db::file_create(db_conn, &f.path, &f.hash, f.kind).await?);
            }
            return Ok(f);
        }
        let me = self.clone();
        let p = path.to_path_buf();
        let probe = self.blocking(move || me.probe(p, owner, false)).await?;
        let p = path.to_path_buf();
        let hash = self
            .blocking(move || fsutil::calculate_hash(&p, owner))
            .await?
            .with_context(|| format!("Could not calculate hash for file {}", path.display()))?;
        Ok(db::file_create(db_conn, &path_str(path), &hash, probe.kind).await?)
    }

    /// `handle_file_group`: the photo, `Ok(None)` for a group of non-media
    /// files that is skipped (still counted as processed), or the error text
    /// recorded on the job.
    pub async fn handle_file_group(
        &self,
        owner: &Owner,
        paths: &[PathBuf],
    ) -> Result<Option<Uuid>, String> {
        let joined: Vec<String> = paths.iter().map(|p| path_str(p)).collect();
        let run = async {
            let mut files = Vec::new();
            for p in paths {
                if let Some(f) =
                    crate::timers::time("1 file record", self.create_file_record(owner, p)).await?
                {
                    files.push(f);
                }
            }
            if files.is_empty() {
                // Only a group with something that looks like media is a
                // failure (a corrupt .jpg); unrelated files (RawTherapee
                // .pp3, notes) are skipped so they cannot fail the scan.
                let ps = paths.to_vec();
                let any_media = self
                    .blocking(move || ps.iter().any(|p| fsutil::looks_like_media(p)))
                    .await?;
                if !any_media {
                    tracing::info!("ignoring non-media files: {}", pyfmt::list_repr(&joined));
                    return Ok::<_, anyhow::Error>(Ok(None));
                }
                return Ok(Err(format!(
                    "No valid files in group: {}",
                    pyfmt::list_repr(&joined)
                )));
            }
            let Some(photo) = crate::timers::time(
                "2 group + motion",
                self.group_files_into_photo(owner, &files),
            )
            .await?
            else {
                return Ok(Err(format!(
                    "Could not create photo for files: {}",
                    pyfmt::list_repr(&joined)
                )));
            };
            if photo.main_file_id.is_some() {
                crate::timers::time("3 process photo", self.process_photo(owner, photo.id)).await?;
            }
            Ok(Ok(Some(photo.id)))
        };
        match run.await {
            Ok(Ok(id)) => Ok(id),
            Ok(Err(msg)) => {
                tracing::warn!("{msg}");
                Err(msg)
            }
            Err(e) => {
                tracing::error!(files = ?joined, error = %format!("{e:#}"), "could not process file group");
                Err(format!("{}: {e:#}", joined.join(", ")))
            }
        }
    }

    /// `group_files_into_photo`.
    async fn group_files_into_photo(
        &self,
        owner: &Owner,
        files: &[FileRow],
    ) -> anyhow::Result<Option<PhotoRow>> {
        let non_meta: Vec<&FileRow> = files.iter().filter(|f| f.kind != METADATA_FILE).collect();
        let Some(main) = non_meta
            .iter()
            .min_by(|a, b| (type_priority(a.kind), &a.path).cmp(&(type_priority(b.kind), &b.path)))
            .copied()
        else {
            tracing::warn!("only metadata files in group, skipping");
            return Ok(None);
        };
        let hashes: Vec<String> = non_meta.iter().map(|f| f.hash.clone()).collect();
        let mut tx = self.state.db.begin().await?;
        // SQLite: a no-op, the IMMEDIATE transaction already serializes writers.
        if tx.dialect().is_pg() {
            lp_db::sql::query("SELECT pg_advisory_xact_lock(7340032, hashtext($1))")
                .bind(&main.hash)
                .execute(&mut *tx)
                .await?;
        }
        if let Some(existing) = db::find_photo_with_files(&mut tx, owner.id, &hashes).await? {
            for f in files {
                db::add_photo_file(&mut tx, existing.id, &f.hash).await?;
            }
            let mut out = existing.clone();
            if let Some(current) = &existing.main_file_id {
                let cur_type = db::file_type(&mut tx, current).await?.unwrap_or(999);
                if type_priority(main.kind) < type_priority(cur_type) {
                    db::set_main_file(&mut tx, existing.id, &main.hash).await?;
                    out.main_file_id = Some(main.hash.clone());
                }
            }
            tx.commit().await?;
            return Ok(Some(out));
        }
        let photo = db::insert_photo(
            &mut tx,
            owner.id,
            &main.hash,
            Some(&main.hash),
            main.kind == VIDEO,
        )
        .await?;
        for f in files {
            db::add_photo_file(&mut tx, photo.id, &f.hash).await?;
        }
        tx.commit().await?;
        crate::timers::time("2a motion", self.attach_motion(owner, photo.id, main)).await?;
        Ok(Some(photo))
    }

    /// `_attach_embedded_motion_video`.
    pub(crate) async fn attach_motion(
        &self,
        owner: &Owner,
        photo: Uuid,
        file: &FileRow,
    ) -> anyhow::Result<()> {
        let f = &self.state.config.features;
        if !(f.process_embedded_media && f.video) {
            return Ok(());
        }
        let src = PathBuf::from(&file.path);
        let out_dir = self.state.config.embedded_media_dir();
        let out = out_dir.join(format!("{}_motion.mp4", file.hash));
        let extracted = self
            .blocking(move || -> Option<PathBuf> {
                if fsutil::mime_type(&src) != "image/jpeg" {
                    return None;
                }
                let pos = motion_video_offset(&src)?;
                std::fs::create_dir_all(&out_dir).ok()?;
                let mut input = std::fs::File::open(&src).ok()?;
                use std::io::{Seek, SeekFrom};
                input.seek(SeekFrom::Start(pos)).ok()?;
                let mut output = std::fs::File::create(&out).ok()?;
                std::io::copy(&mut input, &mut output).ok()?;
                Some(out)
            })
            .await?;
        let Some(em_path) = extracted else {
            return Ok(());
        };
        let mut tx = self.state.db.begin().await?;
        let em = self.file_create_path(&mut tx, owner.id, &em_path).await?;
        db::link_embedded(&mut tx, &file.hash, &em.hash).await?;
        db::add_photo_file(&mut tx, photo, &em.hash).await?;
        db::touch_photo(&mut tx, photo).await?;
        tx.commit().await?;
        Ok(())
    }

    /// `_process_photo`.
    pub async fn process_photo(&self, owner: &Owner, photo_id: Uuid) -> anyhow::Result<()> {
        let t_db = std::time::Instant::now();
        let mut conn = self.state.db.acquire().await?;
        let photo = db::photo_by_id(&mut conn, photo_id)
            .await?
            .ok_or_else(|| anyhow!("photo {photo_id} vanished"))?;
        let Some(main_hash) = photo.main_file_id.clone() else {
            return Ok(());
        };
        let main = db::file_by_hash(&mut conn, &main_hash)
            .await?
            .ok_or_else(|| anyhow!("main file {main_hash} vanished"))?;
        let thumb = db::ensure_thumbnail(&mut conn, photo.id).await?;
        drop(conn);
        crate::timers::add("3a photo reads", t_db);
        let main_path = PathBuf::from(&main.path);

        // One ExifTool request per photo: every tag the metadata and the
        // datetime rules need, fetched while the thumbnails render.
        let mut tags: Vec<String> = exifmap::EXIF_TAGS.iter().map(|t| t.to_string()).collect();
        for t in dates::required_tags(&owner.rules) {
            if !tags.contains(&t) {
                tags.push(t);
            }
        }
        // Inline ML: whether the face step needs its own region read.
        if self.inline.is_some() && crate::inline::region_probe() {
            tags.push(crate::inline::REGION_PROBE_TAG.to_string());
        }
        let exif_pool = self.state.exif.clone();
        let exif_path = main_path.clone();
        let exif_tags = tags.clone();
        let exif_task = tokio::spawn(async move {
            crate::timers::time(
                "x exif call (concurrent)",
                exif_pool.get_metadata(&exif_path, &exif_tags, true, false),
            )
            .await
        });

        let hash = photo.image_hash.clone();
        let rendered = crate::timers::time(
            "3b render (decode, webp)",
            self.generate_thumbnails(&photo, &main_path),
        )
        .await;
        let (fresh, mut big_rgb) = match rendered {
            Ok(r) => r,
            Err(e) => {
                exif_task.abort();
                return Err(e);
            }
        };
        // Inline ML from the big WebP: the pHash's decode also feeds the
        // models (the pixels the follow-up jobs would decode from the file).
        let rgb_from_webp = fresh
            && big_rgb.is_none()
            && self.inline.is_some()
            && crate::inline::source() == crate::inline::Source::Webp;
        let ext = if photo.video { ".mp4" } else { ".webp" };
        let big_path = self.renderer.path(BIG, &hash, ".webp");
        let small_path = self.renderer.path(SQUARE_SMALL, &hash, ext);
        let want_color = thumb.dominant_color.as_deref().is_none_or(str::is_empty) && !photo.video;
        let t_ph = std::time::Instant::now();
        let (aspect, phash, dominant) = {
            let bp = big_path.clone();
            let sp = small_path.clone();
            let (aspect, ph, dom, rgb) = self
                .blocking(move || {
                    let aspect = render::image_size(&bp)
                        .filter(|(w, h)| *w > 0 && *h > 0)
                        .and_then(|(w, h)| lp_core::codecs::aspect_ratio(w, h));
                    let (ph, rgb) = if bp.exists() {
                        phash::phash_webp_file_keep(&bp, rgb_from_webp)
                    } else {
                        (None, None)
                    };
                    let dom = if want_color {
                        color::dominant_webp_file(&sp)
                    } else {
                        None
                    };
                    (aspect, ph, dom, rgb)
                })
                .await?;
            if rgb.is_some() {
                big_rgb = rgb;
            }
            (aspect, ph, dom)
        };
        crate::timers::add("3c phash + colour (webp decode)", t_ph);
        let t_tx = std::time::Instant::now();
        {
            let mut tx = self.state.db.begin().await?;
            db::write_thumbnail(
                &mut tx,
                photo.id,
                &db::ThumbWrite {
                    big: Renderer::stored_name(BIG, &hash, ".webp"),
                    square: Renderer::stored_name(SQUARE, &hash, ext),
                    small: Renderer::stored_name(SQUARE_SMALL, &hash, ext),
                    aspect_ratio: aspect,
                    dominant_color: None,
                },
            )
            .await?;
            if let Some(ph) = &phash {
                db::set_perceptual_hash(&mut tx, photo.id, ph).await?;
            }
            tx.commit().await?;
        }
        crate::timers::add("3d thumbnail tx", t_tx);

        let t_ex = std::time::Instant::now();
        let values = exif_task
            .await
            .map_err(|e| anyhow!("exif task: {e}"))?
            .map_err(|e| anyhow!("{e}"))?;
        crate::timers::add("3e exif wait", t_ex);
        let t_meta = std::time::Instant::now();
        let by_tag: HashMap<String, Option<Value>> = tags.into_iter().zip(values).collect();
        let hints = crate::inline::PhotoHints {
            xmp_regions: by_tag
                .get(crate::inline::REGION_PROBE_TAG)
                .map(|v| v.as_ref().is_some_and(|v| !v.is_null())),
        };
        let vals = exifmap::Values(&by_tag);
        let photo_update = exifmap::photo_update(&vals);
        let meta_update = exifmap::metadata_update(&vals);

        let mut tx = self.state.db.begin().await?;
        let meta = db::upsert_metadata(&mut tx, photo.id, &meta_update).await?;
        if let Some(k) = &meta.keywords {
            db::link_tags(&mut tx, owner.id, photo.id, k).await?;
        }
        if let Some(d) = &meta_update.description {
            db::import_description(&mut tx, owner.id, photo.id, &photo.image_hash, d).await?;
        }
        let is_screenshot = if photo.category_source != "user" {
            Some(classify_screenshot(&main.path, &photo, &meta))
        } else {
            None
        };
        let ctx = dates::Inputs {
            gps_lat: photo.exif_gps_lat,
            gps_lon: photo.exif_gps_lon,
            user_default_tz: &owner.default_timezone,
            user_defined_timestamp: photo.timestamp,
        };
        let exif_ts = dates::extract_local_date_time(&main_path, &owner.rules, &by_tag, &ctx);
        db::move_to_album_date(
            &mut tx,
            owner.id,
            photo.id,
            &photo.image_hash,
            photo.exif_timestamp,
            exif_ts,
        )
        .await?;
        db::save_photo_scan_fields(&mut tx, photo.id, &photo_update, is_screenshot, exif_ts)
            .await?;
        if let Some(rgb) = dominant {
            lp_db::sql::query(
                "UPDATE api_thumbnail SET dominant_color = $2 WHERE photo_id = $1 \
                 AND (dominant_color IS NULL OR dominant_color = '')",
            )
            .bind(photo.id)
            .bind(lp_core::codecs::DominantColor::format(rgb))
            .execute(&mut *tx)
            .await?;
        }
        db::recreate_search(&mut tx, photo.id, &self.state.settings().tagging_model).await?;
        tx.commit().await?;
        crate::timers::add("3f metadata tx", t_meta);
        // The photo's rows are written: tags and faces from the pixels in hand.
        if let (Some(inline), Some(rgb)) = (&self.inline, big_rgb) {
            crate::timers::time(
                "3g inline submit (wait)",
                inline.submit(&self.state, photo.id, rgb, hints),
            )
            .await;
        }
        Ok(())
    }

    /// `Thumbnail._generate_thumbnail`: only what is missing on disk. Returns
    /// the big thumbnail's RGB pixels when it was rendered here and the scan
    /// runs ML inline.
    async fn generate_thumbnails(
        &self,
        photo: &PhotoRow,
        main_path: &Path,
    ) -> anyhow::Result<(bool, Option<image::RgbImage>)> {
        let hash = photo.image_hash.clone();
        let r = &self.renderer;
        if !photo.video {
            let missing: Vec<&'static str> = STATIC_DIRS
                .iter()
                .copied()
                .filter(|d| !r.path(d, &hash, ".webp").exists())
                .collect();
            if !missing.is_empty() {
                let rr = r.clone();
                let input = main_path.to_path_buf();
                let lo = photo.local_orientation;
                let keep = self.inline.is_some()
                    && crate::inline::source() == crate::inline::Source::Pixels;
                let fresh = missing.contains(&BIG);
                return self
                    .blocking(move || rr.static_thumbnails(&input, &hash, &missing, lo, keep))
                    .await?
                    .map(|rgb| (fresh, rgb))
                    .with_context(|| {
                        format!(
                            "could not generate thumbnail for image {}",
                            main_path.display()
                        )
                    });
            }
            return Ok((false, None));
        }
        let t_video = std::time::Instant::now();
        let _video = crate::timers::Timed("v video thumbnails (ffmpeg)", t_video);
        if !r.path(BIG, &hash, ".webp").exists() {
            r.video_big(main_path, &hash).await?;
        }
        for dir in [SQUARE, SQUARE_SMALL] {
            if !r.path(dir, &hash, ".mp4").exists() {
                r.video_animated(main_path, &hash, dir).await?;
            }
        }
        Ok((false, None))
    }

    /// `Thumbnail._regenerate_thumbnails`: delete, render, aspect ratio, pHash.
    pub async fn regenerate_thumbnails(&self, photo_id: Uuid) -> anyhow::Result<()> {
        let mut conn = self.state.db.acquire().await?;
        let photo = db::photo_by_id(&mut conn, photo_id)
            .await?
            .ok_or_else(|| anyhow!("photo {photo_id} vanished"))?;
        let Some(main_hash) = photo.main_file_id.clone() else {
            return Ok(());
        };
        let main = db::file_by_hash(&mut conn, &main_hash)
            .await?
            .ok_or_else(|| anyhow!("main file vanished"))?;
        db::ensure_thumbnail(&mut conn, photo.id).await?;
        drop(conn);
        self.delete_thumbnail_files(&photo.image_hash);
        self.generate_thumbnails(&photo, Path::new(&main.path))
            .await?;
        let hash = photo.image_hash.clone();
        let ext = if photo.video { ".mp4" } else { ".webp" };
        let big = self.renderer.path(BIG, &hash, ".webp");
        let (aspect, ph) = self
            .blocking(move || {
                let a = render::image_size(&big)
                    .filter(|(w, h)| *w > 0 && *h > 0)
                    .and_then(|(w, h)| lp_core::codecs::aspect_ratio(w, h));
                (a, phash::phash_webp_file(&big))
            })
            .await?;
        let mut tx = self.state.db.begin().await?;
        db::write_thumbnail(
            &mut tx,
            photo.id,
            &db::ThumbWrite {
                big: Renderer::stored_name(BIG, &hash, ".webp"),
                square: Renderer::stored_name(SQUARE, &hash, ext),
                small: Renderer::stored_name(SQUARE_SMALL, &hash, ext),
                aspect_ratio: aspect,
                dominant_color: None,
            },
        )
        .await?;
        if let Some(ph) = ph {
            db::set_perceptual_hash(&mut tx, photo.id, &ph).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// `delete_thumbnail_files`.
    pub fn delete_thumbnail_files(&self, hash: &str) {
        for (dir, ext) in [
            (BIG, ".webp"),
            (SQUARE, ".webp"),
            (SQUARE_SMALL, ".webp"),
            (SQUARE, ".mp4"),
            (SQUARE_SMALL, ".mp4"),
        ] {
            let p = self.renderer.path(dir, hash, ext);
            if p.exists()
                && let Err(e) = std::fs::remove_file(&p)
            {
                tracing::error!(path = %p.display(), error = %e, "could not remove thumbnail");
            }
        }
    }

    // ---- replaced files ------------------------------------------------------

    /// The pHash `path` would get as a big thumbnail (None when not comparable).
    async fn rendered_phash(
        &self,
        path: &Path,
        local_orientation: i32,
        legacy: bool,
    ) -> Option<String> {
        let me = self.clone();
        let p = path.to_path_buf();
        if fsutil::is_video(path) {
            return None;
        }
        self.blocking(move || {
            let dir = tempfile::tempdir().ok()?;
            let out = dir.path().join("candidate.webp");
            match me.renderer.render_big_to(&p, &out, local_orientation, legacy) {
                Ok(()) => phash::phash_webp_file(&out),
                Err(e) => {
                    tracing::error!(path = %p.display(), error = %format!("{e:#}"), "could not render to compare it with the index");
                    None
                }
            }
        })
        .await
        .ok()
        .flatten()
    }

    /// `reindex_replaced_file`: re-point `path`'s rows at its new content.
    pub(crate) async fn reindex_replaced(
        &self,
        owner: &Owner,
        path: &Path,
        new_hash: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        let pstr = path_str(path);
        let mut conn = self.state.db.acquire().await?;
        let Some(existing) = db::file_by_path(&mut conn, &pstr).await? else {
            return Ok(None);
        };
        let md5 = |h: &str| h.get(..32).unwrap_or(h).to_string();
        let owner_part = |h: &str| h.get(32..).unwrap_or("").to_string();
        if md5(&existing.hash) == md5(new_hash) {
            return Ok(None);
        }
        if owner_part(&existing.hash) != owner_part(new_hash) {
            tracing::info!(path = %pstr, "indexed under another user's hash, leaving it to their scan");
            return Ok(None);
        }
        if db::file_by_hash(&mut conn, new_hash).await?.is_some() {
            tracing::error!(path = %pstr, "changed file matches an already indexed file, not re-indexing");
            return Ok(None);
        }
        let old = existing.hash.clone();
        let affected: Vec<PhotoRow> = lp_db::sql::query_as(format!(
            "SELECT {} FROM api_photo p WHERE NOT p.removed AND ( \
               EXISTS (SELECT 1 FROM api_photo_files pf WHERE pf.photo_id = p.id AND pf.file_id = $1) \
               OR p.main_file_id = $1 OR (p.image_hash = $1 AND p.main_file_id IS NOT NULL)) ORDER BY p.id",
            db::PHOTO_COLS
        ))
        .bind(&old)
        .fetch_all(&mut *conn)
        .await?;
        drop(conn);
        let main_ids: Vec<Uuid> = affected
            .iter()
            .filter(|p| p.main_file_id.as_deref() == Some(old.as_str()))
            .map(|p| p.id)
            .collect();
        let compare = {
            let scanned = affected
                .iter()
                .find(|p| p.owner_id == owner.id && p.image_hash == old);
            match scanned {
                Some(s) if s.perceptual_hash.as_deref().is_some_and(|h| !h.is_empty()) => Some(s),
                _ => affected
                    .iter()
                    .find(|p| {
                        p.image_hash == old
                            && p.perceptual_hash.as_deref().is_some_and(|h| !h.is_empty())
                    })
                    .or(scanned),
            }
        };
        let verdict = self.picture_verdict(compare, path).await;
        tracing::info!(path = %pstr, ?verdict, new_hash, "content changed, re-keying");

        let mut after = AfterCommit::new();
        let mut rebuild = Vec::new();
        let mut main_photo = None;
        let mut tx = self.state.db.begin().await?;
        if verdict == Verdict::New {
            discard_embedded_media(&mut tx, &old, &mut after).await?;
        }
        rekey_file(&mut tx, &existing, new_hash, fsutil::detect_file_type(path)).await?;
        for p in &affected {
            if main_ids.contains(&p.id) && p.owner_id == owner.id {
                main_photo = Some(p.id);
            }
            if verdict == Verdict::Same || p.image_hash != old {
                continue;
            }
            self.discard_cheap(&mut tx, p.id, &old, &mut after).await?;
            if verdict == Verdict::Uncomparable {
                rebuild.push(p.id);
                continue;
            }
            discard_faces(&mut tx, p.id, &self.state.config.media_root, &mut after).await?;
            for (dir, ext) in [
                (BIG, ".webp"),
                (SQUARE, ".webp"),
                (SQUARE_SMALL, ".webp"),
                (SQUARE, ".mp4"),
                (SQUARE_SMALL, ".mp4"),
            ] {
                after.delete_file(self.renderer.path(dir, &old, ext));
            }
            lp_db::sql::query("UPDATE api_photo SET image_hash = $2, added_on = now(), last_modified = now() WHERE id = $1")
                .bind(p.id)
                .bind(new_hash)
                .execute(&mut *tx)
                .await?;
            rebuild.push(p.id);
        }
        tx.commit().await?;
        after.run().await;
        for id in rebuild {
            if let Err(e) = self.regenerate_thumbnails(id).await {
                tracing::warn!(photo = %id, error = %format!("{e:#}"), "could not regenerate thumbnails");
            }
        }
        if verdict == Verdict::New
            && let Some(mp) = main_photo
        {
            let file = FileRow {
                hash: new_hash.to_string(),
                path: pstr.clone(),
                kind: existing.kind,
                missing: existing.missing,
            };
            self.attach_motion(owner, mp, &file).await?;
        }
        Ok(main_photo)
    }

    async fn picture_verdict(&self, photo: Option<&PhotoRow>, path: &Path) -> Verdict {
        let Some(p) = photo else {
            return Verdict::Uncomparable;
        };
        let Some(stored) = p.perceptual_hash.clone().filter(|h| !h.is_empty()) else {
            return Verdict::Uncomparable;
        };
        if p.local_orientation != 1 {
            return Verdict::Uncomparable;
        }
        let candidate = self.rendered_phash(path, p.local_orientation, false).await;
        if candidate.as_deref() == Some(stored.as_str()) {
            return Verdict::Same;
        }
        let legacy = self.rendered_phash(path, p.local_orientation, true).await;
        if legacy.as_deref() == Some(stored.as_str()) {
            return Verdict::Same;
        }
        if candidate.is_none() || legacy.is_none() {
            return Verdict::Uncomparable;
        }
        Verdict::New
    }

    /// `_discard_cheap_derived_content`: the cached transcode and the colour.
    async fn discard_cheap(
        &self,
        tx: &mut Conn,
        photo: Uuid,
        old: &str,
        after: &mut AfterCommit,
    ) -> anyhow::Result<()> {
        after.delete_file(
            self.state
                .config
                .transcoded_dir()
                .join(format!("{old}.mp4")),
        );
        lp_db::sql::query("UPDATE api_thumbnail SET dominant_color = NULL WHERE photo_id = $1")
            .bind(photo)
            .execute(tx)
            .await?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Same,
    New,
    Uncomparable,
}

/// `File.rekey`: a new row under `new_hash`, relations carried across.
async fn rekey_file(tx: &mut Conn, old: &FileRow, new_hash: &str, kind: i32) -> anyhow::Result<()> {
    let variant_of: Vec<Uuid> = lp_db::sql::query_scalar(
        "SELECT photo_id FROM api_photo_files WHERE file_id = $1 AND photo_id IS NOT NULL",
    )
    .bind(&old.hash)
    .fetch_all(&mut *tx)
    .await?;
    let main_of: Vec<Uuid> =
        lp_db::sql::query_scalar("SELECT id FROM api_photo WHERE main_file_id = $1")
            .bind(&old.hash)
            .fetch_all(&mut *tx)
            .await?;
    let embedded: Vec<String> = lp_db::sql::query_scalar(
        "SELECT to_file_id FROM api_file_embedded_media WHERE from_file_id = $1",
    )
    .bind(&old.hash)
    .fetch_all(&mut *tx)
    .await?;
    let embedded_in: Vec<String> = lp_db::sql::query_scalar(
        "SELECT from_file_id FROM api_file_embedded_media WHERE to_file_id = $1",
    )
    .bind(&old.hash)
    .fetch_all(&mut *tx)
    .await?;
    lp_db::sql::query("DELETE FROM api_photo_files WHERE file_id = $1")
        .bind(&old.hash)
        .execute(&mut *tx)
        .await?;
    lp_db::sql::query(
        "DELETE FROM api_file_embedded_media WHERE from_file_id = $1 OR to_file_id = $1",
    )
    .bind(&old.hash)
    .execute(&mut *tx)
    .await?;
    lp_db::sql::query("UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = $1")
        .bind(&old.hash)
        .execute(&mut *tx)
        .await?;
    lp_db::sql::query("DELETE FROM api_file WHERE hash = $1")
        .bind(&old.hash)
        .execute(&mut *tx)
        .await?;
    lp_db::sql::query("INSERT INTO api_file (hash, path, type, missing) VALUES ($1, $2, $3, $4)")
        .bind(new_hash)
        .bind(&old.path)
        .bind(kind)
        .bind(old.missing)
        .execute(&mut *tx)
        .await?;
    for e in embedded {
        db::link_embedded(tx, new_hash, &e).await?;
    }
    for parent in embedded_in {
        db::link_embedded(tx, &parent, new_hash).await?;
    }
    let mut seen = std::collections::HashSet::new();
    for p in variant_of.iter().chain(main_of.iter()) {
        if !seen.insert(*p) {
            continue;
        }
        if variant_of.contains(p) {
            db::add_photo_file(tx, *p, new_hash).await?;
        }
        if main_of.contains(p) {
            db::set_main_file(tx, *p, new_hash).await?;
        }
    }
    Ok(())
}

/// `_discard_embedded_media`.
async fn discard_embedded_media(
    tx: &mut Conn,
    file: &str,
    after: &mut AfterCommit,
) -> anyhow::Result<()> {
    let embedded: Vec<(String, String)> = lp_db::sql::query_as(
        "SELECT f.hash, f.path FROM api_file_embedded_media em JOIN api_file f ON f.hash = em.to_file_id \
         WHERE em.from_file_id = $1",
    )
    .bind(file)
    .fetch_all(&mut *tx)
    .await?;
    for (hash, path) in embedded {
        lp_db::sql::query(
            "DELETE FROM api_file_embedded_media WHERE to_file_id = $1 OR from_file_id = $1",
        )
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
        lp_db::sql::query("DELETE FROM api_photo_files WHERE file_id = $1")
            .bind(&hash)
            .execute(&mut *tx)
            .await?;
        lp_db::sql::query("UPDATE api_photo SET main_file_id = NULL WHERE main_file_id = $1")
            .bind(&hash)
            .execute(&mut *tx)
            .await?;
        lp_db::sql::query("DELETE FROM api_file WHERE hash = $1")
            .bind(&hash)
            .execute(&mut *tx)
            .await?;
        after.delete_file(path);
    }
    Ok(())
}

/// `_discard_faces`: delete the photo's faces (and crops), repair people.
async fn discard_faces(
    tx: &mut Conn,
    photo: Uuid,
    media_root: &Path,
    after: &mut AfterCommit,
) -> anyhow::Result<()> {
    let persons: Vec<i32> = lp_db::sql::query_scalar(
        "SELECT DISTINCT pe.id FROM api_person pe WHERE pe.cover_photo_id = $1 OR pe.id IN ( \
           SELECT person_id FROM api_face WHERE photo_id = $1 AND person_id IS NOT NULL \
           UNION SELECT classification_person_id FROM api_face WHERE photo_id = $1 AND classification_person_id IS NOT NULL \
           UNION SELECT cluster_person_id FROM api_face WHERE photo_id = $1 AND cluster_person_id IS NOT NULL) ORDER BY pe.id",
    )
    .bind(photo)
    .fetch_all(&mut *tx)
    .await?;
    let images: Vec<Option<String>> =
        lp_db::sql::query_scalar("SELECT image FROM api_face WHERE photo_id = $1")
            .bind(photo)
            .fetch_all(&mut *tx)
            .await?;
    lp_db::sql::query("UPDATE api_person SET cover_face_id = NULL WHERE cover_face_id IN (SELECT id FROM api_face WHERE photo_id = $1)")
        .bind(photo)
        .execute(&mut *tx)
        .await?;
    lp_db::sql::query("DELETE FROM api_face WHERE photo_id = $1")
        .bind(photo)
        .execute(&mut *tx)
        .await?;
    for img in images.into_iter().flatten().filter(|s| !s.is_empty()) {
        after.delete_file(media_root.join(img));
    }
    for person in persons {
        lp_db::sql::query(
            "UPDATE api_person SET cover_photo_id = NULL, cover_face_id = NULL, last_modified = now() \
             WHERE id = $1 AND cover_photo_id = $2",
        )
        .bind(person)
        .bind(photo)
        .execute(&mut *tx)
        .await?;
        lp_db::sql::query(
            "UPDATE api_person pe SET face_count = (SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
               WHERE f.person_id = pe.id AND NOT p.hidden AND NOT p.in_trashcan AND p.owner_id = pe.cluster_owner_id), \
               last_modified = now() WHERE pe.id = $1 AND pe.cluster_owner_id IS NOT NULL",
        )
        .bind(person)
        .execute(&mut *tx)
        .await?;
        lp_db::sql::query(
            "UPDATE api_person pe SET cover_photo_id = f.photo_id, cover_face_id = f.id, last_modified = now() \
             FROM (SELECT id, photo_id FROM api_face WHERE person_id = $1 ORDER BY id LIMIT 1) f \
             WHERE pe.id = $1 AND pe.cover_photo_id IS NULL",
        )
        .bind(person)
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

// ---- screenshot detection ------------------------------------------------------

const SCREENSHOT_PREFIXES: [&str; 7] = [
    "screenshot",
    "screen shot",
    "bildschirmfoto",
    "captura de pantalla",
    "capture d'ecran",
    "снимок экрана",
    "スクリーンショット",
];

fn normalize(text: &str) -> String {
    text.to_lowercase()
        .replace('\u{2019}', "'")
        .replace(['_', '-'], " ")
}

fn matches_screenshot_prefix(basename: &str) -> bool {
    let n = normalize(basename);
    SCREENSHOT_PREFIXES.iter().any(|p| {
        n.strip_prefix(p)
            .is_some_and(|rest| rest.chars().next().is_none_or(|c| !c.is_alphabetic()))
    })
}

fn in_screenshots_dir(path: &str) -> bool {
    let parts: Vec<&str> = path.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    let n = parts.len();
    parts
        .iter()
        .take(n.saturating_sub(1))
        .any(|p| p.to_lowercase() == "screenshots")
}

/// `api.screenshot_detection.classify`.
fn classify_screenshot(path: &str, photo: &PhotoRow, meta: &db::MetaRow) -> bool {
    if !path.is_empty() {
        let base = path.rsplit(['/', '\\']).next().unwrap_or(path);
        if matches_screenshot_prefix(base) || in_screenshots_dir(path) {
            return true;
        }
    }
    if fsutil::splitext(path).1.to_lowercase() != ".png" {
        return false;
    }
    if db::has_camera_metadata(meta) {
        return false;
    }
    if photo.exif_gps_lat.is_some()
        || photo.exif_gps_lon.is_some()
        || meta.gps_latitude.is_some()
        || meta.gps_longitude.is_some()
    {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_names() {
        assert!(matches_screenshot_prefix("Screenshot_20240115-093000.png"));
        assert!(matches_screenshot_prefix("Screen Shot 2020.png"));
        assert!(matches_screenshot_prefix("screenshot.png"));
        assert!(!matches_screenshot_prefix("screenshotly.png"));
        assert!(in_screenshots_dir(r"C:\a\Screenshots\x.png"));
        assert!(!in_screenshots_dir(r"C:\a\screenshots.png"));
    }
}

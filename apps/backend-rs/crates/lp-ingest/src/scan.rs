//! `scan_photos` (`api/directory_watcher/scan_jobs.py`): walk, group,
//! decide what changed, process the groups (in-process, bounded
//! concurrency), finish the LongRunningJob exactly once, then the
//! follow-ups: missing-file check, variant repair and the ML jobs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::anyhow;
use chrono::{DateTime, Utc};
use futures::StreamExt;
use lp_jobs::{EnqueueOptions, JobType};
use serde_json::{Value, json};
use tokio::sync::Mutex;

use crate::db;
use crate::fsutil::{self, path_str};
use crate::pipeline::{Owner, Pipeline};
use crate::pyfmt;

const PATH_PREFETCH_BATCH: usize = 10_000;
const CANCEL_CHECK_EVERY: usize = 100;

#[derive(Debug, Clone, Default)]
pub struct ScanOptions {
    pub full_scan: bool,
    /// Force the missing-file check even when Django would skip it.
    pub scan_missing: bool,
    /// Only `<scan_directory>/uploads/web` (`/api/scanuploadedphotos`).
    pub uploaded_only: bool,
    /// Explicit files instead of a walk (`scan_files`).
    pub files: Vec<PathBuf>,
    /// Leave out the follow-up jobs (benchmarks and parity runs).
    pub skip_followups: bool,
}

pub type Group = ((String, String), Vec<PathBuf>);

/// `_partition_scan_paths`: `(directory, stem)` groups (insertion order)
/// with their sidecars, and the sidecars whose media is not in this scan.
pub fn partition(paths: &[PathBuf]) -> (Vec<Group>, Vec<PathBuf>) {
    let mut index: HashMap<(String, String), usize> = HashMap::new();
    let mut groups: Vec<Group> = Vec::new();
    let mut sidecars = Vec::new();
    for p in paths {
        let s = path_str(p);
        if fsutil::is_metadata(&s) {
            sidecars.push(p.clone());
            continue;
        }
        let key = fsutil::grouping_key(&s);
        match index.get(&key) {
            Some(&i) => groups[i].1.push(p.clone()),
            None => {
                index.insert(key.clone(), groups.len());
                groups.push((key, vec![p.clone()]));
            }
        }
    }
    let mut orphans = Vec::new();
    for p in sidecars {
        let keys = fsutil::sidecar_grouping_keys(&path_str(&p));
        match keys.iter().find_map(|k| index.get(k)) {
            Some(&i) => groups[i].1.push(p),
            None => orphans.push(p),
        }
    }
    (groups, orphans)
}

fn modified_after(path: &Path, t: DateTime<Utc>) -> bool {
    fsutil::mtime_utc(path).is_some_and(|m| m > t)
}

fn changed_since(path: &Path, t: DateTime<Utc>) -> bool {
    modified_after(path, t)
        || lp_exif::sidecar_files_in_priority_order(path)
            .iter()
            .any(|s| modified_after(s, t))
}

/// Running error record in Django's `result` shape.
#[derive(Default)]
struct Errors {
    count: usize,
    errors: Vec<String>,
    first: Option<String>,
}

impl Errors {
    fn add(&mut self, e: String) {
        self.count += 1;
        if !self.errors.contains(&e) {
            self.errors.push(e.clone());
            if self.errors.len() > 100 {
                let drop = self.errors.len() - 100;
                self.errors.drain(..drop);
            }
        }
        if self.first.is_none() {
            self.first = Some(e);
        }
    }

    fn failed(&self, target: usize) -> bool {
        if target == 0 {
            return self.count > 0;
        }
        self.count as f64 > f64::max(10.0, 0.05 * target as f64)
    }

    fn result(&self, target: usize) -> Value {
        let mut m = serde_json::Map::new();
        if self.count > 0 {
            m.insert("error_count".into(), json!(self.count));
            m.insert("errors".into(), json!(self.errors));
            m.insert("error".into(), json!(self.first));
            m.insert(
                "status".into(),
                json!(if self.failed(target) {
                    "failed"
                } else {
                    "partial_failure"
                }),
            );
        }
        Value::Object(m)
    }
}

struct Progress {
    done: usize,
    target: usize,
    errors: Errors,
    last_flush: std::time::Instant,
}

/// `scan_photos`. `job_id` is the LongRunningJob the UI polls.
pub async fn scan_user(
    p: &Pipeline,
    user_id: i32,
    job_id: &str,
    opts: ScanOptions,
) -> anyhow::Result<()> {
    let state = &p.state;
    let user = lp_db::users::by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| anyhow!("user {user_id} not found"))?;
    p.renderer.ensure_dirs()?;
    db::lrj_get_or_create(&state.db, job_id, JobType::ScanPhotos.as_i32(), user_id).await?;
    match scan_inner(p, &user, job_id, &opts).await {
        Ok(()) => Ok(()),
        Err(e) => {
            tracing::error!(error = %format!("{e:#}"), "scan failed");
            lp_jobs::lrj::fail(&state.db, job_id, &format!("{e:#}")).await?;
            Ok(())
        }
    }
}

async fn scan_inner(
    p: &Pipeline,
    user: &lp_db::users::User,
    job_id: &str,
    opts: &ScanOptions,
) -> anyhow::Result<()> {
    // Tags, embeddings and faces from the pixels the scan renders anyway.
    let mut with_inline = p.clone();
    with_inline.inline = crate::inline::InlineMl::for_scan(&p.state);
    let p = &with_inline;
    let state = &p.state;
    let scan_directory = if opts.uploaded_only {
        Path::new(&user.scan_directory).join("uploads").join("web")
    } else {
        PathBuf::from(&user.scan_directory)
    };
    let patterns = fsutil::skip_patterns(&state.settings().skip_patterns);
    let photo_list: Vec<PathBuf> = if opts.files.is_empty() {
        // Django's walk starts with an os.stat of the directory and fails the job.
        std::fs::metadata(&scan_directory)
            .map_err(|e| anyhow!("{e}: '{}'", scan_directory.display()))?;
        let dir = scan_directory.clone();
        state
            .blocking(move || fsutil::walk_directory(&dir, &patterns))
            .await
            .map_err(|e| anyhow!("{e}"))?
    } else {
        opts.files.iter().filter(|f| f.is_file()).cloned().collect()
    };
    let last_scan = db::last_scan_finished_at(&state.db, user.id).await?;
    let (groups, orphans) = partition(&photo_list);

    let to_process: Vec<Group> = if let (false, Some(last)) = (opts.full_scan, last_scan) {
        let mut out = Vec::new();
        for batch in groups.chunks(PATH_PREFETCH_BATCH) {
            let paths: Vec<String> = batch
                .iter()
                .flat_map(|(_, ps)| ps.iter().map(|p| path_str(p)))
                .collect();
            let known = db::known_paths(&state.db, &paths).await?;
            for (key, ps) in batch {
                let needs = ps
                    .iter()
                    .any(|path| !known.contains(&path_str(path)) || changed_since(path, last));
                if needs {
                    out.push((key.clone(), ps.clone()));
                }
            }
        }
        out
    } else {
        groups
    };

    let target = to_process.len() + orphans.len();
    let scan_missing =
        opts.scan_missing || opts.full_scan || (!opts.uploaded_only && opts.files.is_empty());
    let photo_count_before = db::photo_count(&state.db, user.id).await?;
    db::lrj_record_errors(
        &state.db,
        job_id,
        &json!({"followups": {
        "full_scan": opts.full_scan, "scan_missing_photos": scan_missing,
        "photo_count_before": photo_count_before}}),
        false,
    )
    .await?;
    db::lrj_progress(&state.db, job_id, 0, target as i32).await?;
    tracing::info!(
        files = photo_list.len(),
        groups = to_process.len(),
        "grouped files, {} need processing",
        to_process.len()
    );

    let owner = Arc::new(Owner::from_user(user));
    let progress = Arc::new(Mutex::new(Progress {
        done: 0,
        target,
        errors: Errors::default(),
        last_flush: std::time::Instant::now(),
    }));
    let concurrency = state.config.scan_concurrency();
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let work = futures::stream::iter(to_process.into_iter().enumerate())
        .map(|(i, (_, paths))| {
            let p = p.clone();
            let owner = owner.clone();
            let progress = progress.clone();
            let cancelled = cancelled.clone();
            let job_id = job_id.to_string();
            async move {
                if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }
                if i % CANCEL_CHECK_EVERY == 0
                    && lp_jobs::lrj::is_cancelled(&p.state.db, &job_id)
                        .await
                        .unwrap_or(false)
                {
                    cancelled.store(true, std::sync::atomic::Ordering::Relaxed);
                    return;
                }
                let outcome = p.handle_file_group(&owner, &paths).await;
                tick(&p, &job_id, &progress, outcome.err()).await;
            }
        })
        .buffer_unordered(concurrency);
    let t_groups = std::time::Instant::now();
    work.collect::<Vec<()>>().await;
    tracing::info!(secs = t_groups.elapsed().as_secs_f64(), "file groups done");
    if let Some(inline) = &p.inline {
        inline.finish().await;
        tracing::info!(photos = inline.submitted(), "inline ML done");
    }
    crate::timers::report(t_groups.elapsed());

    for path in &orphans {
        if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let needs = !db::path_is_known(&state.db, &path_str(path)).await?
            || opts.full_scan
            || last_scan.is_none()
            || last_scan.is_some_and(|t| changed_since(path, t));
        let err = if needs {
            attach_sidecar(p, &owner, path).await.err()
        } else {
            None
        };
        tick(p, job_id, &progress, err).await;
    }

    if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
        tracing::info!(job_id, "scan cancelled");
        return Ok(());
    }
    let (done, errors_result, failed) = {
        let pg = progress.lock().await;
        (
            pg.done,
            pg.errors.result(pg.target),
            pg.errors.failed(pg.target),
        )
    };
    db::lrj_record_errors(&state.db, job_id, &errors_result, failed).await?;
    db::lrj_progress(&state.db, job_id, done as i32, target as i32).await?;
    let won = db::lrj_finish(&state.db, job_id).await?;
    tracing::info!(files = photo_list.len(), dir = %scan_directory.display(), "scanned");
    // The metadata batches are done: stop the idle ExifTool processes now
    // rather than after the idle timeout, while the ML jobs run.
    state.exif.shutdown().await;

    backfill_missing_aspect_ratios(p, user.id).await?;

    if won && !opts.skip_followups {
        let added = db::photo_count(&state.db, user.id).await? - photo_count_before;
        tracing::info!("Added {added} photos");
        queue_followups(p, user.id, opts.full_scan, scan_missing).await?;
    }
    Ok(())
}

async fn tick(p: &Pipeline, job_id: &str, progress: &Mutex<Progress>, err: Option<String>) {
    let mut pg = progress.lock().await;
    pg.done += 1;
    let had_error = err.is_some();
    if let Some(e) = err {
        pg.errors.add(e);
    }
    if had_error || pg.last_flush.elapsed() >= std::time::Duration::from_millis(250) {
        pg.last_flush = std::time::Instant::now();
        let (done, target) = (pg.done, pg.target);
        let result = pg.errors.result(target);
        let failed = pg.errors.failed(target);
        drop(pg);
        let _ = db::lrj_progress(&p.state.db, job_id, done as i32, target as i32).await;
        if had_error {
            let _ = db::lrj_record_errors(&p.state.db, job_id, &result, failed).await;
        }
    }
}

/// `handle_new_image` for an XMP sidecar: attach it to the photo it describes.
pub async fn attach_sidecar(p: &Pipeline, owner: &Owner, path: &Path) -> Result<(), String> {
    let run = async {
        let pstr = path_str(path);
        let hash = {
            let pp = path.to_path_buf();
            let uid = owner.id;
            p.state
                .blocking(move || fsutil::calculate_hash(&pp, uid))
                .await
                .map_err(|e| anyhow!("{e}"))??
        };
        let mut tx = p.state.db.begin().await?;
        if db::is_embedded_media(&mut tx, &hash).await? {
            return Ok::<_, anyhow::Error>(());
        }
        let mut found = None;
        for (dir, stem) in fsutil::sidecar_grouping_keys(&pstr) {
            let prefix = format!("{}{}", fsutil::media_name(&dir, &stem), ".");
            let rows: Vec<(uuid::Uuid, String)> = sqlx::query_as(
                "SELECT p.id, f.path FROM api_photo p JOIN api_photo_files pf ON pf.photo_id = p.id \
                 JOIN api_file f ON f.hash = pf.file_id WHERE p.owner_id = $1 \
                 AND upper(f.path) LIKE upper($2) ESCAPE '\\' ORDER BY f.path",
            )
            .bind(owner.id)
            .bind(format!("{}%", like_escape(&prefix)))
            .fetch_all(&mut *tx)
            .await?;
            if let Some((id, _)) = rows.into_iter().find(|(_, fp)| {
                fsutil::grouping_key(fp) == (dir.clone(), stem.clone()) && !fsutil::is_metadata(fp)
            }) {
                found = Some(id);
                break;
            }
        }
        let Some(photo) = found else {
            tracing::warn!(path = %pstr, "no photo to metadata file found");
            return Ok(());
        };
        let f = db::file_create(&mut tx, &pstr, &hash, fsutil::METADATA_FILE).await?;
        db::add_photo_file(&mut tx, photo, &f.hash).await?;
        db::touch_photo(&mut tx, photo).await?;
        tx.commit().await?;
        Ok(())
    };
    run.await
        .map_err(|e: anyhow::Error| format!("{}: {e:#}", path_str(path)))
}

fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// `backfill_missing_aspect_ratios`.
async fn backfill_missing_aspect_ratios(p: &Pipeline, user_id: i32) -> anyhow::Result<()> {
    let rows: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT t.photo_id, t.thumbnail_big FROM api_thumbnail t JOIN api_photo p ON p.id = t.photo_id \
         WHERE p.owner_id = $1 AND t.aspect_ratio IS NULL AND t.thumbnail_big IS NOT NULL",
    )
    .bind(user_id)
    .fetch_all(&p.state.db)
    .await?;
    for (photo, name) in rows {
        if name.is_empty() {
            continue;
        }
        let path = p.state.config.media_root.join(&name);
        if let Some((w, h)) = crate::render::image_size(&path)
            && let Some(a) = lp_core::codecs::aspect_ratio(w, h)
        {
            sqlx::query("UPDATE api_thumbnail SET aspect_ratio = $2 WHERE photo_id = $1")
                .bind(photo)
                .bind(a)
                .execute(&p.state.db)
                .await?;
        }
    }
    Ok(())
}

/// `_queue_followup_jobs`.
pub async fn queue_followups(
    p: &Pipeline,
    user_id: i32,
    full_scan: bool,
    scan_missing: bool,
) -> anyhow::Result<()> {
    let state = &p.state;
    if scan_missing {
        let job = uuid::Uuid::new_v4().to_string();
        if let Err(e) = crate::repair::scan_missing_photos(p, user_id, &job).await {
            tracing::error!(error = %format!("{e:#}"), "scan missing photos failed");
        }
    }
    lp_jobs::enqueue(
        state,
        "repair.file_variants",
        json!({"user_id": user_id}),
        EnqueueOptions::tracked(JobType::RepairFileVariants, user_id),
    )
    .await?;
    let f = &state.config.features;
    let tags = if f.scene_classification {
        Some(
            lp_jobs::enqueue(
                state,
                "tags.generate",
                json!({"user_id": user_id, "full_scan": full_scan}),
                EnqueueOptions::tracked(JobType::GenerateTags, user_id),
            )
            .await?,
        )
    } else {
        None
    };
    if f.reverse_geocoding {
        lp_jobs::enqueue(
            state,
            "geo.locate",
            json!({"user_id": user_id, "full_scan": full_scan}),
            EnqueueOptions::tracked(JobType::AddGeolocation, user_id),
        )
        .await?;
    }
    let mut clip_opts = EnqueueOptions::tracked(JobType::CalculateClipEmbeddings, user_id);
    if let Some(tags) = tags
        .as_ref()
        .filter(|_| state.ml().semantic_shares_tagger())
    {
        // tags.generate stores the embeddings; CLIP only fills the gaps
        // and rebuilds the index once it is done.
        clip_opts = clip_opts.after(tags.id);
    }
    let clip =
        lp_jobs::enqueue(state, "clip.embed", json!({"user_id": user_id}), clip_opts).await?;
    if f.face_detection {
        // Django's Chain: faces run once the CLIP job has finished. Photos
        // whose faces this scan already found inline are skipped.
        let skip_inline = p.inline.as_ref().is_some_and(|i| i.submitted() > 0);
        lp_jobs::enqueue(
            state,
            "faces.scan",
            json!({"user_id": user_id, "full_scan": full_scan, "skip_inline": skip_inline}),
            EnqueueOptions::tracked(JobType::ScanFaces, user_id).after(clip.id),
        )
        .await?;
    }
    Ok(())
}

pub fn describe_list(paths: &[PathBuf]) -> String {
    pyfmt::list_repr(&paths.iter().map(|p| path_str(p)).collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partition_groups_sidecars() {
        let paths: Vec<PathBuf> = [
            r"C:\p\IMG_1.jpg",
            r"C:\p\IMG_1.CR2",
            r"C:\p\IMG_1.xmp",
            r"C:\p\IMG_2.jpg.xmp",
            r"C:\p\IMG_2.jpg",
            r"C:\p\lonely.xmp",
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        let (groups, orphans) = partition(&paths);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].1.len(), 3);
        assert_eq!(groups[1].1.len(), 2);
        assert_eq!(orphans, vec![PathBuf::from(r"C:\p\lonely.xmp")]);
    }

    #[test]
    fn errors_shape() {
        let mut e = Errors::default();
        assert_eq!(e.result(10), json!({}));
        e.add("a: boom".into());
        e.add("a: boom".into());
        let r = e.result(100);
        assert_eq!(r["error_count"], 2);
        assert_eq!(r["errors"], json!(["a: boom"]));
        assert_eq!(r["status"], "partial_failure");
        assert!(!e.failed(100));
    }
}

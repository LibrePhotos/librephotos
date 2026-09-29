//! Zip downloads (`api/views/zip_downloads.py`, `api/all_tasks.py`):
//! `POST /api/photos/download` starts a `zip.build` job, `GET ?job_id=`
//! polls it, `DELETE /api/delete/zip/{uuid}` removes the archive. The job
//! streams the archive to `protected_media/zip/<uuid><user id>.zip`.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use anyhow::Context;
use axum::Json;
use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Datelike, Local, Timelike};
use lp_auth::AuthUser;
use lp_core::extract::py_truthy;
use lp_core::{ApiError, ApiJson, ApiResult, AppState, QueryMap};
use lp_db::jobs_zip_services::{self as db, DownloadSelection};
use lp_db::scope::PhotoFilterParams;
use lp_jobs::{EnqueueOptions, JobCtx, JobType, Progress, lrj};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// `zip_file_name`: `<uuid><user id>.zip`, only for a canonical UUID (so a
/// crafted value can neither leave the zip directory nor name another
/// user's archive).
pub fn zip_file_name(file_uuid: &str, user_id: i32) -> Option<String> {
    let canonical = Uuid::parse_str(file_uuid).ok()?.hyphenated().to_string();
    (canonical == file_uuid.to_lowercase()).then(|| format!("{canonical}{user_id}.zip"))
}

fn json_status(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

/// `include_stacked_photos`: list -> first item, string -> "1/true/yes/on", else truthiness.
fn include_stacked(v: Option<&Value>) -> bool {
    let v = match v {
        Some(Value::Array(a)) => a.first(),
        other => other,
    };
    match v {
        Some(Value::String(s)) => matches!(
            s.trim().to_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Some(v) => py_truthy(v),
        None => false,
    }
}

fn string_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| match x {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ZipPayload {
    pub user_id: i32,
    pub photo_ids: Vec<Uuid>,
    pub zip_uuid: String,
    pub include_stacked_photos: bool,
}

/// Free bytes on the filesystem holding `path` (or its nearest existing ancestor).
fn free_space(path: &Path) -> Option<u64> {
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            return None;
        }
    }
    let probe = probe.canonicalize().unwrap_or(probe);
    let probe = strip_verbatim(&probe);
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| probe.starts_with(strip_verbatim(d.mount_point())))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

/// `\\?\C:\x` -> `C:\x`, so canonical paths compare with mount points on Windows.
fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

/// `POST /api/photos/download`: `{image_hashes}` or `{select_all, query,
/// excluded_hashes}`, plus `include_stacked_photos` -> `{job_id, url}`.
pub async fn start(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(data): ApiJson<Value>,
) -> ApiResult<Response> {
    let stacked = include_stacked(data.get("include_stacked_photos"));
    let photos = if data.get("select_all").is_some_and(py_truthy) {
        let query = match data.get("query") {
            Some(Value::Array(a)) => a.first().cloned().unwrap_or(Value::Null),
            Some(v) => v.clone(),
            None => Value::Null,
        };
        let query = if query.is_object() { query } else { json!({}) };
        let params = PhotoFilterParams::from_json(&query)?;
        let excluded = if data.get("excluded_hashes").is_some_and(py_truthy) {
            string_list(data.get("excluded_hashes"))
        } else {
            Vec::new()
        };
        let sel = DownloadSelection::Query {
            params: &params,
            favorite_min_rating: user.favorite_min_rating,
            excluded: &excluded,
        };
        db::download_photos(&state.db, user.id, &sel, stacked).await?
    } else {
        if !data.get("image_hashes").is_some_and(py_truthy) {
            return Ok(json_status(
                StatusCode::BAD_REQUEST,
                json!({"error": "image_hashes required"}),
            ));
        }
        let hashes = string_list(data.get("image_hashes"));
        db::download_photos(
            &state.db,
            user.id,
            &DownloadSelection::Hashes(&hashes),
            stacked,
        )
        .await?
    };
    if photos.is_empty() {
        return Ok(json_status(
            StatusCode::NOT_FOUND,
            json!({"error": "No photos found"}),
        ));
    }

    let total: i64 = photos.iter().map(|p| p.size.max(0)).sum();
    let zip_dir = state.config.zip_dir();
    let free = state.blocking(move || free_space(&zip_dir)).await?;
    if free.is_some_and(|f| f < total as u64) {
        return Ok(json_status(
            StatusCode::INSUFFICIENT_STORAGE,
            json!({"status": "Insufficient Storage"}),
        ));
    }

    let file_uuid = Uuid::new_v4();
    let payload = ZipPayload {
        user_id: user.id,
        photo_ids: photos.iter().map(|p| p.id).collect(),
        zip_uuid: file_uuid.to_string(),
        include_stacked_photos: stacked,
    };
    let enqueued = lp_jobs::enqueue(
        &state,
        "zip.build",
        serde_json::to_value(&payload)?,
        EnqueueOptions::tracked(JobType::DownloadPhotos, user.id),
    )
    .await?;
    Ok(Json(json!({"job_id": enqueued.lrj_id, "url": file_uuid})).into_response())
}

/// `GET /api/photos/download?job_id=`: 200 SUCCESS / 500 FAILURE / 202
/// PENDING. Like Django, `finished` is checked first (a failed job is also
/// finished); only the starter may poll.
pub async fn poll(
    State(state): State<AppState>,
    user: AuthUser,
    q: QueryMap,
) -> ApiResult<Response> {
    let Some(job_id) = q.non_empty("job_id") else {
        return Ok(json_status(
            StatusCode::BAD_REQUEST,
            json!({"error": "job_id is required"}),
        ));
    };
    let Some(job) = db::download_job_state(&state.db, job_id, user.id).await? else {
        return Err(ApiError::status_only(StatusCode::NOT_FOUND));
    };
    Ok(if job.finished {
        json_status(StatusCode::OK, json!({"status": "SUCCESS"}))
    } else if job.failed {
        json_status(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"status": "FAILURE", "result": job.result}),
        )
    } else {
        json_status(
            StatusCode::ACCEPTED,
            json!({"status": "PENDING", "progress": job.result}),
        )
    })
}

fn is_uuid_shaped(s: &str) -> bool {
    let groups: Vec<&str> = s.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(g, n)| g.len() == n && g.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// `DELETE /api/delete/zip/{uuid}`: the archive is named after the
/// requester, so only their own can be named. A missing file is still 200.
pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    UrlPath(fname): UrlPath<String>,
) -> ApiResult<StatusCode> {
    if !is_uuid_shaped(&fname) {
        return Err(ApiError::not_found());
    }
    let Some(name) = zip_file_name(&fname, user.id) else {
        return Err(ApiError::status_only(StatusCode::NOT_FOUND));
    };
    let path = state.config.zip_dir().join(name);
    match tokio::fs::remove_file(&path).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            tracing::warn!(path = %path.display(), "zip to delete not found")
        }
        Err(e) => tracing::error!(path = %path.display(), error = %e, "deleting zip failed"),
    }
    Ok(StatusCode::OK)
}

/// `os.path.splitext`: the last dot not leading the name starts the extension.
fn splitext(name: &str) -> (&str, &str) {
    let lead = name.len() - name.trim_start_matches('.').len();
    match name[lead..].rfind('.') {
        Some(i) => name.split_at(lead + i),
        None => (name, ""),
    }
}

/// `_unique_arcname`.
fn unique_arcname(name: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(name) {
        return name.to_string();
    }
    let (base, ext) = splitext(name);
    (1..)
        .map(|n| format!("{base}_{n}{ext}"))
        .find(|c| !taken.contains(c))
        .expect("unbounded counter")
}

fn zip_time(meta: &std::fs::Metadata) -> Option<zip::DateTime> {
    let local: DateTime<Local> = meta.modified().ok()?.into();
    zip::DateTime::from_date_and_time(
        u16::try_from(local.year()).ok()?,
        local.month() as u8,
        local.day() as u8,
        local.hour() as u8,
        local.minute() as u8,
        local.second() as u8,
    )
    .ok()
}

/// The archive being written, moved in and out of the blocking pool.
struct Archive {
    writer: ZipWriter<BufWriter<File>>,
    /// Source paths already added (`files_added` keys).
    paths: HashSet<String>,
    /// Entry names already used (`files_added` values).
    names: HashSet<String>,
}

impl Archive {
    fn create(path: &Path) -> std::io::Result<Self> {
        Ok(Archive {
            writer: ZipWriter::new(BufWriter::new(File::create(path)?)),
            paths: HashSet::new(),
            names: HashSet::new(),
        })
    }

    /// `_add_photo_files_to_zip` for one photo's files, in order.
    fn add_files(&mut self, files: &[String]) -> anyhow::Result<()> {
        for path in files {
            if path.is_empty() || self.paths.contains(path) {
                continue;
            }
            let meta = match std::fs::metadata(path) {
                Ok(m) if m.is_file() => m,
                _ => {
                    tracing::warn!(path, "file not found, skipping");
                    continue;
                }
            };
            let base = Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            let name = unique_arcname(&base, &self.names);
            let mut opts = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .large_file(meta.len() >= u32::MAX as u64);
            if let Some(t) = zip_time(&meta) {
                opts = opts.last_modified_time(t);
            }
            self.writer
                .start_file(name.as_str(), opts)
                .with_context(|| format!("zip entry {name}"))?;
            let mut src = File::open(path).with_context(|| format!("open {path}"))?;
            std::io::copy(&mut src, &mut self.writer).with_context(|| format!("zip {path}"))?;
            self.paths.insert(path.clone());
            self.names.insert(name);
        }
        Ok(())
    }

    fn finish(self) -> anyhow::Result<()> {
        let mut out = self.writer.finish()?;
        out.flush()?;
        out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
        Ok(())
    }
}

/// How often (in photos) the job checks for cancellation.
const CANCEL_CHECK_EVERY: usize = 100;

/// `zip.build`: `zip_photos_task`. Progress is the photo count; the file
/// is written as `.part` and renamed when complete, so a download never
/// sees half an archive.
pub async fn build(ctx: JobCtx) -> anyhow::Result<()> {
    let p: ZipPayload = serde_json::from_value(ctx.job.payload.clone())?;
    let lrj_id = ctx
        .job
        .lrj_id
        .clone()
        .context("zip.build needs a LongRunningJob")?;
    let db = ctx.state.db.clone();
    let count = p.photo_ids.len();
    lrj::start(&db, &lrj_id, Some(count as i32)).await?;

    let name = zip_file_name(&p.zip_uuid, p.user_id).context("bad zip uuid")?;
    let dir = ctx.state.config.zip_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let final_path = dir.join(&name);
    let part = dir.join(format!("{name}.part"));

    let result = write_archive(&ctx, &p, &lrj_id, &part).await;
    match result {
        Ok(true) => {
            tokio::fs::rename(&part, &final_path).await?;
            lrj::finish(&db, &lrj_id, None).await?;
            Ok(())
        }
        Ok(false) => {
            let _ = tokio::fs::remove_file(&part).await;
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
            Err(e)
        }
    }
}

/// Writes every photo's files; false when the job was cancelled.
async fn write_archive(
    ctx: &JobCtx,
    p: &ZipPayload,
    lrj_id: &str,
    part: &Path,
) -> anyhow::Result<bool> {
    let state = &ctx.state;
    let rows = lp_db::jobs_zip_services::zip_files(&state.db, p.user_id, &p.photo_ids).await?;
    let mut by_photo: Vec<Vec<String>> = vec![Vec::new(); p.photo_ids.len()];
    for r in rows {
        if let Some(slot) = usize::try_from(r.ord - 1)
            .ok()
            .and_then(|i| by_photo.get_mut(i))
        {
            slot.push(r.path);
        }
    }

    let part_path = part.to_path_buf();
    let mut archive = Some(
        state
            .blocking(move || Archive::create(&part_path))
            .await??,
    );
    let mut progress = Progress::new(state.db.clone(), lrj_id);
    for (i, files) in by_photo.into_iter().enumerate() {
        if i > 0 && i % CANCEL_CHECK_EVERY == 0 && ctx.is_cancelled().await {
            progress.flush().await?;
            return Ok(false);
        }
        let mut a = archive.take().expect("archive present");
        a = state
            .blocking(move || a.add_files(&files).map(|()| a))
            .await??;
        archive = Some(a);
        progress.inc(1).await?;
    }
    progress.flush().await?;
    let a = archive.take().expect("archive present");
    state.blocking(move || a.finish()).await??;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        let u = "0f8fad5b-d9cb-469f-a165-70867728950e";
        assert_eq!(zip_file_name(u, 12).unwrap(), format!("{u}12.zip"));
        assert_eq!(
            zip_file_name(&u.to_uppercase(), 3).unwrap(),
            format!("{u}3.zip")
        );
        assert!(zip_file_name("0f8fad5bd9cb469fa16570867728950e", 1).is_none());
        assert!(zip_file_name("../x", 1).is_none());
        assert!(is_uuid_shaped(u));
        assert!(!is_uuid_shaped("0f8fad5bd9cb469fa16570867728950e"));
    }

    #[test]
    fn arcnames_like_python() {
        assert_eq!(splitext("a.jpg"), ("a", ".jpg"));
        assert_eq!(splitext("a.tar.gz"), ("a.tar", ".gz"));
        assert_eq!(splitext(".hidden"), (".hidden", ""));
        assert_eq!(splitext("noext"), ("noext", ""));
        let mut taken = HashSet::new();
        taken.insert("a.jpg".to_string());
        assert_eq!(unique_arcname("a.jpg", &taken), "a_1.jpg");
        taken.insert("a_1.jpg".to_string());
        assert_eq!(unique_arcname("a.jpg", &taken), "a_2.jpg");
        assert_eq!(unique_arcname("b.jpg", &taken), "b.jpg");
    }

    #[test]
    fn stacked_flag() {
        assert!(include_stacked(Some(&json!(true))));
        assert!(include_stacked(Some(&json!("Yes"))));
        assert!(include_stacked(Some(&json!(["on"]))));
        assert!(!include_stacked(Some(&json!("false"))));
        assert!(!include_stacked(Some(&json!(0))));
        assert!(!include_stacked(None));
    }
}

//! The background work of a server connection.
//!
//! - **Checker**: library files whose server state is unknown are hashed (MD5, streamed, off
//!   the async threads) and asked about with `GET /api/exists/<md5><user id>`, newest first,
//!   a few at a time. The answer is stored per file, so badges and server search can map the
//!   server's `image_hash` (= MD5 + user id) back to local files without further requests.
//! - **Uploaders** (bounded): when backup is on, every library file the server lacks; always,
//!   files the user asked to upload from the viewer. Each file goes up in 8 MB chunks
//!   (`POST /api/upload/` with `Content-Range`), then `POST /api/upload/complete/`; the upload id
//!   and offset are saved after every chunk, so an upload resumes after a restart. Failures are
//!   retried with exponential back-off. When the queue runs dry the import jobs the completions
//!   named are sealed (`POST /api/upload/seal/`) so the server starts its follow-up work.
//!
//! All state lives in the library database (CONTRACT.md "Server"), so a restart picks up where
//! the last run stopped.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use md5::{Digest, Md5};
use serde_json::Value;

use super::{RemoteOf, Server, Upload};
use crate::library::db::{self, Job, remote};
use crate::library::{file_stat, local_wall_ms};

pub const CHUNK: i64 = 8 * 1024 * 1024;
const CHECK_BATCH: i64 = 32;
const CHECK_CONCURRENCY: usize = 4;
pub const UPLOAD_CONCURRENCY: usize = 2;
/// Idle workers look for work at least this often (a missed wake-up costs no more).
const IDLE_POLL: Duration = Duration::from_secs(5);
/// After a network error the checker waits this long before trying again.
const OFFLINE_WAIT: Duration = Duration::from_secs(15);

#[derive(Default)]
pub struct Stats {
    pub current: HashMap<i64, Upload>,
    /// (when, bytes) of recent chunks, for the speed.
    samples: VecDeque<(Instant, i64)>,
    pub files: i64,
    pub bytes: i64,
    job_ids: Vec<String>,
}

impl Stats {
    pub fn rate(&self) -> f64 {
        let Some((first, _)) = self.samples.front() else {
            return 0.0;
        };
        let secs = first.elapsed().as_secs_f64().max(1.0);
        self.samples.iter().map(|(_, b)| *b as f64).sum::<f64>() / secs
    }

    fn sample(&mut self, bytes: i64) {
        self.bytes += bytes;
        self.samples.push_back((Instant::now(), bytes));
        while self
            .samples
            .front()
            .is_some_and(|(t, _)| t.elapsed() > Duration::from_secs(8))
        {
            self.samples.pop_front();
        }
    }
}

/// MD5 of a file, lower-case hex, read in 1 MB blocks.
pub fn md5_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Md5::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

async fn md5_async(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || md5_file(Path::new(&path)).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

fn read_chunk(path: &str, offset: i64, len: i64) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset as u64))?;
    let mut buf = vec![0u8; len as usize];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

/// Seconds before retry `attempt` (1-based): 10 s, 20 s, 40 s, ... up to an hour.
pub fn backoff_ms(attempt: i64) -> i64 {
    (10_000i64 << (attempt - 1).clamp(0, 9)).min(3_600_000)
}

/// Whether an error is the network (try later) rather than the server refusing this file.
fn transient(e: &str) -> bool {
    e.starts_with("couldn't reach")
        || e.starts_with("HTTP 5")
        || e.starts_with("HTTP 429")
        || e.contains("timed out")
        || e == "signed out"
        || e == "not signed in"
}

impl Server {
    /// Starts the checker and the uploaders on the async runtime.
    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move { me.check_loop().await });
        for _ in 0..UPLOAD_CONCURRENCY {
            let me = self.clone();
            tauri::async_runtime::spawn(async move { me.upload_loop().await });
        }
    }

    async fn idle(&self, d: Duration) {
        let _ = tokio::time::timeout(d, self.wake.notified()).await;
    }

    async fn check_loop(self: Arc<Self>) {
        loop {
            if !self.connected() {
                self.idle(IDLE_POLL).await;
                continue;
            }
            let jobs = db::claim_checks(&self.lib.conn(), CHECK_BATCH).unwrap_or_default();
            if jobs.is_empty() {
                self.idle(IDLE_POLL).await;
                continue;
            }
            let mut offline = false;
            let mut set = tokio::task::JoinSet::new();
            let mut queue = jobs.into_iter();
            loop {
                while set.len() < CHECK_CONCURRENCY {
                    let Some(job) = queue.next() else { break };
                    let me = self.clone();
                    set.spawn(async move { me.check(job).await });
                }
                let Some(r) = set.join_next().await else {
                    break;
                };
                if let Ok(Err(e)) = r
                    && transient(&e)
                {
                    offline = true;
                    self.set_error(Some(e));
                }
            }
            self.lib.notify_changed();
            self.changed();
            self.wake.notify_waiters();
            if offline {
                tokio::time::sleep(OFFLINE_WAIT).await;
            } else {
                self.clear_error();
            }
        }
    }

    /// Hash (if needed) and ask the server about one claimed file.
    async fn check(&self, job: Job) -> Result<(), String> {
        let result = async {
            let md5 = match job.md5.clone() {
                Some(m) => m,
                None => {
                    let m = md5_async(job.path.clone()).await?;
                    db::set_md5(&self.lib.conn(), job.id, &m).map_err(|e| e.to_string())?;
                    m
                }
            };
            self.exists(&md5).await
        }
        .await;
        let conn = self.lib.conn();
        match &result {
            Ok(Some(photo_id)) => {
                let _ = db::set_remote(&conn, job.id, remote::PRESENT, Some(photo_id), None);
            }
            Ok(None) => {
                let _ = db::set_remote(&conn, job.id, remote::ABSENT, None, None);
            }
            Err(e) if transient(e) => {
                let _ = db::set_remote(&conn, job.id, remote::UNKNOWN, None, None);
            }
            // The file is unreadable (gone, locked): leave it unknown until it changes.
            Err(e) => {
                let _ = db::set_failed(&conn, job.id, e, db::MAX_ATTEMPTS, 0);
            }
        }
        result.map(|_| ())
    }

    async fn upload_loop(self: Arc<Self>) {
        loop {
            let s = self.settings();
            if !self.connected() || s.paused {
                self.idle(IDLE_POLL).await;
                continue;
            }
            let now = chrono::Utc::now().timestamp_millis();
            let job = db::claim_upload(&self.lib.conn(), s.backup, now).unwrap_or(None);
            let Some(job) = job else {
                self.seal().await;
                let next = db::next_retry_ms(&self.lib.conn(), s.backup).ok().flatten();
                let wait = next.map_or(IDLE_POLL, |t| {
                    Duration::from_millis((t - now).clamp(200, IDLE_POLL.as_millis() as i64) as u64)
                });
                self.idle(wait).await;
                continue;
            };
            let id = job.id;
            let attempts = job.attempts;
            let result = self.upload(job).await;
            {
                let conn = self.lib.conn();
                match &result {
                    Ok(photo_id) => {
                        let _ = db::set_remote(&conn, id, remote::PRESENT, Some(photo_id), None);
                    }
                    Err(e) => {
                        let attempts = if transient(e) { attempts } else { attempts + 1 };
                        let next =
                            chrono::Utc::now().timestamp_millis() + backoff_ms(attempts.max(1));
                        let _ = db::set_failed(&conn, id, e, attempts, next);
                    }
                }
            }
            self.stats.lock().unwrap().current.remove(&id);
            if let Err(e) = &result
                && transient(e)
            {
                self.set_error(Some(e.clone()));
                tokio::time::sleep(OFFLINE_WAIT).await;
            }
            self.lib.notify_changed();
            self.changed();
        }
    }

    /// Uploads one file; Ok is the server's photo id.
    async fn upload(&self, job: Job) -> Result<String, String> {
        // The file may have changed since it was listed.
        let meta = std::fs::metadata(&job.path).map_err(|e| format!("{}: {e}", job.path))?;
        let size = meta.len() as i64;
        if size == 0 {
            return Err("the file is empty".into());
        }
        let fresh = size == job.size && crate::listing::modified_ms(&meta) == job.mtime;
        let md5 = match (&job.md5, fresh) {
            (Some(m), true) => m.clone(),
            _ => {
                let m = md5_async(job.path.clone()).await?;
                db::set_md5(&self.lib.conn(), job.id, &m).map_err(|e| e.to_string())?;
                m
            }
        };
        // Deduplicate: whatever the server already has never goes up again.
        if let Some(photo_id) = self.exists(&md5).await? {
            return Ok(photo_id);
        }
        self.stats.lock().unwrap().current.insert(
            job.id,
            Upload {
                name: job.name.clone(),
                sent: 0,
                total: size,
            },
        );
        self.changed();
        let (mut upload_id, mut offset) = match &job.upload_id {
            Some(u) if fresh => (Some(u.clone()), job.upload_offset.clamp(0, size)),
            _ => (None, 0),
        };
        let mut restarts = 0;
        while offset < size {
            let len = CHUNK.min(size - offset);
            let path = job.path.clone();
            let bytes = tokio::task::spawn_blocking(move || read_chunk(&path, offset, len))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| format!("{}: {e}", job.path))?;
            let range = format!("bytes {}-{}/{}", offset, offset + len - 1, size);
            let res = self
                .send(|base| {
                    let part = reqwest::multipart::Part::bytes(bytes.clone())
                        .file_name(job.name.clone())
                        .mime_str("application/octet-stream")
                        .expect("static mime");
                    let mut form = reqwest::multipart::Form::new()
                        .part("file", part)
                        .text("offset", offset.to_string())
                        .text("md5", md5.clone());
                    if let Some(u) = &upload_id {
                        form = form.text("upload_id", u.clone());
                    }
                    self.http
                        .post(format!("{base}/api/upload/"))
                        .header("Content-Range", range.clone())
                        .multipart(form)
                })
                .await?;
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            if status.is_success() {
                upload_id = v["upload_id"].as_str().map(str::to_owned).or(upload_id);
                let new_offset = v["offset"].as_i64().unwrap_or(offset + len);
                let sent = new_offset - offset;
                offset = new_offset;
                db::set_upload_progress(&self.lib.conn(), job.id, upload_id.as_deref(), offset)
                    .map_err(|e| e.to_string())?;
                {
                    let mut st = self.stats.lock().unwrap();
                    st.sample(sent);
                    if let Some(u) = st.current.get_mut(&job.id) {
                        u.sent = offset;
                    }
                }
                self.changed();
                continue;
            }
            // The server is elsewhere than we thought: continue from its offset.
            if status == reqwest::StatusCode::BAD_REQUEST
                && let Some(o) = v["offset"].as_i64()
                && upload_id.is_some()
                && restarts < 3
            {
                restarts += 1;
                offset = o;
                continue;
            }
            // The upload expired, completed or was deleted on the server: start over.
            if matches!(status.as_u16(), 404 | 410) && upload_id.is_some() && restarts < 3 {
                restarts += 1;
                upload_id = None;
                offset = 0;
                continue;
            }
            return Err(super::http_error(status, &body));
        }
        let upload_id = upload_id.ok_or("the server gave no upload id")?;
        let device_time = chrono::DateTime::from_timestamp_millis(job.mtime)
            .map(|d| d.with_timezone(&chrono::Local).to_rfc3339());
        let res = self
            .send(|base| {
                let mut form = reqwest::multipart::Form::new()
                    .text("upload_id", upload_id.clone())
                    .text("md5", md5.clone())
                    .text("filename", job.name.clone());
                if let Some(t) = &device_time {
                    form = form.text("device_modified_at", t.clone());
                }
                self.http
                    .post(format!("{base}/api/upload/complete/"))
                    .multipart(form)
            })
            .await?;
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if !status.is_success() {
            // A completion that failed for good leaves nothing to resume.
            let _ = db::set_upload_progress(&self.lib.conn(), job.id, None, 0);
            return Err(super::http_error(status, &body));
        }
        let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        {
            let mut st = self.stats.lock().unwrap();
            if let Some(j) = v["job_id"].as_str() {
                st.job_ids.push(j.to_string());
            }
            st.files += 1;
        }
        match v["photo_id"].as_str() {
            Some(p) => Ok(p.to_string()),
            None => Err("the server made no photo from this file".into()),
        }
    }

    /// Tells the server the upload run is over, so its import jobs finish now.
    async fn seal(&self) {
        let ids = std::mem::take(&mut self.stats.lock().unwrap().job_ids);
        if ids.is_empty() {
            return;
        }
        let body = serde_json::json!({ "job_ids": ids });
        if self
            .fetch("POST", "/api/upload/seal/", Some(body))
            .await
            .is_err()
        {
            // Sealed by the server after a few idle minutes anyway.
            self.stats.lock().unwrap().job_ids.extend(ids);
        }
    }

    /// The row of `path`, made a loose row when it is not in the library.
    fn row_of(&self, path: &str) -> Result<db::LibraryFile, String> {
        let meta = std::fs::metadata(path).map_err(|e| format!("{path}: {e}"))?;
        let stat = file_stat(Path::new(path), &meta).ok_or("not a picture or video")?;
        let mut conn = self.lib.conn();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let id =
            db::ensure_loose(&tx, &stat, local_wall_ms(stat.mtime)).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        db::by_id(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "vanished".to_string())
    }

    /// What the server knows about a local file (hashing it and asking when needed).
    pub async fn remote_of(&self, path: &str) -> Result<RemoteOf, String> {
        let row = self.row_of(path)?;
        let mut out = RemoteOf {
            state: row.remote.clone(),
            photo_id: row.remote_id.clone(),
            md5: row.md5.clone(),
            image_hash: None,
            in_library: row.root_id.is_some(),
        };
        if !self.connected() {
            return Ok(out);
        }
        let md5 = match row.md5 {
            Some(m) => m,
            None => {
                let m = md5_async(path.to_string()).await?;
                db::set_md5(&self.lib.conn(), row.id, &m).map_err(|e| e.to_string())?;
                m
            }
        };
        out.image_hash = self.user_id().map(|u| format!("{md5}{u}"));
        out.md5 = Some(md5.clone());
        if row.remote == remote::UPLOADING {
            return Ok(out);
        }
        let found = self.exists(&md5).await?;
        let state = if found.is_some() {
            remote::PRESENT
        } else if row.remote == remote::FAILED {
            remote::FAILED
        } else {
            remote::ABSENT
        };
        db::set_remote(&self.lib.conn(), row.id, state, found.as_deref(), None)
            .map_err(|e| e.to_string())?;
        out.state = state.into();
        out.photo_id = found;
        Ok(out)
    }

    /// Queues one file (in the library or not) for upload.
    pub fn upload_file(&self, path: &str) -> Result<RemoteOf, String> {
        if !self.connected() {
            return Err("Connect to a LibrePhotos server first".into());
        }
        let row = self.row_of(path)?;
        db::want_upload(&self.lib.conn(), row.id).map_err(|e| e.to_string())?;
        if row.remote == remote::FAILED {
            let _ = db::set_remote(&self.lib.conn(), row.id, remote::UNKNOWN, None, None);
        }
        self.wake.notify_waiters();
        self.changed();
        Ok(RemoteOf {
            state: row.remote,
            photo_id: row.remote_id,
            md5: row.md5,
            image_hash: None,
            in_library: row.root_id.is_some(),
        })
    }

    pub fn retry_failed(&self) -> Result<usize, String> {
        let n = db::retry_failed(&self.lib.conn()).map_err(|e| e.to_string())?;
        self.wake.notify_waiters();
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_files() {
        let p = std::env::temp_dir().join(format!("lpview-md5-{}", std::process::id()));
        std::fs::write(&p, b"hello").unwrap();
        assert_eq!(md5_file(&p).unwrap(), "5d41402abc4b2a76b9719d911017c592");
        assert_eq!(read_chunk(p.to_str().unwrap(), 1, 3).unwrap(), b"ell");
        std::fs::remove_file(&p).unwrap();
    }

    #[test]
    fn backs_off() {
        assert_eq!(backoff_ms(1), 10_000);
        assert_eq!(backoff_ms(2), 20_000);
        assert_eq!(backoff_ms(30), 3_600_000);
        assert!(transient("couldn't reach http://x: refused"));
        assert!(transient("HTTP 502: bad gateway"));
        assert!(!transient("HTTP 400: File type not allowed"));
    }
}

//! `api_longrunningjob` stays the UI contract (04 §2): the jobs page and the
//! worker indicator poll it every 2 s.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::{FromRow, PgExecutor, PgPool};
use uuid::Uuid;

/// `LongRunningJob.JOB_*` (same integers as Django).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(i32)]
pub enum JobType {
    ScanPhotos = 1,
    GenerateAutoAlbums = 2,
    GenerateAutoAlbumTitles = 3,
    TrainFaces = 4,
    DeleteMissingPhotos = 5,
    CalculateClipEmbeddings = 6,
    ScanFaces = 7,
    ClusterAllFaces = 8,
    DownloadPhotos = 9,
    DownloadModels = 10,
    AddGeolocation = 11,
    GenerateTags = 12,
    GenerateFaceEmbeddings = 13,
    ScanMissingPhotos = 14,
    DetectDuplicates = 15,
    RepairFileVariants = 16,
    ClassifyMedia = 17,
    GenerateOcr = 18,
}

impl JobType {
    pub fn as_i32(self) -> i32 {
        self as i32
    }

    /// `get_job_type_display()`.
    pub fn label(self) -> &'static str {
        match self {
            JobType::ScanPhotos => "Scan Photos",
            JobType::GenerateAutoAlbums => "Generate Event Albums",
            JobType::GenerateAutoAlbumTitles => "Regenerate Event Titles",
            JobType::TrainFaces => "Train Faces",
            JobType::DeleteMissingPhotos => "Delete Missing Photos",
            JobType::CalculateClipEmbeddings => "Calculate Clip Embeddings",
            JobType::ScanFaces => "Scan Faces",
            JobType::ClusterAllFaces => "Find Similar Faces",
            JobType::DownloadPhotos => "Download Selected Photos",
            JobType::DownloadModels => "Download Models",
            JobType::AddGeolocation => "Add Geolocation",
            JobType::GenerateTags => "Generate Tags",
            JobType::GenerateFaceEmbeddings => "Generate Face Embeddings",
            JobType::ScanMissingPhotos => "Scan Missing Photos",
            JobType::DetectDuplicates => "Detect Duplicate Photos",
            JobType::RepairFileVariants => "Repair File Variants",
            JobType::ClassifyMedia => "Classify Media Categories",
            JobType::GenerateOcr => "Extract Text (OCR)",
        }
    }

    pub fn from_i32(v: i32) -> Option<JobType> {
        use JobType::*;
        Some(match v {
            1 => ScanPhotos,
            2 => GenerateAutoAlbums,
            3 => GenerateAutoAlbumTitles,
            4 => TrainFaces,
            5 => DeleteMissingPhotos,
            6 => CalculateClipEmbeddings,
            7 => ScanFaces,
            8 => ClusterAllFaces,
            9 => DownloadPhotos,
            10 => DownloadModels,
            11 => AddGeolocation,
            12 => GenerateTags,
            13 => GenerateFaceEmbeddings,
            14 => ScanMissingPhotos,
            15 => DetectDuplicates,
            16 => RepairFileVariants,
            17 => ClassifyMedia,
            18 => GenerateOcr,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct LongRunningJob {
    pub id: i32,
    pub job_type: i32,
    pub finished: bool,
    pub failed: bool,
    pub cancelled: bool,
    pub job_id: String,
    pub queued_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub started_by_id: i32,
    pub progress_current: i32,
    pub progress_target: i32,
    pub progress_step: Option<String>,
    pub result: Option<Value>,
}

pub const LRJ_COLUMNS: &str = "id, job_type, finished, failed, cancelled, job_id, queued_at, \
    started_at, finished_at, started_by_id, progress_current, progress_target, progress_step, result";

/// `LongRunningJob.create_job`: a queued row; returns its `job_id`.
pub async fn create<'e>(
    db: impl PgExecutor<'e>,
    job_type: JobType,
    user_id: i32,
) -> sqlx::Result<String> {
    let job_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO api_longrunningjob (job_type, finished, failed, cancelled, job_id, queued_at, \
           started_by_id, progress_current, progress_target) \
         VALUES ($1, FALSE, FALSE, FALSE, $2, now(), $3, 0, 0)",
    )
    .bind(job_type.as_i32())
    .bind(&job_id)
    .bind(user_id)
    .execute(db)
    .await?;
    Ok(job_id)
}

pub async fn get<'e>(
    db: impl PgExecutor<'e>,
    job_id: &str,
) -> sqlx::Result<Option<LongRunningJob>> {
    sqlx::query_as::<_, LongRunningJob>(&format!(
        "SELECT {LRJ_COLUMNS} FROM api_longrunningjob WHERE job_id = $1"
    ))
    .bind(job_id)
    .fetch_optional(db)
    .await
}

/// Start: `started_at`, then `progress_target` when known.
pub async fn start<'e>(
    db: impl PgExecutor<'e>,
    job_id: &str,
    target: Option<i32>,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE api_longrunningjob SET started_at = COALESCE(started_at, now()), \
           progress_target = COALESCE($2, progress_target) WHERE job_id = $1",
    )
    .bind(job_id)
    .bind(target)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn set_target<'e>(
    db: impl PgExecutor<'e>,
    job_id: &str,
    target: i32,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE api_longrunningjob SET progress_target = $2 WHERE job_id = $1")
        .bind(job_id)
        .bind(target.max(0))
        .execute(db)
        .await?;
    Ok(())
}

pub async fn set_step<'e>(db: impl PgExecutor<'e>, job_id: &str, step: &str) -> sqlx::Result<()> {
    let step: String = step.chars().take(100).collect();
    sqlx::query("UPDATE api_longrunningjob SET progress_step = $2 WHERE job_id = $1")
        .bind(job_id)
        .bind(step)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn set_result<'e>(
    db: impl PgExecutor<'e>,
    job_id: &str,
    result: &Value,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE api_longrunningjob SET result = $2 WHERE job_id = $1")
        .bind(job_id)
        .bind(result)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn add_progress<'e>(
    db: impl PgExecutor<'e>,
    job_id: &str,
    delta: i32,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE api_longrunningjob SET progress_current = progress_current + $2 WHERE job_id = $1",
    )
    .bind(job_id)
    .bind(delta)
    .execute(db)
    .await?;
    Ok(())
}

/// Finish exactly once (guarded UPDATE). Returns true for the caller that
/// won; for scans, the winner runs the follow-ups.
pub async fn finish<'e>(
    db: impl PgExecutor<'e>,
    job_id: &str,
    result: Option<&Value>,
) -> sqlx::Result<bool> {
    let n = sqlx::query(
        "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now(), \
           result = COALESCE($2, result) WHERE job_id = $1 AND NOT finished",
    )
    .bind(job_id)
    .bind(result)
    .execute(db)
    .await?
    .rows_affected();
    Ok(n > 0)
}

/// `LongRunningJob.fail`: failed + finished, `result = {"status":"failed","error":...}`.
pub async fn fail<'e>(db: impl PgExecutor<'e>, job_id: &str, error: &str) -> sqlx::Result<bool> {
    let n = sqlx::query(
        "UPDATE api_longrunningjob SET failed = TRUE, finished = TRUE, finished_at = now(), \
           result = $2 WHERE job_id = $1 AND NOT finished",
    )
    .bind(job_id)
    .bind(json!({"status": "failed", "error": error}))
    .execute(db)
    .await?
    .rows_affected();
    Ok(n > 0)
}

/// `LongRunningJob.cancel` (cooperative: workers poll [`is_cancelled`]).
pub async fn cancel<'e>(db: impl PgExecutor<'e>, job_id: &str) -> sqlx::Result<bool> {
    let n = sqlx::query(
        "UPDATE api_longrunningjob SET cancelled = TRUE, finished = TRUE, finished_at = now(), \
           result = '{\"status\": \"cancelled\"}'::jsonb WHERE job_id = $1 AND NOT finished",
    )
    .bind(job_id)
    .execute(db)
    .await?
    .rows_affected();
    Ok(n > 0)
}

/// The cancel endpoint: cancel the LongRunningJob and its queued/running
/// `job_queue` rows in one transaction. False when it had already finished.
pub async fn cancel_with_queue(db: &PgPool, job_id: &str) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    let won = cancel(&mut *tx, job_id).await?;
    crate::queue::cancel_for_lrj(&mut tx, job_id).await?;
    tx.commit().await?;
    Ok(won)
}

pub async fn is_cancelled<'e>(db: impl PgExecutor<'e>, job_id: &str) -> sqlx::Result<bool> {
    Ok(
        sqlx::query_scalar::<_, bool>("SELECT cancelled FROM api_longrunningjob WHERE job_id = $1")
            .bind(job_id)
            .fetch_optional(db)
            .await?
            .unwrap_or(false),
    )
}

/// Progress counter with increments batched and flushed at most every
/// 250 ms (instead of one UPDATE per file). Call [`Progress::flush`] at the end.
pub struct Progress {
    db: PgPool,
    job_id: String,
    pending: i32,
    last_flush: Instant,
    interval: Duration,
}

impl Progress {
    pub fn new(db: PgPool, job_id: impl Into<String>) -> Self {
        Progress {
            db,
            job_id: job_id.into(),
            pending: 0,
            last_flush: Instant::now(),
            interval: Duration::from_millis(250),
        }
    }

    pub async fn inc(&mut self, n: i32) -> sqlx::Result<()> {
        self.pending += n;
        if self.last_flush.elapsed() >= self.interval {
            self.flush().await?;
        }
        Ok(())
    }

    pub async fn flush(&mut self) -> sqlx::Result<()> {
        if self.pending != 0 {
            add_progress(&self.db, &self.job_id, self.pending).await?;
            self.pending = 0;
        }
        self.last_flush = Instant::now();
        Ok(())
    }
}

/// Per-item errors collected for `result` (deduped, at most 100 kept).
#[derive(Debug, Default, Clone)]
pub struct JobErrors {
    count: usize,
    first: Option<String>,
    seen: BTreeSet<String>,
    kept: Vec<String>,
}

impl JobErrors {
    pub fn add(&mut self, msg: impl Into<String>) {
        let msg = msg.into();
        self.count += 1;
        if self.first.is_none() {
            self.first = Some(msg.clone());
        }
        if self.kept.len() < 100 && self.seen.insert(msg.clone()) {
            self.kept.push(msg);
        }
    }

    pub fn count(&self) -> usize {
        self.count
    }

    /// `failed` only above `max(10, 5% of total)` errors, else `partial_failure`.
    pub fn is_failure(&self, total: usize) -> bool {
        let threshold = std::cmp::max(10, total / 20);
        self.count > threshold
    }

    /// `{error_count, errors, error, status}`; None when there were no errors.
    pub fn to_result(&self, total: usize) -> Option<Value> {
        if self.count == 0 {
            return None;
        }
        Some(json!({
            "status": if self.is_failure(total) { "failed" } else { "partial_failure" },
            "error_count": self.count,
            "errors": self.kept,
            "error": self.first,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_type_roundtrip() {
        for i in 1..=18 {
            assert_eq!(JobType::from_i32(i).unwrap().as_i32(), i);
        }
        assert!(JobType::from_i32(19).is_none());
    }

    #[test]
    fn errors() {
        let mut e = JobErrors::default();
        assert!(e.to_result(10).is_none());
        for _ in 0..5 {
            e.add("boom");
        }
        let r = e.to_result(1000).unwrap();
        assert_eq!(r["status"], "partial_failure");
        assert_eq!(r["error_count"], 5);
        assert_eq!(r["errors"].as_array().unwrap().len(), 1);
        for i in 0..60 {
            e.add(format!("e{i}"));
        }
        assert_eq!(e.to_result(100).unwrap()["status"], "failed");
    }
}

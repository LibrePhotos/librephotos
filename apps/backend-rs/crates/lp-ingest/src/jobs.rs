//! Job handlers owned by ingest (payloads carry ids only).

use std::path::PathBuf;

use anyhow::anyhow;
use chrono::{DateTime, Utc};
use lp_jobs::{HandlerRegistry, JobCtx, JobType};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::pipeline::{Owner, Pipeline};
use crate::scan::{self, ScanOptions};
use crate::{db, repair, upload};

#[derive(Debug, Deserialize)]
pub struct ScanUser {
    pub user_id: i32,
    #[serde(default)]
    pub full_scan: bool,
    #[serde(default)]
    pub scan_missing: bool,
    #[serde(default)]
    pub uploaded_only: bool,
}

#[derive(Debug, Deserialize)]
pub struct FileGroup {
    pub user_id: i32,
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PhotoId {
    pub photo_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct UserId {
    pub user_id: i32,
}

#[derive(Debug, Deserialize)]
pub struct MetadataWrite {
    pub photo_id: Uuid,
    #[serde(default)]
    pub fields: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UploadProcess {
    pub user_id: i32,
    pub photo_id: Option<Uuid>,
    pub path: Option<String>,
    pub device_created_at: Option<DateTime<Utc>>,
}

fn payload<T: serde::de::DeserializeOwned>(ctx: &JobCtx) -> anyhow::Result<T> {
    serde_json::from_value(ctx.job.payload.clone())
        .map_err(|e| anyhow!("bad {} payload: {e}", ctx.job.kind))
}

fn lrj_id(ctx: &JobCtx) -> String {
    ctx.job
        .lrj_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

pub async fn scan_user(ctx: JobCtx) -> anyhow::Result<()> {
    let p: ScanUser = payload(&ctx)?;
    let pipeline = Pipeline::new(ctx.state.clone());
    scan::scan_user(
        &pipeline,
        p.user_id,
        &lrj_id(&ctx),
        ScanOptions {
            full_scan: p.full_scan,
            scan_missing: p.scan_missing,
            uploaded_only: p.uploaded_only,
            files: Vec::new(),
            skip_followups: false,
        },
    )
    .await
}

/// One group outside a whole-library scan: progress on the job it belongs
/// to, which finishes (and queues its follow-ups) with its last group.
pub async fn scan_file_group(ctx: JobCtx) -> anyhow::Result<()> {
    let p: FileGroup = payload(&ctx)?;
    let pipeline = Pipeline::new(ctx.state.clone());
    let user = lp_db::users::by_id(&ctx.state.db, p.user_id)
        .await?
        .ok_or_else(|| anyhow!("user {} not found", p.user_id))?;
    let owner = Owner::from_user(&user);
    let paths: Vec<PathBuf> = p.paths.iter().map(PathBuf::from).collect();
    let outcome = pipeline.handle_file_group(&owner, &paths).await;
    let Some(job) = ctx.job.lrj_id.as_deref() else {
        return outcome.map(|_| ()).map_err(|e| anyhow!(e));
    };
    let db = &ctx.state.db;
    sqlx::query(
        "UPDATE api_longrunningjob SET progress_current = progress_current + 1 WHERE job_id = $1",
    )
    .bind(job)
    .execute(db)
    .await?;
    if let Err(e) = outcome {
        let lrj = lp_jobs::lrj::get(db, job).await?;
        let mut result = lrj
            .as_ref()
            .and_then(|l| l.result.clone())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}));
        let count = result["error_count"].as_u64().unwrap_or(0) + 1;
        result["error_count"] = json!(count);
        let mut errors: Vec<Value> = result["errors"].as_array().cloned().unwrap_or_default();
        if !errors.contains(&json!(e)) {
            errors.push(json!(e));
        }
        result["errors"] = json!(errors);
        if result.get("error").is_none() {
            result["error"] = json!(e);
        }
        let target = lrj.map(|l| l.progress_target).unwrap_or(0).max(0) as f64;
        let failed = if target == 0.0 {
            true
        } else {
            count as f64 > f64::max(10.0, 0.05 * target)
        };
        result["status"] = json!(if failed { "failed" } else { "partial_failure" });
        db::lrj_record_errors(db, job, &result, failed).await?;
    }
    let finished = sqlx::query(
        "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() WHERE job_id = $1 \
         AND NOT finished AND NOT cancelled AND progress_current >= progress_target",
    )
    .bind(job)
    .execute(db)
    .await?
    .rows_affected()
        > 0;
    let Some(lrj) = lp_jobs::lrj::get(db, job).await? else {
        return Ok(());
    };
    if finished && lrj.job_type == JobType::ScanPhotos.as_i32() {
        // `queue_scan_followups`: the options the scan stored, taken once.
        let opts = lrj
            .result
            .as_ref()
            .and_then(|r| r.get("followups"))
            .cloned()
            .unwrap_or(Value::Null);
        sqlx::query(
            "UPDATE api_longrunningjob SET result = result - 'followups' WHERE job_id = $1 \
             AND jsonb_typeof(result) = 'object'",
        )
        .bind(job)
        .execute(db)
        .await?;
        if opts.as_object().is_some_and(|m| !m.is_empty()) {
            let flag = |k: &str| opts.get(k).and_then(Value::as_bool).unwrap_or(false);
            scan::queue_followups(
                &pipeline,
                p.user_id,
                flag("full_scan"),
                flag("scan_missing_photos"),
            )
            .await?;
        }
    }
    Ok(())
}

pub async fn thumbnails_rerender(ctx: JobCtx) -> anyhow::Result<()> {
    let p: PhotoId = payload(&ctx)?;
    Pipeline::new(ctx.state.clone())
        .regenerate_thumbnails(p.photo_id)
        .await
}

/// `write_photo_metadata` for the listed fields, per the owner's
/// `save_metadata_to_disk` (OFF / SIDECAR_FILE / MEDIA_FILE).
pub async fn metadata_write(ctx: JobCtx) -> anyhow::Result<()> {
    let p: MetadataWrite = payload(&ctx)?;
    type Row = (i32, Option<DateTime<Utc>>, String, Option<String>);
    let row: Option<Row> = sqlx::query_as(
        "SELECT p.rating, p.timestamp, u.save_metadata_to_disk, f.path FROM api_photo p \
         JOIN api_user u ON u.id = p.owner_id LEFT JOIN api_file f ON f.hash = p.main_file_id WHERE p.id = $1",
    )
    .bind(p.photo_id)
    .fetch_optional(&ctx.state.db)
    .await?;
    let Some((rating, timestamp, mode, Some(path))) = row else {
        return Ok(());
    };
    if mode == "OFF" {
        return Ok(());
    }
    let mut tags: Vec<(String, Value)> = Vec::new();
    if p.fields.iter().any(|f| f == "rating") {
        tags.push(("Rating".into(), json!(rating)));
    }
    if p.fields.iter().any(|f| f == "timestamp") {
        let v = timestamp
            .map(|t| t.format("%Y:%m:%d %H:%M:%S").to_string())
            .unwrap_or_default();
        tags.push(("XMP:DateCreated".into(), json!(v)));
    }
    if tags.is_empty() {
        return Ok(());
    }
    ctx.state
        .exif
        .write_metadata(std::path::Path::new(&path), &tags, mode == "SIDECAR_FILE")
        .await
        .map_err(|e| anyhow!("{e}"))?;
    Ok(())
}

pub async fn delete_missing_photos(ctx: JobCtx) -> anyhow::Result<()> {
    let p: UserId = payload(&ctx)?;
    repair::delete_missing_photos(&Pipeline::new(ctx.state.clone()), p.user_id, &lrj_id(&ctx)).await
}

pub async fn repair_file_variants(ctx: JobCtx) -> anyhow::Result<()> {
    let p: UserId = payload(&ctx)?;
    repair::repair_file_variants(&Pipeline::new(ctx.state.clone()), p.user_id, &lrj_id(&ctx)).await
}

pub async fn upload_process(ctx: JobCtx) -> anyhow::Result<()> {
    let p: UploadProcess = payload(&ctx)?;
    let pipeline = Pipeline::new(ctx.state.clone());
    let photo = match (p.photo_id, &p.path) {
        (Some(id), _) => Some(id),
        (None, Some(path)) => {
            upload::create_new_image(&pipeline, p.user_id, std::path::Path::new(path)).await?
        }
        (None, None) => None,
    };
    let Some(photo) = photo else {
        return Ok(());
    };
    upload::process_upload(&pipeline, p.user_id, photo, p.device_created_at).await
}

pub fn register(reg: &mut HandlerRegistry) {
    reg.register("scan.user", scan_user);
    reg.register("scan.file_group", scan_file_group);
    reg.register("thumbnails.rerender", thumbnails_rerender);
    reg.register("metadata.write", metadata_write);
    reg.register(crate::face_tags::KIND, crate::face_tags::run);
    reg.register("delete.missing_photos", delete_missing_photos);
    reg.register("repair.file_variants", repair_file_variants);
    reg.register("upload.process", upload_process);
}

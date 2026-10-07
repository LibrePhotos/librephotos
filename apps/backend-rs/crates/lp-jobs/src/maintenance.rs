//! Handlers of the `maintenance.*` kinds the schedules enqueue (04 §1).

use std::path::Path;
use std::time::{Duration, SystemTime};

use crate::registry::{HandlerRegistry, JobCtx};

/// Removed photos stay in the trash this long before they are deleted.
pub const DELETED_PHOTO_DAYS: i32 = 30;
/// `LongRunningJob.STUCK_JOB_HOURS`.
pub const STUCK_JOB_HOURS: i32 = 24;
/// `cleanup_old_jobs(days=30)`.
pub const OLD_JOB_DAYS: i32 = 30;
/// A zip archive is deleted this long after it was written.
pub const ZIP_TTL: Duration = Duration::from_secs(24 * 3600);

pub fn register(reg: &mut HandlerRegistry) {
    reg.register(
        "maintenance.cleanup_deleted_photos",
        |ctx: JobCtx| async move {
            let n = lp_db::write::jobs_zip_services::cleanup_deleted_photos(
                &ctx.state.db,
                &ctx.state.config.media_root,
                DELETED_PHOTO_DAYS,
            )
            .await?;
            tracing::info!(deleted = n, "cleanup_deleted_photos");
            Ok(())
        },
    );
    reg.register("maintenance.cleanup_stuck_jobs", |ctx: JobCtx| async move {
        let n = lp_db::write::jobs_zip_services::cleanup_stuck_jobs(&ctx.state.db, STUCK_JOB_HOURS)
            .await?;
        if n > 0 {
            tracing::info!(failed = n, "cleanup_stuck_jobs");
        }
        Ok(())
    });
    reg.register("maintenance.cleanup_old_jobs", |ctx: JobCtx| async move {
        let n =
            lp_db::write::jobs_zip_services::cleanup_old_jobs(&ctx.state.db, OLD_JOB_DAYS).await?;
        tracing::info!(deleted = n, "cleanup_old_jobs");
        Ok(())
    });
    reg.register(
        "maintenance.prune_refresh_tokens",
        |ctx: JobCtx| async move {
            lp_db::write::jobs_zip_services::prune_refresh_tokens(&ctx.state.db).await?;
            Ok(())
        },
    );
    reg.register("maintenance.prune_deletion_log", |ctx: JobCtx| async move {
        let n = lp_db::write::deletion_log::prune(&ctx.state.db).await?;
        tracing::info!(deleted = n, "prune_deletion_log");
        Ok(())
    });
    reg.register("maintenance.zip_expiry", |ctx: JobCtx| async move {
        let dir = ctx.state.config.zip_dir();
        let n = tokio::task::spawn_blocking(move || expire_zips(&dir, ZIP_TTL)).await??;
        if n > 0 {
            tracing::info!(deleted = n, "zip_expiry");
        }
        Ok(())
    });
}

/// Delete `*.zip` (and abandoned `*.part`) files older than `ttl`.
pub fn expire_zips(dir: &Path, ttl: Duration) -> std::io::Result<usize> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let now = SystemTime::now();
    let mut n = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "zip" && ext != "part" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let age = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .unwrap_or_default();
        if age >= ttl {
            match std::fs::remove_file(&path) {
                Ok(()) => n += 1,
                Err(e) => tracing::warn!(path = %path.display(), error = %e, "zip expiry"),
            }
        }
    }
    Ok(n)
}

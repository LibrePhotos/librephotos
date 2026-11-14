//! `models.download` (`ml_models.download_models`) and the triggers Django
//! chains ahead of its ML work (`if not do_all_models_exist():
//! chain.append(download_models, user)`): scans, face scan/train, turning
//! semantic search on, the site settings POST, and `generateim2txt`.
//!
//! Django's chain runs the download before the job that needs it. The Rust
//! queue runs jobs side by side, so the ML follow-ups call
//! [`wait_for_download`] first instead.

use std::time::{Duration, Instant};

use lp_core::AppState;
use lp_jobs::{EnqueueOptions, JobCtx, JobType};
use lp_ml::models::{self, Outcome};
use serde_json::json;

use crate::run;

pub const KIND: &str = "models.download";

/// The live site-setting selection, with the semantic-search model in
/// effect (ViT-B/32 while CLIP runs as a sidecar).
pub fn selection(state: &AppState) -> lp_ml::Selection {
    let mut sel = state.ml.context().selection();
    sel.semantic_search_model = state.ml().semantic_model().name().to_string();
    sel
}

/// `do_all_models_exist`.
pub fn all_present(state: &AppState) -> bool {
    models::all_required_exist(&state.config.data_models_dir(), &selection(state))
}

/// `captioning_model_exists`.
pub fn captioning_present(state: &AppState) -> bool {
    models::captioning_model_exists(&state.config.data_models_dir())
}

/// Whether a Download Models job is queued or running.
pub async fn download_running(state: &AppState) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_longrunningjob WHERE job_type = $1 AND NOT finished)",
    )
    .bind(JobType::DownloadModels.as_i32())
    .fetch_one(&state.db)
    .await
}

/// `start_model_download`: queue a Download Models job unless one is
/// already underway. True when a download is running now. Nothing is queued
/// with `LP_ML_AUTO_DOWNLOAD=off`.
pub async fn start_download(state: &AppState, user_id: i32) -> bool {
    if !state.ml.auto_download() {
        return false;
    }
    match download_running(state).await {
        Ok(true) => return true,
        Ok(false) => {}
        Err(e) => {
            tracing::error!(error = %e, "could not check for a running model download");
            return false;
        }
    }
    match lp_jobs::enqueue(
        state,
        KIND,
        json!({ "user_id": user_id }),
        EnqueueOptions::tracked(JobType::DownloadModels, user_id),
    )
    .await
    {
        Ok(_) => true,
        Err(e) => {
            tracing::error!(error = %e, "failed to queue the model download");
            false
        }
    }
}

/// The chain step: download the selected models first when any is missing.
/// Never fails the caller (a trigger answers as before either way).
pub async fn queue_if_missing(state: &AppState, user_id: i32) {
    if !all_present(state) {
        start_download(state, user_id).await;
    }
}

/// Upper bound on how long an ML job waits for a download (a crashed
/// download leaves its LongRunningJob unfinished until the stuck-job sweep).
pub const WAIT_LIMIT: Duration = Duration::from_secs(30 * 60);

/// Wait while a Download Models job is running (polled every 2 s).
pub async fn wait_for_download(state: &AppState) {
    let started = Instant::now();
    let mut logged = false;
    while started.elapsed() < WAIT_LIMIT {
        match download_running(state).await {
            Ok(true) => {
                if !logged {
                    tracing::info!("waiting for the model download to finish");
                    logged = true;
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            _ => return,
        }
    }
    tracing::warn!("model download still running after 30 min; continuing");
}

/// One download at a time per process.
static DOWNLOAD_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// `download_models`: every catalog model in order, progress per model; a
/// failure is recorded and the rest still downloaded.
pub async fn download(ctx: JobCtx) -> anyhow::Result<()> {
    #[derive(serde::Deserialize)]
    struct Payload {
        user_id: i32,
    }
    let p: Payload = serde_json::from_value(ctx.job.payload.clone())
        .map_err(|e| anyhow::anyhow!("{KIND} payload: {e}"))?;
    let state = &ctx.state;
    let db = &state.db;
    let job_id = run::begin(
        db,
        ctx.job.lrj_id.as_deref(),
        JobType::DownloadModels,
        p.user_id,
    )
    .await?;
    let _one = DOWNLOAD_LOCK.lock().await;
    let total = models::CATALOG.len() as i32;
    run::set_progress(db, &job_id, 0, total).await?;
    let dir = state.config.data_models_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let http = models::http_client()?;
    let sel = selection(state);
    let mut failures = Vec::new();
    for (i, m) in models::CATALOG.iter().enumerate() {
        match models::download_model(&http, &dir, m, &sel).await {
            Ok(Outcome::Downloaded) => {
                tracing::info!(
                    model = m.name,
                    bytes = models::size_on_disk(&dir, m),
                    "model installed"
                );
            }
            Ok(_) => {}
            Err(e) => {
                tracing::error!(model = m.name, error = %format!("{e:#}"), "failed to download model");
                failures.push(format!("{}: {e:#}", m.name));
            }
        }
        run::set_progress(db, &job_id, i as i32 + 1, total).await?;
    }
    if failures.is_empty() {
        run::complete(db, &job_id).await?;
    } else {
        run::fail(
            db,
            &job_id,
            &format!("Failed to download {}", failures.join(", ")),
        )
        .await?;
    }
    Ok(())
}

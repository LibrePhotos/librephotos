//! Per-photo work with a shared job counter: Django queues one task per
//! photo (`_queue_per_photo_tasks`) that each bump the counter; here the job
//! runs them itself, a few at a time.

use std::future::Future;

use futures::StreamExt;
use lp_core::AppState;
use uuid::Uuid;

use crate::run::{self, CANCEL_CHECK_EVERY, ItemCounter};

/// Photos in flight per job. The sidecars serve one inference at a time,
/// so more only queues requests on their side.
pub const PHOTO_CONCURRENCY: usize = 4;

/// Run `work` for every id (`Err(message)` records a per-item error),
/// polling for cancellation every 100 items, then finish the job once its
/// counter reached the target. Returns false when the job was cancelled.
pub async fn for_each_photo<F, Fut>(
    state: &AppState,
    job_id: &str,
    ids: Vec<Uuid>,
    concurrency: usize,
    work: F,
) -> anyhow::Result<bool>
where
    F: Fn(Uuid) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    if run::is_cancelled(&state.db, job_id).await? {
        return Ok(false);
    }
    let mut counter = ItemCounter::new(state.db.clone(), job_id, ids.len());
    let concurrency = concurrency.clamp(1, state.config.worker_concurrency.max(1));
    let mut results = futures::stream::iter(ids)
        .map(&work)
        .buffer_unordered(concurrency);
    let mut seen = 0usize;
    while let Some(outcome) = results.next().await {
        counter.done(outcome.err()).await?;
        seen += 1;
        if seen.is_multiple_of(CANCEL_CHECK_EVERY) && run::is_cancelled(&state.db, job_id).await? {
            counter.flush().await?;
            return Ok(false);
        }
    }
    counter.finish().await?;
    Ok(true)
}

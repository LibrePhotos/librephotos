//! The embedded worker (`serve`) / standalone worker (`worker`).

use std::sync::Arc;

use lp_core::AppState;
use tokio_util::sync::CancellationToken;

use crate::registry::HandlerRegistry;

pub struct Worker {
    pub state: AppState,
    pub registry: Arc<HandlerRegistry>,
    /// `WORKER_CONCURRENCY` job slots.
    pub concurrency: usize,
    /// `locked_by` value, unique per process.
    pub id: String,
}

impl Worker {
    pub fn new(state: AppState, registry: HandlerRegistry) -> Self {
        let concurrency = state.config.worker_concurrency;
        Worker {
            state,
            registry: Arc::new(registry),
            concurrency,
            id: format!("{}-{}", hostname(), std::process::id()),
        }
    }

    /// TODO(jobs agent): the loop from 04 §1: `LISTEN job_queue` + 1 s poll
    /// backup + `state.job_wakeup`, `queue::claim_next` into
    /// `concurrency` slots, heartbeat, `mark_done`/`mark_failed`, stale
    /// requeue, schedules via `schedule_state`, graceful shutdown.
    pub async fn run(self, shutdown: CancellationToken) -> anyhow::Result<()> {
        tracing::info!(
            worker = %self.id,
            kinds = self.registry.len(),
            "job worker loop not implemented yet; jobs stay queued"
        );
        shutdown.cancelled().await;
        Ok(())
    }
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "worker".into())
}

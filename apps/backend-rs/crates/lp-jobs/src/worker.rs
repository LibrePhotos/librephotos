//! The embedded worker (`serve`) / standalone worker (`worker`), 04 §1:
//! `LISTEN job_queue` plus a 1 s poll, `WORKER_CONCURRENCY` slots,
//! heartbeats, stale requeue, retries with backoff, schedules, graceful
//! shutdown.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use lp_core::AppState;
use sqlx::postgres::PgListener;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::lrj;
use crate::queue::{self, NOTIFY_CHANNEL, QueuedJob};
use crate::registry::{HandlerRegistry, JobCtx};
use crate::schedules::{self, SCHEDULES, Schedule};

#[derive(Debug, Clone)]
pub struct WorkerTiming {
    /// Backup poll when no NOTIFY arrives.
    pub poll: Duration,
    /// Heartbeat of a running job.
    pub heartbeat: Duration,
    /// A running row whose heartbeat is older than this is requeued.
    pub stale_after: Duration,
    /// How often stale rows and due schedules are checked.
    pub maintenance: Duration,
    /// How long shutdown waits for running jobs before handing them back.
    pub shutdown_grace: Duration,
    /// First retry delay; doubles per attempt, capped at 10 min.
    pub retry_base: Duration,
}

impl Default for WorkerTiming {
    fn default() -> Self {
        WorkerTiming {
            poll: Duration::from_secs(1),
            heartbeat: Duration::from_secs(10),
            stale_after: Duration::from_secs(120),
            maintenance: Duration::from_secs(30),
            shutdown_grace: Duration::from_secs(8),
            retry_base: Duration::from_secs(5),
        }
    }
}

pub struct Worker {
    pub state: AppState,
    pub registry: Arc<HandlerRegistry>,
    /// `WORKER_CONCURRENCY` job slots.
    pub concurrency: usize,
    /// `locked_by` value, unique per process.
    pub id: String,
    /// Recurring jobs this worker enqueues (those whose kind is registered).
    pub schedules: Vec<Schedule>,
    pub timing: WorkerTiming,
    /// Run the sidecar watchdog next to the loop (`LP_SUPERVISE_SIDECARS`).
    pub supervise_sidecars: bool,
}

impl Worker {
    pub fn new(state: AppState, registry: HandlerRegistry) -> Self {
        let concurrency = state.config.worker_concurrency.max(1);
        let schedules = SCHEDULES
            .iter()
            .filter(|s| registry.get(s.kind).is_some())
            .cloned()
            .collect();
        Worker {
            state,
            registry: Arc::new(registry),
            concurrency,
            id: format!(
                "{}-{}-{}",
                hostname(),
                std::process::id(),
                &uuid::Uuid::new_v4().simple().to_string()[..6]
            ),
            schedules,
            timing: WorkerTiming::default(),
            supervise_sidecars: crate::services::supervise_enabled(),
        }
    }

    pub async fn run(self, shutdown: CancellationToken) -> anyhow::Result<()> {
        let kinds = self.registry.kinds();
        tracing::info!(
            worker = %self.id,
            kinds = kinds.len(),
            slots = self.concurrency,
            "job worker started"
        );
        let wake = Arc::new(Notify::new());
        let bg = shutdown.child_token();
        let mut background = JoinSet::new();
        background.spawn(listen(self.state.clone(), wake.clone(), bg.clone()));
        background.spawn(maintenance(
            self.state.clone(),
            self.schedules.clone(),
            self.timing.clone(),
            bg.clone(),
        ));
        if self.supervise_sidecars {
            background.spawn(crate::services::watchdog(self.state.clone(), bg.clone()));
        }

        let slots = Arc::new(Semaphore::new(self.concurrency));
        let in_flight: Arc<Mutex<HashSet<i64>>> = Arc::default();
        let mut tasks = JoinSet::new();

        'outer: loop {
            while tasks.try_join_next().is_some() {}
            let permit = tokio::select! {
                _ = shutdown.cancelled() => break 'outer,
                p = slots.clone().acquire_owned() => p?,
            };
            if !kinds.is_empty() {
                match self.claim(&kinds).await {
                    Ok(Some(job)) => {
                        in_flight.lock().expect("in-flight lock").insert(job.id);
                        tasks.spawn(run_job(
                            self.state.clone(),
                            self.registry.clone(),
                            job,
                            self.timing.clone(),
                            in_flight.clone(),
                            permit,
                        ));
                        continue;
                    }
                    Ok(None) => {}
                    Err(e) => tracing::warn!(error = %e, "claiming a job failed"),
                }
            }
            drop(permit);
            tokio::select! {
                _ = shutdown.cancelled() => break 'outer,
                _ = wake.notified() => {}
                _ = self.state.job_wakeup.notified() => {}
                _ = tokio::time::sleep(self.timing.poll) => {}
            }
        }

        bg.cancel();
        let drained = tokio::time::timeout(self.timing.shutdown_grace, async {
            while tasks.join_next().await.is_some() {}
        })
        .await
        .is_ok();
        if !drained {
            tasks.abort_all();
            while tasks.join_next().await.is_some() {}
            let ids: Vec<i64> = in_flight
                .lock()
                .expect("in-flight lock")
                .iter()
                .copied()
                .collect();
            if !ids.is_empty() {
                match self.state.db.acquire().await {
                    Ok(mut conn) => match queue::release(&mut conn, &ids).await {
                        Ok(n) => tracing::info!(released = n, "handed running jobs back"),
                        Err(e) => tracing::warn!(error = %e, "releasing jobs failed"),
                    },
                    Err(e) => tracing::warn!(error = %e, "releasing jobs failed"),
                }
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(10), async {
            while background.join_next().await.is_some() {}
        })
        .await;
        tracing::info!(worker = %self.id, "job worker stopped");
        Ok(())
    }

    async fn claim(&self, kinds: &[String]) -> sqlx::Result<Option<QueuedJob>> {
        let mut conn = self.state.db.acquire().await?;
        queue::claim_next(&mut conn, &self.id, kinds).await
    }
}

/// Retry delay after failed attempt number `attempts` (1-based): `base`,
/// `2 * base`, `4 * base`, ... capped at 10 min.
pub fn backoff(attempts: i32, base: Duration) -> Duration {
    let exp = attempts.clamp(1, 16) as u32 - 1;
    (base * (1u32 << exp)).min(Duration::from_secs(600))
}

async fn run_job(
    state: AppState,
    registry: Arc<HandlerRegistry>,
    job: QueuedJob,
    timing: WorkerTiming,
    in_flight: Arc<Mutex<HashSet<i64>>>,
    _permit: OwnedSemaphorePermit,
) {
    let id = job.id;
    let kind = job.kind.clone();
    let started = std::time::Instant::now();
    let handler = registry.get(&job.kind).cloned();
    let hb_stop = CancellationToken::new();
    let hb = tokio::spawn(heartbeat(
        state.clone(),
        id,
        timing.heartbeat,
        hb_stop.clone(),
    ));

    let outcome: Result<(), String> = match handler {
        None => Err(format!("no handler for job kind {kind:?}")),
        Some(h) => {
            let ctx = JobCtx {
                state: state.clone(),
                job: job.clone(),
            };
            match tokio::spawn(h(ctx)).await {
                Ok(Ok(())) => Ok(()),
                Ok(Err(e)) => Err(format!("{e:#}")),
                Err(e) if e.is_panic() => Err(format!("job panicked: {}", panic_message(e))),
                Err(e) => Err(format!("job aborted: {e}")),
            }
        }
    };
    hb_stop.cancel();
    let _ = hb.await;

    let record = async {
        let mut conn = state.db.acquire().await?;
        match &outcome {
            Ok(()) => {
                queue::mark_done(&mut conn, id).await?;
                tracing::info!(
                    job = id,
                    kind,
                    elapsed_ms = started.elapsed().as_millis() as u64,
                    "job done"
                );
            }
            Err(msg) => {
                let retry_at = Utc::now()
                    + chrono::Duration::from_std(backoff(job.attempts, timing.retry_base))
                        .unwrap_or_default();
                let final_failure = queue::mark_failed(&mut conn, id, msg, Some(retry_at)).await?;
                tracing::warn!(job = id, kind, attempt = job.attempts, final_failure, error = %msg, "job failed");
                // A fan-out child (group_id set) shares its parent's
                // LongRunningJob; one failed child must not fail the whole run.
                if final_failure
                    && job.group_id.is_none()
                    && let Some(lrj_id) = &job.lrj_id
                {
                    lrj::fail(&mut *conn, lrj_id, msg).await?;
                }
            }
        }
        Ok::<(), sqlx::Error>(())
    };
    if let Err(e) = record.await {
        tracing::error!(job = id, error = %e, "recording the job outcome failed");
    }
    in_flight.lock().expect("in-flight lock").remove(&id);
}

async fn heartbeat(state: AppState, id: i64, every: Duration, stop: CancellationToken) {
    loop {
        tokio::select! {
            _ = stop.cancelled() => return,
            _ = tokio::time::sleep(every) => {}
        }
        if let Ok(mut conn) = state.db.acquire().await
            && let Err(e) = queue::heartbeat(&mut conn, id).await
        {
            tracing::warn!(job = id, error = %e, "heartbeat failed");
        }
    }
}

fn panic_message(e: tokio::task::JoinError) -> String {
    let p = e.into_panic();
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".into()
    }
}

/// `LISTEN job_queue`: every NOTIFY pokes the claim loop. Reconnects on error.
async fn listen(state: AppState, wake: Arc<Notify>, stop: CancellationToken) {
    loop {
        let mut listener = match PgListener::connect_with(&state.db).await {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(error = %e, "LISTEN connect failed; polling only");
                tokio::select! {
                    _ = stop.cancelled() => return,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => continue,
                }
            }
        };
        if let Err(e) = listener.listen(NOTIFY_CHANNEL).await {
            tracing::warn!(error = %e, "LISTEN failed; polling only");
            tokio::select! {
                _ = stop.cancelled() => return,
                _ = tokio::time::sleep(Duration::from_secs(5)) => continue,
            }
        }
        loop {
            tokio::select! {
                _ = stop.cancelled() => return,
                n = listener.recv() => match n {
                    Ok(_) => wake.notify_one(),
                    Err(e) => {
                        tracing::warn!(error = %e, "LISTEN connection lost");
                        break;
                    }
                }
            }
        }
    }
}

/// Stale requeue and due schedules, every `timing.maintenance`.
async fn maintenance(
    state: AppState,
    schedules: Vec<Schedule>,
    timing: WorkerTiming,
    stop: CancellationToken,
) {
    loop {
        match state.db.acquire().await {
            Ok(mut conn) => {
                match queue::requeue_stale(&mut conn, timing.stale_after.as_secs() as i64).await {
                    Ok((0, 0)) => {}
                    Ok((requeued, failed)) => {
                        tracing::warn!(requeued, failed, "recovered jobs with stale heartbeats")
                    }
                    Err(e) => tracing::warn!(error = %e, "stale requeue failed"),
                }
            }
            Err(e) => tracing::warn!(error = %e, "stale requeue failed"),
        }
        match schedules::run_due(&state.db, &schedules).await {
            Ok(fired) if !fired.is_empty() => {
                tracing::info!(?fired, "scheduled jobs enqueued");
                state.job_wakeup.notify_one();
            }
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "schedules failed"),
        }
        tokio::select! {
            _ = stop.cancelled() => return,
            _ = tokio::time::sleep(timing.maintenance) => {}
        }
    }
}

fn hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "worker".into())
}

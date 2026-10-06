//! Worker loop: lifecycle, LongRunningJob contract (04 §2), retries,
//! panics, cooperative cancel, stale requeue, LISTEN wake-ups, concurrency,
//! graceful shutdown, schedules and the maintenance handlers.

#![allow(clippy::disallowed_methods)]

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use lp_core::AppState;
use lp_jobs::schedules::{self, Schedule};
use lp_jobs::{EnqueueOptions, HandlerRegistry, JobCtx, JobType, Worker, WorkerTiming, lrj};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

fn fast() -> WorkerTiming {
    WorkerTiming {
        poll: Duration::from_millis(100),
        heartbeat: Duration::from_millis(200),
        stale_after: Duration::from_secs(2),
        maintenance: Duration::from_millis(300),
        shutdown_grace: Duration::from_millis(500),
        retry_base: Duration::from_millis(50),
    }
}

struct Running {
    stop: CancellationToken,
    handle: JoinHandle<anyhow::Result<()>>,
}

impl Running {
    async fn shutdown(self) {
        self.stop.cancel();
        tokio::time::timeout(Duration::from_secs(20), self.handle)
            .await
            .expect("worker stops")
            .expect("join")
            .expect("worker ok");
    }
}

fn start(state: &AppState, reg: HandlerRegistry, slots: usize, timing: WorkerTiming) -> Running {
    let mut w = Worker::new(state.clone(), reg);
    w.concurrency = slots;
    w.timing = timing;
    w.schedules = Vec::new();
    w.supervise_sidecars = false;
    let stop = CancellationToken::new();
    let handle = tokio::spawn(w.run(stop.clone()));
    Running { stop, handle }
}

async fn wait_for<F, Fut>(what: &str, limit: Duration, mut f: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    let t = Instant::now();
    while t.elapsed() < limit {
        if f().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for {what}");
}

fn unique(kind: &str) -> String {
    format!(
        "test.{kind}.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    )
}

async fn queue_status(db: &PgPool, id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM job_queue WHERE id = $1")
        .bind(id)
        .fetch_one(db)
        .await
        .unwrap()
}

async fn wait_status(db: &PgPool, id: i64, status: &str) {
    let db = db.clone();
    wait_for(
        &format!("job {id} -> {status}"),
        Duration::from_secs(15),
        || {
            let db = db.clone();
            async move { queue_status(&db, id).await == status }
        },
    )
    .await;
}

#[tokio::test]
async fn lifecycle_follows_the_long_running_job_contract() {
    let app = lp_testkit::TestApp::shared().await;
    let user = app
        .create_user(&unique("u").replace('.', "_"), "pw", false)
        .await;
    let kind = unique("life");
    let mut reg = HandlerRegistry::new();
    reg.register(&kind, |ctx: JobCtx| async move {
        let id = ctx.job.lrj_id.clone().unwrap();
        let db = &ctx.state.db;
        lrj::start(db, &id, Some(3)).await?;
        lrj::set_step(db, &id, "working").await?;
        let mut p = lp_jobs::Progress::new(db.clone(), &id);
        for _ in 0..3 {
            p.inc(1).await?;
        }
        p.flush().await?;
        lrj::finish(db, &id, Some(&json!({"status": "ok"}))).await?;
        Ok(())
    });
    let w = start(&app.state, reg, 2, fast());
    let e = lp_jobs::enqueue(
        &app.state,
        &kind,
        json!({"user_id": user.id}),
        EnqueueOptions::tracked(JobType::ScanPhotos, user.id),
    )
    .await
    .unwrap();
    let lrj_id = e.lrj_id.clone().unwrap();
    let queued = lrj::get(app.pool(), &lrj_id).await.unwrap().unwrap();
    assert!(!queued.finished && queued.started_at.is_none());
    assert_eq!(queued.job_type, 1);
    assert_eq!(queued.started_by_id, user.id);

    wait_status(app.pool(), e.id, "done").await;
    let done = lrj::get(app.pool(), &lrj_id).await.unwrap().unwrap();
    assert!(done.finished && !done.failed && !done.cancelled);
    assert_eq!((done.progress_current, done.progress_target), (3, 3));
    assert_eq!(done.progress_step.as_deref(), Some("working"));
    assert_eq!(done.result, Some(json!({"status": "ok"})));
    let (started, finished) = (done.started_at.unwrap(), done.finished_at.unwrap());
    assert!(done.queued_at <= started && started <= finished);
    let row: (i32, Option<String>, Option<String>) =
        sqlx::query_as("SELECT attempts, locked_by, last_error FROM job_queue WHERE id = $1")
            .bind(e.id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!(row, (1, None, None));
    w.shutdown().await;
    app.cleanup().await;
}

#[tokio::test]
async fn retries_then_fails_the_long_running_job() {
    let app = lp_testkit::TestApp::shared().await;
    let user = app
        .create_user(&unique("u").replace('.', "_"), "pw", false)
        .await;
    let flaky = unique("flaky");
    let broken = unique("broken");
    let panics = unique("panic");
    let calls = Arc::new(AtomicUsize::new(0));
    let mut reg = HandlerRegistry::new();
    let c = calls.clone();
    reg.register(&flaky, move |_ctx: JobCtx| {
        let c = c.clone();
        async move {
            if c.fetch_add(1, Ordering::SeqCst) < 2 {
                anyhow::bail!("transient");
            }
            Ok(())
        }
    });
    reg.register(&broken, |_ctx: JobCtx| async move {
        anyhow::bail!("disk on fire")
    });
    reg.register(&panics, |_ctx: JobCtx| async move {
        if true {
            panic!("boom");
        }
        Ok(())
    });
    let w = start(&app.state, reg, 2, fast());

    let opts = EnqueueOptions {
        max_attempts: 3,
        ..EnqueueOptions::default()
    };
    let a = lp_jobs::enqueue(&app.state, &flaky, json!({}), opts)
        .await
        .unwrap();
    let b = lp_jobs::enqueue(
        &app.state,
        &broken,
        json!({}),
        EnqueueOptions {
            max_attempts: 2,
            ..EnqueueOptions::tracked(JobType::DownloadPhotos, user.id)
        },
    )
    .await
    .unwrap();
    let c = lp_jobs::enqueue(
        &app.state,
        &panics,
        json!({}),
        EnqueueOptions::tracked(JobType::GenerateTags, user.id),
    )
    .await
    .unwrap();

    wait_status(app.pool(), a.id, "done").await;
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    wait_status(app.pool(), b.id, "failed").await;
    wait_status(app.pool(), c.id, "failed").await;

    let (attempts, err): (i32, String) =
        sqlx::query_as("SELECT attempts, last_error FROM job_queue WHERE id = $1")
            .bind(b.id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!((attempts, err.as_str()), (2, "disk on fire"));
    let job = lrj::get(app.pool(), b.lrj_id.as_ref().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert!(job.failed && job.finished && job.finished_at.is_some());
    assert_eq!(
        job.result,
        Some(json!({"status": "failed", "error": "disk on fire"}))
    );
    let job = lrj::get(app.pool(), c.lrj_id.as_ref().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert!(job.failed);
    assert_eq!(job.result.unwrap()["error"], "job panicked: boom");
    w.shutdown().await;
    app.cleanup().await;
}

#[tokio::test]
async fn fan_out_child_failure_leaves_the_parent_job_running() {
    let app = lp_testkit::TestApp::shared().await;
    let user = app
        .create_user(&unique("u").replace('.', "_"), "pw", false)
        .await;
    let kind = unique("child");
    let mut reg = HandlerRegistry::new();
    reg.register(
        &kind,
        |_ctx: JobCtx| async move { anyhow::bail!("one file") },
    );
    let w = start(&app.state, reg, 1, fast());
    let parent = lrj::create(app.pool(), JobType::ScanPhotos, user.id)
        .await
        .unwrap();
    let e = lp_jobs::enqueue(
        &app.state,
        &kind,
        json!({}),
        EnqueueOptions {
            lrj_id: Some(parent.clone()),
            group_id: Some(format!("scan:{parent}")),
            ..EnqueueOptions::default()
        },
    )
    .await
    .unwrap();
    wait_status(app.pool(), e.id, "failed").await;
    let job = lrj::get(app.pool(), &parent).await.unwrap().unwrap();
    assert!(!job.finished && !job.failed);
    w.shutdown().await;
    app.cleanup().await;
}

#[tokio::test]
async fn cancel_is_cooperative_and_marks_queue_rows() {
    let app = lp_testkit::TestApp::shared().await;
    let user = app
        .create_user(&unique("u").replace('.', "_"), "pw", false)
        .await;
    let kind = unique("cancel");
    let seen = Arc::new(AtomicUsize::new(0));
    let mut reg = HandlerRegistry::new();
    let s = seen.clone();
    reg.register(&kind, move |ctx: JobCtx| {
        let s = s.clone();
        async move {
            lrj::start(
                &ctx.state.db,
                ctx.job.lrj_id.as_deref().unwrap(),
                Some(1000),
            )
            .await?;
            for _ in 0..400 {
                if ctx.is_cancelled().await {
                    s.fetch_add(1, Ordering::SeqCst);
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            anyhow::bail!("was never cancelled")
        }
    });
    // One slot: the second job stays queued behind the first.
    let w = start(&app.state, reg, 1, fast());
    let running = lp_jobs::enqueue(
        &app.state,
        &kind,
        json!({}),
        EnqueueOptions::tracked(JobType::ScanFaces, user.id),
    )
    .await
    .unwrap();
    wait_status(app.pool(), running.id, "running").await;
    let queued = lp_jobs::enqueue(
        &app.state,
        &kind,
        json!({}),
        EnqueueOptions::tracked(JobType::ScanFaces, user.id),
    )
    .await
    .unwrap();

    assert!(
        lrj::cancel_with_queue(app.pool(), queued.lrj_id.as_ref().unwrap())
            .await
            .unwrap()
    );
    assert!(
        lrj::cancel_with_queue(app.pool(), running.lrj_id.as_ref().unwrap())
            .await
            .unwrap()
    );
    let pool = app.pool().clone();
    wait_for("handler saw the cancel", Duration::from_secs(10), || {
        let s = seen.clone();
        async move { s.load(Ordering::SeqCst) == 1 }
    })
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(queue_status(&pool, running.id).await, "cancelled");
    assert_eq!(queue_status(&pool, queued.id).await, "cancelled");
    for id in [&running.lrj_id, &queued.lrj_id] {
        let j = lrj::get(&pool, id.as_ref().unwrap())
            .await
            .unwrap()
            .unwrap();
        assert!(j.cancelled && j.finished && !j.failed);
        assert_eq!(j.result, Some(json!({"status": "cancelled"})));
    }
    // A finished job cannot be cancelled again.
    assert!(
        !lrj::cancel_with_queue(&pool, running.lrj_id.as_ref().unwrap())
            .await
            .unwrap()
    );
    w.shutdown().await;
    app.cleanup().await;
}

#[tokio::test]
async fn stale_rows_are_requeued_and_capped() {
    let app = lp_testkit::TestApp::new().await;
    let kind = unique("stale");
    let runs = Arc::new(AtomicUsize::new(0));
    let mut reg = HandlerRegistry::new();
    let r = runs.clone();
    reg.register(&kind, move |_ctx: JobCtx| {
        let r = r.clone();
        async move {
            r.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    });
    let insert = "INSERT INTO job_queue (kind, status, locked_by, heartbeat_at, started_at, attempts, max_attempts) \
                  VALUES ($1, 'running', 'dead-worker', now() - interval '1 hour', now() - interval '1 hour', $2, 1) RETURNING id";
    let lost: i64 = sqlx::query_scalar(insert)
        .bind(&kind)
        .bind(1)
        .fetch_one(app.pool())
        .await
        .unwrap();
    let hopeless: i64 = sqlx::query_scalar(insert)
        .bind(&kind)
        .bind(3)
        .fetch_one(app.pool())
        .await
        .unwrap();
    // A hopeless row tracked by a LongRunningJob must not leave that job
    // unfinished: the worker indicator would show it busy for 24 h.
    let owner = app.create_user("stale_owner", "pw", false).await;
    let tracked_lrj = lrj::create(app.pool(), JobType::ScanPhotos, owner.id)
        .await
        .unwrap();
    let tracked: i64 = sqlx::query_scalar(
        "INSERT INTO job_queue (kind, status, locked_by, heartbeat_at, started_at, attempts, \
           max_attempts, lrj_id) \
         VALUES ($1, 'running', 'dead-worker', now() - interval '1 hour', \
           now() - interval '1 hour', 3, 1, $2) RETURNING id",
    )
    .bind(&kind)
    .bind(&tracked_lrj)
    .fetch_one(app.pool())
    .await
    .unwrap();
    let w = start(&app.state, reg, 2, fast());
    wait_status(app.pool(), lost, "done").await;
    wait_status(app.pool(), hopeless, "failed").await;
    wait_status(app.pool(), tracked, "failed").await;
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    let job = lrj::get(app.pool(), &tracked_lrj).await.unwrap().unwrap();
    assert!(
        job.finished && job.failed,
        "lost job's LongRunningJob is failed"
    );
    assert_eq!(job.result.as_ref().unwrap()["status"], "failed");
    let err: String = sqlx::query_scalar("SELECT last_error FROM job_queue WHERE id = $1")
        .bind(hopeless)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert!(err.contains("stale heartbeat"));
    w.shutdown().await;
    app.cleanup().await;
}

#[tokio::test]
async fn notify_wakes_the_worker_and_slots_bound_concurrency() {
    let app = lp_testkit::TestApp::shared().await;
    let kind = unique("slots");
    let now = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let mut reg = HandlerRegistry::new();
    let (n, p) = (now.clone(), peak.clone());
    reg.register(&kind, move |_ctx: JobCtx| {
        let (n, p) = (n.clone(), p.clone());
        async move {
            let cur = n.fetch_add(1, Ordering::SeqCst) + 1;
            p.fetch_max(cur, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(300)).await;
            n.fetch_sub(1, Ordering::SeqCst);
            Ok(())
        }
    });
    // No backup poll to speak of: only LISTEN/NOTIFY can wake the loop.
    let timing = WorkerTiming {
        poll: Duration::from_secs(60),
        ..fast()
    };
    let w = start(&app.state, reg, 2, timing);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let t = Instant::now();
    let mut ids = Vec::new();
    for _ in 0..5 {
        // enqueue_in + commit without lp_jobs::wake: the NOTIFY alone.
        let mut tx = app.pool().begin().await.unwrap();
        let e = lp_jobs::enqueue_in(&mut tx, &kind, json!({}), &EnqueueOptions::default())
            .await
            .unwrap();
        tx.commit().await.unwrap();
        ids.push(e.id);
    }
    for id in &ids {
        wait_status(app.pool(), *id, "done").await;
    }
    assert!(t.elapsed() < Duration::from_secs(10));
    assert_eq!(peak.load(Ordering::SeqCst), 2);
    w.shutdown().await;
    app.cleanup().await;
}

/// A handler that checks `shutting_down()` stops at its safe point within
/// the grace period, cleans up its partial output and is handed back (not
/// failed, attempt not counted), its LongRunningJob left running.
#[tokio::test]
async fn shutdown_stops_handlers_at_a_safe_point() {
    let app = lp_testkit::TestApp::shared().await;
    let kind = unique("safe");
    let dir = tempfile::tempdir().unwrap();
    let part = dir.path().join("out.part");
    let steps = Arc::new(AtomicUsize::new(0));
    let mut reg = HandlerRegistry::new();
    let (p, s) = (part.clone(), steps.clone());
    reg.register(&kind, move |_ctx: JobCtx| {
        let (p, s) = (p.clone(), s.clone());
        async move {
            std::fs::write(&p, b"half")?;
            loop {
                if lp_jobs::shutting_down() {
                    std::fs::remove_file(&p)?;
                    return Err(lp_jobs::interrupted());
                }
                s.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }
    });
    let timing = WorkerTiming {
        shutdown_grace: Duration::from_secs(5),
        ..fast()
    };
    let w = start(&app.state, reg, 1, timing);
    let user = app
        .create_user(&unique("u").replace('.', "_"), "pw", false)
        .await;
    let e = lp_jobs::enqueue(
        &app.state,
        &kind,
        json!({}),
        EnqueueOptions::tracked(JobType::ScanPhotos, user.id),
    )
    .await
    .unwrap();
    wait_status(app.pool(), e.id, "running").await;
    wait_for("a few steps", Duration::from_secs(5), || {
        let s = steps.clone();
        async move { s.load(Ordering::SeqCst) > 2 }
    })
    .await;
    assert!(part.exists());
    let t = Instant::now();
    w.shutdown().await;
    assert!(
        t.elapsed() < Duration::from_secs(2),
        "stopped at the safe point, not after the grace period"
    );
    assert!(!part.exists(), "partial output removed");
    let (status, attempts, locked, last_error): (String, i32, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT status, attempts, locked_by, last_error FROM job_queue WHERE id = $1",
        )
        .bind(e.id)
        .fetch_one(app.pool())
        .await
        .unwrap();
    assert_eq!(
        (status.as_str(), attempts, locked, last_error),
        ("queued", 0, None, None)
    );
    let job = lrj::get(app.pool(), e.lrj_id.as_deref().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert!(!job.failed && !job.finished, "the UI job is not failed");
    sqlx::query("DELETE FROM job_queue WHERE id = $1")
        .bind(e.id)
        .execute(app.pool())
        .await
        .unwrap();
    app.cleanup().await;
}

#[tokio::test]
async fn shutdown_hands_running_jobs_back() {
    let app = lp_testkit::TestApp::shared().await;
    let kind = unique("slow");
    let finished = Arc::new(AtomicUsize::new(0));
    let mut reg = HandlerRegistry::new();
    let f = finished.clone();
    reg.register(&kind, move |_ctx: JobCtx| {
        let f = f.clone();
        async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            f.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    });
    let w = start(&app.state, reg, 1, fast());
    let e = lp_jobs::enqueue(&app.state, &kind, json!({}), EnqueueOptions::default())
        .await
        .unwrap();
    wait_status(app.pool(), e.id, "running").await;
    let t = Instant::now();
    w.shutdown().await;
    assert!(t.elapsed() < Duration::from_secs(5));
    let (status, attempts, locked): (String, i32, Option<String>) =
        sqlx::query_as("SELECT status, attempts, locked_by FROM job_queue WHERE id = $1")
            .bind(e.id)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert_eq!((status.as_str(), attempts, locked), ("queued", 0, None));
    // The handed-back job must really stop, or it runs twice once another
    // worker claims the row.
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(
        finished.load(Ordering::SeqCst),
        0,
        "aborted handler kept running"
    );
    sqlx::query("DELETE FROM job_queue WHERE id = $1")
        .bind(e.id)
        .execute(app.pool())
        .await
        .unwrap();
    app.cleanup().await;
}

#[tokio::test]
async fn schedules_fire_once_per_interval_and_run_through_the_worker() {
    let app = lp_testkit::TestApp::shared().await;
    let kind: &'static str = Box::leak(unique("sched").into_boxed_str());
    let name: &'static str = Box::leak(unique("s").into_boxed_str());
    let sched = [Schedule {
        name,
        kind,
        every: Duration::from_secs(3600),
    }];
    assert_eq!(
        schedules::run_due(app.pool(), &sched).await.unwrap(),
        vec![name]
    );
    assert!(
        schedules::run_due(app.pool(), &sched)
            .await
            .unwrap()
            .is_empty()
    );
    let next: chrono::DateTime<chrono::Utc> =
        sqlx::query_scalar("SELECT next_run_at FROM schedule_state WHERE name = $1")
            .bind(name)
            .fetch_one(app.pool())
            .await
            .unwrap();
    assert!(next > chrono::Utc::now() + chrono::Duration::minutes(59));
    sqlx::query(
        "UPDATE schedule_state SET next_run_at = now() - interval '1 second' WHERE name = $1",
    )
    .bind(name)
    .execute(app.pool())
    .await
    .unwrap();

    let runs = Arc::new(AtomicUsize::new(0));
    let mut reg = HandlerRegistry::new();
    let r = runs.clone();
    reg.register(kind, move |_ctx: JobCtx| {
        let r = r.clone();
        async move {
            r.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    });
    let mut worker = Worker::new(app.state.clone(), reg);
    worker.timing = fast();
    worker.schedules = sched.to_vec();
    worker.supervise_sidecars = false;
    let stop = CancellationToken::new();
    let h = tokio::spawn(worker.run(stop.clone()));
    // The earlier run_due enqueued one, the due schedule another.
    wait_for("two scheduled runs", Duration::from_secs(10), || {
        let r = runs.clone();
        async move { r.load(Ordering::SeqCst) == 2 }
    })
    .await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(runs.load(Ordering::SeqCst), 2);
    stop.cancel();
    h.await.unwrap().unwrap();
    app.cleanup().await;
}

async fn run_kind(app: &lp_testkit::TestApp, kind: &str) {
    let mut reg = HandlerRegistry::new();
    lp_jobs::maintenance::register(&mut reg);
    let w = start(&app.state, reg, 1, fast());
    let e = lp_jobs::enqueue(&app.state, kind, json!({}), EnqueueOptions::default())
        .await
        .unwrap();
    wait_status(app.pool(), e.id, "done").await;
    w.shutdown().await;
}

#[tokio::test]
async fn maintenance_cleans_jobs_tokens_zips_and_deleted_photos() {
    let app = lp_testkit::TestApp::new().await;
    let db = app.pool().clone();
    let u = app.create_user("maint", "pw", false).await;

    // Stuck: started 25 h ago, or queued 25 h ago and never started.
    let mk = |t: JobType, sql: &'static str| {
        let db = db.clone();
        async move {
            let id = lrj::create(&db, t, u.id).await.unwrap();
            sqlx::query(sql).bind(&id).execute(&db).await.unwrap();
            id
        }
    };
    let stuck_started = mk(
        JobType::ScanPhotos,
        "UPDATE api_longrunningjob SET started_at = now() - interval '25 hours' WHERE job_id = $1",
    )
    .await;
    let stuck_queued = mk(
        JobType::ScanPhotos,
        "UPDATE api_longrunningjob SET queued_at = now() - interval '25 hours' WHERE job_id = $1",
    )
    .await;
    let fresh = mk(
        JobType::ScanPhotos,
        "UPDATE api_longrunningjob SET started_at = now() WHERE job_id = $1",
    )
    .await;
    run_kind(&app, "maintenance.cleanup_stuck_jobs").await;
    for id in [&stuck_started, &stuck_queued] {
        let j = lrj::get(&db, id).await.unwrap().unwrap();
        assert!(j.failed && j.finished);
        assert_eq!(
            j.result,
            Some(json!({"status": "failed", "error": "Job timed out after 24 hours"}))
        );
    }
    assert!(!lrj::get(&db, &fresh).await.unwrap().unwrap().finished);

    // Old: two finished 40+ days ago of one type; the newer is the baseline.
    let old = mk(JobType::GenerateTags, "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() - interval '41 days' WHERE job_id = $1").await;
    let baseline = mk(JobType::GenerateTags, "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() - interval '40 days' WHERE job_id = $1").await;
    run_kind(&app, "maintenance.cleanup_old_jobs").await;
    assert!(lrj::get(&db, &old).await.unwrap().is_none());
    assert!(lrj::get(&db, &baseline).await.unwrap().is_some());

    sqlx::query(
        "INSERT INTO refresh_token (jti, user_id, expires_at) VALUES \
         ('expired-jti', $1, now() - interval '1 day'), ('live-jti', $1, now() + interval '1 day')",
    )
    .bind(u.id)
    .execute(&db)
    .await
    .unwrap();
    run_kind(&app, "maintenance.prune_refresh_tokens").await;
    let left: Vec<String> =
        sqlx::query_scalar("SELECT jti FROM refresh_token WHERE user_id = $1 ORDER BY jti")
            .bind(u.id)
            .fetch_all(&db)
            .await
            .unwrap();
    assert_eq!(left, vec!["live-jti".to_string()]);

    let zip_dir = app.state.config.zip_dir();
    std::fs::create_dir_all(&zip_dir).unwrap();
    let stale = zip_dir.join("old.zip");
    let recent = zip_dir.join("new.zip");
    std::fs::write(&stale, b"x").unwrap();
    std::fs::write(&recent, b"x").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&stale)
        .unwrap()
        .set_modified(std::time::SystemTime::now() - Duration::from_secs(25 * 3600))
        .unwrap();
    run_kind(&app, "maintenance.zip_expiry").await;
    assert!(!stale.exists() && recent.exists());

    // Removed photos: one past the 30-day window goes, with its relations.
    let removed: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT id, image_hash FROM api_photo WHERE removed ORDER BY image_hash LIMIT 1",
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert!(!removed.is_empty(), "the fixture has a removed photo");
    let (gone, hash) = removed[0].clone();
    sqlx::query("UPDATE api_photo SET last_modified = now() - interval '31 days' WHERE id = $1")
        .bind(gone)
        .execute(&db)
        .await
        .unwrap();
    let thumbs = app.state.config.thumbnails_big_dir();
    std::fs::create_dir_all(&thumbs).unwrap();
    let thumb = thumbs.join(format!("{hash}.webp"));
    std::fs::write(&thumb, b"webp").unwrap();
    let recent_removed: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM api_photo WHERE removed AND last_modified > now() - interval '30 days'",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    run_kind(&app, "maintenance.cleanup_deleted_photos").await;
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM api_photo WHERE id = $1")
        .bind(gone)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(left, 0);
    let still: i64 = sqlx::query_scalar("SELECT count(*) FROM api_photo WHERE removed")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(still, recent_removed);
    let hash_still_used: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM api_photo WHERE image_hash = $1)")
            .bind(&hash)
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(thumb.exists(), hash_still_used);
    app.cleanup().await;
}

#[tokio::test]
async fn backoff_doubles_and_caps() {
    use lp_jobs::worker::backoff;
    let b = Duration::from_secs(5);
    assert_eq!(backoff(1, b), Duration::from_secs(5));
    assert_eq!(backoff(3, b), Duration::from_secs(20));
    assert_eq!(backoff(12, b), Duration::from_secs(600));
    let _: Option<Value> = None;
}

//! Job dependencies (`EnqueueOptions::after`, Django's `Chain`): a job waits
//! until every job it depends on has ended (done, failed, cancelled or
//! deleted), and is woken right after, without waiting for the backup poll.

#![allow(clippy::disallowed_methods)]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lp_jobs::{EnqueueOptions, HandlerRegistry, JobCtx, Worker, WorkerTiming};
use serde_json::json;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;

fn unique(kind: &str) -> String {
    format!(
        "test.{kind}.{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    )
}

async fn status(db: &PgPool, id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM job_queue WHERE id = $1")
        .bind(id)
        .fetch_one(db)
        .await
        .unwrap()
}

async fn wait_status(db: &PgPool, id: i64, want: &str) {
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(15) {
        if status(db, id).await == want {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("job {id} never reached {want}");
}

type Log = Arc<Mutex<Vec<(String, &'static str, Instant)>>>;

fn logging(reg: &mut HandlerRegistry, kind: &str, log: &Log, work: Duration, fail: bool) {
    let log = log.clone();
    let name = kind.to_string();
    reg.register(kind, move |_ctx: JobCtx| {
        let (log, name) = (log.clone(), name.clone());
        async move {
            log.lock()
                .unwrap()
                .push((name.clone(), "start", Instant::now()));
            tokio::time::sleep(work).await;
            log.lock()
                .unwrap()
                .push((name.clone(), "end", Instant::now()));
            if fail {
                anyhow::bail!("{name} failed");
            }
            Ok(())
        }
    });
}

fn at(log: &Log, kind: &str, what: &str) -> Instant {
    log.lock()
        .unwrap()
        .iter()
        .find(|(k, w, _)| k == kind && *w == what)
        .map(|(_, _, t)| *t)
        .unwrap_or_else(|| panic!("{kind} never logged {what}"))
}

#[tokio::test]
async fn dependents_wait_for_every_dependency_to_end() {
    let app = lp_testkit::TestApp::shared().await;
    let (a, b, c, d) = (unique("a"), unique("b"), unique("c"), unique("d"));
    let log: Log = Arc::default();
    let mut reg = HandlerRegistry::new();
    logging(&mut reg, &a, &log, Duration::from_millis(600), false);
    logging(&mut reg, &b, &log, Duration::from_millis(300), true);
    logging(&mut reg, &c, &log, Duration::from_millis(10), false);
    logging(&mut reg, &d, &log, Duration::from_millis(10), false);

    // Enqueue before the worker starts: with 4 free slots every job would
    // start at once if dependencies were ignored.
    let st = &app.state;
    let ja = lp_jobs::enqueue(st, &a, json!({}), EnqueueOptions::default())
        .await
        .unwrap();
    let jb = lp_jobs::enqueue(st, &b, json!({}), EnqueueOptions::default())
        .await
        .unwrap();
    // c waits on a (done) and b (failed); d on a job id that does not exist.
    let jc = lp_jobs::enqueue(
        st,
        &c,
        json!({}),
        EnqueueOptions::default().after(ja.id).after(jb.id),
    )
    .await
    .unwrap();
    let jd = lp_jobs::enqueue(st, &d, json!({}), EnqueueOptions::default().after(i64::MAX))
        .await
        .unwrap();

    let mut w = Worker::new(app.state.clone(), reg);
    w.concurrency = 4;
    // Only the dependency wake-up (or a NOTIFY) can start `c` in time.
    w.timing = WorkerTiming {
        poll: Duration::from_secs(30),
        heartbeat: Duration::from_millis(200),
        maintenance: Duration::from_secs(30),
        ..WorkerTiming::default()
    };
    w.schedules = Vec::new();
    w.supervise_sidecars = false;
    let stop = CancellationToken::new();
    let handle = tokio::spawn(w.run(stop.clone()));

    wait_status(app.pool(), jd.id, "done").await;
    wait_status(app.pool(), jc.id, "done").await;
    assert_eq!(status(app.pool(), ja.id).await, "done");
    assert_eq!(status(app.pool(), jb.id).await, "failed");
    let c_start = at(&log, &c, "start");
    assert!(c_start >= at(&log, &a, "end"), "c started before a ended");
    assert!(c_start >= at(&log, &b, "end"), "c started before b ended");
    assert!(
        c_start.duration_since(at(&log, &a, "end")) < Duration::from_secs(5),
        "c was not woken when its last dependency ended"
    );
    assert!(at(&log, &d, "start") < at(&log, &a, "end"), "d waited");

    stop.cancel();
    handle.await.unwrap().unwrap();
    app.cleanup().await;
}

#[tokio::test]
async fn cancelled_dependency_releases_and_claim_skips_waiting_rows() {
    let app = lp_testkit::TestApp::shared().await;
    let (a, b) = (unique("a"), unique("b"));
    let st = &app.state;
    let ja = lp_jobs::enqueue(st, &a, json!({}), EnqueueOptions::default())
        .await
        .unwrap();
    let jb = lp_jobs::enqueue(st, &b, json!({}), EnqueueOptions::default().after(ja.id))
        .await
        .unwrap();
    let kinds = vec![a.clone(), b.clone()];
    let mut conn = app.pool().acquire().await.unwrap();
    // b is older than nothing but still waits: the claim hands out a first.
    let first = lp_jobs::queue::claim_next(&mut conn, "t", &kinds)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first.id, ja.id);
    assert!(
        lp_jobs::queue::claim_next(&mut conn, "t", &kinds)
            .await
            .unwrap()
            .is_none(),
        "b is claimable while a runs"
    );
    sqlx::query("UPDATE job_queue SET status = 'cancelled' WHERE id = $1")
        .bind(ja.id)
        .execute(&mut *conn)
        .await
        .unwrap();
    let next = lp_jobs::queue::claim_next(&mut conn, "t", &kinds)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(next.id, jb.id);
    let deps: Vec<i64> = sqlx::query_scalar("SELECT depends_on FROM job_queue WHERE id = $1")
        .bind(jb.id)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(deps, vec![ja.id]);
    drop(conn);
    app.cleanup().await;
}

//! The scan's follow-up chain (`_queue_followup_jobs`): faces run after
//! the CLIP job has finished (Django's `Chain`), through the real worker,
//! with free slots and no backup poll to hide behind.

#![allow(clippy::disallowed_methods)]

use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use lp_db::db::DjList;
use lp_jobs::{HandlerRegistry, JobCtx, Worker, WorkerTiming};
use lp_testkit::TestApp;
use tokio_util::sync::CancellationToken;

type Row = (
    i64,
    String,
    DjList<i64>,
    String,
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
);

async fn rows(app: &TestApp) -> Vec<Row> {
    lp_db::sql::query_as(
        "SELECT id, kind, depends_on, status, started_at, finished_at FROM job_queue \
         WHERE kind IN ('repair.file_variants', 'tags.generate', 'geo.locate', 'clip.embed', \
           'faces.scan') ORDER BY id",
    )
    .fetch_all(app.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn faces_scan_waits_for_clip_embed() {
    let app = TestApp::new().await;
    let user = app.create_user("chain_user", "pw", false).await;
    let p = lp_ingest::Pipeline::new(app.state.clone());
    lp_ingest::scan::queue_followups(&p, user.id, false, false)
        .await
        .unwrap();

    let queued = rows(&app).await;
    let clip = queued.iter().find(|r| r.1 == "clip.embed").unwrap();
    let faces = queued.iter().find(|r| r.1 == "faces.scan").unwrap();
    assert_eq!(faces.2.0, vec![clip.0], "faces.scan depends on clip.embed");
    // With MobileCLIP-S2 serving tags and search (the default), the tagger
    // stores the embeddings and clip.embed only fills the gaps after it.
    let unified = app.state.ml().semantic_shares_tagger();
    let tags = queued.iter().find(|r| r.1 == "tags.generate").unwrap();
    if unified {
        assert_eq!(
            clip.2.0,
            vec![tags.0],
            "clip.embed depends on tags.generate"
        );
    }
    for r in queued
        .iter()
        .filter(|r| r.1 != "faces.scan" && !(unified && r.1 == "clip.embed"))
    {
        assert!(r.2.0.is_empty(), "{} has no dependency", r.1);
    }

    let mut reg = HandlerRegistry::new();
    for kind in [
        "repair.file_variants",
        "tags.generate",
        "geo.locate",
        "faces.scan",
    ] {
        reg.register(kind, |_ctx: JobCtx| async move { Ok(()) });
    }
    reg.register("clip.embed", |_ctx: JobCtx| async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        Ok(())
    });
    let mut w = Worker::new(app.state.clone(), reg);
    w.concurrency = 4;
    w.timing = WorkerTiming {
        poll: Duration::from_secs(30),
        ..WorkerTiming::default()
    };
    w.schedules = Vec::new();
    w.supervise_sidecars = false;
    let stop = CancellationToken::new();
    let handle = tokio::spawn(w.run(stop.clone()));

    let t = Instant::now();
    loop {
        let r = rows(&app).await;
        if r.iter().all(|r| r.3 == "done") {
            break;
        }
        assert!(t.elapsed() < Duration::from_secs(20), "chain stuck: {r:?}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let done = rows(&app).await;
    let clip = done.iter().find(|r| r.1 == "clip.embed").unwrap();
    let faces = done.iter().find(|r| r.1 == "faces.scan").unwrap();
    let clip_end = clip.5.unwrap();
    let faces_start = faces.4.unwrap();
    assert!(
        faces_start >= clip_end,
        "faces started before CLIP finished"
    );
    assert!(
        faces_start - clip_end < chrono::Duration::seconds(3),
        "faces were not woken when CLIP finished ({:?})",
        faces_start - clip_end
    );
    stop.cancel();
    handle.await.unwrap().unwrap();
    app.cleanup().await;
}

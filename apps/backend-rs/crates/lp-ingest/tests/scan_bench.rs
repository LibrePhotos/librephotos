//! Scan every user of an existing database with the Rust pipeline and print
//! the timing, for the parity diff and benchmark in
//! `apps/backend-rs/tests/ingest/scan_diff.sh`. Ignored unless run by name:
//!
//! ```text
//! LP_SCAN_DB=<db> LP_SCAN_BASE_DATA=<dir> [LP_SCAN_CONCURRENCY=12] \
//!   LP_EXIFTOOL=... LP_FFMPEG=... LP_FFPROBE=... LP_VIPS_LIB=... LP_PYTHON=... \
//!   cargo test -p lp-ingest --test scan_bench -- --ignored --nocapture
//! ```

#![allow(clippy::disallowed_methods)]

use std::collections::HashMap;
use std::time::Instant;

use lp_core::{AppState, Config};
use lp_ingest::Pipeline;
use lp_ingest::scan::{self, ScanOptions};

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore]
async fn scan_database() {
    let db = env("LP_SCAN_DB").expect("LP_SCAN_DB");
    let base = env("LP_SCAN_BASE_DATA").expect("LP_SCAN_BASE_DATA");
    let mut vars: HashMap<String, String> = HashMap::new();
    let mut set = |k: &str, v: String| {
        vars.insert(k.to_string(), v);
    };
    set("BASE_DATA", base.clone());
    set("BASE_LOGS", format!("{base}/logs"));
    set("SECRET_KEY", "rust-bench-secret".into());
    set("DB_NAME", db.clone());
    set(
        "DB_HOST",
        env("LP_TEST_PG_HOST").unwrap_or_else(|| "localhost".into()),
    );
    set(
        "DB_PORT",
        env("LP_TEST_PG_PORT").unwrap_or_else(|| "5433".into()),
    );
    set("DB_USER", "postgres".into());
    set("DB_PASS", "x".into());
    set("LP_DB_POOL", "24".into());
    set(
        "WORKER_CONCURRENCY",
        env("LP_SCAN_CONCURRENCY").unwrap_or_else(|| "12".into()),
    );
    for k in [
        "LP_EXIFTOOL",
        "LP_FFMPEG",
        "LP_FFPROBE",
        "LP_VIPS_LIB",
        "LP_PYTHON",
        "LP_EXIF_POOL",
    ] {
        if let Some(v) = env(k) {
            set(k, v);
        }
    }
    for k in [
        "FEATURE_FACE_DETECTION",
        "FEATURE_FACE_CLUSTER",
        "FEATURE_IMAGE_CAPTIONING",
        "FEATURE_REVERSE_GEOCODING",
        "FEATURE_SCENE_CLASSIFICATION",
    ] {
        set(k, "0".into());
    }
    std::fs::create_dir_all(format!("{base}/logs")).ok();
    let config = Config::from_map(&vars).expect("config");
    let pool = lp_db::connect(&config).await.expect("connect");
    let tracked: Option<String> =
        lp_db::sql::query_scalar("SELECT to_regclass('public._sqlx_migrations')::text")
            .fetch_one(&pool)
            .await
            .unwrap();
    if tracked.is_none() {
        lp_db::adopt::adopt(&pool, true).await.expect("adopt");
    }
    let settings = lp_db::settings::load(&pool, &config).await.unwrap();
    let state = AppState::new(pool.clone(), config, settings).unwrap();
    let pipeline = Pipeline::new(state.clone());

    let users: Vec<(i32, String)> = lp_db::sql::query_as(
        "SELECT id, username FROM api_user WHERE scan_directory <> '' ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let total = Instant::now();
    let mut report = Vec::new();
    for (id, name) in users {
        let job = uuid::Uuid::new_v4().to_string();
        let t = Instant::now();
        if env("LP_SCAN_MISSING").is_some() {
            // The missing-file check and delete_missing_photos instead of a scan.
            lp_ingest::repair::scan_missing_photos(&pipeline, id, &job)
                .await
                .expect("scan missing");
            let del = uuid::Uuid::new_v4().to_string();
            lp_ingest::repair::delete_missing_photos(&pipeline, id, &del)
                .await
                .expect("delete missing");
            report.push(serde_json::json!({"user": name, "seconds": t.elapsed().as_secs_f64()}));
            continue;
        }
        scan::scan_user(
            &pipeline,
            id,
            &job,
            ScanOptions {
                skip_followups: true,
                ..Default::default()
            },
        )
        .await
        .expect("scan");
        let (target, result): (i32, Option<serde_json::Value>) = lp_db::sql::query_as(
            "SELECT progress_target, result FROM api_longrunningjob WHERE job_id = $1",
        )
        .bind(&job)
        .fetch_one(&pool)
        .await
        .unwrap();
        report.push(serde_json::json!({
            "user": name, "groups": target, "seconds": t.elapsed().as_secs_f64(), "result": result,
        }));
    }
    let files: i64 = lp_db::sql::query_scalar("SELECT count(*) FROM api_file")
        .fetch_one(&pool)
        .await
        .unwrap();
    let secs = total.elapsed().as_secs_f64();
    println!(
        "SCAN_REPORT {}",
        serde_json::json!({"users": report, "files": files, "seconds": secs,
                           "files_per_second": files as f64 / secs})
    );
    state.exif.shutdown().await;
}

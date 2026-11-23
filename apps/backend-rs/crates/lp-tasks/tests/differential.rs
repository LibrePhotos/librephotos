//! The Rust side of a tasks differential run (tests/tasks/README.md): run
//! one job on an existing fixture clone, with the sidecars at the shared
//! Python mock and (for clustering) the real face_cluster sidecar.
//!
//! ```text
//! LP_DIFF_DB=rs_tasks_x_rs LP_DIFF_BASE_DATA=C:/.../x_rs LP_DIFF_JOB=tags.generate \
//! LP_DIFF_USER=alice LP_DIFF_MOCK=http://127.0.0.1:18120 \
//! [LP_DIFF_FACE_CLUSTER=http://127.0.0.1:18121] [LP_DIFF_PHOTO=<uuid>] [LP_DIFF_FULL=0] \
//!   cargo test -p lp-tasks --test differential -- --ignored --nocapture
//! ```

#![allow(clippy::disallowed_methods)]

mod common;

use lp_jobs::EnqueueOptions;
use lp_sidecars::Sidecar;
use lp_testkit::TestApp;
use serde_json::json;

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}

#[tokio::test]
#[ignore = "driven by tests/tasks/run_diff.sh"]
async fn run_one_job_on_a_clone() {
    let db_name = env("LP_DIFF_DB").expect("LP_DIFF_DB");
    let base_data = env("LP_DIFF_BASE_DATA").expect("LP_DIFF_BASE_DATA");
    let kind = env("LP_DIFF_JOB").expect("LP_DIFF_JOB");
    let username = env("LP_DIFF_USER").unwrap_or_else(|| "alice".into());
    let mock = env("LP_DIFF_MOCK").expect("LP_DIFF_MOCK");
    let full = env("LP_DIFF_FULL").is_none_or(|v| v != "0");

    let adopt_pool = lp_testkit::TestDb::existing(&db_name).await;
    lp_db::adopt::adopt(&adopt_pool.pool, true)
        .await
        .expect("adopt");
    adopt_pool.cleanup().await;

    let photos = format!("{base_data}/data");
    let mut vars: Vec<(String, String)> = common::feature_env()
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    vars.push(("BASE_DATA".into(), base_data.clone()));
    vars.push(("PHOTOS".into(), photos));
    vars.push(("SECRET_KEY".into(), "rust-bench-secret".into()));
    let pairs: Vec<(&str, &str)> = vars.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let app = TestApp::attach(&db_name, &pairs).await;
    let mut state = app.state.clone();
    let mut sidecars = state.sidecars.clone();
    for s in Sidecar::ALL {
        sidecars = sidecars.with_base(s, &mock);
    }
    if let Some(fc) = env("LP_DIFF_FACE_CLUSTER") {
        sidecars = sidecars.with_base(Sidecar::FaceCluster, fc);
    }
    state.sidecars = sidecars;
    lp_tasks::geocode::providers::set_base_url(lp_tasks::geocode::Provider::Nominatim, &mock);
    if let Some(settings) = env("LP_DIFF_SETTINGS") {
        let pairs: Vec<(String, serde_json::Value)> = settings
            .split(';')
            .filter_map(|kv| kv.split_once('='))
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect();
        let refs: Vec<(&str, serde_json::Value)> =
            pairs.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
        lp_db::write::settings::save(&state, &refs)
            .await
            .expect("settings");
    }

    let user = common::user_id(&state.db, &username).await;
    let payload = match kind.as_str() {
        "captions.generate" => json!({"photo_id": env("LP_DIFF_PHOTO").expect("LP_DIFF_PHOTO")}),
        _ => json!({"user_id": user, "full_scan": full}),
    };
    let started = std::time::Instant::now();
    let (res, lrj) = common::run_job(&state, &kind, payload, EnqueueOptions::default()).await;
    res.expect("job");
    // What Django runs inline after these.
    if matches!(kind.as_str(), "faces.scan" | "faces.cluster") {
        while let Some(r) = common::run_queued(&state, "faces.train").await {
            r.expect("faces.train");
        }
    }
    println!(
        "rust {kind} for {username} done in {:.2}s (lrj {lrj:?})",
        started.elapsed().as_secs_f64()
    );
    app.cleanup().await;
}

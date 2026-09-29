//! Glue between `AppState` and the sidecar supervisor (`lp_sidecars::supervisor`).

use std::collections::HashMap;

use lp_core::AppState;
use lp_sidecars::supervisor::{self, SupervisorConfig};
use tokio_util::sync::CancellationToken;

/// The supervisor's view of the configuration and live site settings.
pub fn supervisor_config(state: &AppState) -> SupervisorConfig {
    let c = &state.config;
    let f = &c.features;
    let flags = HashMap::from([
        ("FEATURE_FACE_DETECTION", f.face_detection),
        ("FEATURE_IMAGE_CAPTIONING", f.image_captioning),
        ("FEATURE_SCENE_CLASSIFICATION", f.scene_classification),
        ("FEATURE_FACE_CLUSTER", f.face_cluster),
    ]);
    let mut env = vec![
        ("BASE_DATA".to_string(), c.base_data.display().to_string()),
        ("BASE_LOGS".to_string(), c.base_logs.display().to_string()),
        ("LOG_LEVEL".to_string(), c.log_level.to_uppercase()),
    ];
    if let Some(p) = &c.onnx_providers {
        env.push(("ONNX_PROVIDERS".into(), p.clone()));
    }
    SupervisorConfig {
        python: c.binaries.python.clone(),
        backend_dir: supervisor::default_backend_dir(),
        host: "127.0.0.1".into(),
        env,
        flags,
        ocr_model_selected: supervisor::model_selected(&state.settings().ocr_model),
    }
}

/// Whether this process supervises the sidecars (`LP_SUPERVISE_SIDECARS`).
/// Off by default: sidecar ports are fixed and shared machine-wide.
pub fn supervise_enabled() -> bool {
    std::env::var("LP_SUPERVISE_SIDECARS")
        .map(|v| {
            matches!(
                v.trim().to_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

/// The sidecar watchdog task, run next to the worker loop.
pub async fn watchdog(state: AppState, shutdown: CancellationToken) {
    let http = state.http.clone();
    supervisor::global()
        .watchdog(http, || supervisor_config(&state), shutdown)
        .await;
}

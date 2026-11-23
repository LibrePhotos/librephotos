//! `ServiceViewSet` (`/api/services/`, staff only): the sidecar list, a
//! health probe per sidecar (polled every 15 s) and start/stop.
//!
//! Every ML service is served in-process by default and has no process: it
//! is healthy when enabled, its status adds `mode`, `configured`
//! (`LP_ML_<SERVICE>`), `ready` (its model is on disk), `model_loaded`,
//! `busy`, `last_used` (unix seconds) and the loaded `models`; start is a
//! no-op (models load on first use) and stop unloads its models. A service
//! opted into its Python sidecar (`LP_ML_<SERVICE>=sidecar`) reports
//! `mode: "sidecar"` and is probed.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use indexmap::IndexMap;
use lp_auth::AdminUser;
use lp_core::{ApiResult, AppState};
use lp_jobs::services::supervisor_config;
use lp_sidecars::supervisor::{self, SupervisorConfig};
use serde_json::json;

fn reply(status: StatusCode, body: serde_json::Value) -> Response {
    (status, Json(body)).into_response()
}

fn not_found(name: &str) -> Response {
    reply(
        StatusCode::NOT_FOUND,
        json!({"error": format!("Service {name} not found")}),
    )
}

fn known(cfg: &SupervisorConfig, name: &str) -> bool {
    cfg.spec(name).is_some()
}

pub async fn list(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Response> {
    let cfg = supervisor_config(&state);
    let services: IndexMap<&str, u16> = cfg.services().iter().map(|s| (s.name, s.port)).collect();
    Ok(Json(json!({ "services": services })).into_response())
}

/// A switched-off sidecar is not probed (nothing listens there).
pub async fn status(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> ApiResult<Response> {
    let cfg = supervisor_config(&state);
    let Some(spec) = cfg.spec(&name) else {
        return Ok(not_found(&name));
    };
    let enabled = cfg.is_enabled(&name);
    if cfg.is_in_process(&name)
        && let Some(service) = lp_ml::Service::from_name(&name)
    {
        let st = state.ml().status(service);
        return Ok(Json(json!({
            "service_name": name,
            "healthy": enabled,
            "enabled": enabled,
            "feature_flag": spec.feature_flag,
            "mode": st.mode,
            "configured": st.configured,
            "ready": st.ready,
            "model_loaded": st.model_loaded,
            "busy": st.busy,
            "last_used": st.last_used,
            "models": st.models,
        }))
        .into_response());
    }
    let healthy = enabled
        && supervisor::global()
            .is_healthy(&state.http, &cfg, &name)
            .await;
    Ok(Json(json!({
        "service_name": name,
        "healthy": healthy,
        "enabled": enabled,
        "feature_flag": spec.feature_flag,
        "mode": "sidecar",
    }))
    .into_response())
}

pub async fn start(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> ApiResult<Response> {
    let cfg = supervisor_config(&state);
    let Some(spec) = cfg.spec(&name) else {
        return Ok(not_found(&name));
    };
    if !cfg.is_enabled(&name) {
        return Ok(reply(
            StatusCode::CONFLICT,
            json!({
                "error": format!("Service {name} is not started: {}", cfg.disabled_reason(&name)),
                "feature_flag": spec.feature_flag,
            }),
        ));
    }
    Ok(if supervisor::global().start(&cfg, &name) {
        reply(
            StatusCode::OK,
            json!({"message": format!("Service {name} started successfully")}),
        )
    } else {
        reply(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error": format!("Failed to start service {name}")}),
        )
    })
}

/// Only a sidecar this process started can be stopped (Django killed every
/// process whose command line looked like one).
pub async fn stop(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(name): Path<String>,
) -> ApiResult<Response> {
    let cfg = supervisor_config(&state);
    if !known(&cfg, &name) {
        return Ok(not_found(&name));
    }
    if cfg.is_in_process(&name)
        && let Some(service) = lp_ml::Service::from_name(&name)
    {
        state.ml.unload(service);
        return Ok(reply(
            StatusCode::OK,
            json!({"message": format!("Service {name} stopped successfully")}),
        ));
    }
    Ok(if supervisor::global().stop(&name).await {
        reply(
            StatusCode::OK,
            json!({"message": format!("Service {name} stopped successfully")}),
        )
    } else {
        reply(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error": format!("Failed to stop service {name}")}),
        )
    })
}

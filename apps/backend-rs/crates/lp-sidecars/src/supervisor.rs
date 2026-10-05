//! Sidecar process supervisor (04 §4), the port of `api/services.py`:
//! start the enabled sidecars as `python service/<name>/main.py`, probe
//! `/health`, restart dead ones, ask idle ones to unload their model.
//!
//! Unlike Django, which stops every process whose command line looks like a
//! sidecar, only processes this supervisor started are ever stopped.

use lp_proc::NoWindow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

/// A sidecar the services page lists (`api.sidecars.SERVICES` minus the
/// exif sidecar, which is in-process now).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceSpec {
    pub name: &'static str,
    pub port: u16,
    /// `SERVICE_FEATURE_FLAGS`; None = core, always on.
    pub feature_flag: Option<&'static str>,
}

pub const SERVICES: &[ServiceSpec] = &[
    ServiceSpec {
        name: "image_similarity",
        port: 8002,
        feature_flag: None,
    },
    ServiceSpec {
        name: "thumbnail",
        port: 8003,
        feature_flag: None,
    },
    ServiceSpec {
        name: "face_recognition",
        port: 8005,
        feature_flag: Some("FEATURE_FACE_DETECTION"),
    },
    ServiceSpec {
        name: "clip_embeddings",
        port: 8006,
        feature_flag: None,
    },
    ServiceSpec {
        name: "image_captioning",
        port: 8007,
        feature_flag: Some("FEATURE_IMAGE_CAPTIONING"),
    },
    ServiceSpec {
        name: "tags",
        port: 8011,
        feature_flag: Some("FEATURE_SCENE_CLASSIFICATION"),
    },
    ServiceSpec {
        name: "ocr",
        port: 8012,
        feature_flag: None,
    },
    ServiceSpec {
        name: "face_cluster",
        port: 8013,
        feature_flag: Some("FEATURE_FACE_CLUSTER"),
    },
];

/// A sidecar with a model loaded and no request for this long is asked to unload it.
pub const IDLE_UNLOAD: Duration = Duration::from_secs(120);
/// Watchdog period (`check_services` ran every minute).
pub const CHECK_EVERY: Duration = Duration::from_secs(60);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const UNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// Everything the supervisor needs from the process configuration and the
/// live site settings; rebuilt by the caller for every check.
#[derive(Debug, Clone)]
pub struct SupervisorConfig {
    pub python: PathBuf,
    /// `apps/backend`: holds `service/<name>/main.py` and `image_similarity/`.
    pub backend_dir: PathBuf,
    pub host: String,
    /// Extra environment for the children (`BASE_DATA`, `BASE_LOGS`, `LOG_LEVEL`, ...).
    pub env: Vec<(String, String)>,
    /// Feature flag name -> value (`FEATURE_*`).
    pub flags: HashMap<&'static str, bool>,
    /// OCR is switched by the `OCR_MODEL` site setting, not a flag.
    pub ocr_model_selected: bool,
    /// Services `lp-ml` serves in-process right now: never started or
    /// restarted as a Python process.
    pub in_process: Vec<&'static str>,
}

impl SupervisorConfig {
    /// Sidecars whose script exists in this checkout.
    pub fn services(&self) -> Vec<ServiceSpec> {
        SERVICES
            .iter()
            .copied()
            .filter(|s| s.name != "face_cluster" || self.script(s.name).exists())
            .collect()
    }

    pub fn spec(&self, name: &str) -> Option<ServiceSpec> {
        self.services().into_iter().find(|s| s.name == name)
    }

    pub fn script(&self, name: &str) -> PathBuf {
        if name == "image_similarity" {
            return self.backend_dir.join("image_similarity").join("main.py");
        }
        let script = self.backend_dir.join("service").join(name).join("main.py");
        if name == "face_cluster" && !script.exists() {
            // Only the Rust port has it: apps/backend-rs/sidecars/face_cluster.
            if let Some(apps) = self.backend_dir.parent() {
                return apps
                    .join("backend-rs")
                    .join("sidecars")
                    .join(name)
                    .join("main.py");
            }
        }
        script
    }

    fn flag_on(&self, flag: Option<&str>) -> bool {
        flag.is_none_or(|f| self.flags.get(f).copied().unwrap_or(true))
    }

    /// `is_service_enabled`.
    pub fn is_enabled(&self, name: &str) -> bool {
        if name == "ocr" && !self.ocr_model_selected {
            return false;
        }
        match self.spec(name) {
            Some(s) => self.flag_on(s.feature_flag),
            None => false,
        }
    }

    /// `disabled_reason`.
    pub fn disabled_reason(&self, name: &str) -> String {
        match self.spec(name).and_then(|s| s.feature_flag) {
            Some(flag) if !self.flag_on(Some(flag)) => format!("{flag} is disabled"),
            _ => "no model is selected for it in the site settings".into(),
        }
    }

    pub fn is_in_process(&self, name: &str) -> bool {
        self.in_process.contains(&name)
    }

    fn url(&self, spec: ServiceSpec, path: &str) -> String {
        format!("http://{}:{}{}", self.host, spec.port, path)
    }
}

/// `ml_models._is_model_not_selected`, inverted.
pub fn model_selected(value: &str) -> bool {
    let v = value.trim();
    !v.is_empty() && !v.eq_ignore_ascii_case("none")
}

#[derive(Default)]
pub struct Supervisor {
    children: Mutex<HashMap<String, Child>>,
    last_health: Mutex<HashMap<String, Value>>,
}

/// The process-wide supervisor (the API and the watchdog share it).
pub fn global() -> &'static Supervisor {
    static SUP: OnceLock<Supervisor> = OnceLock::new();
    SUP.get_or_init(Supervisor::default)
}

impl Supervisor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a process this supervisor started for `name` is still alive.
    pub fn is_running(&self, name: &str) -> bool {
        let mut children = self.children.lock().expect("supervisor lock");
        match children.get_mut(name) {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                _ => {
                    children.remove(name);
                    false
                }
            },
            None => false,
        }
    }

    pub fn pid(&self, name: &str) -> Option<u32> {
        self.children
            .lock()
            .expect("supervisor lock")
            .get(name)
            .and_then(|c| c.id())
    }

    /// `start_service`: false when disabled, unknown or the spawn failed.
    /// A sidecar this supervisor already runs is not started twice.
    pub fn start(&self, cfg: &SupervisorConfig, name: &str) -> bool {
        if !cfg.is_enabled(name) {
            tracing::info!(
                service = name,
                reason = cfg.disabled_reason(name),
                "service not started"
            );
            return false;
        }
        if cfg.is_in_process(name) {
            tracing::debug!(service = name, "served in-process; no sidecar started");
            return true;
        }
        if self.is_running(name) {
            return true;
        }
        let script = cfg.script(name);
        let mut cmd = Command::new(&cfg.python);
        cmd.no_window()
            .arg(&script)
            .current_dir(&cfg.backend_dir)
            .stdin(std::process::Stdio::null())
            .kill_on_drop(false);
        let pythonpath = match std::env::var_os("PYTHONPATH") {
            Some(existing) => {
                let mut paths = vec![cfg.backend_dir.clone()];
                paths.extend(std::env::split_paths(&existing));
                std::env::join_paths(paths).unwrap_or_else(|_| cfg.backend_dir.clone().into())
            }
            None => cfg.backend_dir.clone().into(),
        };
        cmd.env("PYTHONPATH", pythonpath);
        for (k, v) in &cfg.env {
            cmd.env(k, v);
        }
        match cmd.spawn() {
            Ok(child) => {
                tracing::info!(service = name, pid = ?child.id(), "service started");
                self.children
                    .lock()
                    .expect("supervisor lock")
                    .insert(name.to_string(), child);
                true
            }
            Err(e) => {
                tracing::error!(service = name, script = %script.display(), error = %e, "service start failed");
                false
            }
        }
    }

    /// `stop_service`: true when a running process was stopped.
    pub async fn stop(&self, name: &str) -> bool {
        let child = self.children.lock().expect("supervisor lock").remove(name);
        self.last_health
            .lock()
            .expect("supervisor lock")
            .remove(name);
        let Some(mut child) = child else {
            tracing::warn!(service = name, "service is not running");
            return false;
        };
        if !matches!(child.try_wait(), Ok(None)) {
            return false;
        }
        if let Err(e) = child.start_kill() {
            tracing::error!(service = name, error = %e, "failed to stop service");
            return false;
        }
        let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
        tracing::info!(service = name, "service stopped");
        true
    }

    /// Stop everything this supervisor started (shutdown).
    pub async fn stop_all(&self) {
        let names: Vec<String> = self
            .children
            .lock()
            .expect("supervisor lock")
            .keys()
            .cloned()
            .collect();
        for n in names {
            self.stop(&n).await;
        }
    }

    /// `is_healthy`: `/health` answers 200. A probe that fails while our
    /// process is still alive means "busy", not dead (the sidecars serve one
    /// request at a time).
    pub async fn is_healthy(
        &self,
        http: &reqwest::Client,
        cfg: &SupervisorConfig,
        name: &str,
    ) -> bool {
        self.last_health
            .lock()
            .expect("supervisor lock")
            .remove(name);
        let Some(spec) = cfg.spec(name) else {
            return false;
        };
        match http
            .get(cfg.url(spec, "/health"))
            .timeout(HEALTH_TIMEOUT)
            .send()
            .await
        {
            Ok(res) if res.status().as_u16() == 200 => {
                if let Ok(body) = res.json::<Value>().await
                    && body.is_object()
                {
                    self.last_health
                        .lock()
                        .expect("supervisor lock")
                        .insert(name.to_string(), body);
                }
                true
            }
            Ok(_) => false,
            Err(_) => self.is_running(name),
        }
    }

    /// `unload_idle_model`, from the `/health` body `is_healthy` just read.
    pub async fn unload_idle(
        &self,
        http: &reqwest::Client,
        cfg: &SupervisorConfig,
        name: &str,
    ) -> bool {
        let health = self
            .last_health
            .lock()
            .expect("supervisor lock")
            .remove(name)
            .unwrap_or(Value::Null);
        if health.get("model_loaded") != Some(&Value::Bool(true)) {
            return false;
        }
        if health.get("busy").and_then(Value::as_bool).unwrap_or(false) {
            return false;
        }
        let Some(last) = health.get("last_request_time").and_then(Value::as_f64) else {
            return false;
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        if now - last < IDLE_UNLOAD.as_secs_f64() {
            return false;
        }
        let Some(spec) = cfg.spec(name) else {
            return false;
        };
        match http
            .get(cfg.url(spec, "/unload-model"))
            .timeout(UNLOAD_TIMEOUT)
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => {
                tracing::info!(service = name, "idle service unloaded its model");
                true
            }
            // 409: a request is in flight; try again next round.
            Ok(_) => false,
            Err(e) => {
                tracing::warn!(service = name, error = %e, "could not unload model");
                false
            }
        }
    }

    /// `check_services`: restart unhealthy enabled sidecars, unload idle ones.
    pub async fn check(&self, http: &reqwest::Client, cfg: &SupervisorConfig) {
        for spec in cfg.services() {
            if !cfg.is_enabled(spec.name) || cfg.is_in_process(spec.name) {
                continue;
            }
            if !self.is_healthy(http, cfg, spec.name).await {
                self.stop(spec.name).await;
                tracing::info!(service = spec.name, "restarting service");
                self.start(cfg, spec.name);
            } else {
                self.unload_idle(http, cfg, spec.name).await;
            }
        }
    }

    /// Start every enabled sidecar, then check them every [`CHECK_EVERY`]
    /// until `shutdown`, then stop them.
    pub async fn watchdog<F>(&self, http: reqwest::Client, config: F, shutdown: CancellationToken)
    where
        F: Fn() -> SupervisorConfig,
    {
        let cfg = config();
        for spec in cfg.services() {
            if cfg.is_enabled(spec.name) && !cfg.is_in_process(spec.name) {
                self.start(&cfg, spec.name);
            }
        }
        loop {
            tokio::select! {
                _ = shutdown.cancelled() => break,
                _ = tokio::time::sleep(CHECK_EVERY) => {}
            }
            self.check(&http, &config()).await;
        }
        self.stop_all().await;
    }
}

/// Default `apps/backend` of this checkout (override with `LP_BACKEND_DIR`).
pub fn default_backend_dir() -> PathBuf {
    std::env::var_os("LP_BACKEND_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("..")
                .join("..")
                .join("backend")
        })
}

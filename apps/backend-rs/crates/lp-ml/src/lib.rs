//! In-process ML: ONNX Runtime models that replace the Python sidecars, the
//! model store (`api/ml_models.py`), and the switch between the two.
//!
//! Every sidecar capability is a trait in `lp_ml::<service>` (e.g.
//! [`clip::ClipApi`]) with two implementations: the HTTP client
//! ([`lp_sidecars::Sidecars`]) and `lp_ml::<service>::InProcess`. Callers go
//! through [`MlView`] (`state.ml()` in `lp-core`), which picks one per call:
//!
//! `LP_ML_<SERVICE>` = `inprocess` | `sidecar` | `auto` (default). `auto`
//! runs in-process when that implementation is done
//! (`InProcess::IMPLEMENTED`), the sidecar's URL was not redirected
//! (`LP_SIDECAR_<NAME>_URL`, or a test's mock), and the model files are on
//! disk; otherwise the sidecar. `<SERVICE>` is one of `CLIP`, `SIMILARITY`,
//! `TAGS`, `OCR`, `FACE`, `CAPTION`, `FACE_CLUSTER`, `RAW_THUMBNAIL`.
//!
//! In-process errors reuse [`SidecarError`] so callers keep one error path:
//! bad input is a 400 `Status`, a failed inference a 500 `Status` (what the
//! sidecar would have answered), a missing model or runtime `Unreachable`.

pub mod golden;
pub mod models;
pub mod preprocess;
pub mod runtime;
pub mod slot;
pub mod tokenize;

pub mod caption;
pub mod clip;
pub mod face;
pub mod face_cluster;
pub mod ocr;
pub mod raw_thumbnail;
pub mod similarity;
pub mod tags;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, UNIX_EPOCH};

pub use lp_sidecars::SidecarError;
use lp_sidecars::{Sidecar, Sidecars};
use serde::Serialize;

pub use models::Selection;
pub use slot::{ModelSlot, Registry, SlotInfo};

/// An ML capability that exists both as a sidecar and in-process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Service {
    Clip,
    Similarity,
    Tags,
    Ocr,
    Face,
    Caption,
    FaceCluster,
    RawThumbnail,
}

impl Service {
    pub const ALL: [Service; 8] = [
        Service::Clip,
        Service::Similarity,
        Service::Tags,
        Service::Ocr,
        Service::Face,
        Service::Caption,
        Service::FaceCluster,
        Service::RawThumbnail,
    ];

    pub fn sidecar(self) -> Sidecar {
        match self {
            Service::Clip => Sidecar::Clip,
            Service::Similarity => Sidecar::Similarity,
            Service::Tags => Sidecar::Tags,
            Service::Ocr => Sidecar::Ocr,
            Service::Face => Sidecar::Face,
            Service::Caption => Sidecar::Caption,
            Service::FaceCluster => Sidecar::FaceCluster,
            Service::RawThumbnail => Sidecar::Thumbnail,
        }
    }

    /// The sidecar's service name (`/api/services`), e.g. `clip_embeddings`.
    pub fn name(self) -> &'static str {
        self.sidecar().name()
    }

    pub fn from_name(name: &str) -> Option<Service> {
        Service::ALL.into_iter().find(|s| s.name() == name)
    }

    /// `<SERVICE>` in `LP_ML_<SERVICE>`.
    pub fn env_key(self) -> &'static str {
        match self {
            Service::Clip => "CLIP",
            Service::Similarity => "SIMILARITY",
            Service::Tags => "TAGS",
            Service::Ocr => "OCR",
            Service::Face => "FACE",
            Service::Caption => "CAPTION",
            Service::FaceCluster => "FACE_CLUSTER",
            Service::RawThumbnail => "RAW_THUMBNAIL",
        }
    }

    /// The `inprocess:` pseudo-URL errors carry.
    pub fn url(self) -> String {
        format!("inprocess:{}", self.name())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// In-process when implemented, not redirected and the model is present.
    Auto,
    InProcess,
    Sidecar,
}

impl Mode {
    pub fn parse(v: &str) -> Option<Mode> {
        match v.trim().to_ascii_lowercase().as_str() {
            "" | "auto" => Some(Mode::Auto),
            "inprocess" | "in-process" | "in_process" | "rust" => Some(Mode::InProcess),
            "sidecar" | "python" | "http" => Some(Mode::Sidecar),
            _ => None,
        }
    }
}

/// Process-level ML settings (from the environment, see [`MlConfig::from_env`]).
#[derive(Debug, Clone)]
pub struct MlConfig {
    /// `MEDIA_ROOT` (`$BASE_DATA/protected_media`).
    pub media_root: PathBuf,
    /// `MEDIA_ROOT/data_models`.
    pub data_models: PathBuf,
    pub runtime: runtime::RuntimeConfig,
    /// `LP_ML_IDLE_UNLOAD_SECS` (120, the sidecar watchdog's threshold).
    pub idle_unload: Duration,
    /// How often the reaper looks for idle models.
    pub reaper_period: Duration,
    /// `LP_ML_<SERVICE>`.
    pub modes: HashMap<Service, Mode>,
    /// `LP_ML_<SERVICE>_CONCURRENCY` (default 1): parallel calls, and so
    /// loaded copies, per model.
    pub concurrency: HashMap<Service, usize>,
    /// `LP_ML_AUTO_DOWNLOAD` (default on): queue `models.download` where
    /// Django chains `download_models` (scans, face jobs, settings, captions).
    pub auto_download: bool,
}

impl MlConfig {
    pub fn new(media_root: PathBuf) -> Self {
        MlConfig {
            data_models: media_root.join("data_models"),
            media_root,
            runtime: runtime::RuntimeConfig::default(),
            idle_unload: Duration::from_secs(120),
            reaper_period: Duration::from_secs(10),
            modes: HashMap::new(),
            concurrency: HashMap::new(),
            auto_download: true,
        }
    }

    pub fn from_env(media_root: PathBuf) -> Self {
        let mut c = MlConfig::new(media_root);
        c.runtime = runtime::RuntimeConfig::from_env();
        if let Some(v) = env("LP_ML_AUTO_DOWNLOAD") {
            c.auto_download = !matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            );
        }
        if let Some(secs) = env("LP_ML_IDLE_UNLOAD_SECS").and_then(|v| v.parse::<u64>().ok()) {
            c.idle_unload = Duration::from_secs(secs);
            c.reaper_period = c.reaper_period.min(Duration::from_secs(secs.max(1)));
        }
        for s in Service::ALL {
            if let Some(v) = env(&format!("LP_ML_{}", s.env_key())) {
                match Mode::parse(&v) {
                    Some(m) => {
                        c.modes.insert(s, m);
                    }
                    None => {
                        tracing::warn!(service = s.name(), value = %v, "unknown LP_ML_* mode, using auto")
                    }
                }
            }
            if let Some(n) = env(&format!("LP_ML_{}_CONCURRENCY", s.env_key()))
                .and_then(|v| v.parse::<usize>().ok())
                .filter(|n| *n > 0)
            {
                c.concurrency.insert(s, n);
            }
        }
        c
    }
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.trim().is_empty())
}

/// Reads the live model selection (site settings) on demand.
pub type Selector = Arc<dyn Fn() -> Selection + Send + Sync>;

/// What an in-process implementation gets: configuration, the slot
/// registry and the live model selection.
pub struct MlContext {
    pub config: MlConfig,
    pub registry: Arc<Registry>,
    selector: Selector,
}

impl MlContext {
    pub fn data_models(&self) -> &Path {
        &self.config.data_models
    }

    pub fn media_root(&self) -> &Path {
        &self.config.media_root
    }

    /// The site settings' current model choices.
    pub fn selection(&self) -> Selection {
        (self.selector)()
    }

    pub fn concurrency(&self, s: Service) -> usize {
        self.config.concurrency.get(&s).copied().unwrap_or(1)
    }

    /// A new registered [`ModelSlot`] for `service` (call once, at `InProcess::new`).
    pub fn slot<T: Send + 'static>(&self, service: Service, label: &str) -> ModelSlot<T> {
        ModelSlot::new(&self.registry, service, label, self.concurrency(service))
    }

    /// Whether the catalog model `name` is fully installed.
    pub fn model_present(&self, name: &str) -> bool {
        models::by_name(name).is_some_and(|m| models::target_exists(self.data_models(), m))
    }

    /// Directory of the catalog model `name` under data_models.
    pub fn model_dir(&self, name: &str) -> Option<PathBuf> {
        models::by_name(name).map(|m| models::model_dir(self.data_models(), m))
    }
}

/// What every `<service>::InProcess` exposes to the switch.
pub trait Backend: Send + Sync {
    /// The port is complete (auto mode may pick it).
    fn implemented(&self) -> bool;
    /// Its model files (for the current selection) are on disk.
    fn ready(&self) -> bool;
}

struct Inner {
    ctx: Arc<MlContext>,
    modes: RwLock<HashMap<Service, Mode>>,
    auto_download: AtomicBool,
    clip: clip::InProcess,
    similarity: similarity::InProcess,
    tags: tags::InProcess,
    ocr: ocr::InProcess,
    face: face::InProcess,
    caption: caption::InProcess,
    face_cluster: face_cluster::InProcess,
    raw_thumbnail: raw_thumbnail::InProcess,
}

/// The in-process implementations of one process. Cheap to clone.
#[derive(Clone)]
pub struct Ml {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for Ml {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ml")
            .field("data_models", &self.inner.ctx.config.data_models)
            .finish()
    }
}

impl Ml {
    /// Set up the in-process services (nothing is loaded yet) and start the
    /// idle reaper. The first `Ml` of a process fixes the ORT configuration.
    pub fn new(config: MlConfig, selector: Selector) -> Ml {
        runtime::configure(config.runtime.clone());
        let registry = Arc::new(Registry::default());
        slot::spawn_reaper(
            Arc::downgrade(&registry),
            config.idle_unload,
            config.reaper_period,
        );
        let modes = RwLock::new(config.modes.clone());
        let auto_download = AtomicBool::new(config.auto_download);
        let ctx = Arc::new(MlContext {
            config,
            registry,
            selector,
        });
        Ml {
            inner: Arc::new(Inner {
                clip: clip::InProcess::new(ctx.clone()),
                similarity: similarity::InProcess::new(ctx.clone()),
                tags: tags::InProcess::new(ctx.clone()),
                ocr: ocr::InProcess::new(ctx.clone()),
                face: face::InProcess::new(ctx.clone()),
                caption: caption::InProcess::new(ctx.clone()),
                face_cluster: face_cluster::InProcess::new(ctx.clone()),
                raw_thumbnail: raw_thumbnail::InProcess::new(ctx.clone()),
                ctx,
                modes,
                auto_download,
            }),
        }
    }

    pub fn context(&self) -> &Arc<MlContext> {
        &self.inner.ctx
    }

    pub fn mode(&self, s: Service) -> Mode {
        self.inner
            .modes
            .read()
            .expect("ml modes")
            .get(&s)
            .copied()
            .unwrap_or(Mode::Auto)
    }

    /// Override `LP_ML_<SERVICE>` at runtime (tests, benchmarks).
    pub fn set_mode(&self, s: Service, mode: Mode) {
        self.inner.modes.write().expect("ml modes").insert(s, mode);
    }

    /// Whether missing models are downloaded automatically.
    pub fn auto_download(&self) -> bool {
        self.inner.auto_download.load(Ordering::Relaxed)
    }

    /// Tests switch it off: a worker would otherwise fetch gigabytes.
    pub fn set_auto_download(&self, on: bool) {
        self.inner.auto_download.store(on, Ordering::Relaxed);
    }

    pub fn view<'a>(&'a self, sidecars: &'a Sidecars) -> MlView<'a> {
        MlView { ml: self, sidecars }
    }

    fn backend(&self, s: Service) -> &dyn Backend {
        let i = &self.inner;
        match s {
            Service::Clip => &i.clip,
            Service::Similarity => &i.similarity,
            Service::Tags => &i.tags,
            Service::Ocr => &i.ocr,
            Service::Face => &i.face,
            Service::Caption => &i.caption,
            Service::FaceCluster => &i.face_cluster,
            Service::RawThumbnail => &i.raw_thumbnail,
        }
    }

    /// Drop the loaded models of `s` unless a call is running.
    pub fn unload(&self, s: Service) -> bool {
        self.inner.ctx.registry.unload_service(s)
    }

    /// Models currently loaded (label, copies) of `s`.
    pub fn loaded_models(&self, s: Service) -> Vec<(String, usize)> {
        self.inner
            .ctx
            .registry
            .of(s)
            .into_iter()
            .filter(|x| x.loaded() > 0)
            .map(|x| (x.label().to_string(), x.loaded()))
            .collect()
    }
}

/// `Ml` plus the sidecar clients: picks the implementation per call.
#[derive(Clone, Copy)]
pub struct MlView<'a> {
    ml: &'a Ml,
    sidecars: &'a Sidecars,
}

/// How a service is served right now (`/api/services`, the supervisor).
#[derive(Debug, Clone, Serialize)]
pub struct ServiceStatus {
    pub service: &'static str,
    /// `inprocess` or `sidecar`.
    pub mode: &'static str,
    pub configured: Mode,
    pub implemented: bool,
    pub ready: bool,
    pub model_loaded: bool,
    pub busy: bool,
    /// Unix seconds of the last call start (what `/health` calls
    /// `last_request_time`).
    pub last_used: Option<f64>,
    pub models: Vec<LoadedModel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoadedModel {
    pub model: String,
    pub copies: usize,
}

impl<'a> MlView<'a> {
    pub fn sidecars(&self) -> &'a Sidecars {
        self.sidecars
    }

    pub fn ml(&self) -> &'a Ml {
        self.ml
    }

    /// Whether calls for `s` go to the in-process implementation now.
    pub fn is_inprocess(&self, s: Service) -> bool {
        let b = self.ml.backend(s);
        match self.ml.mode(s) {
            Mode::InProcess => true,
            Mode::Sidecar => false,
            Mode::Auto => b.implemented() && !self.sidecars.is_redirected(s.sidecar()) && b.ready(),
        }
    }

    pub fn status(&self, s: Service) -> ServiceStatus {
        let b = self.ml.backend(s);
        let slots = self.ml.inner.ctx.registry.of(s);
        let last_used = slots
            .iter()
            .filter_map(|x| x.last_used())
            .max()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64());
        ServiceStatus {
            service: s.name(),
            mode: if self.is_inprocess(s) {
                "inprocess"
            } else {
                "sidecar"
            },
            configured: self.ml.mode(s),
            implemented: b.implemented(),
            ready: b.ready(),
            model_loaded: slots.iter().any(|x| x.loaded() > 0),
            busy: slots.iter().any(|x| x.in_flight() > 0),
            last_used,
            models: slots
                .iter()
                .filter(|x| x.loaded() > 0)
                .map(|x| LoadedModel {
                    model: x.label().to_string(),
                    copies: x.loaded(),
                })
                .collect(),
        }
    }

    pub fn clip(&self) -> &'a dyn clip::ClipApi {
        if self.is_inprocess(Service::Clip) {
            &self.ml.inner.clip
        } else {
            self.sidecars
        }
    }

    pub fn similarity(&self) -> &'a dyn similarity::SimilarityApi {
        if self.is_inprocess(Service::Similarity) {
            &self.ml.inner.similarity
        } else {
            self.sidecars
        }
    }

    pub fn tags(&self) -> &'a dyn tags::TagsApi {
        if self.is_inprocess(Service::Tags) {
            &self.ml.inner.tags
        } else {
            self.sidecars
        }
    }

    pub fn ocr(&self) -> &'a dyn ocr::OcrApi {
        if self.is_inprocess(Service::Ocr) {
            &self.ml.inner.ocr
        } else {
            self.sidecars
        }
    }

    pub fn face(&self) -> &'a dyn face::FaceApi {
        if self.is_inprocess(Service::Face) {
            &self.ml.inner.face
        } else {
            self.sidecars
        }
    }

    pub fn caption(&self) -> &'a dyn caption::CaptionApi {
        if self.is_inprocess(Service::Caption) {
            &self.ml.inner.caption
        } else {
            self.sidecars
        }
    }

    pub fn face_cluster(&self) -> &'a dyn face_cluster::FaceClusterApi {
        if self.is_inprocess(Service::FaceCluster) {
            &self.ml.inner.face_cluster
        } else {
            self.sidecars
        }
    }

    pub fn raw_thumbnail(&self) -> &'a dyn raw_thumbnail::RawThumbnailApi {
        if self.is_inprocess(Service::RawThumbnail) {
            &self.ml.inner.raw_thumbnail
        } else {
            self.sidecars
        }
    }
}

/// An owned `Ml` + sidecar clients for code that outlives a borrow of the
/// state (blocking tasks, the thumbnail renderer).
#[derive(Clone, Debug)]
pub struct MlHandle {
    pub ml: Ml,
    pub sidecars: Sidecars,
}

impl MlHandle {
    pub fn view(&self) -> MlView<'_> {
        self.ml.view(&self.sidecars)
    }
}

// ---- errors -----------------------------------------------------------------

/// The sidecar's 400: the request cannot be served (unreadable image, bad
/// argument). Callers treat it like the sidecar's own refusal.
pub fn bad_input(s: Service, detail: impl Into<String>) -> SidecarError {
    status(s, 400, detail.into())
}

/// The sidecar's 500 `{"error": ...}`: inference failed.
pub fn failed(s: Service, detail: impl Into<String>) -> SidecarError {
    status(s, 500, detail.into())
}

/// No model or no runtime: like a sidecar that is not running.
pub fn unavailable(s: Service, message: impl Into<String>) -> SidecarError {
    SidecarError::Unreachable {
        sidecar: s.name(),
        url: s.url(),
        message: message.into(),
    }
}

/// The stub answer of an in-process service that is not ported yet.
pub fn not_implemented(s: Service) -> SidecarError {
    unavailable(
        s,
        format!(
            "the in-process {} service is not implemented yet (set LP_ML_{}=sidecar)",
            s.name(),
            s.env_key()
        ),
    )
}

fn status(s: Service, code: u16, detail: String) -> SidecarError {
    SidecarError::Status {
        sidecar: s.name(),
        url: s.url(),
        status: code,
        body: Some(Box::new(serde_json::json!({ "error": detail }))),
        detail,
    }
}

/// An anyhow error from a slot run as the sidecar's 500.
pub fn failed_from(s: Service, e: anyhow::Error) -> SidecarError {
    failed(s, format!("{e:#}"))
}

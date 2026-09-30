//! ONNX Runtime loading and session creation (`service/onnx_session.py`).
//!
//! `ort` is built with `load-dynamic`: nothing is linked, the runtime library
//! is opened on first use, so the binary carries no ONNX Runtime and the
//! Python sidecars and Rust can run the very same build side by side.
//!
//! Library lookup, first hit wins:
//! 1. `LP_ORT_LIB`, then `ORT_DYLIB_PATH` (ort's own variable);
//! 2. `onnxruntime.dll` / `libonnxruntime.so[.1]` / `libonnxruntime.dylib`
//!    next to the executable (how the Docker image and a standalone build ship it);
//! 3. on Linux/macOS the bare name through the system loader (`/usr/lib`,
//!    `LD_LIBRARY_PATH`). Never on Windows: System32 carries an old Windows ML
//!    `onnxruntime.dll` that the loader would pick up first.
//!
//! What an image ships: the official `onnxruntime-linux-{x64,aarch64}-<ver>.tgz`
//! release (`lib/libonnxruntime.so.<ver>`, ~20 MB x64 / ~17 MB arm64) or the
//! `.so` out of the `onnxruntime` wheel, copied next to `librephotos-rs`; the
//! GPU image uses the `onnxruntime-linux-x64-gpu` tarball plus the CUDA/cuDNN
//! libraries. Any ONNX Runtime >= 1.17 works (the `api-17` feature floor).
//!
//! `ONNX_PROVIDERS` (comma-separated, most preferred first; names this build
//! does not offer are skipped; unset: CUDA when available, then CPU) and
//! `ONNX_INTRA_OP_THREADS` (unset or 0: ORT's default, one per physical core)
//! behave as in the sidecars.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{Context, anyhow};
use ort::ep::{self, ExecutionProvider, ExecutionProviderDispatch};
use ort::session::Session;
use ort::session::builder::SessionBuilder;

pub const CPU: &str = "CPUExecutionProvider";
pub const CUDA: &str = "CUDAExecutionProvider";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuntimeConfig {
    /// Explicit runtime library (`LP_ORT_LIB` / `ORT_DYLIB_PATH`).
    pub lib: Option<PathBuf>,
    /// `ONNX_PROVIDERS`, parsed; empty = CUDA, then CPU.
    pub providers: Vec<String>,
    /// `ONNX_INTRA_OP_THREADS`; `None` = ORT's default.
    pub intra_threads: Option<usize>,
}

impl RuntimeConfig {
    pub fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        RuntimeConfig {
            lib: var("LP_ORT_LIB")
                .or_else(|| var("ORT_DYLIB_PATH"))
                .map(PathBuf::from),
            providers: parse_providers(var("ONNX_PROVIDERS").as_deref().unwrap_or("")),
            intra_threads: var("ONNX_INTRA_OP_THREADS")
                .and_then(|v| v.trim().parse::<usize>().ok())
                .filter(|n| *n > 0),
        }
    }
}

pub fn parse_providers(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// What got loaded.
#[derive(Debug, Clone)]
pub struct RuntimeInfo {
    pub lib: PathBuf,
    /// `ort::info()`: build string with the git branch (`rel-1.27.0`) etc.
    pub build_info: String,
    /// The providers sessions are created with, most preferred first.
    pub providers: Vec<String>,
    pub intra_threads: Option<usize>,
}

static CONFIG: OnceLock<RuntimeConfig> = OnceLock::new();
static RUNTIME: OnceLock<Result<RuntimeInfo, String>> = OnceLock::new();

/// Set the process-wide runtime configuration; the first call wins (one
/// ONNX Runtime per process). Does not load anything yet.
pub fn configure(cfg: RuntimeConfig) {
    let _ = CONFIG.set(cfg);
}

fn config() -> &'static RuntimeConfig {
    CONFIG.get_or_init(RuntimeConfig::from_env)
}

/// Whether the runtime library has been loaded (by [`init`]).
pub fn is_loaded() -> bool {
    matches!(RUNTIME.get(), Some(Ok(_)))
}

/// Candidate library paths in lookup order (see the module docs).
pub fn candidates(cfg: &RuntimeConfig) -> Vec<PathBuf> {
    if let Some(lib) = &cfg.lib {
        return vec![lib.clone()];
    }
    let names: &[&str] = if cfg!(windows) {
        &["onnxruntime.dll"]
    } else if cfg!(target_os = "macos") {
        &["libonnxruntime.dylib"]
    } else {
        &["libonnxruntime.so", "libonnxruntime.so.1"]
    };
    let mut out = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        for n in names {
            let p = dir.join(n);
            if p.exists() {
                out.push(p);
            }
        }
    }
    if !cfg!(windows) {
        out.extend(names.iter().map(PathBuf::from));
    }
    out
}

/// Load ONNX Runtime once per process. Every later call returns the same
/// result, so a missing library is reported, not retried per request.
pub fn init() -> Result<&'static RuntimeInfo, String> {
    RUNTIME
        .get_or_init(|| load(config()))
        .as_ref()
        .map_err(Clone::clone)
}

fn load(cfg: &RuntimeConfig) -> Result<RuntimeInfo, String> {
    let candidates = candidates(cfg);
    if candidates.is_empty() {
        return Err(
            "no ONNX Runtime library: set LP_ORT_LIB to onnxruntime.dll / libonnxruntime.so".into(),
        );
    }
    let mut errors = Vec::new();
    for lib in candidates {
        match ort::init_from(&lib) {
            Ok(builder) => {
                let _ = builder.with_name("librephotos").commit();
                let providers = resolve_providers(&cfg.providers);
                let info = RuntimeInfo {
                    build_info: ort::info().to_string(),
                    lib,
                    providers,
                    intra_threads: cfg.intra_threads,
                };
                tracing::info!(
                    lib = %info.lib.display(),
                    providers = ?info.providers,
                    threads = ?info.intra_threads,
                    "ONNX Runtime loaded"
                );
                return Ok(info);
            }
            Err(e) => errors.push(format!("{}: {e}", lib.display())),
        }
    }
    Err(format!(
        "could not load ONNX Runtime ({})",
        errors.join("; ")
    ))
}

fn dispatch(name: &str) -> Option<ExecutionProviderDispatch> {
    match name {
        CPU => Some(ep::CPU::default().build()),
        CUDA => {
            let cuda = ep::CUDA::default();
            cuda.is_available().unwrap_or(false).then(|| cuda.build())
        }
        _ => None,
    }
}

/// `execution_providers()`: the requested (or default) providers this
/// runtime offers, CPU when none is.
fn resolve_providers(requested: &[String]) -> Vec<String> {
    let preferred: Vec<String> = if requested.is_empty() {
        vec![CUDA.into(), CPU.into()]
    } else {
        requested.to_vec()
    };
    let mut out: Vec<String> = preferred
        .into_iter()
        .filter(|n| dispatch(n).is_some())
        .collect();
    if out.is_empty() {
        out.push(CPU.into());
    }
    out
}

/// `uses_gpu()`.
pub fn uses_gpu() -> bool {
    init().is_ok_and(|i| i.providers.iter().any(|p| p == CUDA))
}

/// A session builder with the configured providers and thread count.
pub fn session_builder() -> anyhow::Result<SessionBuilder> {
    let info = init().map_err(|e| anyhow!(e))?;
    let mut b = Session::builder().context("creating an ONNX Runtime session builder")?;
    if let Some(n) = info.intra_threads {
        b = b
            .with_intra_threads(n)
            .map_err(|e| anyhow!("ONNX_INTRA_OP_THREADS: {e}"))?;
    }
    let eps: Vec<ExecutionProviderDispatch> =
        info.providers.iter().filter_map(|n| dispatch(n)).collect();
    b = b
        .with_execution_providers(eps)
        .map_err(|e| anyhow!("execution providers: {e}"))?;
    Ok(b)
}

/// `inference_session(path)`: a session for the model file at `path`.
pub fn session(path: &Path) -> anyhow::Result<Session> {
    let mut b = session_builder()?;
    b.commit_from_file(path)
        .with_context(|| format!("loading ONNX model {}", path.display()))
}

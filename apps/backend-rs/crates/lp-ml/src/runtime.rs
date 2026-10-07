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
//! does not offer are skipped; unset: CUDA when available, then DirectML,
//! then CPU) and `ONNX_INTRA_OP_THREADS` (unset or 0: ORT's default, one per
//! physical core) behave as in the sidecars. Short names are accepted too:
//! `cuda`, `dml`/`directml`, `cpu`.
//!
//! GPU runtimes: the DirectML build (`onnxruntime-directml` wheel:
//! `onnxruntime.dll` + `DirectML.dll`, any DirectX 12 GPU on Windows) or the
//! CUDA build (`onnxruntime-gpu` + the CUDA / cuDNN runtime libraries on
//! `PATH` / `LD_LIBRARY_PATH`). A `DirectML.dll` next to the runtime library
//! is loaded first, so the older copy in System32 never shadows it. A GPU
//! provider that is requested but missing falls back to the next one, and to
//! CPU in the end.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{Context, anyhow};
use ort::ep::{self, ExecutionProvider, ExecutionProviderDispatch};
use ort::session::builder::SessionBuilder;
use ort::session::{RunOptions, Session, SessionInputs, SessionOutputs};

pub const CPU: &str = "CPUExecutionProvider";
pub const CUDA: &str = "CUDAExecutionProvider";
pub const DML: &str = "DmlExecutionProvider";

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
        .map(|s| match s.to_ascii_lowercase().as_str() {
            "cpu" => CPU.to_string(),
            "cuda" | "gpu" => CUDA.to_string(),
            "dml" | "directml" => DML.to_string(),
            _ => s.to_string(),
        })
        .collect()
}

/// Windows: load the `DirectML.dll` that ships next to the runtime library
/// before the runtime itself, so the runtime binds to it and not to the
/// (older) System32 copy the default DLL search order would find first.
fn preload_beside(lib: &Path) {
    if !cfg!(windows) {
        return;
    }
    let Some(dir) = lib.parent() else {
        return;
    };
    let dml = dir.join("DirectML.dll");
    if dml.exists() {
        // SAFETY: loading a system library without initialisation side
        // effects; the handle is leaked on purpose (process lifetime).
        match unsafe { libloading::Library::new(&dml) } {
            Ok(l) => std::mem::forget(l),
            Err(e) => {
                tracing::warn!(path = %dml.display(), error = %e, "could not preload DirectML")
            }
        }
    }
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
        preload_beside(&lib);
        match ort::init_from(&lib) {
            Ok(builder) => {
                let _ = builder.with_name("librephotos").commit();
                if arena_mode() == ArenaMode::Shared
                    && let Err(e) = register_shared_arena()
                {
                    return Err(format!("shared CPU arena: {e}"));
                }
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

/// What ONNX Runtime's CPU memory arena does (`LP_ORT_CPU_ARENA`).
///
/// A per-session arena keeps every buffer a run allocated for the next run
/// instead of returning it, so it grows to the largest input that session
/// has seen and never shrinks (OCR on a document page: ~400 MB for a 31 MB
/// model). Without an arena every tensor comes from the system allocator.
/// ML-on scan of 290 photos, 4 cores (`bench/OPTIMIZATIONS.md` #1): `on`
/// 1.84 GB peak / 1.57 GB after captions, `shared` 1.34 / 0.59 GB with OCR
/// +3% and everything else unchanged, `off` 1.32 / 0.52 GB with OCR +6%.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArenaMode {
    /// `1`/`on`: one arena per session, kept at its high-water mark (ORT's
    /// and Python's default; the fastest by a few percent).
    On,
    /// `0`/`off`: no arena, every tensor from the system allocator.
    Off,
    /// `shrink`: one arena per session, whose free regions are handed back
    /// after each run (`memory.enable_memory_arena_shrinkage`).
    Shrink,
    /// `shared` (default): one arena for every session, registered on the
    /// environment, extended by exactly what is requested
    /// (`kSameAsRequested`) and shrunk after each run.
    Shared,
}

impl ArenaMode {
    pub fn parse(v: &str) -> Option<ArenaMode> {
        Some(match v.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => ArenaMode::On,
            "0" | "false" | "no" | "off" => ArenaMode::Off,
            "shrink" => ArenaMode::Shrink,
            "shared" => ArenaMode::Shared,
            _ => return None,
        })
    }

    fn shrinks(self) -> bool {
        matches!(self, ArenaMode::Shrink | ArenaMode::Shared)
    }
}

/// The default when `LP_ORT_CPU_ARENA` is unset.
pub const DEFAULT_ARENA: ArenaMode = ArenaMode::Shared;

pub fn arena_mode() -> ArenaMode {
    static MODE: OnceLock<ArenaMode> = OnceLock::new();
    *MODE.get_or_init(|| match std::env::var("LP_ORT_CPU_ARENA") {
        Err(_) => DEFAULT_ARENA,
        Ok(v) if v.trim().is_empty() => DEFAULT_ARENA,
        Ok(v) => ArenaMode::parse(&v).unwrap_or_else(|| {
            tracing::warn!(value = %v, "LP_ORT_CPU_ARENA: expected 1, 0, shrink or shared");
            DEFAULT_ARENA
        }),
    })
}

fn cpu_arena() -> bool {
    arena_mode() != ArenaMode::Off
}

/// Run options that hand the CPU arena's free regions back after the run,
/// when the arena mode shrinks.
fn shrink_options() -> Option<&'static RunOptions> {
    static OPTS: OnceLock<Option<RunOptions>> = OnceLock::new();
    OPTS.get_or_init(|| {
        if !arena_mode().shrinks() {
            return None;
        }
        let mut o = RunOptions::new().ok()?;
        match o.set("memory.enable_memory_arena_shrinkage", "cpu:0") {
            Ok(()) => Some(o),
            Err(e) => {
                tracing::warn!(error = %e, "ONNX Runtime refused arena shrinkage");
                None
            }
        }
    })
    .as_ref()
}

/// `session.run(inputs)`, shrinking the CPU arena afterwards when the arena
/// mode asks for it. Every model call goes through here.
pub fn run<'s, 'i, 'v: 'i, const N: usize>(
    session: &'s mut Session,
    inputs: impl Into<SessionInputs<'i, 'v, N>>,
) -> ort::Result<SessionOutputs<'s>> {
    match shrink_options() {
        Some(o) => session.run_with_options(inputs, o),
        None => session.run(inputs),
    }
}

/// `session.run(inputs)` without shrinking, for the steps of a loop whose
/// next step needs the same buffers again (autoregressive decoding).
pub fn run_keep<'s, 'i, 'v: 'i, const N: usize>(
    session: &'s mut Session,
    inputs: impl Into<SessionInputs<'i, 'v, N>>,
) -> ort::Result<SessionOutputs<'s>> {
    session.run(inputs)
}

/// `ArenaMode::Shared`: register one CPU arena allocator
/// (`kSameAsRequested`) on the environment for every session to use.
fn register_shared_arena() -> Result<(), String> {
    use ort::AsPointer;
    use ort::sys::{OrtAllocatorType, OrtArenaCfg, OrtMemType, OrtMemoryInfo, OrtStatusPtr};
    let api = ort::api();
    let check = |st: OrtStatusPtr, what: &str| -> Result<(), String> {
        if st.0.is_null() {
            return Ok(());
        }
        // SAFETY: a non-null status from the C API, released once.
        let msg = unsafe {
            let m = std::ffi::CStr::from_ptr((api.GetErrorMessage)(st.0))
                .to_string_lossy()
                .into_owned();
            (api.ReleaseStatus)(st.0);
            m
        };
        Err(format!("{what}: {msg}"))
    };
    let env = ort::environment::Environment::current().map_err(|e| e.to_string())?;
    let keys = [c"arena_extend_strategy".as_ptr()];
    let values = [1usize]; // kSameAsRequested
    let mut cfg: *mut OrtArenaCfg = std::ptr::null_mut();
    let mut info: *mut OrtMemoryInfo = std::ptr::null_mut();
    // SAFETY: plain C API calls with valid out-pointers; both objects are
    // released after registering (the environment copies what it needs).
    unsafe {
        check(
            (api.CreateArenaCfgV2)(keys.as_ptr(), values.as_ptr(), keys.len(), &mut cfg),
            "CreateArenaCfgV2",
        )?;
        let r = check(
            (api.CreateCpuMemoryInfo)(
                OrtAllocatorType::OrtArenaAllocator,
                OrtMemType::OrtMemTypeDefault,
                &mut info,
            ),
            "CreateCpuMemoryInfo",
        )
        .and_then(|()| {
            check(
                (api.CreateAndRegisterAllocator)(env.ptr().cast_mut(), info, cfg),
                "CreateAndRegisterAllocator",
            )
        });
        if !info.is_null() {
            (api.ReleaseMemoryInfo)(info);
        }
        (api.ReleaseArenaCfg)(cfg);
        r
    }
}

fn dispatch(name: &str) -> Option<ExecutionProviderDispatch> {
    match name {
        CPU => Some(ep::CPU::default().with_arena_allocator(cpu_arena()).build()),
        CUDA => {
            let cuda = ep::CUDA::default();
            cuda.is_available().unwrap_or(false).then(|| cuda.build())
        }
        DML => {
            let dml = ep::DirectML::default();
            dml.is_available().unwrap_or(false).then(|| dml.build())
        }
        _ => None,
    }
}

/// `execution_providers()`: the requested (or default) providers this
/// runtime offers, CPU when none is.
fn resolve_providers(requested: &[String]) -> Vec<String> {
    let preferred: Vec<String> = if requested.is_empty() {
        vec![CUDA.into(), DML.into(), CPU.into()]
    } else {
        requested.to_vec()
    };
    let mut out: Vec<String> = Vec::new();
    for n in preferred {
        if out.contains(&n) {
            continue;
        }
        if dispatch(&n).is_some() {
            out.push(n);
        } else if !requested.is_empty() {
            tracing::warn!(provider = %n, "ONNX_PROVIDERS: not offered by this ONNX Runtime build, skipped");
        }
    }
    // CPU always comes last: nodes a GPU provider cannot run fall back to it.
    if !out.iter().any(|p| p == CPU) {
        out.push(CPU.into());
    }
    out
}

/// `uses_gpu()`: the preferred provider is a GPU one.
pub fn uses_gpu() -> bool {
    init().is_ok_and(|i| i.providers.first().is_some_and(|p| p == CUDA || p == DML))
}

/// The GPU provider sessions run on, if any (`CUDA` / `DML`).
pub fn gpu_provider() -> Option<&'static str> {
    let info = init().ok()?;
    match info.providers.first().map(String::as_str) {
        Some(CUDA) => Some(CUDA),
        Some(DML) => Some(DML),
        _ => None,
    }
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
    if info.providers.iter().any(|p| p == DML) {
        // DirectML requires both (ORT's DirectML EP documentation).
        b = b
            .with_memory_pattern(false)
            .map_err(|e| anyhow!("DirectML session options: {e}"))?
            .with_parallel_execution(false)
            .map_err(|e| anyhow!("DirectML session options: {e}"))?;
    }
    b = b
        .with_execution_providers(eps)
        .map_err(|e| anyhow!("execution providers: {e}"))?;
    if arena_mode() == ArenaMode::Shared {
        b = b
            .with_env_allocators()
            .map_err(|e| anyhow!("shared CPU arena: {e}"))?;
    }
    Ok(b)
}

/// `inference_session(path)`: a session for the model file at `path`.
pub fn session(path: &Path) -> anyhow::Result<Session> {
    let mut b = session_builder()?;
    b.commit_from_file(path)
        .with_context(|| format!("loading ONNX model {}", path.display()))
}

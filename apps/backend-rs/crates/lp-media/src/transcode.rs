//! Video conversion for the "Always transcode videos" setting: the live
//! stream (`api/views/media.py` `build_live_command`, `VideoTranscoder`), the
//! seekable disk cache filled after it (`api/transcode_cache.py`), the ffmpeg
//! CPU budget probes (`api/ffmpeg_budget.py`) and HDR tonemapping
//! (`api/video_color.py`).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use axum::body::Body;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, StatusCode};
use axum::response::Response;
use futures::StreamExt;
use lp_core::Config;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::OnceCell;
use tokio_util::io::ReaderStream;

use crate::pyfmt::py_float;

const BYTES_PER_GB: f64 = 1024.0 * 1024.0 * 1024.0;
/// About 15 MB of output per minute; used only to judge whether a video fits.
const ESTIMATED_BYTES_PER_SECOND: f64 = 15.0 * BYTES_PER_GB / 1024.0 / 60.0;
const STALE_PART: Duration = Duration::from_secs(6 * 60 * 60);
const SPACE_CHECK: Duration = Duration::from_secs(15);
const PART_SUFFIX: &str = ".part";
const STDERR_TAIL_BYTES: usize = 8192;
const HDR_TRANSFERS: [&str; 2] = ["smpte2084", "arib-std-b67"];
const TONEMAP: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
const FALLBACK_FILTER: &str = "format=yuv420p";
const SCALE: &str = "scale=-2:'min(720,ih)'";
const CACHE_PRESET: &str = "veryfast";

/// What the video to convert is, independent of how it was looked up.
#[derive(Debug, Clone)]
pub struct Source {
    pub image_hash: String,
    pub path: PathBuf,
    pub video_length: Option<String>,
}

// ---------------------------------------------------------------- budget

/// `ffmpeg_budget.cpu_share`: cores / fraction, never fewer than one.
pub fn cpu_share(cores: usize, fraction: usize) -> usize {
    if fraction < 1 {
        return cores;
    }
    (cores / fraction).max(1)
}

#[derive(Debug, Default)]
struct Probe {
    help: String,
    filters: String,
}

static PROBE: OnceCell<Probe> = OnceCell::const_new();

async fn run_capture(bin: &Path, args: &[&str]) -> String {
    let fut = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(Duration::from_secs(30), fut).await {
        Ok(Ok(out)) => String::from_utf8_lossy(&out.stdout).into_owned(),
        _ => String::new(),
    }
}

async fn probe(config: &Config) -> &'static Probe {
    PROBE
        .get_or_init(|| async {
            let bin = &config.binaries.ffmpeg;
            Probe {
                help: run_capture(bin, &["-hide_banner", "-h", "full"]).await,
                filters: run_capture(bin, &["-hide_banner", "-filters"]).await,
            }
        })
        .await
}

/// `ffmpeg_budget.supports`: whether `-option` is listed in `-h full`.
fn supports(probe: &Probe, option: &str) -> bool {
    let wanted = format!("-{option}");
    probe
        .help
        .lines()
        .any(|l| l.trim().split(' ').next() == Some(wanted.as_str()))
}

/// `ffmpeg_budget.supports_filter`.
fn supports_filter(probe: &Probe, name: &str) -> bool {
    probe
        .filters
        .lines()
        .any(|l| l.split_whitespace().nth(1) == Some(name))
}

// ---------------------------------------------------------------- colour

/// `video_color.transfer_characteristics`: "" whenever it cannot be had.
async fn transfer_characteristics(config: &Config, path: &Path) -> String {
    let path = path.to_string_lossy();
    let out = run_capture(
        &config.binaries.ffprobe,
        &[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=color_transfer",
            "-of",
            "json",
            &path,
        ],
    )
    .await;
    serde_json::from_str::<serde_json::Value>(&out)
        .ok()
        .and_then(|v| {
            v.get("streams")?
                .get(0)?
                .get("color_transfer")?
                .as_str()
                .map(str::to_string)
        })
        .unwrap_or_default()
}

/// `video_color.video_filter(path, scale)`.
async fn video_filter(config: &Config, path: &Path, scale: &str) -> Option<String> {
    let mut steps = vec![scale.to_string()];
    if HDR_TRANSFERS.contains(&transfer_characteristics(config, path).await.as_str()) {
        if supports_filter(probe(config).await, "zscale") {
            steps.push(TONEMAP.to_string());
        } else {
            tracing::warn!(path = %path.display(), "this ffmpeg has no zscale; cannot tonemap");
            steps.push(FALLBACK_FILTER.to_string());
        }
    }
    let joined = steps.join(",");
    (!joined.is_empty()).then_some(joined)
}

// ---------------------------------------------------------------- live

/// `build_live_command`: argv after the ffmpeg binary.
pub async fn live_args(config: &Config, path: &Path) -> Vec<String> {
    let t = &config.transcode;
    let threads = cpu_share(config.cores, t.live_cpu_fraction).to_string();
    let probe = probe(config).await;
    let mut args: Vec<String> = ["-nostdin", "-loglevel", "error", "-threads", &threads]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if supports(probe, "filter_threads") {
        args.extend(["-filter_threads".into(), threads.clone()]);
    }
    if t.live_readrate > 0.0 && supports(probe, "readrate") {
        args.extend(["-readrate".into(), py_float(t.live_readrate)]);
        if t.live_burst_seconds > 0.0 && supports(probe, "readrate_initial_burst") {
            args.extend([
                "-readrate_initial_burst".into(),
                py_float(t.live_burst_seconds),
            ]);
        }
    }
    args.extend(
        [
            "-i",
            &path.to_string_lossy(),
            "-threads",
            &threads,
            "-vcodec",
            "libx264",
            "-preset",
            "ultrafast",
            "-movflags",
            "frag_keyframe+empty_moov",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    if let Some(filter) = video_filter(config, path, SCALE).await {
        args.extend(["-filter:v".into(), filter]);
    }
    args.extend(["-f".into(), "mp4".into(), "-".into()]);
    args
}

/// Runs when the live response body goes away: kills ffmpeg if the viewer
/// left early, logs a failed conversion, then starts filling the cache.
struct LiveGuard {
    child: Option<tokio::process::Child>,
    finished: bool,
    stderr_tail: Arc<Mutex<VecDeque<u8>>>,
    config: Arc<Config>,
    source: Source,
}

impl Drop for LiveGuard {
    fn drop(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };
        if !self.finished {
            let _ = child.start_kill();
        }
        let finished = self.finished;
        let tail = self.stderr_tail.clone();
        let config = self.config.clone();
        let source = self.source.clone();
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            return;
        };
        handle.spawn(async move {
            if let Ok(status) = child.wait().await
                && finished
                && !status.success()
            {
                let said = {
                    let t = tail.lock().map(|t| t.iter().copied().collect::<Vec<u8>>());
                    String::from_utf8_lossy(&t.unwrap_or_default())
                        .trim()
                        .to_string()
                };
                tracing::warn!(
                    status = ?status.code(),
                    stderr = if said.is_empty() { "no output on stderr" } else { said.as_str() },
                    "live video transcode failed"
                );
            }
            ensure_cached(config, source).await;
        });
    }
}

/// `_transcoded_video_response` without a cache hit: ffmpeg's fragmented mp4
/// streamed as the body, `Cache-Control: no-store`. A HEAD gets the headers
/// only (no conversion), and still starts caching.
pub async fn live_response(config: Arc<Config>, source: Source, head: bool) -> Response {
    let mut res = if head {
        tokio::spawn(ensure_cached(config.clone(), source));
        Response::new(Body::empty())
    } else {
        match spawn_live(config, source).await {
            Some(body) => Response::new(body),
            None => {
                let mut r = Response::new(Body::empty());
                *r.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
                return r;
            }
        }
    };
    let h = res.headers_mut();
    h.insert(CONTENT_TYPE, HeaderValue::from_static("video/mp4"));
    h.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

async fn spawn_live(config: Arc<Config>, source: Source) -> Option<Body> {
    let args = live_args(&config, &source.path).await;
    let mut child = match Command::new(&config.binaries.ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "could not start the live transcode");
            return None;
        }
    };
    let stdout = child.stdout.take()?;
    let tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_BYTES)));
    if let Some(mut stderr) = child.stderr.take() {
        let tail = tail.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                if let Ok(mut t) = tail.lock() {
                    t.extend(&buf[..n]);
                    let excess = t.len().saturating_sub(STDERR_TAIL_BYTES);
                    t.drain(..excess);
                }
            }
        });
    }
    let guard = LiveGuard {
        child: Some(child),
        finished: false,
        stderr_tail: tail,
        config,
        source,
    };
    let stream = async_stream::stream! {
        let mut guard = guard;
        let mut reader = ReaderStream::with_capacity(stdout, 64 * 1024);
        while let Some(chunk) = reader.next().await {
            yield chunk;
        }
        guard.finished = true;
    };
    Some(Body::from_stream(stream))
}

// ---------------------------------------------------------------- cache

fn cache_root(config: &Config) -> PathBuf {
    config.transcoded_dir()
}

fn max_bytes(config: &Config) -> f64 {
    config.transcode.cache_max_gb * BYTES_PER_GB
}

fn min_free_bytes(config: &Config) -> f64 {
    config.transcode.cache_min_free_gb * BYTES_PER_GB
}

/// `transcode_cache.is_enabled`.
pub fn is_enabled(config: &Config) -> bool {
    max_bytes(config) > 0.0
}

/// `transcode_cache.final_path`.
pub fn final_path(config: &Config, image_hash: &str) -> Option<PathBuf> {
    (!image_hash.is_empty()).then(|| cache_root(config).join(format!("{image_hash}.mp4")))
}

/// `transcode_cache.cached_path`: the finished conversion, stamped as just
/// used (its mtime is the eviction order). Blocking.
pub fn cached_path(config: &Config, image_hash: &str) -> Option<PathBuf> {
    if !is_enabled(config) {
        return None;
    }
    let path = final_path(config, image_hash)?;
    if !path.is_file() {
        return None;
    }
    if let Ok(f) = std::fs::OpenOptions::new().write(true).open(&path) {
        let _ = f.set_modified(SystemTime::now());
    }
    Some(path)
}

/// `transcode_cache.discard`: forget a deleted photo's conversion.
pub fn discard(config: &Config, image_hash: &str) {
    let Some(path) = final_path(config, image_hash) else {
        return;
    };
    let mut part = path.clone().into_os_string();
    part.push(PART_SUFFIX);
    for candidate in [path, PathBuf::from(part)] {
        if candidate.exists() && std::fs::remove_file(&candidate).is_err() {
            tracing::warn!(path = %candidate.display(), "could not remove cached transcode");
        }
    }
}

/// `transcode_cache.estimated_size`.
pub fn estimated_size(video_length: Option<&str>) -> u64 {
    let mut seconds = video_length
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|s| s.is_finite())
        .unwrap_or(0.0);
    if seconds <= 0.0 {
        seconds = 60.0;
    }
    (seconds * ESTIMATED_BYTES_PER_SECOND) as u64
}

fn is_part(name: &str) -> bool {
    name.ends_with(PART_SUFFIX)
}

/// Finished cache files as (path, mtime, size), least recently used first.
fn entries(root: &Path) -> Vec<(PathBuf, SystemTime, u64)> {
    let Ok(dir) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<_> = dir
        .flatten()
        .filter(|e| !is_part(&e.file_name().to_string_lossy()))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            meta.is_file().then(|| {
                (
                    e.path(),
                    meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    meta.len(),
                )
            })
        })
        .collect();
    out.sort_by_key(|e| e.1);
    out
}

fn in_flight(root: &Path) -> usize {
    std::fs::read_dir(root)
        .map(|d| {
            d.flatten()
                .filter(|e| is_part(&e.file_name().to_string_lossy()))
                .count()
        })
        .unwrap_or(0)
}

fn drop_stale_parts(root: &Path) {
    let Ok(dir) = std::fs::read_dir(root) else {
        return;
    };
    let now = SystemTime::now();
    for e in dir.flatten() {
        if !is_part(&e.file_name().to_string_lossy()) {
            continue;
        }
        let stale = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_some_and(|age| age > STALE_PART);
        if stale && std::fs::remove_file(e.path()).is_ok() {
            tracing::info!(path = %e.path().display(), "removed abandoned transcode");
        }
    }
}

/// Free bytes on the volume holding `root` (0 when unknown).
pub fn free_bytes(root: &Path) -> f64 {
    let Ok(real) = root.canonicalize() else {
        return 0.0;
    };
    let real = strip_verbatim(&real);
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .list()
        .iter()
        .filter(|d| real.starts_with(strip_verbatim(d.mount_point())))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map_or(0.0, |d| d.available_space() as f64)
}

fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

/// `transcode_cache.make_room`: evict least recently served until `wanted`
/// fits under both ceilings; false when it cannot.
fn make_room(config: &Config, root: &Path, wanted: f64) -> bool {
    let list = entries(root);
    let mut used: f64 = list.iter().map(|e| e.2 as f64).sum();
    let budget = max_bytes(config);
    let reserve = min_free_bytes(config);
    for (path, _, size) in list {
        let over_budget = used + wanted > budget;
        let under_reserve = free_bytes(root) - wanted < reserve;
        if !over_budget && !under_reserve {
            return true;
        }
        if std::fs::remove_file(&path).is_err() {
            continue;
        }
        used -= size as f64;
        tracing::info!(path = %path.display(), "evicted cached transcode");
    }
    used + wanted <= budget && free_bytes(root) - wanted >= reserve
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

/// `transcode_cache.build_command`: (program, argv).
pub async fn cache_command(
    config: &Config,
    source: &Path,
    destination: &Path,
) -> (PathBuf, Vec<String>) {
    let threads = (config.cores / 2).max(1).to_string();
    let mut args: Vec<String> = [
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-i",
        &source.to_string_lossy(),
        "-threads",
        &threads,
        "-vcodec",
        "libx264",
        "-preset",
        CACHE_PRESET,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(filter) = video_filter(config, source, SCALE).await {
        args.extend(["-filter:v".into(), filter]);
    }
    args.extend(
        ["-movflags", "+faststart", "-f", "mp4"]
            .iter()
            .map(|s| s.to_string()),
    );
    args.push(destination.to_string_lossy().into_owned());

    let niceness = config.transcode.cache_nice;
    let nice = if cfg!(unix) && niceness != 0 {
        which("nice")
    } else {
        None
    };
    match nice {
        Some(nice) => {
            let mut full = vec![
                "-n".to_string(),
                niceness.to_string(),
                config.binaries.ffmpeg.to_string_lossy().into_owned(),
            ];
            full.extend(args);
            (nice, full)
        }
        None => (config.binaries.ffmpeg.clone(), args),
    }
}

/// `transcode_cache.run_transcode`: convert into `part`, publish as `final`
/// by rename only if ffmpeg exited cleanly with output and the disk held.
async fn run_transcode(
    config: &Config,
    program: PathBuf,
    args: Vec<String>,
    part: PathBuf,
    final_: PathBuf,
) -> bool {
    let root = cache_root(config);
    let mut child = match Command::new(&program)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, path = %final_.display(), "could not start a transcode");
            let _ = std::fs::remove_file(&part);
            return false;
        }
    };
    let status = loop {
        match tokio::time::timeout(SPACE_CHECK, child.wait()).await {
            Ok(status) => break status.ok(),
            Err(_) => {
                if free_bytes(&root) < min_free_bytes(config) {
                    let _ = child.kill().await;
                    tracing::info!(path = %final_.display(), "abandoned caching: the disk is close to full");
                    let _ = std::fs::remove_file(&part);
                    return false;
                }
            }
        }
    };
    if !status.is_some_and(|s| s.success()) {
        tracing::warn!(path = %final_.display(), "transcode failed");
        let _ = std::fs::remove_file(&part);
        return false;
    }
    match std::fs::metadata(&part) {
        Ok(m) if m.len() > 0 => {}
        _ => {
            let _ = std::fs::remove_file(&part);
            return false;
        }
    }
    if let Err(e) = std::fs::rename(&part, &final_) {
        tracing::warn!(error = %e, path = %final_.display(), "could not publish cached transcode");
        let _ = std::fs::remove_file(&part);
        return false;
    }
    tracing::info!(path = %final_.display(), "cached a seekable copy");
    true
}

/// `transcode_cache.ensure_cached`: claim (O_EXCL part-file) and start a
/// background conversion unless it is cached, claimed, over the concurrency
/// limit, or out of room. Returns whether a conversion ran.
pub async fn ensure_cached(config: Arc<Config>, source: Source) -> bool {
    if !is_enabled(&config) {
        return false;
    }
    let Some(final_) = final_path(&config, &source.image_hash) else {
        return false;
    };
    let claim = {
        let config = config.clone();
        let final_ = final_.clone();
        let video_length = source.video_length.clone();
        tokio::task::spawn_blocking(move || {
            claim_blocking(&config, &final_, video_length.as_deref())
        })
        .await
        .ok()
        .flatten()
    };
    let Some(part) = claim else {
        return false;
    };
    let (program, args) = cache_command(&config, &source.path, &part).await;
    run_transcode(&config, program, args, part, final_).await
}

fn claim_blocking(config: &Config, final_: &Path, video_length: Option<&str>) -> Option<PathBuf> {
    if final_.is_file() {
        return None;
    }
    let root = cache_root(config);
    if std::fs::create_dir_all(&root).is_err() {
        tracing::warn!(root = %root.display(), "cannot create the transcode cache");
        return None;
    }
    drop_stale_parts(&root);
    if in_flight(&root) >= config.transcode.cache_max_concurrent.max(1) {
        return None;
    }
    if !make_room(config, &root, estimated_size(video_length) as f64) {
        tracing::info!(path = %final_.display(), "no room to cache a transcode");
        return None;
    }
    let mut part = final_.as_os_str().to_owned();
    part.push(PART_SUFFIX);
    let part = PathBuf::from(part);
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part)
    {
        Ok(_) => Some(part),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => None,
        Err(_) => {
            tracing::warn!(root = %root.display(), "cannot write to the transcode cache");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_and_estimates() {
        assert_eq!(cpu_share(12, 2), 6);
        assert_eq!(cpu_share(1, 2), 1);
        assert_eq!(cpu_share(8, 0), 8);
        assert_eq!(estimated_size(Some("60")), estimated_size(None));
        assert_eq!(estimated_size(Some("120")), 2 * estimated_size(Some("60")));
        assert_eq!(estimated_size(Some("abc")), estimated_size(Some("0")));
    }

    #[test]
    fn option_probe_matches_whole_names() {
        let p = Probe {
            help: "  -readrate_initial_burst <float> blah\n-threads <int>\n".into(),
            filters: " ... zscale            V->V       Apply resizing\n T.. scale V->V\n".into(),
        };
        assert!(supports(&p, "readrate_initial_burst"));
        assert!(!supports(&p, "readrate"));
        assert!(supports(&p, "threads"));
        assert!(supports_filter(&p, "zscale"));
        assert!(supports_filter(&p, "scale"));
        assert!(!supports_filter(&p, "zsc"));
    }
}

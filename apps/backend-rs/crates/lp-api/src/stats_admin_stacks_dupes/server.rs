//! What the server says about itself (`api/views/server_info.py`,
//! `ServerStatsView` / `ServerLogs*View` in `api/views/dataviz.py`).

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use lp_auth::{AdminUser, AuthUser};
use lp_core::{ApiResult, AppState, QueryMap};
use lp_db::stats_admin_stacks_dupes::server as db;
use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::OnceCell;

/// `librephotos.logging_bootstrap.LOG_FILENAME`.
pub const LOG_FILENAME: &str = "ownphotos.log";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DiskUsage {
    pub total_storage: u64,
    pub used_storage: u64,
    pub free_storage: u64,
}

fn normalized(p: &Path) -> String {
    let s = p.display().to_string();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
    if cfg!(windows) {
        s.replace('/', "\\").to_lowercase()
    } else {
        s
    }
}

/// `shutil.disk_usage(path)` for the volume holding `path`.
pub fn disk_usage(path: &Path) -> DiskUsage {
    let target = normalized(&std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()));
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let best = disks
        .list()
        .iter()
        .filter(|d| target.starts_with(&normalized(d.mount_point())))
        .max_by_key(|d| normalized(d.mount_point()).len());
    match best {
        Some(d) => DiskUsage {
            total_storage: d.total_space(),
            used_storage: d.total_space().saturating_sub(d.available_space()),
            free_storage: d.available_space(),
        },
        None => DiskUsage {
            total_storage: 0,
            used_storage: 0,
            free_storage: 0,
        },
    }
}

type UsageCache = Mutex<HashMap<PathBuf, (Instant, DiskUsage)>>;

/// [`disk_usage`] cached for two seconds: every page asks for it.
fn cached_disk_usage(path: &Path) -> DiskUsage {
    static CACHE: OnceLock<UsageCache> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some((at, usage)) = cache.lock().ok().and_then(|c| c.get(path).copied())
        && at.elapsed() < Duration::from_secs(2)
    {
        return usage;
    }
    let usage = disk_usage(path);
    if let Ok(mut c) = cache.lock() {
        c.insert(path.to_path_buf(), (Instant::now(), usage));
    }
    usage
}

pub async fn storage_stats(
    State(state): State<AppState>,
    _user: AuthUser,
) -> ApiResult<Json<DiskUsage>> {
    let root = state.config.photos.clone();
    Ok(Json(
        state.blocking(move || cached_disk_usage(&root)).await?,
    ))
}

/// `read_git_hash`: `GIT_HASH`, else `git rev-parse --short HEAD`, else
/// `IMAGE_TAG` or `"unknown"`; computed once.
async fn git_hash() -> &'static str {
    static HASH: OnceCell<String> = OnceCell::const_new();
    HASH.get_or_init(|| async {
        if let Some(h) = std::env::var("GIT_HASH")
            .ok()
            .filter(|h| !h.trim().is_empty())
        {
            return h.trim().to_string();
        }
        let dir = std::env::current_dir().unwrap_or_default();
        let run = tokio::process::Command::new("git")
            .arg("-c")
            .arg(format!("safe.directory={}", dir.display()))
            .args(["rev-parse", "--short", "HEAD"])
            .current_dir(&dir)
            .stderr(std::process::Stdio::null())
            .output();
        match tokio::time::timeout(Duration::from_secs(5), run).await {
            Ok(Ok(out)) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            }
            _ => std::env::var("IMAGE_TAG")
                .ok()
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| "unknown".into()),
        }
    })
    .await
}

pub async fn image_tag(_user: AuthUser) -> ApiResult<Json<Value>> {
    Ok(Json(json!({
        "image_tag": std::env::var("IMAGE_TAG").unwrap_or_default(),
        "git_hash": git_hash().await,
    })))
}

/// `calc_megabytes`: whole MiB, Python rounding.
pub fn megabytes(bytes: i64) -> i64 {
    if bytes == 0 {
        return 0;
    }
    lp_core::codecs::py_round(bytes as f64 / 1024.0 / 1024.0, 0) as i64
}

/// min/max/mean/median of per-group counts as `_aggregate_stats` reports
/// them: min, max and mean turn 0 into null (`or None`), the median is an
/// int for an odd number of groups and a float for an even one.
fn aggregate(counts: &[i64]) -> [Value; 4] {
    if counts.is_empty() {
        return [Value::Null, Value::Null, Value::Null, Value::Null];
    }
    let mut sorted = counts.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let nonzero = |v: i64| if v == 0 { Value::Null } else { json!(v) };
    let mean = sorted.iter().sum::<i64>() as f64 / n as f64;
    let median = if n % 2 == 1 {
        json!(sorted[n / 2])
    } else {
        json!((sorted[n / 2 - 1] + sorted[n / 2]) as f64 / 2.0)
    };
    [
        nonzero(sorted[0]),
        nonzero(sorted[n - 1]),
        if mean == 0.0 {
            Value::Null
        } else {
            json!(mean)
        },
        median,
    ]
}

fn photo_group_stats(groups: &[(i64, i64)]) -> Value {
    let counts: Vec<i64> = groups.iter().map(|g| g.0).collect();
    let videos: Vec<i64> = groups.iter().map(|g| g.1).collect();
    let [min, max, mean, median] = aggregate(&counts);
    let [min_v, max_v, mean_v, median_v] = aggregate(&videos);
    json!({
        "count": groups.len(), "min": min, "max": max, "mean": mean, "median": median,
        "min_videos": min_v, "max_videos": max_v, "mean_videos": mean_v, "median_videos": median_v,
    })
}

fn person_group_stats(groups: &[(i64, i64)]) -> Value {
    let counts: Vec<i64> = groups.iter().map(|g| g.0).collect();
    let [min, max, mean, median] = aggregate(&counts);
    json!({"count": groups.len(), "min": min, "max": max, "mean": mean, "median": median})
}

/// `_get_user_stats` for every real user.
async fn user_stats(db_pool: &sqlx::PgPool) -> ApiResult<Vec<Value>> {
    let (users, totals, groups, clusters) = tokio::try_join!(
        db::real_users(db_pool),
        db::photo_totals(db_pool),
        db::group_counts(db_pool),
        db::cluster_counts(db_pool),
    )?;
    let totals: HashMap<i32, db::PhotoTotals> =
        totals.into_iter().map(|t| (t.owner_id, t)).collect();
    let clusters: HashMap<i32, i64> = clusters.into_iter().collect();
    let mut by_kind: HashMap<(i32, String), Vec<(i64, i64)>> = HashMap::new();
    for g in groups {
        by_kind
            .entry((g.owner_id, g.kind))
            .or_default()
            .push((g.count, g.videos));
    }
    let empty = Vec::new();
    Ok(users
        .into_iter()
        .map(|u| {
            let t = totals.get(&u.id).cloned().unwrap_or_default();
            let kind = |k: &str| by_kind.get(&(u.id, k.to_string())).unwrap_or(&empty);
            json!({
                "date_joined": u.date_joined.format("%d-%m-%Y").to_string(),
                "total_file_size_in_mb": megabytes(t.size_sum.unwrap_or(0)),
                "number_of_photos": t.photos,
                "number_of_videos": t.videos,
                "number_of_screenshots": t.screenshots,
                "number_of_documents": t.documents,
                "number_of_captions": t.captions,
                "number_of_generated_captions": t.generated_captions,
                "album": photo_group_stats(kind("user")),
                "person": person_group_stats(kind("person")),
                "number_of_clusters": clusters.get(&u.id).copied().unwrap_or(0),
                "places": photo_group_stats(kind("place")),
                "things": photo_group_stats(kind("thing")),
                "events": photo_group_stats(kind("auto")),
                "number_of_favorites": t.favorites,
                "number_of_hidden": t.hidden,
                "number_of_public": t.public,
            })
        })
        .collect())
}

/// `py-cpuinfo`'s fields the frontend schema requires, from sysinfo.
fn cpu_info() -> Value {
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_all();
    let cpus = sys.cpus();
    let first = cpus.first();
    let mhz = first.map(|c| c.frequency()).unwrap_or(0);
    let hz = mhz as i64 * 1_000_000;
    let friendly = format!("{:.4} GHz", mhz as f64 / 1000.0);
    let arch = match std::env::consts::ARCH {
        "x86_64" => "X86_64".to_string(),
        "x86" => "X86_32".to_string(),
        "aarch64" => "ARM_8".to_string(),
        other => other.to_uppercase(),
    };
    json!({
        "python_version": "n/a (librephotos-rs)",
        "cpuinfo_version": [0, 0, 0],
        "cpuinfo_version_string": "sysinfo",
        "arch": arch,
        "bits": usize::BITS,
        "count": cpus.len(),
        "arch_string_raw": if cfg!(windows) && std::env::consts::ARCH == "x86_64" { "AMD64" } else { std::env::consts::ARCH },
        "vendor_id_raw": first.map(|c| c.vendor_id()).unwrap_or(""),
        "brand_raw": first.map(|c| c.brand().trim()).unwrap_or(""),
        "hz_advertised_friendly": friendly,
        "hz_actual_friendly": friendly,
        "hz_advertised": [hz, 0],
        "hz_actual": [hz, 0],
        "model": 0,
        "flags": [],
    })
}

/// `_get_gpu_info`: the first NVIDIA GPU's name and memory (MB), else `""`s.
async fn gpu_info() -> (String, Value) {
    let run = tokio::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .stderr(std::process::Stdio::null())
        .output();
    let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(5), run).await else {
        return (String::new(), json!(""));
    };
    if !out.status.success() {
        return (String::new(), json!(""));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.trim().lines().next().unwrap_or("");
    let (name, mem) = line.split_once(',').unwrap_or((line, ""));
    let name = name.trim().to_string();
    if name.is_empty() {
        return (String::new(), json!(""));
    }
    match mem.trim().parse::<f64>() {
        Ok(mb) => (name, json!(mb as i64)),
        Err(_) => (name, json!("")),
    }
}

pub async fn server_stats(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let (users, (gpu_name, gpu_memory), (cpu, ram, disk)) = tokio::try_join!(
        user_stats(&state.db),
        async { Ok(gpu_info().await) },
        state.blocking(|| {
            let mut sys = sysinfo::System::new();
            sys.refresh_memory();
            let root = std::env::current_dir()
                .ok()
                .and_then(|d| d.ancestors().last().map(Path::to_path_buf))
                .unwrap_or_else(|| PathBuf::from("/"));
            (cpu_info(), sys.total_memory(), disk_usage(&root))
        }),
    )?;
    Ok(Json(json!({
        "cpu_info": cpu,
        "image_tag": std::env::var("IMAGE_TAG").unwrap_or_default(),
        "available_ram_in_mb": megabytes(ram as i64),
        "gpu_name": gpu_name,
        "gpu_memory_in_mb": gpu_memory,
        "total_storage_in_mb": megabytes(disk.total_storage as i64),
        "used_storage_in_mb": megabytes(disk.used_storage as i64),
        "free_storage_in_mb": megabytes(disk.free_storage as i64),
        "number_of_users": users.len(),
        "users": users,
    })))
}

fn log_path(state: &AppState) -> PathBuf {
    state.config.base_logs.join(LOG_FILENAME)
}

/// `GET /api/serverlogs`: the whole log file as an attachment.
pub async fn server_logs(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Response> {
    let path = log_path(&state);
    let file = match tokio::fs::File::open(&path).await {
        Ok(f) => f,
        Err(_) => {
            return Ok((
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Log file not found"})),
            )
                .into_response());
        }
    };
    let len = file.metadata().await.map(|m| m.len()).ok();
    let mut resp = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(file)));
    let h = resp.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().expect("static"),
    );
    h.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{LOG_FILENAME}\"")
            .parse()
            .expect("static"),
    );
    if let Some(len) = len {
        h.insert(header::CONTENT_LENGTH, len.into());
    }
    Ok(resp)
}

/// The last `n` lines of `path` (each keeping its `\n`), read from the end.
pub fn tail_lines(path: &Path, n: usize) -> std::io::Result<(Vec<u8>, usize)> {
    let mut f = std::fs::File::open(path)?;
    let size = f.seek(SeekFrom::End(0))?;
    let mut start = size;
    let mut buf: Vec<u8> = Vec::new();
    let mut newlines = 0usize;
    // A final "\n" ends the last line rather than starting a new one.
    let mut skip_final = true;
    'scan: while start > 0 {
        let chunk = (64 * 1024).min(start);
        start -= chunk;
        f.seek(SeekFrom::Start(start))?;
        let mut piece = vec![0u8; chunk as usize];
        f.read_exact(&mut piece)?;
        for i in (0..piece.len()).rev() {
            if piece[i] != b'\n' {
                skip_final = false;
                continue;
            }
            if skip_final {
                skip_final = false;
                continue;
            }
            newlines += 1;
            if newlines == n {
                piece.drain(..=i);
                piece.extend_from_slice(&buf);
                buf = piece;
                break 'scan;
            }
        }
        piece.extend_from_slice(&buf);
        buf = piece;
    }
    let count = buf.split_inclusive(|b| *b == b'\n').count();
    Ok((buf, count))
}

pub async fn server_logs_view(
    State(state): State<AppState>,
    _admin: AdminUser,
    q: QueryMap,
) -> ApiResult<Response> {
    let lines = q
        .get("lines")
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(1, 1000) as usize;
    let path = log_path(&state);
    if !path.exists() {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"logs": "", "count": 0, "error": "Log file not found"})),
        )
            .into_response());
    }
    match state.blocking(move || tail_lines(&path, lines)).await? {
        Ok((bytes, count)) => Ok(Json(json!({
            "logs": String::from_utf8_lossy(&bytes),
            "count": count,
        }))
        .into_response()),
        Err(e) => {
            tracing::error!(error = %e, "reading the log file");
            Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"logs": "", "count": 0, "error": "Failed to read log file"})),
            )
                .into_response())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_like_django() {
        assert_eq!(
            aggregate(&[]),
            [Value::Null, Value::Null, Value::Null, Value::Null]
        );
        assert_eq!(
            aggregate(&[0, 3, 1]),
            [Value::Null, json!(3), json!(4.0 / 3.0), json!(1)]
        );
        assert_eq!(
            aggregate(&[2, 3]),
            [json!(2), json!(3), json!(2.5), json!(2.5)]
        );
        assert_eq!(
            aggregate(&[0, 0]),
            [Value::Null, Value::Null, Value::Null, json!(0.0)]
        );
    }

    #[test]
    fn tails_lines() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.log");
        std::fs::write(&p, "a\nb\nc\n").unwrap();
        assert_eq!(tail_lines(&p, 2).unwrap(), (b"b\nc\n".to_vec(), 2));
        assert_eq!(tail_lines(&p, 10).unwrap(), (b"a\nb\nc\n".to_vec(), 3));
        std::fs::write(&p, "a\nb\nc").unwrap();
        assert_eq!(tail_lines(&p, 1).unwrap(), (b"c".to_vec(), 1));
        std::fs::write(&p, "").unwrap();
        assert_eq!(tail_lines(&p, 5).unwrap(), (Vec::new(), 0));
        let big: String = (0..100_000).map(|i| format!("line {i}\n")).collect();
        std::fs::write(&p, &big).unwrap();
        let (tail, n) = tail_lines(&p, 3).unwrap();
        assert_eq!(
            (tail, n),
            (b"line 99997\nline 99998\nline 99999\n".to_vec(), 3)
        );
    }

    #[test]
    fn megabytes_round_half_even() {
        assert_eq!(megabytes(0), 0);
        assert_eq!(megabytes(1024 * 1024 * 5 / 2), 2);
        assert_eq!(megabytes(1024 * 1024 * 7 / 2), 4);
    }
}

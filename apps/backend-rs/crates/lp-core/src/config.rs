//! Process configuration, read from the same environment variables as Django
//! (`librephotos/settings/production.py`) plus the `LP_*` additions (01).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use rand::Rng;

#[derive(Debug, Clone)]
pub struct DbConfig {
    pub name: String,
    pub user: String,
    pub pass: String,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone)]
pub struct Features {
    pub process_embedded_media: bool,
    pub video: bool,
    pub face_detection: bool,
    pub face_cluster: bool,
    pub image_captioning: bool,
    pub reverse_geocoding: bool,
    pub scene_classification: bool,
}

#[derive(Debug, Clone)]
pub struct TranscodeConfig {
    pub cache_max_gb: f64,
    pub cache_min_free_gb: f64,
    pub cache_max_concurrent: usize,
    pub cache_nice: i32,
    pub live_cpu_fraction: usize,
    pub live_readrate: f64,
    pub live_burst_seconds: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaMode {
    /// Empty body + `X-Accel-Redirect` into nginx's internal locations.
    XAccel,
    /// Stream files from Rust (native dev behind Vite's proxy, benchmark variant).
    Direct,
}

/// Paths of the external binaries. On Windows set these explicitly: a bare
/// `ffmpeg` resolves to System32 before PATH.
#[derive(Debug, Clone)]
pub struct Binaries {
    pub exiftool: PathBuf,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    /// libvips shared library for dynamic loading (`LP_VIPS_LIB`), if set.
    pub vips_lib: Option<PathBuf>,
    /// Python interpreter used to launch the ML sidecars.
    pub python: PathBuf,
}

#[derive(Debug, Clone)]
pub struct AdminBootstrap {
    pub username: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub base_data: PathBuf,
    pub base_logs: PathBuf,
    /// `PHOTOS` (Django `DATA_ROOT`): default `$BASE_DATA/data`.
    pub photos: PathBuf,
    /// `$BASE_DATA/protected_media`.
    pub media_root: PathBuf,
    pub secret_key: String,
    pub db: DbConfig,
    pub features: Features,
    pub transcode: TranscodeConfig,
    pub access_token_minutes: i64,
    pub refresh_token_days: i64,
    /// Env-derived defaults for site settings without a stored row.
    pub env_allow_upload: bool,
    pub env_nextcloud_enabled: bool,
    pub env_skip_patterns: String,
    pub env_map_api_provider: String,
    pub env_mapbox_api_key: String,
    pub env_map_tile_provider: String,
    pub worker_concurrency: usize,
    /// `LP_SCAN_CONCURRENCY`: file groups a scan job processes at once
    /// (thumbnails, metadata, pHash); 0 (default) = the larger of
    /// `WORKER_CONCURRENCY` and min(cores, 8), see [`Config::scan_concurrency`].
    pub scan_concurrency: usize,
    pub log_level: String,
    /// `LOG_LEVELS`: per-target overrides, `target=LEVEL,...` (Django's
    /// per-logger list; Rust targets are module paths, `.` read as `::`).
    pub log_levels: String,
    /// `LOG_TO_CONSOLE` (default on): mirror the log file to stdout.
    pub log_to_console: bool,
    /// Django's `ALLOWED_HOSTS` (`["localhost", BACKEND_HOST]`), checked
    /// against the Host header when `BACKEND_HOST` is set, or exactly
    /// `LP_ALLOWED_HOSTS` (comma-separated, `*` = any) when that is; None =
    /// no check (the binary is also run without a proxy in front).
    pub allowed_hosts: Option<Vec<String>>,
    pub media_mode: MediaMode,
    pub db_pool: u32,
    /// `LP_EXIF_POOL`: ExifTool processes per lane (default min(2, cores);
    /// the scan reads metadata in batches, so 2 keep up with 6 workers).
    pub exif_pool: usize,
    /// `LP_EXIF_IDLE_SECS`: stop ExifTool processes idle this long (default
    /// 15: a respawn is one perl start-up; 0 = keep them).
    pub exif_idle_secs: u64,
    /// `LP_DEV_FALLBACK`: unmatched /api and /media requests are proxied here.
    pub dev_fallback: Option<String>,
    pub bind: SocketAddr,
    pub demo_site: bool,
    pub admin: Option<AdminBootstrap>,
    pub onnx_providers: Option<String>,
    pub binaries: Binaries,
    pub cores: usize,
}

type Lookup<'a> = dyn Fn(&str) -> Option<String> + 'a;

/// Django's `split_domain_port` + `validate_host`: the Host header's
/// domain (port and a trailing dot dropped, lower-cased) matches one of
/// `patterns`: `*`, an exact name, or `.example.com` for the domain and its
/// subdomains.
pub fn host_allowed(host: &str, patterns: &[String]) -> bool {
    let host = host.trim().to_lowercase();
    let domain = if host.starts_with('[') {
        match host.find(']') {
            Some(i) => &host[..=i],
            None => return false,
        }
    } else {
        host.rsplit_once(':').map_or(host.as_str(), |(d, _)| d)
    };
    let domain = domain.strip_suffix('.').unwrap_or(domain);
    if domain.is_empty() {
        return false;
    }
    patterns.iter().any(|p| {
        p == "*"
            || p == domain
            || (p.starts_with('.') && (domain.ends_with(p.as_str()) || domain == &p[1..]))
    })
}

fn allowed_hosts(get: &Lookup) -> Option<Vec<String>> {
    if let Some(list) = get("LP_ALLOWED_HOSTS") {
        return Some(
            list.split(',')
                .map(|h| h.trim().to_lowercase())
                .filter(|h| !h.is_empty())
                .collect(),
        );
    }
    let backend = get("BACKEND_HOST").filter(|h| !h.trim().is_empty())?;
    Some(vec!["localhost".into(), backend.trim().to_lowercase()])
}

impl Config {
    /// File groups a scan job processes at once: `LP_SCAN_CONCURRENCY`, else
    /// the larger of `WORKER_CONCURRENCY` and min(cores, 8) (hardware
    /// threads). A scan is one job, so with a single worker it would
    /// otherwise render one photo at a time on an otherwise idle box
    /// (OPTIMIZATIONS.md #8); 8 is the knee on 6 cores / 12 threads (#21:
    /// 4 -> 8 = +35%, 12 and 16 no faster), a 4-core Pi stays at 4.
    pub fn scan_concurrency(&self) -> usize {
        match self.scan_concurrency {
            0 => self.worker_concurrency.max(self.cores.min(8)).max(1),
            n => n,
        }
    }

    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_lookup(&|k| std::env::var(k).ok())
    }

    /// Build from an explicit map (tests), ignoring the process environment.
    pub fn from_map(vars: &HashMap<String, String>) -> anyhow::Result<Self> {
        Self::from_lookup(&|k| vars.get(k).cloned())
    }

    pub fn from_lookup(get: &Lookup<'_>) -> anyhow::Result<Self> {
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let base_data = PathBuf::from(get("BASE_DATA").unwrap_or_else(|| "/".into()));
        let base_logs = PathBuf::from(get("BASE_LOGS").unwrap_or_else(|| "/logs/".into()));
        let photos = get("PHOTOS")
            .map(PathBuf::from)
            .unwrap_or_else(|| base_data.join("data"));
        let media_root = base_data.join("protected_media");

        let secret_key = match get("SECRET_KEY").filter(|s| !s.is_empty()) {
            Some(k) => k,
            None => load_or_create_secret(&base_logs)?,
        };

        let db = DbConfig {
            name: get("DB_NAME").unwrap_or_else(|| "db".into()),
            user: get("DB_USER").unwrap_or_else(|| "docker".into()),
            pass: get("DB_PASS").unwrap_or_else(|| "AaAa1234".into()),
            host: get("DB_HOST").unwrap_or_else(|| "db".into()),
            port: parse_num(get, "DB_PORT", 5432)?,
        };

        let features = Features {
            process_embedded_media: env_flag(get, "FEATURE_PROCESS_EMBEDDED_MEDIA", true, false),
            video: env_flag(get, "FEATURE_VIDEO", true, false),
            face_detection: env_flag(get, "FEATURE_FACE_DETECTION", true, false),
            face_cluster: env_flag(get, "FEATURE_FACE_CLUSTER", true, false),
            image_captioning: env_flag(get, "FEATURE_IMAGE_CAPTIONING", true, false),
            reverse_geocoding: env_flag(get, "FEATURE_REVERSE_GEOCODING", true, false),
            scene_classification: env_flag(get, "FEATURE_SCENE_CLASSIFICATION", true, false),
        };

        let transcode = TranscodeConfig {
            cache_max_gb: parse_num(get, "TRANSCODE_CACHE_MAX_GB", 10.0)?,
            cache_min_free_gb: parse_num(get, "TRANSCODE_CACHE_MIN_FREE_GB", 2.0)?,
            cache_max_concurrent: parse_num(get, "TRANSCODE_CACHE_MAX_CONCURRENT", 1)?,
            cache_nice: parse_num(get, "TRANSCODE_CACHE_NICE", 10)?,
            live_cpu_fraction: parse_num(get, "TRANSCODE_LIVE_CPU_FRACTION", 2usize)?.max(1),
            live_readrate: parse_num(get, "TRANSCODE_LIVE_READRATE", 2.0)?,
            live_burst_seconds: parse_num(get, "TRANSCODE_LIVE_BURST_SECONDS", 30.0)?,
        };

        let media_mode = match get("LP_MEDIA_MODE").as_deref().map(str::trim) {
            None | Some("") | Some("x-accel") | Some("xaccel") => MediaMode::XAccel,
            Some("direct") => MediaMode::Direct,
            Some(other) => bail!("LP_MEDIA_MODE must be x-accel or direct, got {other:?}"),
        };

        let bind_raw = get("LP_BIND").unwrap_or_else(|| "0.0.0.0:8001".into());
        let bind: SocketAddr = if bind_raw.contains(':') {
            bind_raw
                .parse()
                .with_context(|| format!("LP_BIND {bind_raw:?}"))?
        } else {
            format!("0.0.0.0:{bind_raw}")
                .parse()
                .with_context(|| format!("LP_BIND {bind_raw:?}"))?
        };

        let admin = match (get("ADMIN_USERNAME"), get("ADMIN_PASSWORD")) {
            (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => Some(AdminBootstrap {
                username: u,
                email: get("ADMIN_EMAIL").unwrap_or_default(),
                password: p,
            }),
            _ => None,
        };

        let binaries = Binaries {
            exiftool: PathBuf::from(get("LP_EXIFTOOL").unwrap_or_else(|| "exiftool".into())),
            ffmpeg: PathBuf::from(get("LP_FFMPEG").unwrap_or_else(|| "ffmpeg".into())),
            ffprobe: PathBuf::from(get("LP_FFPROBE").unwrap_or_else(|| "ffprobe".into())),
            vips_lib: get("LP_VIPS_LIB")
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
            python: PathBuf::from(get("LP_PYTHON").unwrap_or_else(|| "python3".into())),
        };

        Ok(Config {
            base_data,
            base_logs,
            photos,
            media_root,
            secret_key,
            db,
            features,
            transcode,
            access_token_minutes: 5,
            refresh_token_days: parse_num(get, "REFRESH_TOKEN_DAYS", 7)?,
            env_allow_upload: env_flag(get, "ALLOW_UPLOAD", true, true),
            env_nextcloud_enabled: matches!(
                get("NEXTCLOUD_ENABLED")
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase()
                    .as_str(),
                "true" | "1" | "t" | "yes" | "on"
            ),
            env_skip_patterns: get("SKIP_PATTERNS").unwrap_or_default(),
            env_map_api_provider: get("MAP_API_PROVIDER").unwrap_or_else(|| "nominatim".into()),
            env_mapbox_api_key: get("MAPBOX_API_KEY").unwrap_or_default(),
            env_map_tile_provider: get("MAP_TILE_PROVIDER").unwrap_or_else(|| "photoprism".into()),
            worker_concurrency: parse_num(get, "WORKER_CONCURRENCY", cores)?.max(1),
            scan_concurrency: parse_num(get, "LP_SCAN_CONCURRENCY", 0usize)?,
            log_level: get("LOG_LEVEL").unwrap_or_else(|| "info".into()),
            log_levels: get("LOG_LEVELS").unwrap_or_default(),
            log_to_console: get("LOG_TO_CONSOLE").is_none_or(|v| {
                matches!(
                    v.trim().to_lowercase().as_str(),
                    "true" | "1" | "yes" | "on"
                )
            }),
            allowed_hosts: allowed_hosts(get),
            media_mode,
            db_pool: parse_num(get, "LP_DB_POOL", (2 * cores) as u32)?.max(1),
            exif_pool: parse_num(get, "LP_EXIF_POOL", cores.min(2))?.max(1),
            exif_idle_secs: parse_num(get, "LP_EXIF_IDLE_SECS", 15)?,
            dev_fallback: get("LP_DEV_FALLBACK")
                .map(|s| s.trim().trim_end_matches('/').to_string())
                .filter(|s| !s.is_empty()),
            bind,
            demo_site: env_flag(get, "DEMO_SITE", false, false),
            admin,
            onnx_providers: get("ONNX_PROVIDERS").filter(|s| !s.is_empty()),
            binaries,
            cores,
        })
    }

    /// `postgres://` URL for the configured database (password URL-encoded).
    pub fn database_url(&self) -> String {
        self.database_url_for(&self.db.name)
    }

    pub fn database_url_for(&self, db_name: &str) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}",
            urlencoding::encode(&self.db.user),
            urlencoding::encode(&self.db.pass),
            self.db.host,
            self.db.port,
            urlencoding::encode(db_name)
        )
    }

    pub fn thumbnails_big_dir(&self) -> PathBuf {
        self.media_root.join("thumbnails_big")
    }
    pub fn square_thumbnails_dir(&self) -> PathBuf {
        self.media_root.join("square_thumbnails")
    }
    pub fn square_thumbnails_small_dir(&self) -> PathBuf {
        self.media_root.join("square_thumbnails_small")
    }
    pub fn faces_dir(&self) -> PathBuf {
        self.media_root.join("faces")
    }
    pub fn embedded_media_dir(&self) -> PathBuf {
        self.media_root.join("embedded_media")
    }
    pub fn transcoded_dir(&self) -> PathBuf {
        self.media_root.join("transcoded")
    }
    pub fn zip_dir(&self) -> PathBuf {
        self.media_root.join("zip")
    }
    pub fn avatars_dir(&self) -> PathBuf {
        self.media_root.join("avatars")
    }
    pub fn chunked_uploads_dir(&self) -> PathBuf {
        self.media_root.join("chunked_uploads")
    }
    pub fn data_models_dir(&self) -> PathBuf {
        self.media_root.join("data_models")
    }
}

/// Django's `_env_flag`: unset = `default`, blank = `empty`, else true/1/yes/on.
pub fn env_flag(get: &Lookup<'_>, name: &str, default: bool, empty: bool) -> bool {
    match get(name) {
        None => default,
        Some(v) => {
            let v = v.trim();
            if v.is_empty() {
                empty
            } else {
                matches!(v.to_lowercase().as_str(), "true" | "1" | "yes" | "on")
            }
        }
    }
}

fn parse_num<T: std::str::FromStr>(get: &Lookup<'_>, name: &str, default: T) -> anyhow::Result<T> {
    match get(name)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        None => Ok(default),
        Some(v) => v
            .parse::<T>()
            .map_err(|_| anyhow::anyhow!("{name} must be a number, got {v:?}")),
    }
}

/// `$BASE_LOGS/secret.key`, generated like Django's `get_random_secret_key()` if missing.
fn load_or_create_secret(base_logs: &Path) -> anyhow::Result<String> {
    let path = base_logs.join("secret.key");
    if let Ok(s) = std::fs::read_to_string(&path) {
        let s = s.trim().to_string();
        if !s.is_empty() {
            return Ok(s);
        }
    }
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*(-_=+)";
    let mut rng = rand::thread_rng();
    let key: String = (0..50)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect();
    std::fs::create_dir_all(base_logs)
        .with_context(|| format!("creating BASE_LOGS {}", base_logs.display()))?;
    std::fs::write(&path, &key).with_context(|| format!("writing {}", path.display()))?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(pairs: &[(&str, &str)]) -> Config {
        let mut m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        m.entry("SECRET_KEY".into()).or_insert_with(|| "x".into());
        Config::from_map(&m).unwrap()
    }

    #[test]
    fn defaults_follow_django() {
        let c = cfg(&[("BASE_DATA", "/srv")]);
        assert_eq!(c.media_root, PathBuf::from("/srv").join("protected_media"));
        assert_eq!(c.photos, PathBuf::from("/srv").join("data"));
        assert_eq!(c.bind.port(), 8001);
        assert!(c.env_allow_upload);
        assert_eq!(c.refresh_token_days, 7);
        assert_eq!(c.media_mode, MediaMode::XAccel);
    }

    #[test]
    fn allowed_hosts_like_django() {
        let hosts = |pairs: &[(&str, &str)]| cfg(pairs).allowed_hosts;
        assert_eq!(hosts(&[]), None);
        assert_eq!(
            hosts(&[("BACKEND_HOST", "Backend")]),
            Some(vec!["localhost".to_string(), "backend".to_string()])
        );
        assert_eq!(
            hosts(&[("BACKEND_HOST", "backend"), ("LP_ALLOWED_HOSTS", "*, a.b")]),
            Some(vec!["*".to_string(), "a.b".to_string()])
        );
        let p: Vec<String> = ["localhost", ".example.com", "10.0.0.5"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        for ok in [
            "localhost",
            "LOCALHOST:3000",
            "localhost.",
            "example.com",
            "photos.example.com:443",
            "10.0.0.5:8001",
        ] {
            assert!(host_allowed(ok, &p), "{ok}");
        }
        for bad in [
            "evil.com",
            "example.com.evil.com",
            "",
            ":80",
            "[::1]:8000",
            "notexample.com",
        ] {
            assert!(!host_allowed(bad, &p), "{bad}");
        }
        assert!(host_allowed("[::1]:8000", &["[::1]".to_string()]));
        assert!(host_allowed("anything", &["*".to_string()]));
    }

    #[test]
    fn flags() {
        let c = cfg(&[
            ("ALLOW_UPLOAD", ""),
            ("FEATURE_VIDEO", ""),
            ("FEATURE_FACE_DETECTION", "off"),
        ]);
        assert!(c.env_allow_upload, "blank ALLOW_UPLOAD means on");
        assert!(!c.features.video, "blank FEATURE_ means off");
        assert!(!c.features.face_detection);
        let c = cfg(&[("LP_BIND", "9000"), ("LP_MEDIA_MODE", "direct")]);
        assert_eq!(c.bind.port(), 9000);
        assert_eq!(c.media_mode, MediaMode::Direct);
    }
}

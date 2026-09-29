//! `/locclust/` and `/folders/subfolders/`.

use std::path::{Path as FsPath, PathBuf};

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::{ApiResult, AppState, QueryMap};
use lp_db::albums_tags::misc::{folder_photo_counts, geolocation_features};
use serde::Serialize;
use serde_json::{Value, json};

/// `_location_cluster_row`: `[lat, lon, text]` from a feature with a
/// non-numeric `text` and a `center` of at least two numbers.
fn cluster_row(feature: &Value) -> Option<(f64, f64, String)> {
    let obj = feature.as_object()?;
    let text = match obj.get("text")? {
        Value::String(s) if !s.is_empty() => s.clone(),
        _ => return None,
    };
    let digits = text.strip_prefix('-').unwrap_or(&text);
    if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let center = obj.get("center")?.as_array()?;
    if center.len() < 2 {
        return None;
    }
    let num = |v: &Value| -> Option<f64> {
        match v {
            Value::Number(n) => n.as_f64(),
            Value::Bool(b) => Some(*b as u8 as f64),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        }
    };
    Some((num(&center[1])?, num(&center[0])?, text))
}

/// `GET /api/locclust/`: one `[lat, lon, name]` per distinct place name of
/// the user's photos (first occurrence wins), sorted by name.
pub async fn location_clusters(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> ApiResult<Json<Vec<(f64, f64, String)>>> {
    let rows = geolocation_features(&state.db, user.id).await?;
    let clusters = state
        .blocking(move || {
            let mut by_name: std::collections::BTreeMap<String, (f64, f64, String)> =
                std::collections::BTreeMap::new();
            for features in rows.into_iter().flatten() {
                let Some(list) = features.as_array() else {
                    continue;
                };
                for feature in list {
                    if let Some(row) = cluster_row(feature) {
                        by_name.entry(row.2.clone()).or_insert(row);
                    }
                }
            }
            by_name.into_values().collect::<Vec<_>>()
        })
        .await?;
    Ok(Json(clusters))
}

const PAGE_SIZE: usize = 100;

fn error(status: u16, message: &str) -> Response {
    (
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        Json(json!({ "error": message })),
    )
        .into_response()
}

/// `os.path.normpath` for POSIX paths (Windows gets it from `absolute`).
#[cfg(not(windows))]
fn normpath(p: &FsPath) -> PathBuf {
    use std::path::Component;
    let mut out: Vec<Component> = Vec::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(out.last(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            other => out.push(other),
        }
    }
    out.iter().collect()
}

/// `os.path.normcase(os.path.abspath(p))`.
fn norm_abs(p: &str) -> String {
    let abs = std::path::absolute(FsPath::new(p)).unwrap_or_else(|_| PathBuf::from(p));
    #[cfg(windows)]
    {
        abs.to_string_lossy().replace('/', "\\").to_lowercase()
    }
    #[cfg(not(windows))]
    {
        normpath(&abs).to_string_lossy().into_owned()
    }
}

/// `api.util.is_valid_path`: `path` is `root` or lies inside it.
fn is_valid_path(path: &str, root: &str) -> bool {
    let abs_path = norm_abs(path);
    let abs_root = norm_abs(root);
    if abs_path == abs_root {
        return true;
    }
    let sep = std::path::MAIN_SEPARATOR;
    let prefix = if abs_root.ends_with(sep) {
        abs_root
    } else {
        format!("{abs_root}{sep}")
    };
    abs_path.starts_with(&prefix)
}

/// `os.path.join(base, name)`.
fn join(base: &str, name: &str) -> String {
    let seps: &[char] = if cfg!(windows) { &['/', '\\'] } else { &['/'] };
    if base.is_empty() || base.ends_with(seps) || (cfg!(windows) && base.ends_with(':')) {
        format!("{base}{name}")
    } else {
        format!("{base}{}{name}", std::path::MAIN_SEPARATOR)
    }
}

/// `os.path.dirname`.
fn dirname(p: &str) -> String {
    let seps: &[char] = if cfg!(windows) { &['/', '\\'] } else { &['/'] };
    let Some(idx) = p.rfind(seps) else {
        return String::new();
    };
    let head = &p[..=idx];
    let trimmed = head.trim_end_matches(seps);
    // Keep a root ("/", "C:\") intact, like Python does.
    if trimmed.is_empty() || (cfg!(windows) && trimmed.ends_with(':')) {
        head.to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Serialize)]
struct Subfolder {
    name: String,
    path: String,
    photo_count: i64,
    modified: f64,
}

#[derive(Debug, Serialize)]
struct Pagination {
    page: i64,
    page_size: usize,
    total_folders: usize,
    total_pages: usize,
    has_next: bool,
    has_previous: bool,
}

#[derive(Debug, Serialize)]
struct FolderResponse {
    current_path: String,
    parent_path: Option<String>,
    subfolders: Vec<Subfolder>,
    pagination: Pagination,
}

/// `st_mtime` as Python computes it (`sec + nsec * 1e-9`).
fn py_mtime(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as f64 + d.subsec_nanos() as f64 * 1e-9)
        .unwrap_or(0.0)
}

/// `_scan_folder_entries`: visible sub-directories, by lower-cased name.
fn scan_entries(base: &str) -> std::io::Result<Vec<(String, String, f64)>> {
    let mut entries = Vec::new();
    for item in std::fs::read_dir(base)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        let path = join(base, &name);
        // `DirEntry.is_dir()` follows symlinks.
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.is_dir() && !name.starts_with('.') {
            entries.push((name, path, py_mtime(&meta)));
        }
    }
    entries.sort_by_key(|e| e.0.to_lowercase());
    Ok(entries)
}

/// `GET /api/folders/subfolders/?path=&page=` (`FolderNavigationViewSet`).
/// Admins browse `DATA_ROOT`, everyone else only their scan directory.
pub async fn subfolders(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
) -> ApiResult<Response> {
    let page = match q.get("page") {
        None => 1,
        Some(p) => p
            .trim()
            .parse::<i64>()
            .ok()
            .filter(|p| *p >= 1)
            .unwrap_or(1),
    };
    let is_admin = user.is_staff;
    let data_root = state.config.photos.to_string_lossy().into_owned();
    let scan_dir = (!user.scan_directory.is_empty()).then(|| user.scan_directory.clone());
    let default_path = if is_admin {
        data_root.clone()
    } else {
        match &scan_dir {
            Some(d) => d.clone(),
            None => return Ok(error(403, "User scan directory not configured")),
        }
    };
    let base = q.get("path").map(str::to_string).unwrap_or(default_path);

    if is_admin {
        if !is_valid_path(&base, &data_root) {
            return Ok(error(403, "Access denied"));
        }
    } else {
        let Some(scan) = &scan_dir else {
            return Ok(error(403, "User scan directory not configured"));
        };
        if !FsPath::new(scan).exists() {
            return Ok(error(403, "Scan directory does not exist"));
        }
        if !is_valid_path(&base, scan) {
            return Ok(error(
                403,
                "Access denied - can only access folders within your scan directory",
            ));
        }
    }
    let base_fs = FsPath::new(&base);
    if !base_fs.exists() {
        return Ok(error(400, "Path does not exist"));
    }
    if !base_fs.is_dir() {
        return Ok(error(400, "Path is not a directory"));
    }

    let scan_base = base.clone();
    let entries = match state.blocking(move || scan_entries(&scan_base)).await? {
        Ok(e) => e,
        Err(e) => {
            tracing::error!("Error scanning directory {base}: {e}");
            return Ok(error(500, "Error scanning directory"));
        }
    };
    let root = if is_admin {
        data_root
    } else {
        user.scan_directory.clone()
    };
    let parent_path = (base != root).then(|| dirname(&base));
    let total = entries.len();
    let start = ((page - 1) as usize).saturating_mul(PAGE_SIZE);
    let page_entries: Vec<_> = entries.into_iter().skip(start).take(PAGE_SIZE).collect();
    let subfolders = if page_entries.is_empty() {
        Vec::new()
    } else {
        let paths: Vec<String> = page_entries.iter().map(|e| e.1.clone()).collect();
        let counts = folder_photo_counts(&state.db, user.id, &paths).await?;
        page_entries
            .into_iter()
            .zip(counts)
            .filter(|(_, c)| *c > 0)
            .map(|((name, path, modified), photo_count)| Subfolder {
                name,
                path,
                photo_count,
                modified,
            })
            .collect()
    };
    let total_pages = total.div_ceil(PAGE_SIZE);
    Ok(Json(FolderResponse {
        current_path: base,
        parent_path,
        subfolders,
        pagination: Pagination {
            page,
            page_size: PAGE_SIZE,
            total_folders: total,
            total_pages,
            has_next: (page as usize) < total_pages,
            has_previous: page > 1,
        },
    })
    .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cluster_rows() {
        let f = json!({"text": "Berlin", "center": [13.4, 52.5]});
        assert_eq!(cluster_row(&f), Some((52.5, 13.4, "Berlin".into())));
        assert_eq!(cluster_row(&json!({"text": "-12", "center": [1, 2]})), None);
        assert_eq!(cluster_row(&json!({"text": "X", "center": [1]})), None);
    }

    #[test]
    fn paths() {
        #[cfg(windows)]
        {
            assert!(is_valid_path("C:\\data\\alice\\x", "C:/Data/Alice"));
            assert!(!is_valid_path("C:\\data\\alice2", "C:\\data\\alice"));
            assert!(!is_valid_path(
                "C:\\data\\alice\\..\\bob",
                "C:\\data\\alice"
            ));
            assert_eq!(dirname("C:\\data\\alice\\x"), "C:\\data\\alice");
            assert_eq!(join("C:\\data", "x"), "C:\\data\\x");
        }
        #[cfg(not(windows))]
        {
            assert!(is_valid_path("/data/alice/x", "/data/alice/"));
            assert!(!is_valid_path("/data/alice/../bob", "/data/alice"));
            assert_eq!(dirname("/data/alice/x"), "/data/alice");
        }
    }
}

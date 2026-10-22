//! `GET /api/dirtree/?path=` (`RootPathTreeView` + `api_util.path_to_dict`):
//! two levels of non-hidden subdirectories below a path inside `DATA_ROOT`.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AdminUser;
use lp_core::{ApiResult, AppState, QueryMap};
use serde_json::{Value, json};

use super::pypath;

fn is_hidden(path: &str) -> bool {
    if pypath::basename(&pypath::abspath(path)).starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Ok(m) = std::fs::metadata(path) {
            return m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0;
        }
    }
    false
}

fn list_subdirectories(path: &str) -> Vec<String> {
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("Could not list directory {path}: {e}");
            return Vec::new();
        }
    };
    entries
        .flatten()
        .map(|e| pypath::join(path, &e.file_name().to_string_lossy()))
        .filter(|p| std::path::Path::new(p).is_dir() && !is_hidden(p))
        .collect()
}

fn path_to_dict(path: &str, recurse: u32) -> Value {
    let mut children: Vec<Value> = if recurse > 0 {
        list_subdirectories(path)
            .iter()
            .map(|c| path_to_dict(c, recurse - 1))
            .collect()
    } else {
        Vec::new()
    };
    children.sort_by_cached_key(|c| c["title"].as_str().unwrap_or_default().to_lowercase());
    json!({
        "title": pypath::basename(path),
        "absolute_path": path,
        "children": children,
    })
}

pub async fn dirtree(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
    q: QueryMap,
) -> ApiResult<Response> {
    let base = state.config.photos.to_string_lossy().into_owned();
    let path = q
        .non_empty("path")
        .map(str::to_string)
        .unwrap_or(base.clone());
    if !pypath::is_valid_path(&path, &base) {
        return Ok((
            StatusCode::FORBIDDEN,
            Json(json!({"message": "Access denied. Path is outside the allowed directory."})),
        )
            .into_response());
    }
    let tree = state.blocking(move || path_to_dict(&path, 2)).await?;
    Ok(Json(json!([tree])).into_response())
}

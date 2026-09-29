//! Area `people_faces`. People & faces (03 §5): /persons/?page_size=1000, person PATCH/DELETE, /faces/incomplete/ (bare array), /faces/?person&page&inferred&order_by, labelfaces, deletefaces, addface, trainfaces, GET /scanfaces (starts a job), /clusterfaces.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::people_faces`, writes in `lp_db::write::people_faces`.
//!
//! The face views answer their own errors as `{"status": false, "message"}`
//! bodies (not the DRF envelope), exactly like Django's `Response(...)`s.

use axum::Json;
use axum::Router;
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use lp_core::{ApiError, AppState};
use lp_jobs::HandlerRegistry;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde_json::{Value, json};

mod add_face;
mod faces;
mod jobs;
pub mod pca;
mod persons;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/persons", get(persons::list))
        .route(
            "/api/persons/{id}",
            get(persons::retrieve)
                .patch(persons::update)
                .delete(persons::destroy),
        )
        .route("/api/faces/incomplete", get(faces::incomplete))
        .route("/api/faces", get(faces::list))
        .route("/api/labelfaces", post(faces::label))
        .route("/api/deletefaces", post(faces::delete))
        .route("/api/addface", post(add_face::add_face))
        .route("/api/trainfaces", post(jobs::train_faces))
        .route(
            "/api/scanfaces",
            get(jobs::scan_faces).post(jobs::scan_faces),
        )
        .route(
            "/api/clusterfaces",
            get(jobs::cluster_faces).post(jobs::cluster_faces),
        )
}

/// Face jobs (`faces.scan`, `faces.train`) are owned by `lp-tasks`.
pub fn register_jobs(_reg: &mut HandlerRegistry) {}

/// `{"status": false, "message": ...}` with `status`, as the face views answer.
fn status_message(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(json!({"status": false, "message": message.into()})),
    )
        .into_response()
}

/// Django `urllib.parse.quote(path, safe="/~!*()'")` (`filepath_to_uri`).
const URI_SAFE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'/')
    .remove(b'~')
    .remove(b'!')
    .remove(b'*')
    .remove(b'(')
    .remove(b')')
    .remove(b'\'')
    .remove(b'-')
    .remove(b'_')
    .remove(b'.');

/// `FieldFile.url` of a stored media name: `/media/<quoted name>`.
fn media_url(name: &str) -> String {
    let name = name.replace('\\', "/");
    format!("/media/{}", utf8_percent_encode(&name, URI_SAFE))
}

/// `request.build_absolute_uri(path)`.
fn absolute_url(headers: &HeaderMap, path: &str) -> String {
    match path.parse::<Uri>() {
        Ok(uri) => crate::common::pagination::absolute_uri(headers, &uri),
        Err(_) => path.to_string(),
    }
}

/// The request URI with the trailing slash the middleware stripped: Django
/// redirects these routes to their slash form, so its page links carry it.
fn canonical_uri(uri: &Uri) -> Uri {
    let path = uri.path();
    if path.ends_with('/') {
        return uri.clone();
    }
    let pq = match uri.query() {
        Some(q) => format!("{path}/?{q}"),
        None => format!("{path}/"),
    };
    pq.parse().unwrap_or_else(|_| uri.clone())
}

/// `body["face_ids"]` as `in_bulk` takes it (ints or numeric strings).
/// Anything else crashes the Django view, hence the 500.
fn face_ids(body: &Value) -> Result<Vec<i32>, ApiError> {
    let list = body
        .get("face_ids")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::internal("face_ids missing or not a list"))?;
    list.iter()
        .map(|v| match v {
            Value::Number(n) => n.as_i64().and_then(|i| i32::try_from(i).ok()),
            Value::String(s) => s.trim().parse::<i32>().ok(),
            _ => None,
        })
        .map(|id| id.ok_or_else(|| ApiError::internal("face id is not an integer")))
        .collect()
}

/// `(request.data.get(key) or "").strip()`; non-string truthy values
/// crash the Django view (`.strip()` on them), hence the 500.
fn stripped_str(body: &Value, key: &str) -> Result<String, ApiError> {
    match body.get(key) {
        Some(Value::String(s)) => Ok(s.trim().to_string()),
        Some(v) if lp_core::extract::py_truthy(v) => {
            Err(ApiError::internal(format!("{key} is not a string")))
        }
        _ => Ok(String::new()),
    }
}

/// Python `float(s)` for query parameters (`min_confidence`); Django
/// crashes (500) on anything it cannot parse.
fn py_float(s: &str) -> Result<f64, ApiError> {
    s.trim()
        .replace('_', "")
        .parse::<f64>()
        .map_err(|_| ApiError::internal(format!("could not convert string to float: {s:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(media_url("faces/ab_0.jpg"), "/media/faces/ab_0.jpg");
        assert_eq!(media_url("faces\\a b.jpg"), "/media/faces/a%20b.jpg");
    }

    #[test]
    fn floats() {
        assert_eq!(py_float(" 0.5 ").unwrap(), 0.5);
        assert_eq!(py_float("1e-1").unwrap(), 0.1);
        assert!(py_float("-inf").unwrap().is_infinite());
        assert!(py_float("abc").is_err());
    }
}

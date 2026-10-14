//! Area `upload` (03 §5, 04 §6): `GET /api/exists/{md5+uid}`, the chunked
//! `POST /api/upload/` and `POST /api/upload/complete/`.
//!
//! The two upload views are plain Django views in the original (the vendored
//! django-chunked-upload), not DRF ones: errors are `{"detail": ...}` (plus
//! `offset` on an offset mismatch), authentication failures are 403, and an
//! unknown `upload_id` is Django's HTML 404.

use std::path::{Path, PathBuf};

use axum::extract::{DefaultBodyLimit, FromRequest, Multipart, Path as UrlPath, Request, State};
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Timelike, Utc};
use lp_core::{ApiResult, AppState};
use lp_db::upload::{COMPLETE, ChunkedUpload};
use lp_db::users::User;
use lp_ingest::Pipeline;
use lp_jobs::{EnqueueOptions, HandlerRegistry};
use serde_json::{Value, json};

use lp_auth::AuthUser;

/// Chunks are 1 MB from the web client; allow generous ones from others.
const MAX_REQUEST: usize = 512 * 1024 * 1024;
/// How much of a refused request's body is read before answering.
const DRAIN_LIMIT: usize = 4 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/exists/{hash}", get(exists))
        .route(
            "/api/upload",
            post(upload_chunk).layer(DefaultBodyLimit::max(MAX_REQUEST)),
        )
        .route(
            "/api/upload/complete",
            post(upload_complete).layer(DefaultBodyLimit::max(MAX_REQUEST)),
        )
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

/// `UploadPhotoExists.retrieve`: only the requester's own library counts.
async fn exists(
    State(state): State<AppState>,
    user: AuthUser,
    UrlPath(hash): UrlPath<String>,
) -> ApiResult<Json<Value>> {
    let exists = lp_db::upload::owns_image_hash(&state.db, user.id, &hash).await?;
    Ok(Json(json!({ "exists": exists })))
}

/// A `ChunkedUploadError` / plain-Django error response.
struct UploadError(Response);

impl IntoResponse for UploadError {
    fn into_response(self) -> Response {
        self.0
    }
}

fn detail(status: StatusCode, msg: impl Into<String>) -> UploadError {
    UploadError((status, Json(json!({ "detail": msg.into() }))).into_response())
}

fn forbidden(msg: &str) -> UploadError {
    detail(StatusCode::FORBIDDEN, msg)
}

fn bad_request(msg: impl Into<String>) -> UploadError {
    detail(StatusCode::BAD_REQUEST, msg)
}

/// `get_object_or_404` in a plain view: Django's default HTML page.
fn html_404() -> UploadError {
    UploadError(
        (
            StatusCode::NOT_FOUND,
            [(CONTENT_TYPE, "text/html; charset=utf-8")],
            "\n<!doctype html>\n<html lang=\"en\">\n<head>\n  <title>Not Found</title>\n</head>\n<body>\n  <h1>Not Found</h1><p>The requested resource was not found on this server.</p>\n</body>\n</html>\n",
        )
            .into_response(),
    )
}

/// `SuspiciousFileOperation` (an underivable file name): Django's 400 page.
fn html_400() -> UploadError {
    UploadError(
        (
            StatusCode::BAD_REQUEST,
            [(CONTENT_TYPE, "text/html; charset=utf-8")],
            "\n<!doctype html>\n<html lang=\"en\">\n<head>\n  <title>Bad Request (400)</title>\n</head>\n<body>\n  <h1>Bad Request (400)</h1><p></p>\n</body>\n</html>\n",
        )
            .into_response(),
    )
}

fn internal(e: impl std::fmt::Display) -> UploadError {
    UploadError(lp_core::ApiError::internal(e).into_response())
}

impl From<sqlx::Error> for UploadError {
    fn from(e: sqlx::Error) -> Self {
        internal(e)
    }
}

impl From<std::io::Error> for UploadError {
    fn from(e: std::io::Error) -> Self {
        internal(e)
    }
}

impl From<anyhow::Error> for UploadError {
    fn from(e: anyhow::Error) -> Self {
        internal(format!("{e:#}"))
    }
}

type UploadResult<T> = Result<T, UploadError>;

/// `authenticate_upload_request`: header token first, else the `jwt`
/// cookie; any unusable token is a 403.
async fn upload_user(state: &AppState, headers: &HeaderMap) -> UploadResult<User> {
    let not_provided = || forbidden("Authentication credentials were not provided");
    let mut token = None;
    if let Some(v) = headers.get(AUTHORIZATION) {
        let text = v.to_str().unwrap_or("");
        let parts: Vec<&str> = text.split_whitespace().collect();
        if parts
            .first()
            .is_some_and(|s| s.eq_ignore_ascii_case("bearer"))
        {
            if parts.len() != 2 {
                return Err(not_provided());
            }
            token = Some(parts[1].to_string());
        }
    }
    if token.is_none() {
        let mut parts = axum::http::Request::new(()).into_parts().0;
        parts.headers = headers.clone();
        token = lp_auth::extract::cookie_token(&parts);
    }
    let Some(token) = token else {
        return Err(not_provided());
    };
    let claims = lp_auth::jwt::decode(&state.jwt, &token, lp_auth::jwt::ACCESS)
        .map_err(|_| forbidden("Authentication credentials were invalid"))?;
    // simplejwt's get_user raises InvalidToken for a token without a user id.
    let uid = claims
        .user_id()
        .ok_or_else(|| forbidden("Authentication credentials were invalid"))?;
    let user = lp_db::users::by_id(&state.db, uid)
        .await?
        .ok_or_else(not_provided)?;
    if !user.is_active {
        return Err(not_provided());
    }
    Ok(user)
}

/// `UploaderScopedMixin.check_permissions`.
async fn check_permissions(state: &AppState, headers: &HeaderMap) -> UploadResult<User> {
    if !state.settings().allow_upload {
        return Err(forbidden("Uploading is not allowed"));
    }
    upload_user(state, headers).await
}

/// DjangoJSONEncoder datetime: milliseconds, `Z`.
fn django_json_datetime(dt: &DateTime<Utc>) -> String {
    let mut s = dt.format("%Y-%m-%dT%H:%M:%S").to_string();
    let micros = dt.nanosecond() / 1000;
    if micros != 0 {
        s.push_str(&format!(".{:03}", micros / 1000));
    }
    s.push('Z');
    s
}

fn response_data(u: &ChunkedUpload) -> Value {
    json!({
        "upload_id": u.upload_id,
        "offset": u.offset,
        "expires": django_json_datetime(&(u.created_on + Duration::days(1))),
    })
}

#[derive(Default)]
struct Form {
    fields: std::collections::HashMap<String, String>,
    chunk: Option<(String, Vec<u8>)>,
}

async fn read_form(mut mp: Multipart) -> UploadResult<Form> {
    let mut form = Form::default();
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|e| bad_request(format!("Multipart form parse error - {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        if let Some(file_name) = field.file_name().map(str::to_string) {
            let data = field
                .bytes()
                .await
                .map_err(|e| bad_request(format!("Multipart form parse error - {e}")))?;
            if name == "file" && form.chunk.is_none() {
                form.chunk = Some((file_name, data.to_vec()));
            }
        } else {
            let text = field
                .text()
                .await
                .map_err(|e| bad_request(format!("Multipart form parse error - {e}")))?;
            form.fields.insert(name, text);
        }
    }
    Ok(form)
}

/// `^bytes (?P<start>\d+)-(?P<end>\d+)/(?P<total>\d+)$`.
fn content_range(headers: &HeaderMap) -> Option<(i64, i64, i64)> {
    let v = headers.get("content-range")?.to_str().ok()?;
    let rest = v.strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let num = |s: &str| -> Option<i64> {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse().ok()
    };
    Some((num(start)?, num(end)?, num(total.trim_end_matches('\n'))?))
}

/// The permission check comes before the form is read, as in Django. A
/// refused request's body is still read (up to [`DRAIN_LIMIT`]) before the
/// answer: a socket closed with unread data is reset, and a client still
/// sending its chunk then sees a network error instead of the 403.
async fn authorized_form(
    state: &AppState,
    req: Request,
) -> Result<(User, HeaderMap, Multipart), Response> {
    let headers = req.headers().clone();
    let user = match check_permissions(state, &headers).await {
        Ok(user) => user,
        Err(e) => {
            let _ = axum::body::to_bytes(req.into_body(), DRAIN_LIMIT).await;
            return Err(e.into_response());
        }
    };
    let mp = Multipart::from_request(req, state)
        .await
        .map_err(IntoResponse::into_response)?;
    Ok((user, headers, mp))
}

async fn upload_chunk(State(state): State<AppState>, req: Request) -> Response {
    let (user, headers, mp) = match authorized_form(&state, req).await {
        Ok(parts) => parts,
        Err(refused) => return refused,
    };
    match upload_chunk_inner(&state, &headers, user, mp).await {
        Ok(r) => r,
        Err(e) => e.into_response(),
    }
}

/// `ChunkedUploadView._post`.
async fn upload_chunk_inner(
    state: &AppState,
    headers: &HeaderMap,
    user: User,
    mp: Multipart,
) -> UploadResult<Response> {
    let form = read_form(mp).await?;
    let Some((chunk_name, chunk)) = form.chunk else {
        return Err(bad_request("No chunk file was submitted"));
    };
    let existing = match form.fields.get("upload_id").filter(|s| !s.is_empty()) {
        Some(id) => {
            let u = lp_db::upload::chunked_upload(&state.db, user.id, id)
                .await?
                .ok_or_else(html_404)?;
            if u.created_on + Duration::days(1) <= Utc::now() {
                return Err(detail(StatusCode::GONE, "Upload has expired"));
            }
            if u.status == COMPLETE {
                return Err(bad_request(
                    "Upload has already been marked as \"complete\"",
                ));
            }
            Some(u)
        }
        None => None,
    };
    let size = chunk.len() as i64;
    let (start, end, _total) = content_range(headers).unwrap_or((0, size - 1, size));
    let chunk_size = end - start + 1;
    let offset = existing.as_ref().map_or(0, |u| u.offset);
    if offset != start {
        return Err(UploadError(
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"detail": "Offsets do not match", "offset": offset})),
            )
                .into_response(),
        ));
    }
    if size != chunk_size {
        return Err(bad_request("File size doesn't match headers"));
    }
    let (upload_id, file_name) = match &existing {
        Some(u) => (u.upload_id.clone(), u.file.clone()),
        None => {
            let id = uuid::Uuid::new_v4().simple().to_string();
            (id.clone(), format!("chunked_uploads/{id}.part"))
        }
    };
    let path = state.config.media_root.join(&file_name);
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    {
        use tokio::io::AsyncWriteExt;
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;
        f.write_all(&chunk).await?;
        f.flush().await?;
    }
    let row = match existing {
        Some(mut u) => {
            u.offset += chunk_size;
            lp_db::write::upload::set_offset(&state.db, u.id, u.offset).await?;
            u
        }
        None => {
            lp_db::write::upload::create_chunked_upload(
                &state.db,
                &upload_id,
                &file_name,
                &chunk_name,
                chunk_size,
                user.id,
            )
            .await?
        }
    };
    Ok((StatusCode::OK, Json(response_data(&row))).into_response())
}

async fn upload_complete(State(state): State<AppState>, req: Request) -> Response {
    let (user, _headers, mp) = match authorized_form(&state, req).await {
        Ok(parts) => parts,
        Err(refused) => return refused,
    };
    match upload_complete_inner(&state, user, mp).await {
        Ok(r) => r,
        Err(e) => e.into_response(),
    }
}

fn md5_file(path: &Path) -> std::io::Result<String> {
    use md5::{Digest, Md5};
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Md5::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Django's `get_valid_filename`.
fn valid_filename(name: &str) -> Option<String> {
    let s: String = name
        .trim()
        .replace(' ', "_")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == '.')
        .collect();
    if s.is_empty() || s == "." || s == ".." {
        None
    } else {
        Some(s)
    }
}

/// `parse_device_timestamp`: epoch milliseconds or ISO 8601.
fn parse_device_timestamp(raw: Option<&String>) -> Option<DateTime<Utc>> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(ms) = raw.replace('_', "").parse::<i64>() {
        return DateTime::<Utc>::from_timestamp_millis(ms);
    }
    lp_core::time::parse_client_datetime(raw)
}

/// `ChunkedUploadCompleteView._post` + `UploadPhotosChunkedComplete.on_completion`.
async fn upload_complete_inner(
    state: &AppState,
    user: User,
    mp: Multipart,
) -> UploadResult<Response> {
    let form = read_form(mp).await?;
    let upload_id = form.fields.get("upload_id").filter(|s| !s.is_empty());
    let md5 = form.fields.get("md5").filter(|s| !s.is_empty());
    let (Some(upload_id), Some(md5)) = (upload_id, md5) else {
        return Err(bad_request("Both 'upload_id' and 'md5' are required"));
    };
    let upload = lp_db::upload::chunked_upload(&state.db, user.id, upload_id)
        .await?
        .ok_or_else(html_404)?;
    if upload.status == COMPLETE {
        return Err(bad_request("Upload has already been marked as complete"));
    }
    let staged = state.config.media_root.join(&upload.file);
    let staged2 = staged.clone();
    let actual = state
        .blocking(move || md5_file(&staged2))
        .await
        .map_err(internal)??;
    if &actual != md5 {
        return Err(bad_request("md5 checksum does not match"));
    }
    // Two concurrent completions both pass the status check above; only the
    // one that flips the row imports the file.
    if !lp_db::write::upload::mark_complete(&state.db, upload.id, Utc::now()).await? {
        return Err(bad_request("Upload has already been marked as complete"));
    }
    match on_completion(state, &user, &upload, &staged, &actual, &form).await {
        Ok(()) => Ok((StatusCode::OK, Json(json!({}))).into_response()),
        Err(Completion::Refused(e)) => {
            lp_db::write::upload::reset_uploading(&state.db, &upload.upload_id).await?;
            Err(e)
        }
        Err(Completion::Failed(e)) => Err(e),
    }
}

enum Completion {
    /// A `ChunkedUploadError`: the upload id stays usable.
    Refused(UploadError),
    Failed(UploadError),
}

impl<E: Into<UploadError>> From<E> for Completion {
    fn from(e: E) -> Self {
        Completion::Failed(e.into())
    }
}

async fn delete_upload(
    state: &AppState,
    upload: &ChunkedUpload,
    staged: &Path,
) -> Result<(), UploadError> {
    lp_db::write::upload::delete_chunked_upload(&state.db, upload.id).await?;
    match tokio::fs::remove_file(staged).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

async fn on_completion(
    state: &AppState,
    user: &User,
    upload: &ChunkedUpload,
    staged: &Path,
    md5: &str,
    form: &Form,
) -> Result<(), Completion> {
    if user.scan_directory.trim().is_empty() {
        return Err(Completion::Refused(bad_request(
            "Upload failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account.",
        )));
    }
    if !Path::new(&user.scan_directory).exists() {
        return Err(Completion::Refused(bad_request(format!(
            "Upload failed: Scan directory '{}' does not exist. Please contact your administrator.",
            user.scan_directory
        ))));
    }
    let pipeline = Pipeline::new(state.clone());
    if !lp_ingest::upload::is_valid_media(&pipeline, staged).await {
        delete_upload(state, upload, staged).await?;
        return Err(Completion::Refused(bad_request("File type not allowed")));
    }
    let raw_name = form
        .fields
        .get("filename")
        .map(String::as_str)
        .unwrap_or("None");
    let Some(filename) = valid_filename(raw_name) else {
        return Err(Completion::Failed(html_400()));
    };
    let device = "web";
    let upload_dir: PathBuf = Path::new(&user.scan_directory).join("uploads").join(device);
    tokio::fs::create_dir_all(&upload_dir).await?;
    let image_hash = format!("{md5}{}", user.id);
    let target = lp_ingest::upload::target_path(
        &pipeline,
        &user.scan_directory,
        user.id,
        device,
        &filename,
        &image_hash,
    )
    .await?;
    if let Some(t) = &target {
        tokio::fs::copy(staged, t).await?;
    }
    delete_upload(state, upload, staged).await?;
    let Some(target) = target else {
        tracing::info!(filename, image_hash, "photo duplicated, no new import");
        return Ok(());
    };
    let photo = lp_ingest::upload::create_new_image(&pipeline, user.id, &target).await?;
    if let Some(photo) = photo {
        let created = parse_device_timestamp(form.fields.get("device_created_at"));
        lp_jobs::enqueue(
            state,
            "upload.process",
            json!({
                "user_id": user.id,
                "photo_id": photo,
                "path": target.to_string_lossy(),
                "device_created_at": created,
            }),
            EnqueueOptions::default(),
        )
        .await
        .map_err(internal)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_like_django() {
        assert_eq!(
            valid_filename("john's portrait in 2004.jpg").as_deref(),
            Some("johns_portrait_in_2004.jpg")
        );
        assert_eq!(valid_filename(" .. "), None);
        assert_eq!(
            valid_filename("Straße ☀.jpg").as_deref(),
            Some("Straße_.jpg")
        );
    }

    #[test]
    fn content_range_header() {
        let mut h = HeaderMap::new();
        h.insert("content-range", "bytes 0-1048575/1048576".parse().unwrap());
        assert_eq!(content_range(&h), Some((0, 1048575, 1048576)));
        h.insert("content-range", "bytes x-1/2".parse().unwrap());
        assert_eq!(content_range(&h), None);
    }

    #[test]
    fn django_encoder_datetimes() {
        let dt = DateTime::parse_from_rfc3339("2026-09-30T12:00:00.123456Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(django_json_datetime(&dt), "2026-09-30T12:00:00.123Z");
        let dt = DateTime::parse_from_rfc3339("2026-09-30T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(django_json_datetime(&dt), "2026-09-30T12:00:00Z");
    }
}

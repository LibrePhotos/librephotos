//! `/media/<path>/<fname>`: port of `UnifiedMediaAccessView`
//! (`api/views/media.py`). Dispatch, photo lookup (hash, UUID on derived
//! paths, several owners sharing one hash), the grant order, refusal
//! semantics and the per-mode delivery, with every file path confined to
//! its root instead of joined from raw URL text.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path as UrlPath, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::Response;
use lp_auth::OptionalUser;
use lp_core::config::MediaMode;
use lp_core::{AppState, Config};
use lp_db::media::{self as q, MediaPhoto, PhotoKey};
use lp_db::users::User;
use uuid::Uuid;

use crate::pyfmt::{self, basename, ext, iri_to_uri, quote};
use crate::serve::{self, FileRequest, empty, forbidden_unauthenticated, refuse, x_accel};
use crate::transcode::{self, Source};

/// Request facts every branch needs.
pub struct Ctx {
    pub config: Arc<Config>,
    pub proxy: bool,
    pub head: bool,
    pub range: Option<String>,
}

impl Ctx {
    pub fn new(state: &AppState, method: &Method, headers: &HeaderMap) -> Ctx {
        Ctx {
            config: state.config.clone(),
            proxy: state.config.media_mode == MediaMode::XAccel,
            head: method == Method::HEAD,
            range: headers
                .get(header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string),
        }
    }

    async fn file(&self, req: FileRequest) -> Response {
        serve::serve_file(req, self.range.clone(), self.head).await
    }
}

/// A request-derived relative directory: `/`-separated plain segments only.
fn safe_dir(path: &str) -> bool {
    !path.is_empty()
        && path.trim_start_matches('/').split('/').all(|seg| {
            !seg.is_empty() && seg != "." && seg != ".." && !seg.contains(['\\', ':', '\0'])
        })
}

/// A request-derived file name: one plain path component.
fn safe_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '\0'])
}

/// `MEDIA_ROOT/<path>/<name>` and its `/protected_media/<path>/<name>`
/// hand-off, or None when either part could escape the media root.
struct Protected {
    file: PathBuf,
    root: PathBuf,
    uri: String,
}

fn protected(config: &Config, path: &str, name: &str) -> Option<Protected> {
    if !safe_dir(path) || !safe_name(name) {
        return None;
    }
    let rel = path.trim_start_matches('/');
    let mut dir = config.media_root.clone();
    for seg in rel.split('/') {
        dir.push(seg);
    }
    Some(Protected {
        file: dir.join(name),
        root: dir,
        uri: format!("/protected_media/{rel}/{name}"),
    })
}

/// A `Thumbnail` FileField's file (`field.path`), confined to MEDIA_ROOT.
fn stored(config: &Config, name: &str, content_type: Option<&str>) -> FileRequest {
    FileRequest::new(
        config.media_root.join(name),
        config.media_root.clone(),
        content_type,
    )
}

/// Where a photo's original may be read from: the library, its owner's
/// scan directory, or (for embedded media, transcodes) the media root.
fn original_roots(config: &Config, photo: &MediaPhoto) -> Vec<PathBuf> {
    let mut roots = vec![config.photos.clone(), config.media_root.clone()];
    if !photo.owner_scan_directory.is_empty() {
        roots.push(PathBuf::from(&photo.owner_scan_directory));
    }
    roots
}

/// `_thumbnail_field_for`: the stored name `path` asks for, None when there
/// is no thumbnail row or the field is empty.
fn thumbnail_field<'a>(photo: &'a MediaPhoto, path: &str) -> Option<&'a str> {
    let field = if path.contains("thumbnails_big") {
        &photo.thumbnail_big
    } else if path.contains("square_thumbnails_small") {
        &photo.square_thumbnail_small
    } else {
        &photo.square_thumbnail
    };
    field.as_deref().filter(|f| !f.is_empty())
}

fn source(photo: &MediaPhoto) -> Option<Source> {
    Some(Source {
        image_hash: photo.image_hash.clone(),
        path: PathBuf::from(photo.main_file_path.as_ref()?),
        video_length: photo.video_length.clone(),
    })
}

/// `api.mime.mime_type` off the async runtime (it reads the file head).
async fn sniff(path: &str) -> String {
    let p = PathBuf::from(path);
    tokio::task::spawn_blocking(move || crate::mime::mime_type(&p))
        .await
        .unwrap_or_else(|_| "application/octet-stream".to_string())
}

/// `_transcoded_video_response`.
async fn transcoded(ctx: &Ctx, photo: &MediaPhoto) -> Response {
    let Some(src) = source(photo) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let cached = {
        let config = ctx.config.clone();
        let hash = photo.image_hash.clone();
        tokio::task::spawn_blocking(move || transcode::cached_path(&config, &hash))
            .await
            .ok()
            .flatten()
    };
    if let Some(cached) = cached {
        if ctx.proxy {
            let name = cached
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            return x_accel("video/mp4", &format!("/protected_media/transcoded/{name}"));
        }
        return ctx
            .file(FileRequest::new(
                cached,
                ctx.config.media_root.clone(),
                Some("video/mp4"),
            ))
            .await;
    }
    transcode::live_response(ctx.config.clone(), src, ctx.head).await
}

/// `_generate_response_proxy`.
async fn generate_proxy(
    ctx: &Ctx,
    photo: &MediaPhoto,
    path: &str,
    fname: &str,
    transcode_videos: bool,
) -> Response {
    let config = &ctx.config;
    if path.contains("thumbnail") {
        let thumb = thumbnail_field(photo, path);
        if path.contains("thumbnails_big") {
            let name = match thumb {
                Some(t) => basename(t).to_string(),
                None => format!("{fname}.webp"),
            };
            let ct = if ext(&name).contains("jpg") {
                "image/jpeg"
            } else {
                "image/webp"
            };
            return match protected(config, path, &name) {
                Some(p) => x_accel(ct, &p.uri),
                None => empty(StatusCode::NOT_FOUND),
            };
        }
        let Some(thumb) = thumb else {
            let (suffix, ct) = if photo.video {
                (".mp4", "video/mp4")
            } else {
                (".webp", "image/webp")
            };
            return match protected(config, path, &format!("{fname}{suffix}")) {
                Some(p) => x_accel(ct, &p.uri),
                None => empty(StatusCode::NOT_FOUND),
            };
        };
        let e = ext(thumb);
        let actual = basename(thumb);
        if e.contains("jpg") {
            let big = thumbnail_field(photo, "thumbnails_big").unwrap_or(thumb);
            let target = config.media_root.join(big).to_string_lossy().into_owned();
            return x_accel("image/jpg", &target);
        }
        let ct = if e.contains("webp") {
            "image/webp"
        } else if e.contains("mp4") {
            "video/mp4"
        } else {
            return empty(StatusCode::OK);
        };
        return match protected(config, path, actual) {
            Some(p) => x_accel(ct, &p.uri),
            None => empty(StatusCode::NOT_FOUND),
        };
    }
    if path.contains("faces") {
        return match protected(config, path, fname) {
            Some(p) => x_accel("image/jpg", &p.uri),
            None => empty(StatusCode::NOT_FOUND),
        };
    }
    if photo.video {
        if transcode_videos {
            return transcoded(ctx, photo).await;
        }
        let Some(main) = photo.main_file_path.as_deref() else {
            return empty(StatusCode::NOT_FOUND);
        };
        let ct = sniff(main).await;
        let target = main.replace(&*config.photos.to_string_lossy(), "/original");
        return x_accel(&ct, &iri_to_uri(&target));
    }
    match protected(config, path, fname) {
        Some(p) => x_accel("image/jpg", &p.uri),
        None => empty(StatusCode::NOT_FOUND),
    }
}

/// `_thumbnail_response_direct`.
async fn thumbnail_direct(ctx: &Ctx, photo: &MediaPhoto, path: &str, fname: &str) -> Response {
    let config = &ctx.config;
    let big_jpg = |fallback: &str| {
        let big = thumbnail_field(photo, "thumbnails_big").unwrap_or(fallback);
        stored(config, big, Some("image/jpg"))
    };
    // _stored_thumbnail_response
    if let Some(thumb) = thumbnail_field(photo, path) {
        let e = ext(thumb);
        if e.contains("jpg") {
            return ctx.file(big_jpg(thumb)).await;
        }
        let file = config.media_root.join(thumb);
        if file.exists() {
            let ct = if e.contains("mp4") {
                "video/mp4"
            } else {
                "image/webp"
            };
            return ctx.file(stored(config, thumb, Some(ct))).await;
        }
    }
    let Some(requested) = protected(config, path, fname) else {
        return empty(StatusCode::NOT_FOUND);
    };
    if !requested.file.exists() {
        for (suffix, ct) in [(".webp", "image/webp"), (".mp4", "video/mp4")] {
            if fname.ends_with(suffix) {
                continue;
            }
            let candidate = requested.root.join(format!("{fname}{suffix}"));
            if candidate.exists() {
                return ctx
                    .file(FileRequest::new(
                        candidate,
                        requested.root.clone(),
                        Some(ct),
                    ))
                    .await;
            }
        }
    }
    if let Some(square) = thumbnail_field(photo, "square_thumbnails")
        && ext(square).contains("jpg")
    {
        return ctx.file(big_jpg(square)).await;
    }
    ctx.file(FileRequest::new(requested.file, requested.root, None))
        .await
}

/// `_generate_response_direct`.
async fn generate_direct(
    ctx: &Ctx,
    photo: &MediaPhoto,
    path: &str,
    fname: &str,
    transcode_videos: bool,
) -> Response {
    if path.contains("thumbnail") {
        return thumbnail_direct(ctx, photo, path, fname).await;
    }
    if path.contains("faces") {
        return match protected(&ctx.config, path, fname) {
            Some(p) => {
                ctx.file(FileRequest::new(p.file, p.root, Some("image/jpg")))
                    .await
            }
            None => empty(StatusCode::NOT_FOUND),
        };
    }
    if photo.video {
        if transcode_videos {
            return transcoded(ctx, photo).await;
        }
        let Some(main) = photo.main_file_path.as_deref() else {
            return empty(StatusCode::NOT_FOUND);
        };
        return ctx
            .file(FileRequest {
                path: PathBuf::from(main),
                roots: original_roots(&ctx.config, photo),
                content_type: None,
            })
            .await;
    }
    match protected(&ctx.config, path, fname) {
        Some(p) => {
            ctx.file(FileRequest::new(p.file, p.root, Some("image/jpg")))
                .await
        }
        None => empty(StatusCode::NOT_FOUND),
    }
}

/// `_generate_response`.
pub async fn generate(
    ctx: &Ctx,
    photo: &MediaPhoto,
    path: &str,
    fname: &str,
    transcode_videos: bool,
) -> Response {
    if ctx.proxy {
        generate_proxy(ctx, photo, path, fname, transcode_videos).await
    } else {
        generate_direct(ctx, photo, path, fname, transcode_videos).await
    }
}

/// `_generate_response_original`: the untouched original (`path == "photos"`).
pub async fn generate_original(
    ctx: &Ctx,
    photo: &MediaPhoto,
    transcode_videos: bool,
    inline: bool,
) -> Response {
    if photo.video && transcode_videos {
        return transcoded(ctx, photo).await;
    }
    let Some(main) = photo.main_file_path.as_deref() else {
        return empty(StatusCode::NOT_FOUND);
    };
    if ctx.proxy {
        let ct = if photo.video {
            sniff(main).await
        } else {
            "image/webp".to_string()
        };
        let photos = ctx.config.photos.to_string_lossy();
        let internal = if let Some(rest) = main.strip_prefix("/nextcloud_media/") {
            // Django slices 21 characters off a 17-character prefix.
            format!("/nextcloud_original{}", rest.get(4..).unwrap_or(""))
        } else if let Some(rest) = main.strip_prefix(&*photos) {
            format!("/original{rest}")
        } else {
            quote(main, "/")
        };
        let mut res = x_accel(&ct, &iri_to_uri(&internal));
        if inline {
            let name = main.rsplit('/').next().unwrap_or(main);
            res.headers_mut().insert(
                header::CONTENT_DISPOSITION,
                pyfmt::header_value(&format!("inline; filename=\"{name}\"")),
            );
        }
        return res;
    }
    ctx.file(FileRequest {
        path: PathBuf::from(main),
        roots: original_roots(&ctx.config, photo),
        content_type: None,
    })
    .await
}

fn is_uuid_format(value: &str) -> bool {
    value.chars().count() == 36 && value.matches('-').count() == 4
}

/// `_pick_visible_photo`: prefer the requester's own row, then one shared
/// to them, then one anyone may see; else the first.
fn pick(mut candidates: Vec<MediaPhoto>, signed_in: bool) -> Option<MediaPhoto> {
    if candidates.len() <= 1 {
        return candidates.pop();
    }
    let idx = (signed_in)
        .then(|| {
            candidates
                .iter()
                .position(|p| p.is_owner)
                .or_else(|| candidates.iter().position(|p| p.shared_directly))
        })
        .flatten()
        .or_else(|| {
            candidates
                .iter()
                .position(|p| p.in_public_album || p.is_public_photo)
        })
        .unwrap_or(0);
    Some(candidates.swap_remove(idx))
}

/// `_lookup_photo`.
async fn lookup(
    state: &AppState,
    image_hash: &str,
    user: Option<&User>,
    allow_uuid: bool,
) -> Result<Option<MediaPhoto>, Response> {
    let uid = user.map(|u| u.id);
    let result = if allow_uuid && is_uuid_format(image_hash) {
        match Uuid::parse_str(image_hash) {
            Ok(id) => q::photo_by_id(&state.db, id, uid).await,
            Err(_) => Ok(None),
        }
    } else {
        q::photos_by_hash(&state.db, image_hash, uid)
            .await
            .map(|c| pick(c, user.is_some()))
    };
    result.map_err(|e| {
        tracing::error!(error = %e, "media lookup failed");
        empty(StatusCode::INTERNAL_SERVER_ERROR)
    })
}

/// `zip_file_name`: `<canonical uuid><user id>.zip`, None for anything else.
pub fn zip_file_name(file_uuid: &str, user_id: i32) -> Option<String> {
    if file_uuid.len() != 36 {
        return None;
    }
    let canonical = Uuid::parse_str(file_uuid).ok()?.hyphenated().to_string();
    (canonical == file_uuid.to_lowercase()).then(|| format!("{canonical}{user_id}.zip"))
}

async fn serve_zip(ctx: &Ctx, user: Option<&User>, path: &str, fname: &str) -> Response {
    let Some(user) = user else {
        return forbidden_unauthenticated();
    };
    let Some(filename) = zip_file_name(fname, user.id) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Some(p) = protected(&ctx.config, path, &filename) else {
        return empty(StatusCode::NOT_FOUND);
    };
    if ctx.proxy {
        return x_accel("application/x-zip-compressed", &p.uri);
    }
    ctx.file(FileRequest::new(
        p.file,
        p.root,
        Some("application/x-zip-compressed"),
    ))
    .await
}

async fn serve_avatar(ctx: &Ctx, user: Option<&User>, path: &str, fname: &str) -> Response {
    if user.is_none() {
        return forbidden_unauthenticated();
    }
    let Some(p) = protected(&ctx.config, path, fname) else {
        return empty(StatusCode::NOT_FOUND);
    };
    if ctx.proxy {
        return x_accel("image/png", &p.uri);
    }
    ctx.file(FileRequest::new(p.file, p.root, Some("image/png")))
        .await
}

async fn serve_embedded(
    state: &AppState,
    ctx: &Ctx,
    user: Option<&User>,
    path: &str,
    fname: &str,
) -> Response {
    let key = if is_uuid_format(fname) {
        match Uuid::parse_str(fname) {
            Ok(id) => PhotoKey::Id(id),
            Err(_) => return empty(StatusCode::NOT_FOUND),
        }
    } else {
        PhotoKey::Hash(fname)
    };
    let found = match q::embedded_media_path(&state.db, key, user.map(|u| u.id)).await {
        Ok(f) => f,
        Err(e) => {
            tracing::error!(error = %e, "embedded media lookup failed");
            return empty(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let Some(Some(embedded)) = found else {
        return empty(StatusCode::NOT_FOUND);
    };
    if ctx.proxy {
        return match protected(&ctx.config, path, basename(&embedded)) {
            Some(p) => x_accel("video/mp4", &p.uri),
            None => empty(StatusCode::NOT_FOUND),
        };
    }
    ctx.file(FileRequest::new(
        PathBuf::from(&embedded),
        ctx.config.media_root.clone(),
        Some("video/mp4"),
    ))
    .await
}

async fn serve_derived(
    state: &AppState,
    ctx: &Ctx,
    user: Option<&User>,
    image_hash: &str,
    path: &str,
    fname: &str,
) -> Response {
    let photo = match lookup(state, image_hash, user, true).await {
        Ok(Some(p)) => p,
        Ok(None) => return refuse(user.is_some()),
        Err(res) => return res,
    };
    let grants = photo.grants();
    if grants.in_public_album {
        return generate(ctx, &photo, path, fname, false).await;
    }
    if let Some(u) = user
        && grants.may_access()
    {
        return generate(ctx, &photo, path, fname, u.transcode_videos).await;
    }
    if grants.is_public_photo {
        return generate(ctx, &photo, path, fname, false).await;
    }
    refuse(user.is_some())
}

async fn serve_original(
    state: &AppState,
    ctx: &Ctx,
    user: Option<&User>,
    image_hash: &str,
) -> Response {
    let photo = match lookup(state, image_hash, user, false).await {
        Ok(Some(p)) => p,
        Ok(None) => return refuse(user.is_some()),
        Err(res) => return res,
    };
    let grants = photo.grants();
    if grants.in_public_album {
        return generate_original(ctx, &photo, false, false).await;
    }
    if let Some(u) = user {
        if grants.is_owner || grants.shared_directly {
            return generate_original(ctx, &photo, u.transcode_videos, true).await;
        }
        if grants.may_access() {
            return generate_original(ctx, &photo, u.transcode_videos, false).await;
        }
    }
    if grants.is_public_photo {
        return generate_original(ctx, &photo, false, false).await;
    }
    refuse(user.is_some())
}

/// Django's `^media/(?P<path>.*)/(?P<fname>.*)`: everything up to the last
/// slash is the path. The router already dropped one trailing slash, so a
/// rest without a slash is read as `<path>/` with an empty name.
fn split_rest(rest: &str) -> (&str, &str) {
    match rest.rfind('/') {
        Some(i) => (&rest[..i], &rest[i + 1..]),
        None => (rest, ""),
    }
}

/// `GET|HEAD /media/{*rest}`.
pub async fn media(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    method: Method,
    headers: HeaderMap,
    UrlPath(rest): UrlPath<String>,
) -> Response {
    let ctx = Ctx::new(&state, &method, &headers);
    let (path, fname) = split_rest(&rest);
    let user = user.as_ref();
    match path.to_lowercase().as_str() {
        "zip" => return serve_zip(&ctx, user, path, fname).await,
        "avatars" => return serve_avatar(&ctx, user, path, fname).await,
        "embedded_media" => return serve_embedded(&state, &ctx, user, path, fname).await,
        _ => {}
    }
    // Django joins this text into file paths and X-Accel targets; a path
    // that could climb out of MEDIA_ROOT names nothing we serve.
    if !safe_dir(path) {
        return empty(StatusCode::NOT_FOUND);
    }
    let image_hash = fname
        .split('.')
        .next()
        .unwrap_or("")
        .split('_')
        .next()
        .unwrap_or("");
    if path.to_lowercase() != "photos" {
        return serve_derived(&state, &ctx, user, image_hash, path, fname).await;
    }
    serve_original(&state, &ctx, user, image_hash).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_is_greedy_like_djangos_regex() {
        assert_eq!(split_rest("thumbnails_big/abc"), ("thumbnails_big", "abc"));
        assert_eq!(split_rest("a/b/c.jpg"), ("a/b", "c.jpg"));
        assert_eq!(split_rest("thumbnails_big"), ("thumbnails_big", ""));
    }

    #[test]
    fn path_safety() {
        assert!(safe_dir("thumbnails_big"));
        assert!(safe_dir("a/b"));
        assert!(!safe_dir("a/../b"));
        assert!(!safe_dir(".."));
        assert!(!safe_dir("a\\b"));
        assert!(!safe_dir("C:"));
        assert!(!safe_dir(""));
        assert!(safe_name("x_0.jpg"));
        assert!(!safe_name(".."));
        assert!(!safe_name("..\\secret"));
        assert!(!safe_name(""));
    }

    #[test]
    fn zip_names() {
        let u = "0f8fad5b-d9cb-469f-a165-70867728950e";
        assert_eq!(
            zip_file_name(u, 3).as_deref(),
            Some("0f8fad5b-d9cb-469f-a165-70867728950e3.zip")
        );
        assert_eq!(
            zip_file_name(&u.to_uppercase(), 3).as_deref(),
            Some("0f8fad5b-d9cb-469f-a165-70867728950e3.zip")
        );
        assert!(zip_file_name("job-1", 3).is_none());
        assert!(zip_file_name("..", 3).is_none());
        assert!(zip_file_name(&format!("{u}1"), 3).is_none());
        assert!(zip_file_name("0f8fad5bd9cb469fa16570867728950e", 3).is_none());
    }
}

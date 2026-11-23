//! Auto (event) albums: list, detail, delete, delete_all, generation jobs.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use lp_auth::AuthUser;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::albums_tags::auto_albums::{self as reads, AlbumPersonRow, PhotoSimpleRow};
use lp_db::albums_tags::search_terms;
use lp_db::write::albums_tags::auto_albums as writes;
use lp_jobs::lrj::{self, JobType, Progress};
use lp_jobs::{EnqueueOptions, HandlerRegistry, JobCtx};
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::dto::{drf_page, fetch_page};
use crate::common::{DrfPage, PageRequest};

pub const GENERATE: &str = "albums.auto_generate";
pub const TITLES: &str = "albums.auto_titles";

/// `AlbumAutoListSerializer`.
#[derive(Debug, Serialize)]
pub struct AutoAlbumListItem {
    id: i32,
    title: String,
    #[serde(serialize_with = "lp_core::time::ser_drf")]
    timestamp: DateTime<Utc>,
    photos: Value,
    photo_count: i64,
    favorited: bool,
}

/// `GET /api/albums/auto/list/`.
pub async fn list(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<AutoAlbumListItem>>> {
    let req = PageRequest::from_query(&q, "page_size", 1000, 2000)?;
    let search = search_terms(q.get("search"));
    let (req, paged) = fetch_page(req, |limit, offset| {
        reads::list(&state.db, user.id, &search, limit, offset)
    })
    .await?;
    let results = paged
        .rows
        .into_iter()
        .map(|r| AutoAlbumListItem {
            id: r.id,
            title: r.title,
            timestamp: r.timestamp,
            // Django answers "" when the cover prefetch came back empty.
            photos: r.cover.map(|c| c.0).unwrap_or_else(|| json!("")),
            photo_count: r.photo_count,
            favorited: r.favorited,
        })
        .collect();
    Ok(Json(drf_page(&headers, &uri, req, paged.total, results)))
}

/// `PhotoSimpleSerializer`.
#[derive(Debug, Serialize)]
struct PhotoSimple {
    id: Uuid,
    square_thumbnail: String,
    image_hash: String,
    #[serde(serialize_with = "lp_core::time::ser_drf_opt")]
    exif_timestamp: Option<DateTime<Utc>>,
    exif_gps_lat: Option<f64>,
    exif_gps_lon: Option<f64>,
    rating: i32,
    geolocation_json: Option<Value>,
    public: bool,
    video: bool,
}

/// `FileSystemStorage.url(name)` under `MEDIA_URL = "/media/"`.
fn media_url(name: &str) -> String {
    const SAFE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'/')
        .remove(b'~')
        .remove(b'!')
        .remove(b'*')
        .remove(b'(')
        .remove(b')')
        .remove(b'\'')
        .remove(b'_')
        .remove(b'.')
        .remove(b'-');
    let path = name.replace('\\', "/");
    let encoded = percent_encoding::utf8_percent_encode(path.trim_start_matches('/'), SAFE);
    format!("/media/{encoded}")
}

impl From<PhotoSimpleRow> for PhotoSimple {
    fn from(r: PhotoSimpleRow) -> Self {
        PhotoSimple {
            id: r.id,
            square_thumbnail: r
                .square_thumbnail
                .filter(|s| !s.is_empty())
                .map(|s| media_url(&s))
                .unwrap_or_default(),
            image_hash: r.image_hash,
            exif_timestamp: r.exif_timestamp,
            exif_gps_lat: r.exif_gps_lat,
            exif_gps_lon: r.exif_gps_lon,
            rating: r.rating,
            geolocation_json: r.geolocation_json,
            public: r.public,
            video: r.video,
        }
    }
}

/// `PersonSerializer` read fields.
#[derive(Debug, Serialize)]
struct PersonOut {
    name: String,
    face_url: String,
    face_count: i32,
    face_photo_url: String,
    video: Value,
    id: i32,
}

impl From<AlbumPersonRow> for PersonOut {
    fn from(r: AlbumPersonRow) -> Self {
        let face_url = if r.has_cover_face {
            format!("/media/{}", r.cover_face_image.unwrap_or_default())
        } else {
            r.first_face_image
                .filter(|s| !s.is_empty())
                .map(|s| format!("/media/{s}"))
                .unwrap_or_default()
        };
        let (face_photo_url, video) = if r.has_cover_photo {
            (
                r.cover_photo_hash.unwrap_or_default(),
                json!(r.cover_photo_video.unwrap_or(false)),
            )
        } else {
            (
                r.first_face_photo_hash.unwrap_or_default(),
                r.first_face_photo_video
                    .map(Value::Bool)
                    .unwrap_or_else(|| json!("False")),
            )
        };
        PersonOut {
            name: r.name,
            face_url,
            face_count: r.face_count,
            face_photo_url,
            video,
            id: r.id,
        }
    }
}

/// `AlbumAutoSerializer` (bare object).
#[derive(Debug, Serialize)]
pub struct AutoAlbumOut {
    id: i32,
    title: String,
    favorited: bool,
    #[serde(serialize_with = "lp_core::time::ser_drf")]
    timestamp: DateTime<Utc>,
    #[serde(serialize_with = "lp_core::time::ser_drf")]
    created_on: DateTime<Utc>,
    gps_lat: Option<f64>,
    people: Vec<PersonOut>,
    gps_lon: Option<f64>,
    photos: Vec<PhotoSimple>,
}

fn not_found_auto() -> ApiError {
    ApiError::not_found_msg("No AlbumAuto matches the given query.")
}

fn parse_pk(raw: &str) -> ApiResult<i32> {
    raw.trim().parse::<i32>().map_err(|_| ApiError::not_found())
}

/// `GET /api/albums/auto/{id}/`.
pub async fn detail(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
) -> ApiResult<Json<AutoAlbumOut>> {
    let id = parse_pk(&raw_id)?;
    let album = reads::detail(&state.db, id, user.id)
        .await?
        .ok_or_else(not_found_auto)?;
    let (photos, people) =
        tokio::try_join!(reads::photos(&state.db, id), reads::people(&state.db, id))?;
    Ok(Json(AutoAlbumOut {
        id: album.id,
        title: album.title,
        favorited: album.favorited,
        timestamp: album.timestamp,
        created_on: album.created_on,
        gps_lat: album.gps_lat,
        people: people.into_iter().map(PersonOut::from).collect(),
        gps_lon: album.gps_lon,
        photos: photos.into_iter().map(PhotoSimple::from).collect(),
    }))
}

/// `DELETE /api/albums/auto/{id}/`.
pub async fn delete(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
) -> ApiResult<StatusCode> {
    let id = parse_pk(&raw_id)?;
    if !reads::deletable(&state.db, id, user.id).await? {
        return Err(not_found_auto());
    }
    writes::delete(&state.db, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/albums/auto/delete_all/` answers the JSON string `"success"`.
pub async fn delete_all(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> ApiResult<Json<Value>> {
    writes::delete_all(&state.db, user.id).await?;
    Ok(Json(json!("success")))
}

/// `start_job`: `{status, job_id}`, or a 500 `{status: false, message}` when
/// the job cannot be queued.
async fn start(
    state: &AppState,
    user_id: i32,
    kind: &str,
    job_type: JobType,
    description: &str,
) -> Response {
    match lp_jobs::enqueue(
        state,
        kind,
        json!({ "user_id": user_id }),
        EnqueueOptions::tracked(job_type, user_id),
    )
    .await
    {
        Ok(queued) => Json(json!({ "status": true, "job_id": queued.lrj_id })).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Could not start {description}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "status": false, "message": format!("Could not start {description}.") })),
            )
                .into_response()
        }
    }
}

/// `POST /api/autoalbumgen/` (GET kept as Django does).
pub async fn generate(State(state): State<AppState>, AuthUser(user): AuthUser) -> Response {
    start(
        &state,
        user.id,
        GENERATE,
        JobType::GenerateAutoAlbums,
        "the auto album generation",
    )
    .await
}

/// `POST /api/autoalbumtitlegen/`.
pub async fn regenerate_titles(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Response {
    start(
        &state,
        user.id,
        TITLES,
        JobType::GenerateAutoAlbumTitles,
        "the auto album title regeneration",
    )
    .await
}

fn user_id(ctx: &JobCtx) -> anyhow::Result<i32> {
    ctx.job
        .payload
        .get("user_id")
        .and_then(Value::as_i64)
        .and_then(|v| i32::try_from(v).ok())
        .ok_or_else(|| anyhow::anyhow!("payload has no user_id"))
}

/// Runs `body` as the LongRunningJob `lrj_id`: started, then finished or
/// failed with the error, like `lrj.complete()` / `lrj.fail(e)`.
async fn tracked<F, Fut>(ctx: &JobCtx, body: F) -> anyhow::Result<()>
where
    F: FnOnce(Option<String>) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<()>>,
{
    let db = &ctx.state.db;
    let lrj_id = ctx.job.lrj_id.clone();
    if let Some(id) = &lrj_id {
        lrj::start(db, id, None).await?;
    }
    match body(lrj_id.clone()).await {
        Ok(()) => {
            if let Some(id) = &lrj_id {
                lrj::finish(db, id, None).await?;
            }
            Ok(())
        }
        Err(e) => {
            if let Some(id) = &lrj_id {
                lrj::fail(db, id, &format!("{e:#}")).await?;
            }
            Err(e)
        }
    }
}

async fn run_generate(ctx: JobCtx) -> anyhow::Result<()> {
    let owner = user_id(&ctx)?;
    let db = ctx.state.db.clone();
    tracked(&ctx, |lrj_id| async move {
        let groups = writes::event_groups(&db, owner).await?;
        let mut progress = lrj_id
            .as_ref()
            .map(|id| Progress::new(db.clone(), id.clone()));
        if let Some(id) = &lrj_id {
            lrj::set_target(&db, id, groups.len() as i32).await?;
        }
        for group in &groups {
            writes::apply_event_group(&db, owner, group).await?;
            if let Some(p) = progress.as_mut() {
                p.inc(1).await?;
            }
        }
        if let Some(p) = progress.as_mut() {
            p.flush().await?;
        }
        Ok(())
    })
    .await
}

async fn run_titles(ctx: JobCtx) -> anyhow::Result<()> {
    let owner = user_id(&ctx)?;
    let db = ctx.state.db.clone();
    tracked(&ctx, |lrj_id| async move {
        let albums = writes::title_targets(&db, owner).await?;
        let mut progress = lrj_id
            .as_ref()
            .map(|id| Progress::new(db.clone(), id.clone()));
        if let Some(id) = &lrj_id {
            lrj::set_target(&db, id, albums.len() as i32).await?;
        }
        for (id, timestamp) in albums {
            writes::retitle(&db, id, timestamp).await?;
            if let Some(p) = progress.as_mut() {
                p.inc(1).await?;
            }
        }
        if let Some(p) = progress.as_mut() {
            p.flush().await?;
        }
        Ok(())
    })
    .await
}

pub fn register_jobs(reg: &mut HandlerRegistry) {
    reg.register(GENERATE, run_generate);
    reg.register(TITLES, run_titles);
}

#[cfg(test)]
mod tests {
    use super::media_url;

    #[test]
    fn urls() {
        assert_eq!(
            media_url("square_thumbnails\\ab c.webp"),
            "/media/square_thumbnails/ab%20c.webp"
        );
    }
}

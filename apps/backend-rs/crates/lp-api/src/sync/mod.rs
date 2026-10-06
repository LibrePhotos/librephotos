//! Mobile delta-sync feeds (`/api/sync/*`, Django `api/views/sync.py` and
//! `api/serializers/sync.py`).
//!
//! Every feed answers the same envelope:
//!
//! ```text
//! {"v": 1, "items": [...], "tombstones": ["id", ...],
//!  "next_cursor": "<b64>" | null, "server_time": "<iso>", "total": n}
//! ```
//!
//! `total` only on a request without a cursor; `400 {"error": "invalid_cursor"}`
//! for a cursor that does not decode, `410 {"error": "cursor_expired"}` for one
//! older than the tombstone horizon. A cursor whose id does not parse as the
//! feed's primary key is a 500, as on Django (the ORM raises while filtering).

pub mod cursor;

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use chrono::{DateTime, Duration, Utc};
use lp_auth::AuthUser;
use lp_core::extract::QueryMap;
use lp_core::time::py_isoformat;
use lp_core::{ApiError, ApiResult, AppState};
use lp_db::sync::{self as q, CursorPk, Keyset};
use lp_db::write::deletion_log::{AlbumKind, PRUNE_HORIZON_DAYS, entity};
use lp_jobs::HandlerRegistry;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use cursor::CursorTime;

const ENVELOPE_VERSION: i64 = 1;
const DEFAULT_PAGE_SIZE: i64 = 500;
const MAX_PAGE_SIZE: i64 = 1000;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/sync/photos", get(photos))
        .route("/api/sync/persons", get(persons))
        .route("/api/sync/albums/user", get(user_albums))
        .route("/api/sync/albums/auto", get(auto_albums))
        .route("/api/sync/albums/thing", get(thing_albums))
        .route("/api/sync/albums/place", get(place_albums))
        .route("/api/sync/albums/tag", get(tag_albums))
        .route("/api/sync/sharing", get(sharing))
        .route("/api/sync/counts", get(counts))
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

// --------------------------------------------------------------------------
// request / envelope
// --------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
enum PkKind {
    Uuid,
    Int,
}

/// A parsed feed request: the raw cursor (if any) and the page size.
struct FeedRequest {
    cursor: Option<(DateTime<Utc>, String)>,
    page_size: i64,
}

impl FeedRequest {
    /// `BaseSyncView.get` up to the query: cursor decoding (400 / 410) and
    /// the page size. `Err` is the finished error response.
    fn parse(query: &QueryMap) -> Result<Self, Box<Response>> {
        let raw = query.get("cursor").filter(|c| !c.is_empty());
        let cursor = match raw {
            None => None,
            Some(c) => {
                let Some((time, pk)) = cursor::decode(c) else {
                    return Err(Box::new(error(StatusCode::BAD_REQUEST, "invalid_cursor")));
                };
                let dt = match time {
                    CursorTime::Aware(dt) => dt,
                    // `cursor_dt < horizon` raises TypeError on Django.
                    CursorTime::Naive(_) => {
                        return Err(ApiError::internal(
                            "can't compare offset-naive and offset-aware datetimes",
                        )
                        .into_response()
                        .into());
                    }
                };
                if dt < Utc::now() - Duration::days(PRUNE_HORIZON_DAYS) {
                    return Err(Box::new(error(StatusCode::GONE, "cursor_expired")));
                }
                Some((dt, pk))
            }
        };
        let page_size = query
            .get("page_size")
            .map_or(Some(DEFAULT_PAGE_SIZE), cursor::py_int)
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        Ok(FeedRequest { cursor, page_size })
    }

    /// The keyset filter, its id parsed as the feed's primary key (Django's
    /// field conversion raises, a 500, when it does not parse).
    fn keyset(&self, kind: PkKind) -> ApiResult<Option<Keyset>> {
        let Some((dt, pk)) = &self.cursor else {
            return Ok(None);
        };
        let pk = match kind {
            PkKind::Uuid => CursorPk::Uuid(
                Uuid::parse_str(pk.trim())
                    .map_err(|_| ApiError::internal(format!("“{pk}” is not a valid UUID.")))?,
            ),
            PkKind::Int => CursorPk::Int(cursor::py_int(pk).ok_or_else(|| {
                ApiError::internal(format!("Field 'id' expected a number but got '{pk}'."))
            })?),
        };
        Ok(Some(Keyset {
            last_modified: *dt,
            pk,
        }))
    }

    fn since(&self) -> Option<DateTime<Utc>> {
        self.cursor.as_ref().map(|(dt, _)| *dt)
    }

    fn is_seed(&self) -> bool {
        self.cursor.is_none()
    }
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(json!({ "error": code }))).into_response()
}

/// Tombstones for `entity` since the cursor; none on a seed pull.
async fn tombstones(
    state: &AppState,
    user_id: i32,
    entity: Option<&str>,
    req: &FeedRequest,
) -> ApiResult<Vec<String>> {
    match (entity, req.since()) {
        (Some(e), Some(since)) => Ok(q::tombstones(&state.db, user_id, e, since).await?),
        _ => Ok(Vec::new()),
    }
}

/// Assemble the envelope. `last` is the `(last_modified, pk)` of the page's
/// last row; `total` is computed only for a seed.
fn envelope(
    items: Vec<Value>,
    tombstones: Vec<String>,
    last: Option<(DateTime<Utc>, String)>,
    total: Option<i64>,
) -> Response {
    let mut out = Map::new();
    out.insert("v".into(), json!(ENVELOPE_VERSION));
    out.insert("items".into(), Value::Array(items));
    out.insert("tombstones".into(), json!(tombstones));
    out.insert(
        "next_cursor".into(),
        last.map_or(Value::Null, |(dt, pk)| {
            Value::String(cursor::encode(&dt, &pk))
        }),
    );
    out.insert("server_time".into(), json!(py_isoformat(&Utc::now())));
    if let Some(total) = total {
        out.insert("total".into(), json!(total));
    }
    Json(Value::Object(out)).into_response()
}

// --------------------------------------------------------------------------
// value helpers (api/serializers/sync.py)
// --------------------------------------------------------------------------

/// `to_ms`: `int(dt.timestamp() * 1000)` in float arithmetic, truncated
/// toward zero.
pub fn to_ms(dt: &DateTime<Utc>) -> i64 {
    let seconds = dt.timestamp_micros() as f64 / 1e6;
    (seconds * 1000.0).trunc() as i64
}

fn ms_opt(dt: Option<&DateTime<Utc>>) -> Value {
    dt.map_or(Value::Null, |d| json!(to_ms(d)))
}

/// `dominant_hex`: `"[r, g, b]"` -> `#rrggbb` (`%02x`, so a negative or
/// larger-than-255 value prints as Python does), `None` on anything else.
pub fn dominant_hex(raw: Option<&str>) -> Option<String> {
    let raw = raw.filter(|r| !r.is_empty())?;
    let chars: Vec<char> = raw.chars().collect();
    let inner: String = if chars.len() >= 2 {
        chars[1..chars.len() - 1].iter().collect()
    } else {
        String::new()
    };
    let parts: Vec<&str> = inner.split(", ").collect();
    if parts.len() != 3 {
        return None;
    }
    let mut out = String::from("#");
    for p in parts {
        let n = cursor::py_int(p)?;
        if n < 0 {
            out.push_str(&format!("-{:x}", n.unsigned_abs()));
        } else {
            out.push_str(&format!("{n:02x}"));
        }
    }
    Some(out)
}

/// `_video_length_ms`: `int(float(raw) * 1000)`; a value that does not parse
/// (or NaN) is null, an infinite one raises `OverflowError` on Django (500).
pub fn video_length_ms(raw: Option<&str>) -> ApiResult<Value> {
    let Some(raw) = raw.filter(|r| !r.is_empty()) else {
        return Ok(Value::Null);
    };
    let Some(f) = cursor::py_float(raw) else {
        return Ok(Value::Null);
    };
    let ms = f * 1000.0;
    if ms.is_nan() {
        return Ok(Value::Null);
    }
    if ms.is_infinite() {
        return Err(ApiError::internal(
            "cannot convert float infinity to integer",
        ));
    }
    Ok(json!(ms.trunc() as i64))
}

fn opt_f64(v: Option<f64>) -> Value {
    v.map_or(Value::Null, |f| json!(f))
}

// --------------------------------------------------------------------------
// feeds
// --------------------------------------------------------------------------

async fn photos(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let keyset = req.keyset(PkKind::Uuid)?;
    let rows = q::photos_page(&state.db, user.id, keyset, req.page_size).await?;
    let mut items = Vec::with_capacity(rows.len());
    for r in &rows {
        let media_type = if r.video {
            "video"
        } else if r.has_motion {
            "motion"
        } else {
            "image"
        };
        let min_rating = r.favorite_min_rating;
        items.push(json!({
            "id": r.id.to_string(),
            "image_hash": r.image_hash,
            "owner_id": r.owner_id,
            "timestamp": ms_opt(r.exif_timestamp.as_ref().or(r.timestamp.as_ref())),
            "added_on": to_ms(&r.added_on),
            "last_modified": to_ms(&r.last_modified),
            "type": media_type,
            "video_length_ms": video_length_ms(r.video_length.as_deref())?,
            "rating": r.rating,
            "is_favorite": min_rating != 0 && r.rating >= min_rating,
            "hidden": r.hidden,
            "in_trashcan": r.in_trashcan,
            "removed": r.removed,
            "is_public": r.public,
            "aspect_ratio": opt_f64(r.aspect_ratio),
            "latitude": opt_f64(r.exif_gps_lat),
            "longitude": opt_f64(r.exif_gps_lon),
            "search_location": r.search_location.clone().unwrap_or_default(),
            "dominant_color": dominant_hex(r.dominant_color.as_deref()),
        }));
    }
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    let tombs = tombstones(&state, user.id, Some(entity::PHOTO), &req).await?;
    let total = if req.is_seed() {
        Some(q::photos_total(&state.db, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

async fn persons(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let rows = q::persons_page(&state.db, user.id, req.keyset(PkKind::Int)?, req.page_size).await?;
    let items = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "name": r.name,
                "kind": r.kind,
                "face_count": r.face_count,
                "cover_photo_hash": r.cover_photo_hash,
                "last_modified": to_ms(&r.last_modified),
            })
        })
        .collect();
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    let tombs = tombstones(&state, user.id, Some(entity::PERSON), &req).await?;
    let total = if req.is_seed() {
        Some(q::persons_total(&state.db, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

/// `str(pk)` of a membership photo id (`"None"` for a NULL through row).
fn py_str_uuid(id: Option<Uuid>) -> String {
    id.map_or_else(|| "None".to_string(), |u| u.to_string())
}

/// Membership of `album_ids`, grouped per album in through-row order.
async fn members(
    state: &AppState,
    kind: AlbumKind,
    album_ids: &[i32],
) -> ApiResult<HashMap<i32, Vec<Option<Uuid>>>> {
    let mut out: HashMap<i32, Vec<Option<Uuid>>> = HashMap::new();
    for (aid, pid) in q::album_members(&state.db, kind, album_ids).await? {
        out.entry(aid).or_default().push(pid);
    }
    Ok(out)
}

async fn user_albums(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let rows =
        q::user_albums_page(&state.db, user.id, req.keyset(PkKind::Int)?, req.page_size).await?;
    let ids: Vec<i32> = rows.iter().map(|r| r.id).collect();
    let membership = members(&state, AlbumKind::User, &ids).await?;
    let shared: HashSet<i32> = q::user_albums_shared(&state.db, &ids)
        .await?
        .into_iter()
        .collect();
    let items = rows
        .iter()
        .map(|r| {
            let photo_ids: Vec<String> = membership
                .get(&r.id)
                .map(|v| v.iter().map(|p| py_str_uuid(*p)).collect())
                .unwrap_or_default();
            json!({
                "id": r.id,
                "title": r.title,
                "owner_id": r.owner_id,
                "favorited": r.favorited,
                "shared": i32::from(shared.contains(&r.id)),
                "cover_hash": r.cover_photo_hash,
                "photo_count": photo_ids.len(),
                "created_on": to_ms(&r.created_on),
                "last_modified": to_ms(&r.last_modified),
                "photo_ids": photo_ids,
            })
        })
        .collect();
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    let tombs = tombstones(&state, user.id, Some(entity::ALBUM_USER), &req).await?;
    let total = if req.is_seed() {
        Some(q::albums_total(&state.db, AlbumKind::User, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

async fn auto_albums(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let rows =
        q::auto_albums_page(&state.db, user.id, req.keyset(PkKind::Int)?, req.page_size).await?;
    let ids: Vec<i32> = rows.iter().map(|r| r.id).collect();
    let membership = members(&state, AlbumKind::Auto, &ids).await?;
    // Cover = the first member's image_hash.
    let firsts: Vec<Uuid> = membership
        .values()
        .filter_map(|v| v.first().copied().flatten())
        .collect();
    let hashes: HashMap<Uuid, String> = q::photo_hashes(&state.db, &firsts)
        .await?
        .into_iter()
        .collect();
    let items = rows
        .iter()
        .map(|r| {
            let pids = membership.get(&r.id).cloned().unwrap_or_default();
            let cover = pids
                .first()
                .copied()
                .flatten()
                .and_then(|p| hashes.get(&p).cloned());
            let photo_ids: Vec<String> = pids.iter().map(|p| py_str_uuid(*p)).collect();
            json!({
                "id": r.id,
                "title": r.title,
                "timestamp": to_ms(&r.timestamp),
                "favorited": r.favorited,
                "photo_count": photo_ids.len(),
                "cover_hash": cover,
                "last_modified": to_ms(&r.last_modified),
                "photo_ids": photo_ids,
            })
        })
        .collect();
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    let tombs = tombstones(&state, user.id, Some(entity::ALBUM_AUTO), &req).await?;
    let total = if req.is_seed() {
        Some(q::albums_total(&state.db, AlbumKind::Auto, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

/// `serialize_named_album_row` (+ `extra`).
fn named_row(r: &q::NamedAlbumRow, cover_hashes: Vec<String>, place: bool) -> Value {
    let mut v = json!({
        "id": r.id,
        "title": r.title,
        "photo_count": r.photo_count,
        "cover_hashes": cover_hashes,
        "last_modified": to_ms(&r.last_modified),
    });
    if place {
        v["geolocation_level"] = json!(r.geolocation_level);
    }
    v
}

async fn thing_albums(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let rows =
        q::thing_albums_page(&state.db, user.id, req.keyset(PkKind::Int)?, req.page_size).await?;
    let ids: Vec<i32> = rows.iter().map(|r| r.id).collect();
    let mut covers: HashMap<i32, Vec<String>> = HashMap::new();
    for (aid, hash) in q::thing_covers(&state.db, &ids).await? {
        covers.entry(aid).or_default().push(hash);
    }
    let items = rows
        .iter()
        .map(|r| named_row(r, covers.remove(&r.id).unwrap_or_default(), false))
        .collect();
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    let tombs = tombstones(&state, user.id, Some(entity::ALBUM_THING), &req).await?;
    let total = if req.is_seed() {
        Some(q::albums_total(&state.db, AlbumKind::Thing, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

async fn place_albums(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let rows =
        q::place_albums_page(&state.db, user.id, req.keyset(PkKind::Int)?, req.page_size).await?;
    let items = rows
        .iter()
        .map(|r| named_row(r, Vec::new(), true))
        .collect();
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    let tombs = tombstones(&state, user.id, Some(entity::ALBUM_PLACE), &req).await?;
    let total = if req.is_seed() {
        Some(q::albums_total(&state.db, AlbumKind::Place, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

async fn tag_albums(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let rows = q::tags_page(&state.db, user.id, req.keyset(PkKind::Int)?, req.page_size).await?;
    let items = rows
        .iter()
        .map(|r| named_row(r, Vec::new(), false))
        .collect();
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    let tombs = tombstones(&state, user.id, Some(entity::TAG), &req).await?;
    let total = if req.is_seed() {
        Some(q::tags_total(&state.db, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

async fn sharing(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    query: QueryMap,
) -> ApiResult<Response> {
    let req = match FeedRequest::parse(&query) {
        Ok(r) => r,
        Err(resp) => return Ok(*resp),
    };
    let rows =
        q::shared_users_page(&state.db, user.id, req.keyset(PkKind::Int)?, req.page_size).await?;
    let items = rows
        .iter()
        .map(|r| {
            let avatar = r
                .avatar
                .as_deref()
                .filter(|a| !a.is_empty())
                .map(|a| format!("/media/{a}"));
            json!({
                "id": r.id,
                "username": r.username,
                "first_name": r.first_name,
                "last_name": r.last_name,
                "avatar_url": avatar,
                "last_modified": to_ms(&r.last_modified),
            })
        })
        .collect();
    let last = rows.last().map(|r| (r.last_modified, r.id.to_string()));
    // User profiles are not tombstoned.
    let tombs = tombstones(&state, user.id, None, &req).await?;
    let total = if req.is_seed() {
        Some(q::shared_users_total(&state.db, user.id).await?)
    } else {
        None
    };
    Ok(envelope(items, tombs, last, total))
}

async fn counts(State(state): State<AppState>, AuthUser(user): AuthUser) -> ApiResult<Response> {
    let c = q::counts(&state.db, user.id).await?;
    Ok(Json(json!({
        "photos": c.photos,
        "persons": c.persons,
        "user_albums": c.user_albums,
        "auto_albums": c.auto_albums,
        "thing_albums": c.thing_albums,
        "place_albums": c.place_albums,
        "tags": c.tags,
        "server_time": py_isoformat(&Utc::now()),
    }))
    .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn ms_truncates_like_python() {
        let dt = Utc.with_ymd_and_hms(2019, 9, 3, 15, 11, 38).unwrap();
        assert_eq!(to_ms(&dt), 1_567_523_498_000);
        let dt = dt + Duration::microseconds(123_999);
        assert_eq!(to_ms(&dt), 1_567_523_498_123);
        // Before the epoch, int() truncates toward zero.
        let dt = Utc.timestamp_micros(-1_500).unwrap();
        assert_eq!(to_ms(&dt), -1);
    }

    #[test]
    fn dominant_colors() {
        assert_eq!(
            dominant_hex(Some("[1, 22, 255]")).as_deref(),
            Some("#0116ff")
        );
        assert_eq!(
            dominant_hex(Some("[300, 0, -5]")).as_deref(),
            Some("#12c00-5")
        );
        assert_eq!(dominant_hex(Some("(1, 2, 3)")).as_deref(), Some("#010203"));
        assert_eq!(dominant_hex(Some("[1, 2]")), None);
        assert_eq!(dominant_hex(Some("[1,2,3]")), None);
        assert_eq!(dominant_hex(Some("")), None);
        assert_eq!(dominant_hex(None), None);
    }

    #[test]
    fn video_lengths() {
        assert_eq!(video_length_ms(Some("12.5")).unwrap(), json!(12500));
        assert_eq!(video_length_ms(Some(" 3 ")).unwrap(), json!(3000));
        assert_eq!(video_length_ms(Some("abc")).unwrap(), Value::Null);
        assert_eq!(video_length_ms(Some("nan")).unwrap(), Value::Null);
        assert_eq!(video_length_ms(Some("")).unwrap(), Value::Null);
        assert_eq!(video_length_ms(None).unwrap(), Value::Null);
        assert!(video_length_ms(Some("inf")).is_err());
    }
}

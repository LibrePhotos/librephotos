//! User albums: `/albums/user/*`, `/useralbum/share`, `/useralbum/makepublic`.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use lp_auth::{AuthUser, OptionalUser};
use lp_core::extract::py_truthy;
use lp_core::time::drf_datetime;
use lp_core::{ApiError, ApiJson, ApiResult, AppState, QueryMap};
use lp_db::albums_tags::misc::owned_photo_ids;
use lp_db::albums_tags::things_places::{AlbumPhotos, album_photos};
use lp_db::albums_tags::user_albums::{
    self as reads, DetailScope, UserAlbumDetailRow, UserAlbumListKind,
};
use lp_db::albums_tags::{self, Paged};
use lp_db::scope::PhotoFilterParams;
use lp_db::users::User;
use lp_db::write::albums_tags::PhotoSelection;
use lp_db::write::albums_tags::user_albums::{
    self as writes, AlbumEdit, PublicShareEdit, SHARING_OPTION_FIELDS,
};
use serde::Serialize;
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::dto::{Group, SharingOptions, UserAlbumListItem, grouped, media_filter};
use super::validate::{self as v, Errors};
use crate::common::{DrfPage, PageRequest};

fn page(
    headers: &HeaderMap,
    uri: &Uri,
    req: PageRequest,
    paged: Paged<lp_db::albums_tags::user_albums::UserAlbumListRow>,
) -> ApiResult<Json<DrfPage<UserAlbumListItem>>> {
    req.valid_for(paged.total)?;
    let results = paged
        .rows
        .into_iter()
        .map(UserAlbumListItem::from)
        .collect();
    Ok(Json(DrfPage::new(headers, uri, req, paged.total, results)))
}

/// `GET /api/albums/user/list/` (`AlbumUserListViewSet`).
pub async fn list(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<UserAlbumListItem>>> {
    let req = PageRequest::from_query(&q, "page_size", 1000, 2000)?;
    let search = albums_tags::search_terms(q.get("search"));
    let paged = reads::list(
        &state.db,
        UserAlbumListKind::Owned {
            owner_id: user.id,
            search: &search,
        },
        req.page_size,
        req.offset(),
    )
    .await?;
    page(&headers, &uri, req, paged)
}

/// `GET /api/albums/user/shared/fromme/`.
pub async fn shared_from_me(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<UserAlbumListItem>>> {
    let req = PageRequest::from_query(&q, "page_size", 2500, 5000)?;
    let paged = reads::list(
        &state.db,
        UserAlbumListKind::SharedFromMe { owner_id: user.id },
        req.page_size,
        req.offset(),
    )
    .await?;
    page(&headers, &uri, req, paged)
}

/// `GET /api/albums/user/shared/tome/`.
pub async fn shared_to_me(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<DrfPage<UserAlbumListItem>>> {
    let req = PageRequest::from_query(&q, "page_size", 2500, 5000)?;
    let paged = reads::list(
        &state.db,
        UserAlbumListKind::SharedToMe { user_id: user.id },
        req.page_size,
        req.offset(),
    )
    .await?;
    page(&headers, &uri, req, paged)
}

/// `AlbumUserSerializer`.
#[derive(Debug, Serialize)]
pub struct UserAlbumDetail {
    id: String,
    title: String,
    owner: Value,
    shared_to: Value,
    date: String,
    location: String,
    grouped_photos: Vec<Group>,
    public: bool,
    public_slug: String,
    #[serde(serialize_with = "lp_core::time::ser_drf_opt")]
    public_expires_at: Option<DateTime<Utc>>,
    public_sharing_options: Option<SharingOptions>,
}

/// `AlbumUserPublicSerializer` (`public_slug` / `public_expires_at` are
/// declared but skipped by DRF: the model has no such attributes).
#[derive(Debug, Serialize)]
pub struct UserAlbumPublic {
    id: String,
    title: String,
    owner: Value,
    date: String,
    location: String,
    grouped_photos: Vec<Group>,
}

fn not_found_album() -> ApiError {
    ApiError::not_found_msg("No AlbumUser matches the given query.")
}

/// Path ids DRF's `get_object_or_404` rejects before querying (`Not found.`).
fn parse_pk(raw: &str) -> ApiResult<i32> {
    raw.trim().parse::<i32>().map_err(|_| ApiError::not_found())
}

/// `get_effective_sharing_settings`: all off, then the owner's defaults,
/// then the album's non-null overrides.
fn effective(row: &UserAlbumDetailRow) -> (bool, bool) {
    let mut location = false;
    let mut timestamps = false;
    if let Some(obj) = row.owner_sharing_defaults.as_object() {
        if let Some(v) = obj.get("share_location") {
            location = py_truthy(v);
        }
        if let Some(v) = obj.get("share_timestamps") {
            timestamps = py_truthy(v);
        }
    }
    if row.share_id.is_some() {
        if let Some(v) = row.share_location {
            location = v;
        }
        if let Some(v) = row.share_timestamps {
            timestamps = v;
        }
    }
    (location, timestamps)
}

async fn detail_response(
    state: &AppState,
    row: UserAlbumDetailRow,
    q: &QueryMap,
) -> ApiResult<Response> {
    let photos = album_photos(
        &state.db,
        AlbumPhotos::User {
            album_id: row.id,
            public: false,
        },
        media_filter(q),
    )
    .await?;
    let has_share = row.share_id.is_some();
    Ok(Json(UserAlbumDetail {
        id: row.id.to_string(),
        title: row.title,
        owner: row.owner.0,
        shared_to: row.shared_to.0,
        date: row
            .first_timestamp
            .as_ref()
            .map(drf_datetime)
            .unwrap_or_default(),
        location: row.first_location.unwrap_or_default(),
        grouped_photos: grouped(photos),
        public: has_share && row.share_enabled.unwrap_or(false),
        public_slug: row.share_slug.unwrap_or_default(),
        public_expires_at: row.share_expires_at,
        public_sharing_options: has_share.then_some(SharingOptions {
            share_location: row.share_location,
            share_camera_info: row.share_camera_info,
            share_timestamps: row.share_timestamps,
            share_captions: row.share_captions,
            share_faces: row.share_faces,
        }),
    })
    .into_response())
}

async fn public_response(
    state: &AppState,
    row: UserAlbumDetailRow,
    q: &QueryMap,
) -> ApiResult<Response> {
    let (share_location, share_timestamps) = effective(&row);
    // Newest first; Postgres sorts NULL timestamps first on DESC.
    let all = album_photos(
        &state.db,
        AlbumPhotos::User {
            album_id: row.id,
            public: true,
        },
        lp_db::albums_tags::things_places::MediaFilter::All,
    )
    .await?;
    let date = if share_timestamps {
        all.iter()
            .find_map(|p| p.exif_timestamp.as_ref().map(drf_datetime))
            .unwrap_or_default()
    } else {
        String::new()
    };
    let location = if share_location {
        all.iter()
            .find(|p| !p.location.is_empty())
            .map(|p| p.location.clone())
            .unwrap_or_default()
    } else {
        String::new()
    };
    let media = media_filter(q);
    let photos: Vec<_> = all
        .into_iter()
        .filter(|p| match media {
            lp_db::albums_tags::things_places::MediaFilter::All => true,
            lp_db::albums_tags::things_places::MediaFilter::Videos => p.video,
            lp_db::albums_tags::things_places::MediaFilter::Photos => !p.video,
        })
        .collect();
    let mut groups = if share_timestamps {
        grouped(photos)
    } else if photos.is_empty() {
        Vec::new()
    } else {
        vec![Group {
            date: None,
            location: String::new(),
            items: photos,
        }]
    };
    for group in &mut groups {
        for item in &mut group.items {
            if !share_location {
                item.exif_gps_lat = None;
                item.exif_gps_lon = None;
                item.location = String::new();
            }
            if !share_timestamps {
                item.date = String::new();
                item.birth_time = String::new();
            }
        }
    }
    Ok(Json(UserAlbumPublic {
        id: row.id.to_string(),
        title: row.title,
        owner: row.owner.0,
        date,
        location,
        grouped_photos: groups,
    })
    .into_response())
}

/// `GET /api/albums/user/{id}/` (bare object). `?public=` makes it an
/// anonymous-readable view of an active public share.
pub async fn detail(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    Path(raw_id): Path<String>,
    q: QueryMap,
) -> ApiResult<Response> {
    if q.flag("public") {
        let id = parse_pk(&raw_id)?;
        let username = q.get("username").filter(|u| !u.is_empty());
        let row = reads::detail(&state.db, id, DetailScope::Public { username })
            .await?
            .ok_or_else(not_found_album)?;
        return public_response(&state, row, &q).await;
    }
    let user = user.ok_or_else(ApiError::not_authenticated)?;
    let id = parse_pk(&raw_id)?;
    let row = reads::detail(
        &state.db,
        id,
        DetailScope::Visible {
            user_id: user.id,
            write: false,
        },
    )
    .await?
    .ok_or_else(not_found_album)?;
    detail_response(&state, row, &q).await
}

async fn owned_detail(
    state: &AppState,
    user: &User,
    raw_id: &str,
) -> ApiResult<UserAlbumDetailRow> {
    let id = parse_pk(raw_id)?;
    reads::detail(
        &state.db,
        id,
        DetailScope::Visible {
            user_id: user.id,
            write: true,
        },
    )
    .await?
    .ok_or_else(not_found_album)
}

/// `PATCH /api/albums/user/{id}/`: rename (owner only; recipients get 404).
pub async fn rename(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    q: QueryMap,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let row = owned_detail(&state, &user, &raw_id).await?;
    let obj = v::body_object(&body)?;
    let mut errors = Errors::default();
    let title = match obj.get("title") {
        Some(t) => errors.check("title", v::char_field(t, 512)),
        None => None,
    };
    errors.into_result()?;
    writes::rename(&state.db, row.id, title.as_deref()).await?;
    let row = owned_detail(&state, &user, &raw_id).await?;
    detail_response(&state, row, &q).await
}

/// `DELETE /api/albums/user/{id}/` (owner only).
pub async fn delete(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
) -> ApiResult<StatusCode> {
    let row = owned_detail(&state, &user, &raw_id).await?;
    writes::delete(&state.db, row.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `AlbumUserEditSerializer` output.
#[derive(Debug, Serialize)]
pub struct EditOut {
    id: i32,
    title: String,
    photos: Vec<Uuid>,
    #[serde(serialize_with = "lp_core::time::ser_drf")]
    created_on: DateTime<Utc>,
    favorited: bool,
    cover_photo: Option<Uuid>,
}

async fn edit_out(state: &AppState, id: i32) -> ApiResult<EditOut> {
    let r = reads::edit_row(&state.db, id).await?;
    Ok(EditOut {
        id: r.id,
        title: r.title,
        photos: r.photos,
        created_on: r.created_on,
        favorited: r.favorited,
        cover_photo: r.cover_photo_id,
    })
}

/// Validated `AlbumUserEditSerializer` input.
struct EditInput {
    title: Option<String>,
    photos: Option<Vec<Uuid>>,
    removed: Option<Vec<String>>,
    cover_photo: Option<Option<Uuid>>,
    select_all: bool,
    query: Option<Value>,
    excluded_hashes: Vec<String>,
}

/// Owner-scoped `OwnedPhotoField` values: every id must name one of the
/// requester's photos; the first bad item (in order) is the field error.
async fn owned_photos(
    state: &AppState,
    user: &User,
    items: &[Value],
) -> ApiResult<Result<Vec<Uuid>, String>> {
    let parsed: Vec<Result<Uuid, String>> = items.iter().map(v::photo_pk).collect();
    let ids: Vec<Uuid> = parsed
        .iter()
        .filter_map(|r| r.as_ref().ok().copied())
        .collect();
    let owned = owned_photo_ids(&state.db, user.id, &ids).await?;
    for (raw, r) in items.iter().zip(&parsed) {
        match r {
            Err(m) => return Ok(Err(m.clone())),
            Ok(id) if !owned.contains(id) => return Ok(Err(v::does_not_exist(raw))),
            Ok(_) => {}
        }
    }
    Ok(Ok(ids))
}

async fn validate_edit(
    state: &AppState,
    user: &User,
    body: &Value,
    creating: bool,
) -> ApiResult<EditInput> {
    let obj: &Map<String, Value> = v::body_object(body)?;
    let mut errors = Errors::default();
    let title = match obj.get("title") {
        Some(t) => errors.check("title", v::char_field(t, 512)),
        None if creating => {
            errors.add("title", v::REQUIRED);
            None
        }
        None => None,
    };
    let photos = match obj.get("photos") {
        Some(p) => match v::many_items(p) {
            Ok(items) => errors.check("photos", owned_photos(state, user, &items).await?),
            Err(m) => {
                errors.add("photos", m);
                None
            }
        },
        None if creating => {
            errors.add("photos", v::REQUIRED);
            None
        }
        None => None,
    };
    if let Some(f) = obj.get("favorited") {
        errors.check("favorited", v::bool_field(f));
    }
    let removed = match obj.get("removedPhotos") {
        Some(r) => errors.check("removedPhotos", v::string_list(r, 100)),
        None => None,
    };
    let cover_photo = match obj.get("cover_photo") {
        Some(Value::Null) => Some(None),
        Some(c) => errors
            .check(
                "cover_photo",
                owned_photos(state, user, std::slice::from_ref(c)).await?,
            )
            .map(|ids| ids.first().copied()),
        None => None,
    };
    let select_all = match obj.get("select_all") {
        Some(s) => errors
            .check("select_all", v::bool_field(s))
            .unwrap_or(false),
        None => false,
    };
    let query = match obj.get("query") {
        Some(qv) => errors.check("query", v::dict_field(qv)),
        None => None,
    };
    let excluded_hashes = match obj.get("excluded_hashes") {
        Some(e) => errors.check("excluded_hashes", v::string_list(e, 100)),
        None => None,
    };
    errors.into_result()?;
    Ok(EditInput {
        title,
        photos,
        removed,
        cover_photo,
        select_all,
        query,
        excluded_hashes: excluded_hashes.unwrap_or_default(),
    })
}

fn to_edit(user: &User, input: EditInput) -> ApiResult<AlbumEdit> {
    let add = if input.select_all {
        let query = input.query.unwrap_or_else(|| json!({}));
        Some(PhotoSelection::SelectAll {
            owner_id: user.id,
            favorite_min_rating: user.favorite_min_rating,
            params: PhotoFilterParams::from_json(&query)?,
            excluded_hashes: input.excluded_hashes,
        })
    } else {
        input.photos.map(PhotoSelection::Ids)
    };
    Ok(AlbumEdit {
        title: input.title,
        removed_hashes: input.removed,
        cover_photo: input.cover_photo,
        add,
    })
}

/// `POST /api/albums/user/edit/`: create (or, for an existing title, update).
pub async fn edit_create(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let input = validate_edit(&state, &user, &body, true).await?;
    let title = input.title.clone().unwrap_or_default();
    let edit = to_edit(&user, input)?;
    let id = writes::create(&state.db, user.id, &title, &edit).await?;
    Ok((StatusCode::CREATED, Json(edit_out(&state, id).await?)).into_response())
}

/// `PATCH /api/albums/user/edit/{id}/`.
pub async fn edit_update(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(raw_id): Path<String>,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Json<EditOut>> {
    let id = parse_pk(&raw_id)?;
    let id = reads::owned_id(&state.db, id, user.id)
        .await?
        .ok_or_else(not_found_album)?;
    let input = validate_edit(&state, &user, &body, false).await?;
    let edit = to_edit(&user, input)?;
    writes::update(&state.db, id, &edit).await?;
    Ok(Json(edit_out(&state, id).await?))
}

fn status_message(code: StatusCode, message: &str) -> Response {
    (code, Json(json!({"status": false, "message": message}))).into_response()
}

/// A request value used as an integer pk: `Ok(None)` = Python's `None`
/// (matches nothing), `Err` = Python raises (500).
fn lookup_int(v: Option<&Value>) -> ApiResult<Option<i32>> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(x) => v::py_int(x)
            .map(|i| i32::try_from(i).ok())
            .ok_or_else(|| ApiError::internal("invalid integer lookup")),
    }
}

async fn album_list_item(state: &AppState, id: i32) -> ApiResult<UserAlbumListItem> {
    let row = reads::by_id(&state.db, id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(UserAlbumListItem::from(row))
}

/// `POST /api/useralbum/share/` (`SetUserAlbumShared`).
pub async fn share(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let obj = v::body_object(&body)?;
    let (Some(shared), Some(target), Some(album)) = (
        obj.get("shared"),
        obj.get("target_user_id"),
        obj.get("album_id"),
    ) else {
        return Err(ApiError::internal("missing share parameters"));
    };
    let target = match lookup_int(Some(target))? {
        Some(id) => lp_db::users::by_id(&state.db, id).await?,
        None => None,
    };
    let Some(target) = target else {
        return Ok(status_message(StatusCode::BAD_REQUEST, "No such user"));
    };
    let owner = match lookup_int(Some(album))? {
        Some(id) => reads::owner_of(&state.db, id).await?.map(|o| (id, o)),
        None => None,
    };
    let Some((album_id, owner_id)) = owner else {
        return Ok(status_message(StatusCode::BAD_REQUEST, "No such album"));
    };
    if owner_id != user.id {
        return Ok(status_message(
            StatusCode::BAD_REQUEST,
            "You cannot share an album you don't own",
        ));
    }
    writes::set_shared(&state.db, album_id, target.id, py_truthy(shared)).await?;
    Ok(Json(album_list_item(&state, album_id).await?).into_response())
}

/// `BooleanField(null=True)` coercion of a sharing option (`Err` = 500).
fn nullable_bool(v: &Value) -> ApiResult<Option<bool>> {
    match v {
        Value::Null => Ok(None),
        Value::Bool(b) => Ok(Some(*b)),
        Value::Number(n) if n.as_f64() == Some(1.0) => Ok(Some(true)),
        Value::Number(n) if n.as_f64() == Some(0.0) => Ok(Some(false)),
        Value::String(s) if matches!(s.as_str(), "t" | "True" | "1") => Ok(Some(true)),
        Value::String(s) if matches!(s.as_str(), "f" | "False" | "0") => Ok(Some(false)),
        Value::String(s) if s.is_empty() => Ok(None),
        Value::Array(a) if a.is_empty() => Ok(None),
        Value::Object(o) if o.is_empty() => Ok(None),
        _ => Err(ApiError::internal("invalid sharing option")),
    }
}

/// `POST /api/useralbum/makepublic` (`SetUserAlbumPublic`).
pub async fn make_public(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let obj = v::body_object(&body)?;
    let album = obj.get("album_id").filter(|x| !x.is_null());
    let val_public = obj.get("val_public").filter(|x| !x.is_null());
    let (Some(album), Some(val_public)) = (album, val_public) else {
        return Ok(status_message(
            StatusCode::BAD_REQUEST,
            "Missing parameters",
        ));
    };
    let owner = match lookup_int(Some(album))? {
        Some(id) => reads::owner_of(&state.db, id).await?.map(|o| (id, o)),
        None => None,
    };
    let Some((album_id, owner_id)) = owner else {
        return Ok(status_message(StatusCode::NOT_FOUND, "No such album"));
    };
    if owner_id != user.id {
        return Ok(status_message(
            StatusCode::FORBIDDEN,
            "You are not the owner of this album",
        ));
    }
    let mut edit = PublicShareEdit {
        enabled: py_truthy(val_public),
        ..Default::default()
    };
    match obj.get("slug") {
        None | Some(Value::Null) => {}
        Some(s) => {
            edit.slug = Some(py_truthy(s).then(|| v::py_str(s)));
        }
    }
    if let Some(Value::String(s)) = obj.get("expires_at") {
        edit.expires_at = Some(lp_core::time::parse_client_datetime(s));
    }
    if let Some(Value::Object(opts)) = obj.get("sharing_options") {
        for (i, field) in SHARING_OPTION_FIELDS.iter().enumerate() {
            if let Some(val) = opts.get(*field) {
                edit.options[i] = Some(nullable_bool(val)?);
            }
        }
    }
    writes::set_public(&state.db, album_id, &edit).await?;
    Ok(Json(json!({
        "status": true,
        "album": album_list_item(&state, album_id).await?,
    }))
    .into_response())
}

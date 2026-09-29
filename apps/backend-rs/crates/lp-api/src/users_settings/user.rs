//! `UserViewSet`, `ManageUserViewSet`, `DeleteUserViewSet` and
//! `IsFirstTimeSetupView` (`api/views/user.py`, `api/serializers/user.py`).

use axum::Json;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use indexmap::IndexMap;
use lp_auth::{AdminUser, OptionalUser};
use lp_core::django_crypto::DjangoCrypto;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::users::User;
use lp_db::users_settings::{UserPhotoStats, UserScope};
use lp_db::write::users::NewUser;
use lp_db::write::users_settings::{self as w, ColVal};
use lp_jobs::lrj::JobType;
use serde_json::{Value, json};

use super::fields::{self, Errors, Kind, Parsed};
use super::input::{self, Input, InputValue, UploadedFile};
use super::{avatar, scan_dir, serialize};

const PAGE_SIZE: i64 = 20_000;

fn char_(max: usize) -> Kind {
    Kind::Char {
        max,
        min: 0,
        allow_blank: true,
    }
}

const PASSWORD: Kind = Kind::Char {
    max: 128,
    min: 0,
    allow_blank: false,
};

/// Writable `UserSerializer` fields, in `Meta.fields` order.
fn user_fields() -> Vec<(&'static str, Kind)> {
    vec![
        ("username", Kind::Username),
        ("email", Kind::Email),
        ("scan_directory", char_(512)),
        ("confidence", Kind::Float),
        ("confidence_person", Kind::Float),
        ("transcode_videos", Kind::Bool),
        ("semantic_search_topk", Kind::Int),
        ("first_name", char_(150)),
        ("last_name", char_(150)),
        ("date_joined", Kind::DateTime { allow_null: false }),
        ("password", PASSWORD),
        ("avatar", Kind::Json), // handled separately (ImageField)
        ("is_superuser", Kind::Bool),
        ("nextcloud_server_address", char_(200)),
        ("nextcloud_username", char_(64)),
        ("nextcloud_app_password", char_(64)),
        ("nextcloud_scan_directory", char_(512)),
        ("favorite_min_rating", Kind::Int),
        ("image_scale", Kind::Float),
        ("text_alignment", Kind::Choice(fields::TEXT_ALIGNMENT)),
        ("header_size", Kind::Choice(fields::HEADER_SIZE)),
        ("save_metadata_to_disk", Kind::Choice(fields::SAVE_METADATA)),
        ("save_face_tags_to_disk", Kind::Bool),
        ("datetime_rules", Kind::Json),
        ("burst_detection_rules", Kind::Json),
        ("llm_settings", Kind::Json),
        ("default_timezone", Kind::Timezone),
        ("public_sharing", Kind::Bool),
        ("public_sharing_defaults", Kind::Json),
        ("min_cluster_size", Kind::Int),
        ("confidence_unknown_face", Kind::Float),
        ("min_samples", Kind::Int),
        ("cluster_selection_epsilon", Kind::Float),
        ("skip_raw_files", Kind::Bool),
        ("stack_raw_jpeg", Kind::Bool),
        ("slideshow_interval", Kind::Int),
        (
            "duplicate_sensitivity",
            Kind::Choice(fields::DUPLICATE_SENSITIVITY),
        ),
        ("duplicate_clear_existing", Kind::Bool),
    ]
}

/// `USER_UPDATE_FIELDS`: what `UserSerializer.update` applies, in order.
const USER_UPDATE_FIELDS: &[&str] = &[
    "avatar",
    "email",
    "first_name",
    "last_name",
    "transcode_videos",
    "nextcloud_server_address",
    "nextcloud_username",
    "nextcloud_app_password",
    "nextcloud_scan_directory",
    "confidence",
    "confidence_person",
    "semantic_search_topk",
    "favorite_min_rating",
    "save_metadata_to_disk",
    "save_face_tags_to_disk",
    "image_scale",
    "text_alignment",
    "header_size",
    "datetime_rules",
    "burst_detection_rules",
    "default_timezone",
    "public_sharing",
    "min_cluster_size",
    "confidence_unknown_face",
    "min_samples",
    "cluster_selection_epsilon",
    "llm_settings",
    "skip_raw_files",
    "stack_raw_jpeg",
    "slideshow_interval",
    "duplicate_sensitivity",
    "duplicate_clear_existing",
];

/// Writable `ManageUserSerializer` fields, in `Meta.fields` order.
fn manage_fields() -> Vec<(&'static str, Kind)> {
    vec![
        ("username", Kind::Username),
        ("scan_directory", char_(512)),
        ("skip_raw_files", Kind::Bool),
        ("stack_raw_jpeg", Kind::Bool),
        ("confidence", Kind::Float),
        ("semantic_search_topk", Kind::Int),
        ("last_login", Kind::DateTime { allow_null: true }),
        ("date_joined", Kind::DateTime { allow_null: false }),
        ("favorite_min_rating", Kind::Int),
        ("image_scale", Kind::Float),
        ("save_metadata_to_disk", Kind::Choice(fields::SAVE_METADATA)),
        ("email", Kind::Email),
        ("first_name", char_(150)),
        ("last_name", char_(150)),
        ("password", PASSWORD),
    ]
}

/// The avatar in validated data: a new file, or `None` to clear it.
enum AvatarInput {
    Clear,
    Upload(UploadedFile),
}

struct Validated {
    values: IndexMap<&'static str, Parsed>,
    avatar: Option<AvatarInput>,
}

impl Validated {
    fn str(&self, k: &str) -> Option<&str> {
        self.values.get(k).and_then(Parsed::as_str)
    }
}

/// DRF `Serializer.is_valid()` over `specs`. `instance` is the user being
/// updated (partial) or None for a create (every `required` field must be sent).
async fn validate(
    state: &AppState,
    input: &Input,
    specs: &[(&'static str, Kind)],
    required: &[&str],
    instance: Option<&User>,
) -> Result<Validated, ApiError> {
    let mut errors = Errors::default();
    let mut out = Validated {
        values: IndexMap::new(),
        avatar: None,
    };
    for (name, kind) in specs {
        let Some(raw) = input.get(name) else {
            if required.contains(name) {
                errors.add(name, vec!["This field is required.".into()]);
            }
            continue;
        };
        if *name == "avatar" {
            match avatar::validate(raw) {
                Ok(a) => out.avatar = Some(a.map_or(AvatarInput::Clear, AvatarInput::Upload)),
                Err(m) => errors.add(name, vec![m]),
            }
            continue;
        }
        let value = match raw {
            InputValue::Value(v) => v.clone(),
            InputValue::File(_) => Value::String(String::new()),
        };
        let value = match (kind, input.html, &value) {
            (Kind::Json, true, Value::String(s)) => match serde_json::from_str::<Value>(s) {
                Ok(v) => v,
                Err(_) => {
                    errors.add(name, vec!["Value must be valid JSON.".into()]);
                    continue;
                }
            },
            _ => value,
        };
        let parsed = match fields::parse(*kind, &value) {
            Ok(p) => p,
            Err(msgs) => {
                errors.add(name, msgs);
                continue;
            }
        };
        if *name == "username" {
            let u = parsed.as_str().unwrap_or_default();
            if lp_db::users_settings::username_taken_by_other(&state.db, u, instance.map(|i| i.id))
                .await?
            {
                errors.add(
                    name,
                    vec!["A user with that username already exists.".into()],
                );
                continue;
            }
        }
        if *name == "nextcloud_server_address" {
            let addr = parsed.as_str().unwrap_or_default().trim().to_string();
            let unchanged = instance.is_some_and(|i| i.nextcloud_server_address == addr);
            if !addr.is_empty()
                && !unchanged
                && let Err(m) = super::nextcloud::validate_server_address(&addr).await
            {
                errors.add(name, vec![m]);
                continue;
            }
        }
        out.values.insert(name, parsed);
    }
    errors.into_result()?;
    Ok(out)
}

fn col(name: &str, p: &Parsed) -> Option<ColVal> {
    Some(match p {
        Parsed::Str(s) => ColVal::Str(s.clone()),
        Parsed::Int(i) => ColVal::Int(*i),
        Parsed::Float(f) => ColVal::Float(*f),
        Parsed::Bool(b) => ColVal::Bool(*b),
        Parsed::Json(v) => ColVal::Json(v.clone()),
        Parsed::DateTime | Parsed::Null => {
            let _ = name;
            return None;
        }
    })
}

async fn hash_password(state: &AppState, pw: String) -> Result<String, ApiError> {
    state.blocking(move || lp_auth::password::hash(&pw)).await
}

fn parse_id(raw: &str) -> Result<i32, ApiError> {
    raw.trim().parse::<i32>().map_err(|_| ApiError::not_found())
}

/// `get_object_or_404` on the user queryset.
fn no_user() -> ApiError {
    ApiError::not_found_msg("No User matches the given query.")
}

// ---------------------------------------------------------------- reads

async fn stats_for(state: &AppState, id: i32) -> Result<UserPhotoStats, ApiError> {
    let mut all = lp_db::users_settings::photo_stats(&state.db, &[id]).await?;
    Ok(all.remove(&id).unwrap_or_default())
}

/// `GET /api/user/{id}/`.
pub async fn retrieve(
    State(state): State<AppState>,
    OptionalUser(viewer): OptionalUser,
    Path(raw_id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let id = parse_id(&raw_id)?;
    let scope = if viewer.is_some() {
        UserScope::Active
    } else {
        UserScope::PublicSharing
    };
    let (target, stats) = match viewer.as_ref().filter(|v| v.id == id) {
        Some(me) => (me.clone(), stats_for(&state, id).await?),
        None => {
            let (target, stats) = tokio::try_join!(
                async {
                    lp_db::users_settings::visible_user(&state.db, id, scope)
                        .await
                        .map_err(ApiError::from)
                },
                stats_for(&state, id)
            )?;
            (target.ok_or_else(no_user)?, stats)
        }
    };
    let full = viewer
        .as_ref()
        .is_some_and(|v| v.is_staff || v.is_superuser || v.id == id);
    let body = if full {
        serialize::full(&target, &stats, &serialize::request_origin(&headers))
    } else {
        serialize::public(&target, &stats)
    };
    Ok(Json(body).into_response())
}

/// DRF `_positive_int`.
fn positive_int(raw: Option<&str>, strict: bool) -> Option<i64> {
    let n: i64 = raw?.trim().parse().ok()?;
    if n < 0 || (strict && n == 0) {
        return None;
    }
    Some(n)
}

/// DRF `replace_query_param` / `remove_query_param` on the request URL.
fn with_params(origin: &str, uri: &Uri, set: &[(&str, i64)], remove: &[&str]) -> String {
    let mut pairs: Vec<(String, String)> = uri
        .query()
        .map(|q| serde_urlencoded::from_str::<Vec<(String, String)>>(q).unwrap_or_default())
        .unwrap_or_default();
    let mut merged: IndexMap<String, Vec<String>> = IndexMap::new();
    for (k, v) in pairs.drain(..) {
        merged.entry(k).or_default().push(v);
    }
    for (k, v) in set {
        merged.insert((*k).to_string(), vec![v.to_string()]);
    }
    for k in remove {
        merged.shift_remove(*k);
    }
    merged.sort_keys();
    let flat: Vec<(String, String)> = merged
        .into_iter()
        .flat_map(|(k, vs)| vs.into_iter().map(move |v| (k.clone(), v)))
        .collect();
    let q = serde_urlencoded::to_string(&flat).unwrap_or_default();
    // DRF's router only matches `/api/user/`; the slash-stripping middleware
    // removed it from `uri`.
    let path = format!("{}/", uri.path().trim_end_matches('/'));
    if q.is_empty() {
        format!("{origin}{path}")
    } else {
        format!("{origin}{path}?{q}")
    }
}

/// `GET /api/user/` (LimitOffsetPagination, default limit 20000).
pub async fn list(
    State(state): State<AppState>,
    OptionalUser(viewer): OptionalUser,
    headers: HeaderMap,
    uri: Uri,
    q: QueryMap,
) -> ApiResult<Response> {
    let limit = positive_int(q.get("limit"), true).unwrap_or(PAGE_SIZE);
    let offset = positive_int(q.get("offset"), false).unwrap_or(0);
    let scope = if viewer.is_some() {
        UserScope::Active
    } else {
        UserScope::PublicSharing
    };
    let (count, users) = lp_db::users_settings::list_users(&state.db, scope, limit, offset).await?;
    let users = if count == 0 || offset > count {
        Vec::new()
    } else {
        users
    };
    let ids: Vec<i32> = users.iter().map(|u| u.id).collect();
    let mut stats = lp_db::users_settings::photo_stats(&state.db, &ids).await?;
    let full = viewer
        .as_ref()
        .is_some_and(|v| v.is_staff || v.is_superuser);
    let origin = serialize::request_origin(&headers);
    let results: Vec<Value> = users
        .iter()
        .map(|u| {
            let s = stats.remove(&u.id).unwrap_or_default();
            if full {
                serialize::full(u, &s, &origin)
            } else {
                serialize::public(u, &s)
            }
        })
        .collect();
    let next = (offset + limit < count).then(|| {
        with_params(
            &origin,
            &uri,
            &[("limit", limit), ("offset", offset + limit)],
            &[],
        )
    });
    let previous = (offset > 0).then(|| {
        if offset - limit <= 0 {
            with_params(&origin, &uri, &[("limit", limit)], &["offset"])
        } else {
            with_params(
                &origin,
                &uri,
                &[("limit", limit), ("offset", offset - limit)],
                &[],
            )
        }
    });
    Ok(Json(json!({
        "count": count,
        "next": next,
        "previous": previous,
        "results": results,
    }))
    .into_response())
}

/// `GET /api/firsttimesetup/`.
pub async fn first_time_setup(
    State(state): State<AppState>,
    OptionalUser(_viewer): OptionalUser,
) -> ApiResult<Response> {
    let first = lp_db::users_settings::is_first_time_setup(&state.db).await?;
    Ok(Json(json!({ "isFirstTimeSetup": first })).into_response())
}

// ---------------------------------------------------------------- create

/// `identify_hasher` fails: not one of `PASSWORD_HASHERS`.
fn unusable_hash(encoded: &str) -> bool {
    let algo = if (encoded.len() == 32 && !encoded.contains('$'))
        || (encoded.len() == 37 && encoded.starts_with("md5$$"))
    {
        "unsalted_md5"
    } else if encoded.len() == 46 && encoded.starts_with("sha1$$") {
        "unsalted_sha1"
    } else {
        encoded.split('$').next().unwrap_or("")
    };
    !matches!(algo, "argon2" | "pbkdf2_sha256" | "pbkdf2_sha1")
}

/// `is_abandoned_signup`.
async fn is_abandoned_signup(state: &AppState, user: &User) -> Result<bool, ApiError> {
    if user.is_superuser || user.last_login.is_some() {
        return Ok(false);
    }
    if !lp_db::users_settings::is_first_time_setup(&state.db).await? {
        return Ok(false);
    }
    Ok(unusable_hash(&user.password))
}

/// `POST /api/user/`: first-time setup, self-registration, or an admin.
pub async fn create(
    State(state): State<AppState>,
    OptionalUser(viewer): OptionalUser,
    headers: HeaderMap,
    req: Request,
) -> ApiResult<Response> {
    let is_admin = viewer.as_ref().is_some_and(|v| v.is_staff);
    if !is_admin
        && !state.settings().allow_registration
        && !lp_db::users_settings::is_first_time_setup(&state.db).await?
    {
        return Err(if viewer.is_some() {
            ApiError::permission_denied()
        } else {
            ApiError::not_authenticated()
        });
    }
    let input = input::read(req).await?;
    if viewer.as_ref().is_some_and(|v| v.is_superuser) {
        admin_create(&state, &input, &headers).await
    } else {
        signup(&state, &input).await
    }
}

async fn signup(state: &AppState, input: &Input) -> ApiResult<Response> {
    let specs = [
        ("username", Kind::Username),
        (
            "password",
            Kind::Char {
                max: 128,
                min: 3,
                allow_blank: false,
            },
        ),
        ("email", Kind::Email),
        ("first_name", char_(150)),
        ("last_name", char_(150)),
        ("is_superuser", Kind::Bool),
    ];
    let required = ["username", "password", "email", "first_name", "last_name"];
    // Username uniqueness is `validate_username` (abandoned sign-ups may be
    // taken over), so the generic unique check is skipped here.
    let mut errors = Errors::default();
    let mut values: IndexMap<&str, Parsed> = IndexMap::new();
    for (name, kind) in specs {
        let Some(raw) = input.get(name) else {
            if required.contains(&name) {
                errors.add(name, vec!["This field is required.".into()]);
            }
            continue;
        };
        let v = match raw {
            InputValue::Value(v) => v.clone(),
            InputValue::File(_) => Value::String(String::new()),
        };
        match fields::parse(kind, &v) {
            Ok(p) => {
                if name == "username" {
                    let u = p.as_str().unwrap_or_default();
                    if let Some(existing) = lp_db::users::by_username(&state.db, u).await?
                        && !is_abandoned_signup(state, &existing).await?
                    {
                        errors.add(
                            name,
                            vec!["A user with that username already exists.".into()],
                        );
                        continue;
                    }
                }
                values.insert(name, p);
            }
            Err(m) => errors.add(name, m),
        }
    }
    errors.into_result()?;
    let s = |k: &str| {
        values
            .get(k)
            .and_then(Parsed::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let hash = hash_password(state, s("password")).await?;
    let crypto = DjangoCrypto::new(&state.config.secret_key);
    let id = w::signup(
        &state.db,
        &crypto,
        &w::Signup {
            username: &s("username"),
            email: &s("email"),
            first_name: &s("first_name"),
            last_name: &s("last_name"),
            password_hash: &hash,
        },
    )
    .await?;
    let user = lp_db::users::by_id(&state.db, id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    scan_dir::auto_create(state, &user, false).await;
    Ok((StatusCode::CREATED, Json(serialize::signup(&user))).into_response())
}

/// `BaseUserManager.normalize_email`: lower-case the domain part.
fn normalize_email(email: &str) -> String {
    match email.trim().rsplit_once('@') {
        Some((name, domain)) => format!("{name}@{}", domain.to_lowercase()),
        None => email.to_string(),
    }
}

async fn admin_create(state: &AppState, input: &Input, headers: &HeaderMap) -> ApiResult<Response> {
    let specs = user_fields();
    let v = validate(state, input, &specs, &["username", "password"], None).await?;
    let mut scan_directory = String::new();
    if let Some(dir) = v.str("scan_directory")
        && dir != "initial"
        && let Some(abs) = scan_dir::normalize(state, dir, None).await?
    {
        scan_directory = abs;
    }
    let username = v.str("username").unwrap_or_default().to_lowercase();
    let email = normalize_email(v.str("email").unwrap_or_default());
    let superuser = matches!(v.values.get("is_superuser"), Some(Parsed::Bool(true)));
    let hash = hash_password(state, v.str("password").unwrap_or_default().to_string()).await?;
    let crypto = DjangoCrypto::new(&state.config.secret_key);
    let mut extra: Vec<(&str, ColVal)> = Vec::new();
    for (name, p) in &v.values {
        if matches!(
            *name,
            "username"
                | "email"
                | "password"
                | "first_name"
                | "last_name"
                | "scan_directory"
                | "is_superuser"
                | "date_joined"
        ) {
            continue;
        }
        let value = if *name == "nextcloud_app_password" {
            Some(ColVal::Bytes(
                crypto.encrypt_str(p.as_str().unwrap_or_default()),
            ))
        } else {
            col(name, p)
        };
        if let Some(value) = value {
            extra.push((name, value));
        }
    }
    let avatar_path = match &v.avatar {
        Some(AvatarInput::Upload(f)) => Some(avatar::store(state, f).await?),
        _ => None,
    };
    if let Some(path) = &avatar_path {
        extra.push(("avatar", ColVal::OptStr(Some(path.clone()))));
    }
    let id = w::admin_create(
        &state.db,
        &crypto,
        &NewUser {
            username: &username,
            email: &email,
            password_hash: &hash,
            first_name: v.str("first_name").unwrap_or_default(),
            last_name: v.str("last_name").unwrap_or_default(),
            is_superuser: superuser,
            is_staff: superuser,
            scan_directory: &scan_directory,
        },
        &extra,
    )
    .await?;
    let user = lp_db::users::by_id(&state.db, id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    scan_dir::auto_create(state, &user, true).await;
    let user = lp_db::users::by_id(&state.db, id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let stats = stats_for(state, id).await?;
    Ok((
        StatusCode::CREATED,
        Json(serialize::full(
            &user,
            &stats,
            &serialize::request_origin(headers),
        )),
    )
        .into_response())
}

// ---------------------------------------------------------------- update

/// `PATCH /api/user/{id}/` (`IsAdminOrSelf`; JSON profile or multipart avatar).
pub async fn update(
    State(state): State<AppState>,
    OptionalUser(viewer): OptionalUser,
    Path(raw_id): Path<String>,
    headers: HeaderMap,
    req: Request,
) -> ApiResult<Response> {
    let id = parse_id(&raw_id)?;
    let scope = if viewer.is_some() {
        UserScope::Active
    } else {
        UserScope::PublicSharing
    };
    let target = lp_db::users_settings::visible_user(&state.db, id, scope)
        .await?
        .ok_or_else(no_user)?;
    match &viewer {
        None => return Err(ApiError::not_authenticated()),
        Some(v) if !v.is_staff && v.id != target.id => return Err(ApiError::permission_denied()),
        _ => {}
    }
    let input = input::read(req).await?;
    let v = validate(&state, &input, &user_fields(), &[], Some(&target)).await?;

    let crypto = DjangoCrypto::new(&state.config.secret_key);
    let mut cols: Vec<(&str, ColVal)> = Vec::new();
    let mut applied_any = false;
    let mut queue_clip = false;
    for field in USER_UPDATE_FIELDS {
        if *field == "avatar" {
            match &v.avatar {
                Some(AvatarInput::Clear) => cols.push(("avatar", ColVal::OptStr(None))),
                Some(AvatarInput::Upload(f)) => {
                    let path = avatar::store(&state, f).await?;
                    cols.push(("avatar", ColVal::OptStr(Some(path))));
                }
                None => continue,
            }
            applied_any = true;
            continue;
        }
        let Some(p) = v.values.get(field) else {
            continue;
        };
        applied_any = true;
        if *field == "semantic_search_topk"
            && let Parsed::Int(n) = p
        {
            queue_clip = target.semantic_search_topk == 0 && *n > 0;
        }
        let value = if *field == "nextcloud_app_password" {
            Some(ColVal::Bytes(
                crypto.encrypt_str(p.as_str().unwrap_or_default()),
            ))
        } else {
            col(field, p)
        };
        if let Some(value) = value {
            cols.push((field, value));
        }
    }
    if applied_any {
        if let Some(pw) = v.str("password")
            && !pw.is_empty()
            && !state.config.demo_site
        {
            let hash = hash_password(&state, pw.to_string()).await?;
            cols.push(("password", ColVal::Str(hash)));
        }
        // Django saves an instance loaded with `.only(...)`, which writes only
        // the loaded and assigned fields: `last_modified` is never bumped here.
        w::apply_user_update(&state.db, target.id, &cols, false).await?;
    }
    if queue_clip {
        lp_jobs::enqueue(
            &state,
            "clip.embed",
            json!({ "user_id": target.id }),
            lp_jobs::EnqueueOptions::tracked(JobType::CalculateClipEmbeddings, target.id),
        )
        .await?;
    }
    let (user, stats) = tokio::try_join!(
        async {
            lp_db::users::by_id(&state.db, target.id)
                .await?
                .ok_or_else(ApiError::not_found)
        },
        stats_for(&state, target.id)
    )?;
    Ok(Json(serialize::full(
        &user,
        &stats,
        &serialize::request_origin(&headers),
    ))
    .into_response())
}

/// `PATCH /api/manage/user/{id}/` (admin).
pub async fn manage_update(
    State(state): State<AppState>,
    AdminUser(_admin): AdminUser,
    Path(raw_id): Path<String>,
    req: Request,
) -> ApiResult<Response> {
    let id = parse_id(&raw_id)?;
    let target = lp_db::users::by_id(&state.db, id)
        .await?
        .ok_or_else(no_user)?;
    let input = input::read(req).await?;
    let v = validate(&state, &input, &manage_fields(), &[], Some(&target)).await?;

    let mut cols: Vec<(&str, ColVal)> = Vec::new();
    let mut new_password = None;
    if let Some(pw) = v.str("password")
        && !pw.is_empty()
        && !state.config.demo_site
    {
        new_password = Some(pw.to_string());
    }
    if let Some(dir) = v.str("scan_directory")
        && let Some(abs) = scan_dir::normalize(&state, dir, Some(&target)).await?
    {
        tracing::info!("Updated scan directory for user {abs}");
        cols.push(("scan_directory", ColVal::Str(abs)));
    }
    for field in ["skip_raw_files", "stack_raw_jpeg"] {
        if let Some(Parsed::Bool(b)) = v.values.get(field) {
            cols.push((field, ColVal::Bool(*b)));
        }
    }
    if let Some(username) = v.str("username") {
        cols.push(("username", ColVal::Str(username.to_string())));
    }
    for field in ["email", "first_name", "last_name"] {
        if let Some(s) = v.str(field) {
            cols.push((field, ColVal::Str(s.to_string())));
        }
    }
    if let Some(pw) = new_password {
        cols.push(("password", ColVal::Str(hash_password(&state, pw).await?)));
    }
    w::apply_user_update(&state.db, target.id, &cols, true).await?;
    let (user, photo_count) = tokio::try_join!(
        async {
            lp_db::users::by_id(&state.db, target.id)
                .await?
                .ok_or_else(ApiError::not_found)
        },
        async {
            lp_db::users_settings::photo_count(&state.db, target.id)
                .await
                .map_err(ApiError::from)
        }
    )?;
    Ok(Json(serialize::manage(&user, photo_count)).into_response())
}

/// `DELETE /api/delete/user/{id}/` (superuser; never another superuser).
pub async fn destroy(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    Path(raw_id): Path<String>,
) -> ApiResult<Response> {
    if !admin.is_superuser {
        return Err(ApiError::status_only(StatusCode::UNAUTHORIZED));
    }
    let id = parse_id(&raw_id)?;
    let target = lp_db::users::by_id(&state.db, id)
        .await?
        .ok_or_else(no_user)?;
    if target.is_superuser {
        return Err(ApiError::status_only(StatusCode::BAD_REQUEST));
    }
    let crypto = DjangoCrypto::new(&state.config.secret_key);
    w::delete_user(&state.db, &crypto, target.id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

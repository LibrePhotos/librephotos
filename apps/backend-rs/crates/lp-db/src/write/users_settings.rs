//! Write services for the `users_settings` area. Conventions: see `lp_db::write`.

use chrono::{DateTime, Utc};
use lp_core::django_crypto::DjangoCrypto;
use serde_json::Value;

use crate::db::{Conn, Db, Qb};
use crate::write::users::{NewUser, create_user};

/// A typed value for one `api_user` column in [`update_user`].
#[derive(Debug, Clone, PartialEq)]
pub enum ColVal {
    Str(String),
    OptStr(Option<String>),
    Bool(bool),
    Int(i32),
    Float(f64),
    Json(Value),
    Bytes(Vec<u8>),
}

/// Columns [`update_user`] may set (the writable `UserSerializer` /
/// `ManageUserSerializer` fields plus `password` and `avatar`).
const UPDATABLE: &[&str] = &[
    "password",
    "username",
    "avatar",
    "email",
    "first_name",
    "last_name",
    "scan_directory",
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
    "public_sharing_defaults",
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
    "is_active",
    "is_staff",
    "is_superuser",
];

/// `UPDATE api_user SET <cols> [, last_modified = now()] WHERE id = $id`.
/// `bump` mirrors Django's full `save()` (S14); `save(update_fields=..)`
/// callers pass false. Panics on a column outside the whitelist (a bug).
pub async fn update_user(
    conn: &mut Conn,
    user_id: i32,
    cols: &[(&str, ColVal)],
    bump: bool,
) -> sqlx::Result<()> {
    if cols.is_empty() && !bump {
        return Ok(());
    }
    let mut qb: Qb<'_> = Qb::new("UPDATE api_user SET ");
    let mut first = true;
    for (col, val) in cols {
        assert!(UPDATABLE.contains(col), "api_user.{col} is not updatable");
        if !first {
            qb.push(", ");
        }
        first = false;
        qb.push(*col).push(" = ");
        match val {
            ColVal::Str(s) => qb.push_bind(s.clone()),
            ColVal::OptStr(s) => qb.push_bind(s.clone()),
            ColVal::Bool(b) => qb.push_bind(*b),
            ColVal::Int(i) => qb.push_bind(*i),
            ColVal::Float(f) => qb.push_bind(*f),
            ColVal::Json(v) => qb.push_bind(v.clone()),
            ColVal::Bytes(b) => qb.push_bind(b.clone()),
        };
    }
    if bump {
        if !first {
            qb.push(", ");
        }
        qb.push("last_modified = now()");
    }
    qb.push(" WHERE id = ").push_bind(user_id);
    qb.build().execute(&mut *conn).await?;
    Ok(())
}

/// What `SignupUserSerializer.create` stores.
pub struct Signup<'a> {
    pub username: &'a str,
    pub email: &'a str,
    pub first_name: &'a str,
    pub last_name: &'a str,
    pub password_hash: &'a str,
}

/// Sign-up: one INSERT (or the takeover of an abandoned sign-up row with the
/// same username), admin when no superuser exists yet. Returns the user id.
pub async fn signup(pool: &Db, crypto: &DjangoCrypto, s: &Signup<'_>) -> sqlx::Result<i32> {
    let mut tx = pool.begin().await?;
    let should_be_superuser: bool =
        crate::sql::query_scalar("SELECT NOT EXISTS (SELECT 1 FROM api_user WHERE is_superuser)")
            .fetch_one(&mut *tx)
            .await?;
    let existing: Option<i32> =
        crate::sql::query_scalar("SELECT id FROM api_user WHERE username = $1")
            .bind(s.username)
            .fetch_optional(&mut *tx)
            .await?;
    let id = match existing {
        Some(id) => {
            update_user(
                &mut tx,
                id,
                &[
                    ("email", ColVal::Str(s.email.into())),
                    ("first_name", ColVal::Str(s.first_name.into())),
                    ("last_name", ColVal::Str(s.last_name.into())),
                    ("password", ColVal::Str(s.password_hash.into())),
                    ("is_staff", ColVal::Bool(should_be_superuser)),
                    ("is_superuser", ColVal::Bool(should_be_superuser)),
                ],
                true,
            )
            .await?;
            id
        }
        None => {
            create_user(
                &mut *tx,
                crypto,
                &NewUser {
                    username: s.username,
                    email: s.email,
                    password_hash: s.password_hash,
                    first_name: s.first_name,
                    last_name: s.last_name,
                    is_superuser: should_be_superuser,
                    is_staff: should_be_superuser,
                    scan_directory: "",
                },
            )
            .await?
        }
    };
    tx.commit().await?;
    Ok(id)
}

/// `UserSerializer.create` (admin): `create_user` / `create_superuser` with
/// the validated fields; `extra` are further model columns the admin sent.
pub async fn admin_create(
    pool: &Db,
    crypto: &DjangoCrypto,
    new: &NewUser<'_>,
    extra: &[(&str, ColVal)],
) -> sqlx::Result<i32> {
    let mut tx = pool.begin().await?;
    let id = create_user(&mut *tx, crypto, new).await?;
    if !extra.is_empty() {
        update_user(&mut tx, id, extra, false).await?;
    }
    tx.commit().await?;
    Ok(id)
}

/// `auto_create_user_directory`: `user.save(update_fields=["scan_directory"])`.
pub async fn set_scan_directory(pool: &Db, user_id: i32, dir: &str) -> sqlx::Result<()> {
    crate::sql::query("UPDATE api_user SET scan_directory = $2 WHERE id = $1")
        .bind(user_id)
        .bind(dir)
        .execute(pool)
        .await?;
    Ok(())
}

/// Apply a profile/manage update as one statement (see [`update_user`]).
pub async fn apply_user_update(
    pool: &Db,
    user_id: i32,
    cols: &[(&str, ColVal)],
    bump: bool,
) -> sqlx::Result<()> {
    let mut conn = pool.acquire().await?;
    update_user(&mut conn, user_id, cols, bump).await
}

/// `ForeignKey(User, on_delete=SET(get_deleted_user))` columns (S15).
const REASSIGN_TO_DELETED: &[(&str, &str)] = &[
    ("api_photo", "owner_id"),
    ("api_cluster", "owner_id"),
    ("api_albumdate", "owner_id"),
    ("api_albumthing", "owner_id"),
    ("api_albumauto", "owner_id"),
    ("api_albumplace", "owner_id"),
    ("api_albumuser", "owner_id"),
    ("api_longrunningjob", "started_by_id"),
    ("api_photostack", "owner_id"),
    ("api_metadataedit", "user_id"),
    ("api_stackreview", "reviewer_id"),
    ("api_duplicate", "owner_id"),
    ("api_tag", "owner_id"),
];

/// Rows removed with the user (M2M through tables and `CASCADE` FKs).
const DELETE_WITH_USER: &[(&str, &str)] = &[
    ("api_user_groups", "user_id"),
    ("api_user_user_permissions", "user_id"),
    ("api_photo_shared_to", "user_id"),
    ("api_albumdate_shared_to", "user_id"),
    ("api_albumthing_shared_to", "user_id"),
    ("api_albumauto_shared_to", "user_id"),
    ("api_albumplace_shared_to", "user_id"),
    ("api_albumuser_shared_to", "user_id"),
    ("api_deletionlog", "owner_id"),
    ("chunked_upload_chunkedupload", "user_id"),
];

async fn table_exists(conn: &mut Conn, table: &str) -> sqlx::Result<bool> {
    let found: Option<String> = crate::sql::query_scalar("SELECT to_regclass($1)::text")
        .bind(format!("public.{table}"))
        .fetch_one(&mut *conn)
        .await?;
    Ok(found.is_some())
}

/// `get_deleted_user()`: the inactive `deleted` sentinel, created if missing.
pub async fn deleted_user_id(conn: &mut Conn, crypto: &DjangoCrypto) -> sqlx::Result<i32> {
    let found: Option<(i32, bool)> =
        crate::sql::query_as("SELECT id, is_active FROM api_user WHERE username = 'deleted'")
            .fetch_optional(&mut *conn)
            .await?;
    let (id, active) = match found {
        Some(row) => row,
        None => {
            let id = create_user(
                &mut *conn,
                crypto,
                &NewUser {
                    username: "deleted",
                    email: "",
                    password_hash: "",
                    first_name: "",
                    last_name: "",
                    is_superuser: false,
                    is_staff: false,
                    scan_directory: "",
                },
            )
            .await?;
            (id, true)
        }
    };
    if active {
        update_user(conn, id, &[("is_active", ColVal::Bool(false))], true).await?;
    }
    Ok(id)
}

/// Delete a user the way Django's collector does (S15): reassign the 13
/// `SET(get_deleted_user)` FKs to the `deleted` user, null `Person.cluster_owner`,
/// drop M2M/CASCADE rows (allauth, admin log, simplejwt outstanding tokens are
/// handled when those tables exist), then the user row. One transaction.
pub async fn delete_user(pool: &Db, crypto: &DjangoCrypto, user_id: i32) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    let deleted = deleted_user_id(&mut tx, crypto).await?;
    for (table, col) in REASSIGN_TO_DELETED {
        crate::sql::query(format!("UPDATE {table} SET {col} = $1 WHERE {col} = $2"))
            .bind(deleted)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    crate::sql::query("UPDATE api_person SET cluster_owner_id = NULL WHERE cluster_owner_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    for (table, col) in DELETE_WITH_USER {
        crate::sql::query(format!("DELETE FROM {table} WHERE {col} = $1"))
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    if table_exists(&mut tx, "account_emailaddress").await? {
        if table_exists(&mut tx, "account_emailconfirmation").await? {
            crate::sql::query(
                "DELETE FROM account_emailconfirmation WHERE email_address_id IN \
                 (SELECT id FROM account_emailaddress WHERE user_id = $1)",
            )
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }
        crate::sql::query("DELETE FROM account_emailaddress WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    if table_exists(&mut tx, "socialaccount_socialaccount").await? {
        if table_exists(&mut tx, "socialaccount_socialtoken").await? {
            crate::sql::query(
                "DELETE FROM socialaccount_socialtoken WHERE account_id IN \
                 (SELECT id FROM socialaccount_socialaccount WHERE user_id = $1)",
            )
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }
        crate::sql::query("DELETE FROM socialaccount_socialaccount WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    if table_exists(&mut tx, "django_admin_log").await? {
        crate::sql::query("DELETE FROM django_admin_log WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    if table_exists(&mut tx, "token_blacklist_outstandingtoken").await? {
        crate::sql::query(
            "UPDATE token_blacklist_outstandingtoken SET user_id = NULL WHERE user_id = $1",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }
    crate::sql::query("DELETE FROM api_user WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// The `api_emailconfig` singleton as `EmailConfig.save()` writes it (pk=1).
pub struct EmailConfigWrite<'a> {
    pub provider: &'a str,
    pub from_email: &'a str,
    pub host: &'a str,
    pub port: i32,
    pub use_tls: bool,
    pub use_ssl: bool,
    pub username: &'a str,
    /// Already encrypted with `DjangoCrypto`.
    pub secret: &'a [u8],
}

/// S21: upsert the singleton row `pk=1`.
pub async fn save_email_config(pool: &Db, c: &EmailConfigWrite<'_>) -> sqlx::Result<()> {
    crate::sql::query(
        "INSERT INTO api_emailconfig (id, provider, from_email, host, port, use_tls, use_ssl, \
           username, secret) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, \
           from_email = EXCLUDED.from_email, host = EXCLUDED.host, port = EXCLUDED.port, \
           use_tls = EXCLUDED.use_tls, use_ssl = EXCLUDED.use_ssl, \
           username = EXCLUDED.username, secret = EXCLUDED.secret",
    )
    .bind(c.provider)
    .bind(c.from_email)
    .bind(c.host)
    .bind(c.port)
    .bind(c.use_tls)
    .bind(c.use_ssl)
    .bind(c.username)
    .bind(c.secret)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record one rate-limited request and forget every hit of `scope` older than
/// `keep_after` (all idents, so spoofed idents cannot pile up rows).
pub async fn record_throttle_hit(
    pool: &Db,
    scope: &str,
    ident: &str,
    at: DateTime<Utc>,
    keep_after: DateTime<Utc>,
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    crate::sql::query("DELETE FROM rate_limit_hit WHERE scope = $1 AND hit_at <= $2")
        .bind(scope)
        .bind(keep_after)
        .execute(&mut *tx)
        .await?;
    crate::sql::query("INSERT INTO rate_limit_hit (scope, ident, hit_at) VALUES ($1, $2, $3)")
        .bind(scope)
        .bind(ident)
        .bind(at)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// An OIDC identity to record for a user (allauth `SocialAccount`).
#[derive(Debug, Clone)]
pub struct SsoIdentity<'a> {
    pub provider: &'a str,
    pub uid: &'a str,
    pub extra_data: &'a Value,
}

/// A first-time SSO login provisioning an account (`SSOSocialAccountAdapter.save_user`):
/// never staff or superuser, an unusable password, the IdP's email recorded
/// as allauth's `EmailAddress` when that table exists. Returns the new id.
pub async fn create_sso_user(
    db: &Db,
    crypto: &DjangoCrypto,
    new: &NewUser<'_>,
    email_verified: bool,
    identity: &SsoIdentity<'_>,
) -> sqlx::Result<i32> {
    let mut tx = db.begin().await?;
    let id = create_user(
        &mut *tx,
        crypto,
        &NewUser {
            is_superuser: false,
            is_staff: false,
            ..*new
        },
    )
    .await?;
    if !new.email.is_empty() && table_exists(&mut tx, "account_emailaddress").await? {
        crate::sql::query(
            "INSERT INTO account_emailaddress (email, verified, \"primary\", user_id) \
             VALUES ($1, $2, TRUE, $3) ON CONFLICT DO NOTHING",
        )
        .bind(new.email)
        .bind(email_verified)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    link_sso_identity(&mut tx, id, identity).await?;
    tx.commit().await?;
    Ok(id)
}

/// `sociallogin.connect` / a returning login: link (or refresh) the
/// identity when allauth's table exists, and bump `last_login`.
pub async fn record_sso_login(
    db: &Db,
    user_id: i32,
    identity: &SsoIdentity<'_>,
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    link_sso_identity(&mut tx, user_id, identity).await?;
    crate::sql::query("UPDATE api_user SET last_login = now() WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

async fn link_sso_identity(
    conn: &mut Conn,
    user_id: i32,
    identity: &SsoIdentity<'_>,
) -> sqlx::Result<()> {
    if !table_exists(conn, "socialaccount_socialaccount").await? {
        return Ok(());
    }
    crate::sql::query(
        "INSERT INTO socialaccount_socialaccount (provider, uid, last_login, date_joined, \
           extra_data, user_id) VALUES ($1, $2, now(), now(), $3, $4) \
         ON CONFLICT (provider, uid) DO UPDATE SET last_login = now(), \
           extra_data = EXCLUDED.extra_data",
    )
    .bind(identity.provider)
    .bind(identity.uid)
    .bind(identity.extra_data)
    .bind(user_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

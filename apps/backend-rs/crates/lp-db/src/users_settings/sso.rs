//! OIDC single sign-on reads: allauth's `SocialApp` (provider config) and
//! `SocialAccount` (identity links). Both tables exist only in databases
//! Django migrated; a Rust-only database has neither.

use serde_json::Value;
use sqlx::FromRow;

use crate::db::{Db, Exec};

/// Django's `SITE_ID`: allauth lists only the apps attached to it.
pub const SITE_ID: i32 = 1;

pub async fn table_exists<'e>(db: impl Exec<'e>, table: &str) -> sqlx::Result<bool> {
    let found: Option<String> = crate::sql::query_scalar("SELECT to_regclass($1)::text")
        .bind(format!("public.{table}"))
        .fetch_one(db)
        .await?;
    Ok(found.is_some())
}

/// An `openid_connect` SocialApp.
#[derive(Debug, Clone, FromRow)]
pub struct SocialApp {
    /// `provider_id`, or the client id when it is blank (the id in the URL).
    pub id: String,
    /// What allauth stores in `SocialAccount.provider` (`sub_id`): the
    /// `provider_id`, or `openid_connect` when it is blank.
    pub account_provider: String,
    pub name: String,
    pub client_id: String,
    pub secret: String,
    pub settings: Value,
}

/// The app behind `/api/accounts/oidc/<id>/...`, restricted to the apps on
/// [`SITE_ID`] like allauth's `SocialApp.objects.on_site(request)`.
pub async fn social_app(db: &Db, id: &str) -> sqlx::Result<Option<SocialApp>> {
    if !table_exists(db, "socialaccount_socialapp").await? {
        return Ok(None);
    }
    let sites = table_exists(db, "socialaccount_socialapp_sites").await?;
    let site_filter = if sites {
        " AND EXISTS (SELECT 1 FROM socialaccount_socialapp_sites s \
           WHERE s.socialapp_id = a.id AND s.site_id = $2)"
    } else {
        " AND $2 = $2"
    };
    crate::sql::query_as::<_, SocialApp>(&format!(
        "SELECT COALESCE(NULLIF(a.provider_id, ''), a.client_id) AS id, \
           COALESCE(NULLIF(a.provider_id, ''), a.provider) AS account_provider, a.name, \
           a.client_id, a.secret, a.settings FROM socialaccount_socialapp a \
         WHERE a.provider = 'openid_connect' \
           AND COALESCE(NULLIF(a.provider_id, ''), a.client_id) = $1{site_filter} \
         ORDER BY a.id LIMIT 1"
    ))
    .bind(id)
    .bind(SITE_ID)
    .fetch_optional(db)
    .await
}

/// The user a `(provider, uid)` identity is linked to, if any.
pub async fn linked_user(db: &Db, provider: &str, uid: &str) -> sqlx::Result<Option<i32>> {
    if !table_exists(db, "socialaccount_socialaccount").await? {
        return Ok(None);
    }
    crate::sql::query_scalar(
        "SELECT user_id FROM socialaccount_socialaccount WHERE provider = $1 AND uid = $2",
    )
    .bind(provider)
    .bind(uid)
    .fetch_optional(db)
    .await
}

/// Users whose email matches case-insensitively (`email__iexact`), at most 2
/// (only "exactly one" matters).
pub async fn users_with_email(db: &Db, email: &str) -> sqlx::Result<Vec<i32>> {
    crate::sql::query_scalar(
        "SELECT id FROM api_user WHERE UPPER(email) = UPPER($1) ORDER BY id LIMIT 2",
    )
    .bind(email)
    .fetch_all(db)
    .await
}

pub async fn username_taken(db: &Db, username: &str) -> sqlx::Result<bool> {
    crate::sql::query_scalar("SELECT EXISTS (SELECT 1 FROM api_user WHERE username = $1)")
        .bind(username)
        .fetch_one(db)
        .await
}

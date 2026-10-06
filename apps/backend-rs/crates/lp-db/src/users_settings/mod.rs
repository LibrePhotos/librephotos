//! Read queries and row types for the `users_settings` area (owned by that area).

use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::{Db, Exec, Qb};
use crate::users::{USER_COLUMNS, User};

pub mod sso;

/// The per-user photo numbers `UserSerializer` / `PublicUserSerializer`
/// compute with one query each (`photo_count`, `public_photo_count`,
/// `public_photo_samples`).
#[derive(Debug, Clone, Default)]
pub struct UserPhotoStats {
    pub photo_count: i64,
    pub public_photo_count: i64,
    /// `PhotoSuperSimpleSerializer` rows, at most 10.
    pub public_photo_samples: Vec<PublicPhotoSample>,
}

#[derive(Debug, Clone, FromRow)]
pub struct PublicPhotoSample {
    pub owner_id: i32,
    pub image_hash: String,
    pub rating: i32,
    pub hidden: bool,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub public: bool,
    pub video: bool,
}

/// A user row plus its photo numbers.
#[derive(Debug, Clone)]
pub struct UserWithStats {
    pub user: User,
    pub stats: UserPhotoStats,
}

#[derive(Debug, FromRow)]
struct CountRow {
    owner_id: i32,
    photo_count: i64,
    public_photo_count: i64,
}

/// Photo numbers for several users: two queries in total (counts, samples).
pub async fn photo_stats(
    db: &Db,
    user_ids: &[i32],
) -> sqlx::Result<std::collections::HashMap<i32, UserPhotoStats>> {
    let mut out: std::collections::HashMap<i32, UserPhotoStats> = user_ids
        .iter()
        .map(|id| (*id, UserPhotoStats::default()))
        .collect();
    if user_ids.is_empty() {
        return Ok(out);
    }
    let (counts, samples) = tokio::try_join!(
        crate::sql::query_as::<_, CountRow>(
            // Two scalar counts per owner can each use an index; one FILTER
            // aggregate forces a sequential scan of the owner's photos.
            "SELECT o.id AS owner_id, \
                    (SELECT count(*) FROM api_photo WHERE owner_id = o.id) AS photo_count, \
                    (SELECT count(*) FROM api_photo WHERE owner_id = o.id AND public) AS public_photo_count \
             FROM unnest($1::int[]) AS o(id)",
        )
        .bind(user_ids)
        .fetch_all(db),
        public_samples(db, user_ids),
    )?;
    for c in counts {
        if let Some(s) = out.get_mut(&c.owner_id) {
            s.photo_count = c.photo_count;
            s.public_photo_count = c.public_photo_count;
        }
    }
    for p in samples {
        if let Some(s) = out.get_mut(&p.owner_id) {
            s.public_photo_samples.push(p);
        }
    }
    Ok(out)
}

/// `Photo.objects.owned_by(u).filter(public=True)[:10]` for every user at once.
async fn public_samples<'e>(
    db: impl Exec<'e>,
    user_ids: &[i32],
) -> sqlx::Result<Vec<PublicPhotoSample>> {
    crate::sql::query_as::<_, PublicPhotoSample>(
        "SELECT owner_id, image_hash, rating, hidden, exif_timestamp, public, video FROM ( \
            SELECT p.owner_id, p.image_hash, p.rating, p.hidden, p.exif_timestamp, p.public, \
                   p.video, row_number() OVER (PARTITION BY p.owner_id) AS rn \
            FROM api_photo p WHERE p.owner_id = ANY($1) AND p.public) s \
         WHERE rn <= 10",
    )
    .bind(user_ids)
    .fetch_all(db)
    .await
}

/// Which users `GET /api/user/` may return (`UserViewSet.get_queryset`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserScope {
    /// Active users.
    Active,
    /// Anonymous callers: active users that opted into public sharing.
    PublicSharing,
    /// Every user, inactive ones included (`ManageUserViewSet`).
    All,
}

fn push_scope(qb: &mut Qb<'_>, scope: UserScope) {
    if scope == UserScope::All {
        qb.push(" WHERE TRUE");
        return;
    }
    qb.push(" WHERE u.is_active");
    if scope == UserScope::PublicSharing {
        qb.push(" AND u.public_sharing");
    }
}

/// One user as `UserViewSet.get_object` finds it (404 = None).
pub async fn visible_user(db: &Db, id: i32, scope: UserScope) -> sqlx::Result<Option<User>> {
    let mut qb = Qb::new(format!(
        "SELECT {} FROM api_user u",
        prefixed_user_columns()
    ));
    push_scope(&mut qb, scope);
    qb.push(" AND u.id = ").push_bind(id);
    qb.build_query_as::<User>().fetch_optional(db).await
}

/// `USER_COLUMNS` with the `u.` alias.
fn prefixed_user_columns() -> String {
    USER_COLUMNS
        .split(',')
        .map(|c| format!("u.{}", c.trim()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// A LimitOffset page of users ordered by id, plus the total count.
pub async fn list_users(
    db: &Db,
    scope: UserScope,
    limit: i64,
    offset: i64,
) -> sqlx::Result<(i64, Vec<User>)> {
    let mut count_q = Qb::new("SELECT count(*) FROM api_user u");
    push_scope(&mut count_q, scope);
    let mut page_q = Qb::new(format!(
        "SELECT {} FROM api_user u",
        prefixed_user_columns()
    ));
    push_scope(&mut page_q, scope);
    page_q
        .push(" ORDER BY u.id LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    let (count, rows) = tokio::try_join!(
        count_q.build_query_scalar::<i64>().fetch_one(db),
        page_q.build_query_as::<User>().fetch_all(db),
    )?;
    Ok((count, rows))
}

/// `not User.objects.filter(is_superuser=True).exists()`.
pub async fn is_first_time_setup<'e>(db: impl Exec<'e>) -> sqlx::Result<bool> {
    let any: bool =
        crate::sql::query_scalar("SELECT EXISTS (SELECT 1 FROM api_user WHERE is_superuser)")
            .fetch_one(db)
            .await?;
    Ok(!any)
}

/// `Photo.objects.owned_by(user).count()`.
pub async fn photo_count<'e>(db: impl Exec<'e>, user_id: i32) -> sqlx::Result<i64> {
    crate::sql::query_scalar("SELECT count(*) FROM api_photo WHERE owner_id = $1")
        .bind(user_id)
        .fetch_one(db)
        .await
}

/// Id of another user with exactly this username (DRF `UniqueValidator`).
pub async fn username_taken_by_other<'e>(
    db: impl Exec<'e>,
    username: &str,
    exclude_id: Option<i32>,
) -> sqlx::Result<bool> {
    crate::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_user WHERE username = $1 \
         AND ($2::int IS NULL OR id <> $2))",
    )
    .bind(username)
    .bind(exclude_id)
    .fetch_one(db)
    .await
}

#[derive(Debug, Clone, FromRow)]
pub struct ScanDirectoryOwner {
    pub id: i32,
    pub username: String,
    pub scan_directory: String,
}

/// Every other user with a scan directory (`reject_overlap_with_another_user`).
pub async fn other_scan_directories<'e>(
    db: impl Exec<'e>,
    exclude_id: Option<i32>,
) -> sqlx::Result<Vec<ScanDirectoryOwner>> {
    crate::sql::query_as::<_, ScanDirectoryOwner>(
        "SELECT id, username, scan_directory FROM api_user \
         WHERE scan_directory <> '' AND ($1::int IS NULL OR id <> $1) ORDER BY id",
    )
    .bind(exclude_id)
    .fetch_all(db)
    .await
}

/// `User.objects.filter(email__iexact=email).first()` (ordered by pk).
pub async fn user_by_email_iexact<'e>(
    db: impl Exec<'e>,
    email: &str,
) -> sqlx::Result<Option<User>> {
    crate::sql::query_as::<_, User>(&format!(
        "SELECT {USER_COLUMNS} FROM api_user WHERE upper(email) = upper($1) ORDER BY id LIMIT 1"
    ))
    .bind(email)
    .fetch_optional(db)
    .await
}

/// The `api_emailconfig` singleton (pk=1), if it was ever saved.
#[derive(Debug, Clone, FromRow)]
pub struct EmailConfigRow {
    pub provider: String,
    pub from_email: String,
    pub host: String,
    pub port: i32,
    pub use_tls: bool,
    pub use_ssl: bool,
    pub username: String,
    /// django-cryptography token; decrypt with `lp_core::django_crypto`.
    pub secret: Vec<u8>,
}

pub async fn email_config<'e>(db: impl Exec<'e>) -> sqlx::Result<Option<EmailConfigRow>> {
    crate::sql::query_as::<_, EmailConfigRow>(
        "SELECT provider, from_email, host, port, use_tls, use_ssl, username, secret \
         FROM api_emailconfig WHERE id = 1",
    )
    .fetch_optional(db)
    .await
}

/// OIDC providers configured through allauth (`SocialApp`, provider
/// `openid_connect`): `(provider_id or client_id, name)`. Empty when the
/// allauth tables do not exist (a Rust-only database).
pub async fn oidc_providers(db: &Db) -> sqlx::Result<Vec<(String, String)>> {
    if !crate::migrate::table_exists(db, "socialaccount_socialapp").await? {
        return Ok(Vec::new());
    }
    crate::sql::query_as::<_, (String, String)>(
        "SELECT COALESCE(NULLIF(provider_id, ''), client_id), name \
         FROM socialaccount_socialapp WHERE provider = 'openid_connect' ORDER BY id",
    )
    .fetch_all(db)
    .await
}

/// Hits recorded in the sliding window of a rate limit (`rate_limit_hit`).
pub async fn throttle_hits_since<'e>(
    db: impl Exec<'e>,
    scope: &str,
    ident: &str,
    since: DateTime<Utc>,
) -> sqlx::Result<Vec<DateTime<Utc>>> {
    crate::sql::query_scalar(
        "SELECT hit_at FROM rate_limit_hit WHERE scope = $1 AND ident = $2 AND hit_at > $3 \
         ORDER BY hit_at DESC",
    )
    .bind(scope)
    .bind(ident)
    .bind(since)
    .fetch_all(db)
    .await
}

/// The encrypted `nextcloud_app_password` (not part of [`User`]).
pub async fn nextcloud_app_password<'e>(
    db: impl Exec<'e>,
    user_id: i32,
) -> sqlx::Result<Option<Vec<u8>>> {
    crate::sql::query_scalar("SELECT nextcloud_app_password FROM api_user WHERE id = $1")
        .bind(user_id)
        .fetch_optional(db)
        .await
}

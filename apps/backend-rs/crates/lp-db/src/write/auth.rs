//! Refresh-token bookkeeping for the token endpoints.

use chrono::{DateTime, Utc};
use sqlx::PgExecutor;

pub async fn record_refresh<'e>(
    db: impl PgExecutor<'e>,
    jti: &str,
    user_id: i32,
    expires_at: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO refresh_token (jti, user_id, expires_at) VALUES ($1, $2, $3) \
         ON CONFLICT (jti) DO NOTHING",
    )
    .bind(jti)
    .bind(user_id)
    .bind(expires_at)
    .execute(db)
    .await?;
    Ok(())
}

/// Blacklist a refresh token, also one Rust never issued (Django-made).
pub async fn revoke_refresh<'e>(
    db: impl PgExecutor<'e>,
    jti: &str,
    user_id: i32,
    expires_at: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO refresh_token (jti, user_id, expires_at, revoked_at) \
         SELECT $1, $2, $3, now() WHERE EXISTS (SELECT 1 FROM api_user WHERE id = $2) \
         ON CONFLICT (jti) DO UPDATE SET revoked_at = COALESCE(refresh_token.revoked_at, now())",
    )
    .bind(jti)
    .bind(user_id)
    .bind(expires_at)
    .execute(db)
    .await?;
    Ok(())
}

/// Daily prune (04 §1 schedule).
pub async fn prune_expired_refresh<'e>(db: impl PgExecutor<'e>) -> sqlx::Result<u64> {
    Ok(
        sqlx::query("DELETE FROM refresh_token WHERE expires_at < now()")
            .execute(db)
            .await?
            .rows_affected(),
    )
}

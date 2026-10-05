use std::time::Duration;

use lp_core::Config;
use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

/// `application_name` of every librephotos-rs connection. The
/// `lp_clip_embeddings_model_reset` trigger (migration
/// `202610041200_search_clip_embeddings_model`) trusts writers with this
/// name to set `api_photo.clip_embeddings_model` themselves; any other
/// writer (Django) that changes an embedding resets it to NULL (ViT-B/32).
pub const APPLICATION_NAME: &str = "librephotos-rs";

pub fn connect_options(config: &Config, db_name: &str) -> PgConnectOptions {
    PgConnectOptions::new()
        .host(&config.db.host)
        .port(config.db.port)
        .username(&config.db.user)
        .password(&config.db.pass)
        .database(db_name)
        .application_name(APPLICATION_NAME)
}

/// Pool of `LP_DB_POOL` connections to `DB_NAME`.
pub async fn connect(config: &Config) -> anyhow::Result<PgPool> {
    connect_to(config, &config.db.name, config.db_pool).await
}

pub async fn connect_to(config: &Config, db_name: &str, size: u32) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(size)
        .acquire_timeout(Duration::from_secs(30))
        .connect_with(connect_options(config, db_name))
        .await?;
    Ok(pool)
}

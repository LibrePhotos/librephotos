use std::time::Duration;

use lp_core::Config;
use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

pub fn connect_options(config: &Config, db_name: &str) -> PgConnectOptions {
    PgConnectOptions::new()
        .host(&config.db.host)
        .port(config.db.port)
        .username(&config.db.user)
        .password(&config.db.pass)
        .database(db_name)
        .application_name("librephotos-rs")
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

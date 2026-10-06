use std::time::Duration;

use lp_core::Config;
use lp_core::db::Db;
use lp_core::db::config::{Backend, DbSettings};
use lp_core::db::lite::{LiteOptions, open};
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

/// The database selected by `DB_BACKEND`: a pool of `LP_DB_POOL`
/// connections to Postgres `DB_NAME` (the default), or the SQLite file at
/// `LP_SQLITE_PATH` (design `sqlite_design.md` §2).
pub async fn connect(config: &Config) -> anyhow::Result<Db> {
    connect_with(config, &DbSettings::from_env()?).await
}

/// [`connect`] with explicit backend settings.
pub async fn connect_with(config: &Config, s: &DbSettings) -> anyhow::Result<Db> {
    connect_opts(config, s, false).await
}

/// [`connect`] for `migrate`: a missing SQLite file (and its directory) is
/// created. Every other command refuses a missing file, so a wrong
/// `LP_SQLITE_PATH` never silently starts on an empty database.
pub async fn connect_creating(config: &Config) -> anyhow::Result<Db> {
    connect_opts(config, &DbSettings::from_env()?, true).await
}

async fn connect_opts(config: &Config, s: &DbSettings, create: bool) -> anyhow::Result<Db> {
    Ok(match s.backend {
        Backend::Postgres => Db::Pg(connect_pg(config).await?),
        Backend::Sqlite => {
            let mut o = LiteOptions::from_settings(s);
            if create {
                if let Some(dir) = o.path.parent().filter(|d| !d.as_os_str().is_empty()) {
                    std::fs::create_dir_all(dir)?;
                }
            } else if !o.path.exists() {
                anyhow::bail!(
                    "SQLite database {} does not exist (DB_BACKEND=sqlite; set LP_SQLITE_PATH, \
                     or create it with `librephotos-rs migrate`)",
                    o.path.display()
                );
            }
            o.create = create;
            Db::Lite(
                open(&o)
                    .await
                    .map_err(|e| anyhow::anyhow!("opening {}: {e}", o.path.display()))?,
            )
        }
    })
}

/// Postgres pool of `LP_DB_POOL` connections to `DB_NAME`.
pub async fn connect_pg(config: &Config) -> anyhow::Result<PgPool> {
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

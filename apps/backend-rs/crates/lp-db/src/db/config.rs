//! Database backend selection, read straight from the environment (Django's
//! variable names where they exist):
//!
//! | Variable | Default | Meaning |
//! |---|---|---|
//! | `DB_BACKEND` | `postgresql` | `postgresql` (also `postgres`, `pg`) or `sqlite` (`sqlite3`) |
//! | `LP_SQLITE_PATH` | `$BASE_DATA/db/librephotos.sqlite3` | the file Django's SQLite mode uses |
//! | `LP_SQLITE_BUSY_MS` | `10000` | `busy_timeout` of every SQLite connection |
//! | `LP_DB_POOL` | `2 * cores` | Postgres pool size / number of SQLite readers |
//!
//! The Postgres connection itself keeps using `lp_core::Config` (`DB_*`).

use std::path::PathBuf;

/// `DB_BACKEND`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Postgres,
    Sqlite,
}

impl Backend {
    pub fn parse(s: &str) -> anyhow::Result<Backend> {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "postgresql" | "postgres" | "pg" => Ok(Backend::Postgres),
            "sqlite" | "sqlite3" => Ok(Backend::Sqlite),
            other => anyhow::bail!("DB_BACKEND: unknown backend {other:?} (postgresql | sqlite)"),
        }
    }
}

/// Backend settings from the environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbSettings {
    pub backend: Backend,
    pub sqlite_path: PathBuf,
    pub busy_ms: u64,
    /// SQLite reader connections (`LP_DB_POOL`).
    pub readers: u32,
}

impl DbSettings {
    pub fn from_env() -> anyhow::Result<DbSettings> {
        DbSettings::from_lookup(|k| std::env::var(k).ok())
    }

    /// Same as [`from_env`](Self::from_env) with an explicit variable lookup (tests).
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> anyhow::Result<DbSettings> {
        let backend = Backend::parse(&get("DB_BACKEND").unwrap_or_default())?;
        let base_data = PathBuf::from(get("BASE_DATA").unwrap_or_else(|| "/".into()));
        let sqlite_path = get("LP_SQLITE_PATH")
            .filter(|s| !s.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| base_data.join("db").join("librephotos.sqlite3"));
        let busy_ms = parse(&get, "LP_SQLITE_BUSY_MS", 10_000u64)?;
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4) as u32;
        let readers = parse(&get, "LP_DB_POOL", 2 * cores)?.max(1);
        Ok(DbSettings {
            backend,
            sqlite_path,
            busy_ms,
            readers,
        })
    }
}

fn parse<T: std::str::FromStr>(
    get: &impl Fn(&str) -> Option<String>,
    key: &str,
    default: T,
) -> anyhow::Result<T> {
    match get(key).filter(|s| !s.trim().is_empty()) {
        None => Ok(default),
        Some(v) => v
            .trim()
            .parse()
            .map_err(|_| anyhow::anyhow!("{key}: not a number: {v:?}")),
    }
}

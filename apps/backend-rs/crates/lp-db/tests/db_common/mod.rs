//! Shared helpers of the dual-dialect DB tests (`db_layer.rs`,
//! `sqlite_spike.rs`): throwaway Postgres databases and SQLite tempfiles.

#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use lp_db::db::{Db, lite::LiteOptions};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Connection, PgConnection, PgPool};

const PREFIX: &str = "lp_dbcore_t_";

fn pg_options(db: &str) -> PgConnectOptions {
    let get = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_owned());
    PgConnectOptions::new()
        .host(&get("LP_TEST_PG_HOST", "localhost"))
        .port(
            get("LP_TEST_PG_PORT", "5433")
                .parse()
                .expect("LP_TEST_PG_PORT"),
        )
        .username(&get("LP_TEST_PG_USER", "postgres"))
        .password(&get("LP_TEST_PG_PASS", "x"))
        .database(db)
}

/// A private Postgres database created from `template0`; call
/// [`PgTestDb::cleanup`] at the end of the test.
pub struct PgTestDb {
    pub name: String,
    pub pool: PgPool,
}

static SEQ: AtomicU32 = AtomicU32::new(0);
static SWEPT: std::sync::Once = std::sync::Once::new();

impl PgTestDb {
    pub async fn new() -> PgTestDb {
        let mut admin = PgConnection::connect_with(&pg_options("postgres"))
            .await
            .expect("Postgres on localhost:5433 (LP_TEST_PG_*)");
        let pid = std::process::id();
        let mut sweep = false;
        SWEPT.call_once(|| sweep = true);
        if sweep {
            // Leftovers of earlier (crashed) runs of these tests only.
            let stale: Vec<String> = sqlx::query_scalar(
                "SELECT datname FROM pg_database WHERE datname LIKE 'lp\\_dbcore\\_t\\_%' \
                 AND datname NOT LIKE $1",
            )
            .bind(format!("{PREFIX}{pid}\\_%"))
            .fetch_all(&mut admin)
            .await
            .unwrap();
            for name in stale {
                let _ = sqlx::query(&format!("DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)"))
                    .execute(&mut admin)
                    .await;
            }
        }
        let name = format!("{PREFIX}{pid}_{}", SEQ.fetch_add(1, Ordering::SeqCst));
        sqlx::query(&format!(
            "CREATE DATABASE \"{name}\" TEMPLATE template0 ENCODING 'UTF8'"
        ))
        .execute(&mut admin)
        .await
        .unwrap();
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect_with(pg_options(&name))
            .await
            .unwrap();
        PgTestDb { name, pool }
    }

    pub fn db(&self) -> Db {
        Db::Pg(self.pool.clone())
    }

    pub async fn cleanup(self) {
        self.pool.close().await;
        let mut admin = PgConnection::connect_with(&pg_options("postgres"))
            .await
            .unwrap();
        sqlx::query(&format!(
            "DROP DATABASE IF EXISTS \"{}\" WITH (FORCE)",
            self.name
        ))
        .execute(&mut admin)
        .await
        .unwrap();
    }
}

/// A fresh SQLite database file in a temp dir (kept alive by the `TempDir`).
pub struct LiteTestDb {
    pub dir: tempfile::TempDir,
    pub path: PathBuf,
    pub db: Db,
}

impl LiteTestDb {
    pub async fn new() -> LiteTestDb {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.sqlite3");
        let mut o = LiteOptions::new(&path);
        o.create = true;
        o.readers = 3;
        o.busy_ms = 2_000;
        let db = Db::open_sqlite(&o).await.unwrap();
        LiteTestDb { dir, path, db }
    }

    /// Opens an existing file (a copy of a fixture).
    pub async fn open(path: PathBuf, dir: tempfile::TempDir) -> LiteTestDb {
        let o = LiteOptions::new(&path);
        let db = Db::open_sqlite(&o).await.unwrap();
        LiteTestDb { dir, path, db }
    }

    pub async fn cleanup(self) {
        self.db.close().await;
        drop(self.dir);
    }
}

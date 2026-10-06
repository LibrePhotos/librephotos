//! Schema migrations. `migrations/0000_baseline.sql` is the adopted Django
//! schema (api.0142); everything after it is additive Rust-only schema.
//! New files: `migrations/<YYYYMMDDHHMM>_<area>_<what>.sql` (see CLAUDE.md).

use sqlx::migrate::Migrator;

use crate::db::Db;

pub static MIGRATOR: Migrator = sqlx::migrate!("../../migrations");

/// Version of the baseline migration (`0000_baseline.sql`).
pub const BASELINE_VERSION: i64 = 0;

/// The migrator used everywhere: tolerates migrations applied by a newer
/// binary on the same DB (parallel branches share databases).
pub fn migrator() -> Migrator {
    Migrator {
        migrations: MIGRATOR.migrations.clone(),
        ignore_missing: true,
        locking: true,
        no_tx: false,
    }
}

pub async fn run(db: &Db) -> anyhow::Result<()> {
    match db.as_pg() {
        Some(pool) => migrator().run(pool).await?,
        // SQLITE(P2): migrations/sqlite/ and its own migrator (design §4).
        None => anyhow::bail!("migrations are not implemented on SQLite yet"),
    }
    Ok(())
}

/// `serve`/`migrate` guard: a Django database must go through `adopt`
/// first (running the baseline on it would fail half-way).
pub async fn run_checked(pool: &Db) -> anyhow::Result<()> {
    // SQLITE(P2): sqlite_master instead of to_regclass.
    let tracked: Option<String> =
        crate::sql::query_scalar("SELECT to_regclass('public._sqlx_migrations')::text")
            .fetch_one(pool)
            .await?;
    let has_photo: Option<String> =
        crate::sql::query_scalar("SELECT to_regclass('public.api_photo')::text")
            .fetch_one(pool)
            .await?;
    if tracked.is_none() && has_photo.is_some() {
        anyhow::bail!(
            "this is a Django-managed database; run `librephotos-rs adopt` once before `migrate`/`serve`"
        );
    }
    run(pool).await
}

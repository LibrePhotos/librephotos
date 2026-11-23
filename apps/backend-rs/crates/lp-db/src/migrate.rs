//! Schema migrations. `migrations/0000_baseline.sql` is the adopted Django
//! schema (api.0142); everything after it is additive Rust-only schema.
//! New files: `migrations/<YYYYMMDDHHMM>_<area>_<what>.sql` (see CLAUDE.md).

use sqlx::PgPool;
use sqlx::migrate::Migrator;

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

pub async fn run(pool: &PgPool) -> anyhow::Result<()> {
    migrator().run(pool).await?;
    Ok(())
}

/// `serve`/`migrate` guard: a Django database must go through `adopt`
/// first (running the baseline on it would fail half-way).
pub async fn run_checked(pool: &PgPool) -> anyhow::Result<()> {
    let tracked: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations')::text")
            .fetch_one(pool)
            .await?;
    let has_photo: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.api_photo')::text")
            .fetch_one(pool)
            .await?;
    if tracked.is_none() && has_photo.is_some() {
        anyhow::bail!(
            "this is a Django-managed database; run `librephotos-rs adopt` once before `migrate`/`serve`"
        );
    }
    run(pool).await
}

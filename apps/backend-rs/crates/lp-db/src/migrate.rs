//! Schema migrations, one set per dialect (design `sqlite_design.md` §4):
//!
//! * `migrations/pg/`: `0000_baseline.sql` is the adopted Django schema
//!   (api.0142); everything after it is additive Rust-only schema.
//! * `migrations/sqlite/`: `0000_baseline.sql` is Django's SQLite schema at
//!   api.0144, then a SQLite twin of every Postgres migration (same version
//!   and description; the `migrations_parity` test enforces it).
//!
//! New files: `migrations/{pg,sqlite}/<YYYYMMDDHHMM>_<area>_<what>.sql`, one in
//! each directory (see CLAUDE.md).

use sqlx::migrate::Migrator;

use crate::db::{Db, Dialect, Exec};

/// The Postgres migrations (`migrations/pg/`).
pub static MIGRATOR: Migrator = sqlx::migrate!("../../migrations/pg");

/// The SQLite migrations (`migrations/sqlite/`).
pub static MIGRATOR_SQLITE: Migrator = sqlx::migrate!("../../migrations/sqlite");

/// Version of the baseline migration (`0000_baseline.sql`).
pub const BASELINE_VERSION: i64 = 0;

/// The embedded migrations of a dialect.
pub fn migrations_for(d: Dialect) -> &'static Migrator {
    match d {
        Dialect::Pg => &MIGRATOR,
        Dialect::Sqlite => &MIGRATOR_SQLITE,
    }
}

/// The Postgres migrator (see [`migrator_for`]).
pub fn migrator() -> Migrator {
    migrator_for(Dialect::Pg)
}

/// The migrator used everywhere: tolerates migrations applied by a newer
/// binary on the same DB (parallel branches share databases).
pub fn migrator_for(d: Dialect) -> Migrator {
    Migrator {
        migrations: migrations_for(d).migrations.clone(),
        ignore_missing: true,
        locking: true,
        no_tx: false,
    }
}

/// Applies the pending migrations of the database's dialect. On SQLite it
/// also restores the Rust objects a Django table rebuild may have dropped
/// ([`ensure_sqlite_objects`]).
pub async fn run(db: &Db) -> anyhow::Result<()> {
    match db {
        Db::Pg(pool) => migrator_for(Dialect::Pg).run(pool).await?,
        Db::Lite(l) => {
            migrator_for(Dialect::Sqlite).run(l.write_pool()).await?;
            ensure_sqlite_objects(db).await?;
        }
    }
    Ok(())
}

/// `serve`/`migrate` guard: a Django database must go through `adopt`
/// first (running the baseline on it would fail half-way).
pub async fn run_checked(db: &Db) -> anyhow::Result<()> {
    let tracked = table_exists(db, "_sqlx_migrations").await?;
    let has_photo = table_exists(db, "api_photo").await?;
    if !tracked && has_photo {
        anyhow::bail!(
            "this is a Django-managed database; run `librephotos-rs adopt` once before `migrate`/`serve`"
        );
    }
    run(db).await
}

/// Whether a table (or view) exists: `to_regclass('public.<name>')` on
/// Postgres, `sqlite_master` on SQLite.
pub async fn table_exists<'e>(ex: impl Exec<'e>, name: &str) -> sqlx::Result<bool> {
    let sql = match ex.dialect() {
        Dialect::Pg => "SELECT to_regclass('public.' || $1) IS NOT NULL",
        Dialect::Sqlite => {
            "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = $1)"
        }
    };
    crate::sql::query_scalar::<_, bool>(sql)
        .bind(name)
        .fetch_one(ex)
        .await
}

/// Rust-owned indexes and triggers on Django tables (SQLite). Django
/// rebuilds a table on most `AlterField`s (`new__x`, copy, drop, rename)
/// and the rebuild drops every object its models do not know; these
/// statements are idempotent and run at every `serve` / `worker` start.
/// `(name, table the object depends on, DDL)`.
pub const SQLITE_OBJECTS: &[(&str, &str, &str)] = &[
    (
        "lp_longrunningjob_unfinished_idx",
        "api_longrunningjob",
        "CREATE INDEX IF NOT EXISTS lp_longrunningjob_unfinished_idx \
         ON api_longrunningjob (started_at) WHERE NOT finished",
    ),
    (
        "lp_photo_owner_visible_idx",
        "api_photo",
        "CREATE INDEX IF NOT EXISTS lp_photo_owner_visible_idx \
         ON api_photo (owner_id, id, hidden, in_trashcan)",
    ),
    (
        "lp_thumbnail_ready_idx",
        "api_thumbnail",
        "CREATE INDEX IF NOT EXISTS lp_thumbnail_ready_idx \
         ON api_thumbnail (photo_id) WHERE aspect_ratio IS NOT NULL",
    ),
    (
        "lp_clip_embeddings_model_reset",
        "lp_photo_clip_model",
        "CREATE TRIGGER IF NOT EXISTS lp_clip_embeddings_model_reset \
         AFTER UPDATE OF clip_embeddings ON api_photo \
         WHEN json(OLD.clip_embeddings) IS NOT json(NEW.clip_embeddings) \
         BEGIN DELETE FROM lp_photo_clip_model WHERE photo_id = NEW.id; END",
    ),
];

/// Recreates the [`SQLITE_OBJECTS`] that are missing (a no-op on Postgres,
/// and for objects whose table does not exist yet, i.e. before `adopt` /
/// `migrate`). Returns the names it had to restore.
pub async fn ensure_sqlite_objects(db: &Db) -> anyhow::Result<Vec<&'static str>> {
    if !db.dialect().is_sqlite() {
        return Ok(Vec::new());
    }
    let mut restored = Vec::new();
    for (name, table, ddl) in SQLITE_OBJECTS {
        let present: bool =
            crate::sql::query_scalar("SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name = $1)")
                .bind(*name)
                .fetch_one(db)
                .await?;
        if present || !table_exists(db, table).await? {
            continue;
        }
        crate::sql::query(*ddl).execute(db).await?;
        restored.push(*name);
    }
    if !restored.is_empty() && table_exists(db, "_sqlx_migrations").await? {
        tracing::warn!(
            ?restored,
            "recreated Rust indexes/triggers on Django tables (dropped by a Django table rebuild?)"
        );
    }
    Ok(restored)
}

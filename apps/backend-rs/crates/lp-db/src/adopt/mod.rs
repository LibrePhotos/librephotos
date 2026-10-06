//! `librephotos-rs adopt`: take over a database Django migrated (02 §1).
//!
//! 1. `django_migrations` must hold the pinned set (`django_migrations.txt`,
//!    taken from a fresh Django DB at api.0142). Individually recorded api
//!    migrations 0001..0100 (pre-squash installs) are tolerated, and so are
//!    the later migrations in [`SCHEMA_NEUTRAL`], which leave a PostgreSQL
//!    schema exactly as 0142 did (a DB at 0142, 0143 or 0144 adopts).
//! 2. The baseline is recorded as applied without running it.
//! 3. The Rust migrations run.
//! 4. constance values are imported into `site_settings` (existing rows win).

use std::collections::BTreeSet;

use lp_core::settings::{KEYS, constance_decode};
use sqlx::PgPool;
use sqlx::migrate::Migrate;

use crate::migrate::{BASELINE_VERSION, migrator};

const PINNED: &str = include_str!("django_migrations.txt");

#[derive(Debug, Default)]
pub struct AdoptReport {
    pub baseline_marked: bool,
    pub imported_settings: Vec<String>,
    pub skipped_settings: Vec<String>,
}

pub fn pinned_set() -> BTreeSet<(String, String)> {
    PINNED
        .lines()
        .filter_map(|l| l.split_once(' '))
        .map(|(a, n)| (a.trim().to_string(), n.trim().to_string()))
        .collect()
}

/// Django migrations after the pin that do nothing on PostgreSQL: both are
/// `RunPython` gated on `connection.vendor == "sqlite"` (verified: a
/// `pg_dump --schema-only` of a 0142 DB is byte-identical after
/// `manage.py migrate` applied them), so the baseline still describes a
/// database that has them.
pub const SCHEMA_NEUTRAL: &[(&str, &str)] = &[
    ("api", "0143_sqlite_photo_ids_hex"),
    ("api", "0144_sqlite_restore_foreign_keys"),
];

fn schema_neutral(app: &str, name: &str) -> bool {
    SCHEMA_NEUTRAL.iter().any(|(a, n)| *a == app && *n == name)
}

/// A pre-squash install also records the migrations the squash replaced.
fn replaced_by_squash(app: &str, name: &str) -> bool {
    app == "api"
        && name
            .get(..4)
            .and_then(|n| n.parse::<u32>().ok())
            .is_some_and(|n| (1..=100).contains(&n))
        && name != "0001_squashed_0100"
}

pub async fn check_django_migrations(pool: &PgPool) -> anyhow::Result<()> {
    let exists: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.django_migrations')::text")
            .fetch_one(pool)
            .await?;
    if exists.is_none() {
        anyhow::bail!("no django_migrations table: this is not a Django-migrated database");
    }
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT app, name FROM django_migrations")
        .fetch_all(pool)
        .await?;
    let have: BTreeSet<(String, String)> = rows.into_iter().collect();
    let pinned = pinned_set();
    let missing: Vec<_> = pinned.difference(&have).collect();
    let extra: Vec<_> = have
        .difference(&pinned)
        .filter(|(a, n)| !replaced_by_squash(a, n) && !schema_neutral(a, n))
        .collect();
    if !missing.is_empty() {
        anyhow::bail!(
            "database is behind the pinned Django schema; run Django to api.0142 first. Missing: {}",
            fmt_list(&missing)
        );
    }
    if !extra.is_empty() {
        anyhow::bail!(
            "database has Django migrations newer than the pinned set (api.0142, plus the PostgreSQL no-ops up to api.0144); re-pin the baseline. Unknown: {}",
            fmt_list(&extra)
        );
    }
    Ok(())
}

fn fmt_list(items: &[&(String, String)]) -> String {
    let mut s: Vec<String> = items
        .iter()
        .take(10)
        .map(|(a, n)| format!("{a}.{n}"))
        .collect();
    if items.len() > 10 {
        s.push(format!("... ({} total)", items.len()));
    }
    s.join(", ")
}

pub async fn adopt(pool: &PgPool, skip_check: bool) -> anyhow::Result<AdoptReport> {
    if !skip_check {
        check_django_migrations(pool).await?;
    }
    let has_photo: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.api_photo')::text")
            .fetch_one(pool)
            .await?;
    if has_photo.is_none() {
        anyhow::bail!("api_photo is missing: not a LibrePhotos database");
    }

    let mut report = AdoptReport::default();
    let m = migrator();
    let baseline = m
        .migrations
        .iter()
        .find(|mig| mig.version == BASELINE_VERSION)
        .ok_or_else(|| anyhow::anyhow!("baseline migration missing from the binary"))?;

    let mut conn = pool.acquire().await?;
    conn.ensure_migrations_table().await?;
    let done: Option<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE version = $1")
            .bind(BASELINE_VERSION)
            .fetch_optional(&mut *conn)
            .await?;
    if done.is_none() {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
             VALUES ($1, $2, TRUE, $3, 0)",
        )
        .bind(BASELINE_VERSION)
        .bind(&*baseline.description)
        .bind(&*baseline.checksum)
        .execute(&mut *conn)
        .await?;
        report.baseline_marked = true;
    }
    drop(conn);

    m.run(pool).await?;

    let has_constance: Option<String> =
        sqlx::query_scalar("SELECT to_regclass('public.constance_constance')::text")
            .fetch_one(pool)
            .await?;
    if has_constance.is_some() {
        let rows: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT key, value FROM constance_constance ORDER BY id")
                .fetch_all(pool)
                .await?;
        for (key, raw) in rows {
            let decoded = raw.as_deref().and_then(constance_decode);
            match decoded {
                Some(value) if KEYS.contains(&key.as_str()) => {
                    let inserted = sqlx::query(
                        "INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
                    )
                    .bind(&key)
                    .bind(&value)
                    .execute(pool)
                    .await?
                    .rows_affected();
                    if inserted > 0 {
                        report.imported_settings.push(key);
                    }
                }
                _ => report.skipped_settings.push(key),
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_has_api_0142() {
        let p = pinned_set();
        assert!(p.contains(&(
            "api".to_string(),
            "0142_deletionlog_albumauto_last_modified_and_more".to_string()
        )));
        assert!(p.len() > 200);
        assert!(replaced_by_squash("api", "0042_foo"));
        assert!(!replaced_by_squash("api", "0101_foo"));
        assert!(!replaced_by_squash("auth", "0001_initial"));
        assert!(schema_neutral("api", "0143_sqlite_photo_ids_hex"));
        assert!(schema_neutral("api", "0144_sqlite_restore_foreign_keys"));
        assert!(!schema_neutral("api", "0145_anything"));
        for (app, name) in SCHEMA_NEUTRAL {
            assert!(!p.contains(&(app.to_string(), name.to_string())));
        }
    }
}

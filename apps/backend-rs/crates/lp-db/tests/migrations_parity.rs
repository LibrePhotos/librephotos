//! The two migration sets (`migrations/pg`, `migrations/sqlite`, design
//! `sqlite_design.md` §4) stay in lockstep, a fresh SQLite file migrates,
//! and `ensure_sqlite_objects` restores what a Django table rebuild drops.

#![allow(clippy::disallowed_methods)]

use lp_db::db::{Db, lite::LiteOptions};
use lp_db::migrate::{MIGRATOR, MIGRATOR_SQLITE, SQLITE_OBJECTS, ensure_sqlite_objects};

#[test]
fn migrations_parity() {
    let pg: Vec<(i64, String)> = MIGRATOR
        .migrations
        .iter()
        .map(|m| (m.version, m.description.to_string()))
        .collect();
    let lite: Vec<(i64, String)> = MIGRATOR_SQLITE
        .migrations
        .iter()
        .map(|m| (m.version, m.description.to_string()))
        .collect();
    assert_eq!(
        pg, lite,
        "every migrations/pg file needs a migrations/sqlite twin with the same version and name"
    );
    assert_eq!(pg.first().map(|m| m.0), Some(0), "baseline first");
}

async fn fresh() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let mut o = LiteOptions::new(dir.path().join("fresh.sqlite3"));
    o.create = true;
    o.readers = 2;
    let db = Db::open_sqlite(&o).await.unwrap();
    (dir, db)
}

async fn names(db: &Db) -> Vec<String> {
    lp_db::sql::query_scalar("SELECT name FROM sqlite_master ORDER BY name")
        .fetch_all(db)
        .await
        .unwrap()
}

#[tokio::test]
async fn sqlite_fresh_migrate_and_self_healing() {
    let (_dir, db) = fresh().await;
    lp_db::migrate::run_checked(&db)
        .await
        .expect("fresh migrate");
    // Idempotent.
    lp_db::migrate::run(&db).await.expect("second run");
    let have = names(&db).await;
    for t in [
        "api_photo",
        "api_user",
        "site_settings",
        "refresh_token",
        "job_queue",
        "schedule_state",
        "rate_limit_hit",
        "lp_photo_clip_model",
        "lp_photo_faces_scanned",
    ] {
        assert!(have.iter().any(|n| n == t), "{t} missing: {have:?}");
    }
    for (name, _, _) in SQLITE_OBJECTS {
        assert!(have.iter().any(|n| n == name), "{name} missing");
    }
    let wal: String = lp_db::sql::query_scalar("PRAGMA journal_mode")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(wal, "wal");

    // A Django rebuild of api_photo drops Rust's index and trigger.
    for ddl in [
        "DROP INDEX lp_photo_owner_visible_idx",
        "DROP TRIGGER lp_clip_embeddings_model_reset",
        "DROP INDEX lp_thumbnail_ready_idx",
    ] {
        lp_db::sql::query(ddl).execute(&db).await.unwrap();
    }
    let mut restored = ensure_sqlite_objects(&db).await.unwrap();
    restored.sort();
    assert_eq!(
        restored,
        vec![
            "lp_clip_embeddings_model_reset",
            "lp_photo_owner_visible_idx",
            "lp_thumbnail_ready_idx"
        ]
    );
    assert!(ensure_sqlite_objects(&db).await.unwrap().is_empty());
    db.close().await;
}

/// Inserts a row with only the NOT NULL columns, filled with type-appropriate
/// dummies, plus `set` (column, SQL literal).
async fn insert_min(tx: &mut lp_db::Tx, table: &str, set: &[(&str, String)]) {
    let cols: Vec<(String, i64, String)> = lp_db::sql::query_as(format!(
        "SELECT name, \"notnull\", lower(type) FROM pragma_table_info('{table}')"
    ))
    .fetch_all(&mut **tx)
    .await
    .unwrap();
    let mut names = Vec::new();
    let mut values = Vec::new();
    for (name, notnull, ty) in &cols {
        let forced = set.iter().find(|(c, _)| c == name).map(|(_, v)| v.clone());
        if *notnull == 0 && forced.is_none() {
            continue;
        }
        names.push(format!("\"{name}\""));
        values.push(forced.unwrap_or_else(|| {
            if ty.starts_with("datetime") {
                "now()".into()
            } else if ty.starts_with("date") {
                "'2020-01-01'".into()
            } else if ty.starts_with("bool") || ty.contains("int") || ty == "real" {
                "0".into()
            } else {
                "'{}'".into() // valid JSON for JSONField CHECKs, fine for text
            }
        }));
    }
    lp_db::sql::query(format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        names.join(", "),
        values.join(", ")
    ))
    .execute(&mut **tx)
    .await
    .unwrap_or_else(|e| panic!("insert into {table}: {e}"));
}

/// The trigger drops the side-table row when any writer changes the
/// embedding, and keeps it when the stored JSON is only re-formatted.
#[tokio::test]
async fn sqlite_clip_model_trigger() {
    let (_dir, db) = fresh().await;
    lp_db::migrate::run(&db).await.unwrap();
    let id = uuid::Uuid::from_u128(7);
    let mut tx = db.begin().await.unwrap();
    insert_min(
        &mut tx,
        "api_user",
        &[("id", "1".into()), ("username", "'u'".into())],
    )
    .await;
    insert_min(
        &mut tx,
        "api_photo",
        &[
            ("id", format!("'{}'", id.simple())),
            ("owner_id", "1".into()),
            ("clip_embeddings", "'[0.5, 1.0]'".into()),
        ],
    )
    .await;
    lp_db::sql::query(lp_db::sql::SQLITE_SET_CLIP_MODEL)
        .bind(id)
        .bind("mobileclip_s2")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let model = || async {
        lp_db::sql::query_scalar::<_, String>(format!(
            "SELECT {} FROM api_photo p WHERE p.id = $1",
            lp_db::sql::stored_clip_model(db.dialect(), "p")
        ))
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap()
    };
    assert_eq!(model().await, "mobileclip_s2");
    // Same JSON value, other spelling: the trigger must not fire.
    lp_db::sql::query("UPDATE api_photo SET clip_embeddings = '[0.5,1.0]' WHERE id = $1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(model().await, "mobileclip_s2");
    // A changed embedding (e.g. Django) resets to Django's model.
    lp_db::sql::query("UPDATE api_photo SET clip_embeddings = '[0.25, 1.0]' WHERE id = $1")
        .bind(id)
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(model().await, "clip_vit_b32");
    db.close().await;
}

/// Read-only check that moving the files to `migrations/pg/` kept their
/// checksums: every migration an adopted Postgres database recorded must
/// match the binary's. `LP_PARITY_PG_DB` (default `lp_t_demo`) on the test
/// server (`LP_TEST_PG_*`); only SELECTs `_sqlx_migrations`.
#[tokio::test]
#[ignore = "needs an adopted Postgres database"]
async fn pg_checksums_match_an_adopted_database() {
    use sqlx::Connection;
    let get = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_owned());
    let opts = sqlx::postgres::PgConnectOptions::new()
        .host(&get("LP_TEST_PG_HOST", "localhost"))
        .port(get("LP_TEST_PG_PORT", "5433").parse().unwrap())
        .username(&get("LP_TEST_PG_USER", "postgres"))
        .password(&get("LP_TEST_PG_PASS", "x"))
        .database(&get("LP_PARITY_PG_DB", "lp_t_demo"));
    let mut conn = sqlx::PgConnection::connect_with(&opts).await.unwrap();
    let rows: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut conn)
            .await
            .unwrap();
    assert!(!rows.is_empty());
    let mut checked = 0;
    for (version, checksum) in rows {
        let Some(m) = MIGRATOR.migrations.iter().find(|m| m.version == version) else {
            continue; // applied by another branch's binary
        };
        assert_eq!(&*m.checksum, &checksum[..], "checksum of {version} changed");
        checked += 1;
    }
    eprintln!("{checked} checksums match");
    let _ = conn.close().await;
}

//! `adopt`'s django_migrations pin: a database at api.0142, 0143 or 0144
//! (the two SQLite-only migrations) is accepted; anything newer or older is
//! refused. Needs the lp_fixture template (a Django DB at 0142), or on
//! SQLite (`LP_TEST_BACKEND=sqlite`) the SQLite fixture pack (at 0144).

#![allow(clippy::disallowed_methods)]

use lp_db::adopt::{SCHEMA_NEUTRAL, check_django_migrations};
use lp_testkit::TestDb;

async fn record(db: &TestDb, app: &str, name: &str) {
    lp_db::sql::query("INSERT INTO django_migrations (app, name, applied) VALUES ($1, $2, now())")
        .bind(app)
        .bind(name)
        .execute(&db.pool)
        .await
        .unwrap();
}

async fn forget(db: &TestDb, app: &str, name: &str) {
    lp_db::sql::query("DELETE FROM django_migrations WHERE app = $1 AND name = $2")
        .bind(app)
        .bind(name)
        .execute(&db.pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn accepts_0142_0143_and_0144() {
    let db = TestDb::new().await;
    let has_table = lp_db::migrate::table_exists(&db.pool, "django_migrations")
        .await
        .unwrap();
    if !has_table {
        eprintln!("skipped: the template is not a Django database");
        db.cleanup().await;
        return;
    }
    for (app, name) in SCHEMA_NEUTRAL {
        forget(&db, app, name).await;
    }
    check_django_migrations(&db.pool).await.expect("at 0142");
    for (app, name) in SCHEMA_NEUTRAL {
        record(&db, app, name).await;
        check_django_migrations(&db.pool)
            .await
            .unwrap_or_else(|e| panic!("at {name}: {e}"));
    }
    // The whole adopt runs on a 0144 database (idempotent on an adopted one).
    lp_db::adopt::adopt(&db.pool, false)
        .await
        .expect("adopt at 0144");

    record(&db, "api", "0145_not_yet_known").await;
    let err = check_django_migrations(&db.pool).await.unwrap_err();
    assert!(err.to_string().contains("api.0145_not_yet_known"), "{err}");
    forget(&db, "api", "0145_not_yet_known").await;

    forget(
        &db,
        "api",
        "0142_deletionlog_albumauto_last_modified_and_more",
    )
    .await;
    let err = check_django_migrations(&db.pool).await.unwrap_err();
    assert!(err.to_string().contains("behind"), "{err}");
    db.cleanup().await;
}

/// SQLite: `adopt` refuses a file Django has not repaired yet (dashed photo
/// ids before api.0143, broken references before api.0144). Works on a copy
/// of the SQLite fixture pack, whatever `LP_TEST_BACKEND` says.
#[tokio::test]
async fn sqlite_adopt_refuses_unrepaired_files() {
    use lp_db::db::{Db, lite::LiteOptions};
    let src = std::path::PathBuf::from(std::env::var("LP_TEST_SQLITE_TEMPLATE").unwrap_or_else(
        |_| "C:/Users/Niaz/librephotos/rust-pg/fixture-sqlite/lp_fixture.sqlite3".into(),
    ));
    if !src.exists() {
        eprintln!("skipped: no SQLite fixture at {}", src.display());
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("adopt.sqlite3");
    std::fs::copy(&src, &path).unwrap();
    let db = Db::open_sqlite(&LiteOptions::new(&path)).await.unwrap();
    let id: String = lp_db::sql::query_scalar("SELECT id FROM api_photo ORDER BY id LIMIT 1")
        .fetch_one(&db)
        .await
        .unwrap();
    let dashed = uuid::Uuid::parse_str(&id).unwrap().hyphenated().to_string();
    let unchecked = |sql: String| {
        let db = db.clone();
        async move {
            let mut conn = db.acquire().await.unwrap();
            lp_db::sql::query("PRAGMA foreign_keys = OFF")
                .execute(&mut *conn)
                .await
                .unwrap();
            lp_db::sql::query(sql).execute(&mut *conn).await.unwrap();
            lp_db::sql::query("PRAGMA foreign_keys = ON")
                .execute(&mut *conn)
                .await
                .unwrap();
        }
    };

    unchecked(format!(
        "UPDATE api_photo SET id = '{dashed}' WHERE id = '{id}'"
    ))
    .await;
    let err = lp_db::adopt::adopt(&db, false).await.unwrap_err();
    assert!(err.to_string().contains("0143"), "{err}");
    unchecked(format!(
        "UPDATE api_photo SET id = '{id}' WHERE id = '{dashed}'"
    ))
    .await;

    let ghost = "f".repeat(32);
    unchecked(format!(
        "INSERT INTO api_photo_shared_to (photo_id, user_id) \
         SELECT '{ghost}', id FROM api_user ORDER BY id LIMIT 1"
    ))
    .await;
    let err = lp_db::adopt::adopt(&db, false).await.unwrap_err();
    assert!(err.to_string().contains("0144"), "{err}");
    unchecked(format!(
        "DELETE FROM api_photo_shared_to WHERE photo_id = '{ghost}'"
    ))
    .await;

    let report = lp_db::adopt::adopt(&db, false).await.expect("adopt");
    assert!(report.baseline_marked);
    let wal: String = lp_db::sql::query_scalar("PRAGMA journal_mode")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(wal, "wal");
    // Idempotent, and the Rust tables are there.
    assert!(
        !lp_db::adopt::adopt(&db, false)
            .await
            .unwrap()
            .baseline_marked
    );
    assert!(
        lp_db::migrate::table_exists(&db, "job_queue")
            .await
            .unwrap()
    );
    db.close().await;
}

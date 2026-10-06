//! `adopt`'s django_migrations pin: a database at api.0142, 0143 or 0144
//! (the two SQLite-only migrations) is accepted; anything newer or older is
//! refused. Needs the lp_fixture template (a Django DB at 0142).

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
    let has_table: Option<String> =
        lp_db::sql::query_scalar("SELECT to_regclass('public.django_migrations')::text")
            .fetch_one(&db.pool)
            .await
            .unwrap();
    if has_table.is_none() {
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

//! P0 spike (design §7): the sqlx / SQLite facts the dual-dialect layer
//! relies on, proven against plain sqlx where possible. Results are written
//! up in `rust-pg/workflows/sqlite_design.md` ("P0 spike results").

#![allow(clippy::disallowed_methods)]

mod db_common;

use std::time::Duration;

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use db_common::PgTestDb;
use lp_db::db::{DjUuid, DjUuidOpt};
use serde_json::{Value, json};
use sqlx::postgres::PgRow;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::types::Json;
use sqlx::{Connection, FromRow, SqliteConnection, SqlitePool};
use uuid::Uuid;

async fn mem() -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .unwrap()
}

/// sqlx-sqlite binds `$N` by number: reuse, out-of-order and two-digit
/// placeholders all resolve like Postgres.
#[tokio::test]
async fn dollar_n_binds_by_number() {
    let p = mem().await;
    let s: String = sqlx::query_scalar("SELECT $2 || '-' || $1 || '-' || $2")
        .bind("a")
        .bind("b")
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(s, "b-a-b");

    let s: String = sqlx::query_scalar("SELECT $3 || $1 || $1 || $2")
        .bind("x")
        .bind("y")
        .bind("z")
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(s, "zxxy");

    let mut q = sqlx::query_scalar::<_, i64>("SELECT $10 * 100 + $1");
    for i in 1..=10i64 {
        q = q.bind(i);
    }
    assert_eq!(q.fetch_one(&p).await.unwrap(), 1001);

    // The same `$1` in WHERE and in the select list.
    sqlx::query("CREATE TABLE t (id integer PRIMARY KEY, name text)")
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("INSERT INTO t VALUES (1, 'a'), (2, 'b')")
        .execute(&p)
        .await
        .unwrap();
    let rows: Vec<(i64, i64)> =
        sqlx::query_as("SELECT id, $1 FROM t WHERE id >= $1 OR name = $2 ORDER BY id")
            .bind(2i64)
            .bind("a")
            .fetch_all(&p)
            .await
            .unwrap();
    assert_eq!(rows, vec![(1, 2), (2, 2)]);
}

#[derive(Debug, FromRow, PartialEq)]
struct Generic {
    #[sqlx(try_from = "DjUuid")]
    id: Uuid,
    #[sqlx(try_from = "DjUuidOpt")]
    parent: Option<Uuid>,
    n: i32,
    big: i64,
    flag: bool,
    at: DateTime<Utc>,
    day: NaiveDate,
    ratio: Option<f64>,
    name: String,
    j: Value,
    tags: Json<Vec<String>>,
}

fn expected() -> Generic {
    Generic {
        id: Uuid::parse_str("0257cee8-81f4-4968-9176-5ac2d144988f").unwrap(),
        parent: None,
        n: 7,
        big: 9_000_000_000,
        flag: true,
        at: Utc.with_ymd_and_hms(2024, 1, 15, 9, 30, 0).unwrap()
            + chrono::Duration::microseconds(123_456),
        day: NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
        ratio: Some(1.5),
        name: "x".into(),
        j: json!({"a": [1, 2.5, null]}),
        tags: Json(vec!["t1".into(), "t2".into()]),
    }
}

/// One `#[derive(FromRow)]` struct (with `try_from = "DjUuid"` fields)
/// decodes from both `PgRow` and `SqliteRow`.
#[tokio::test]
async fn generic_from_row_both_drivers() {
    fn assert_both<T>()
    where
        T: for<'r> FromRow<'r, PgRow> + for<'r> FromRow<'r, SqliteRow>,
    {
    }
    assert_both::<Generic>();

    // SQLite, values stored the way Django stores them.
    let p = mem().await;
    let got: Generic = sqlx::query_as(
        "SELECT '0257cee881f4496891765ac2d144988f' AS id, NULL AS parent, 7 AS n, \
           9000000000 AS big, 1 AS flag, '2024-01-15 09:30:00.123456' AS at, \
           '2024-01-15' AS day, 1.5 AS ratio, 'x' AS name, '{\"a\": [1, 2.5, null]}' AS j, \
           '[\"t1\", \"t2\"]' AS tags",
    )
    .fetch_one(&p)
    .await
    .unwrap();
    assert_eq!(got, expected());

    // Postgres, native types.
    let pg = PgTestDb::new().await;
    let got: Generic = sqlx::query_as(
        "SELECT '0257cee881f4496891765ac2d144988f'::uuid AS id, NULL::uuid AS parent, 7 AS n, \
           9000000000::bigint AS big, true AS flag, \
           '2024-01-15 09:30:00.123456+00'::timestamptz AS at, '2024-01-15'::date AS day, \
           1.5::float8 AS ratio, 'x' AS name, '{\"a\": [1, 2.5, null]}'::jsonb AS j, \
           '[\"t1\", \"t2\"]'::jsonb AS tags",
    )
    .fetch_one(&pg.pool)
    .await
    .unwrap();
    assert_eq!(got, expected());
    pg.cleanup().await;
}

/// The failure modes that force the codecs: plain sqlx `Uuid` cannot read
/// Django's `char(32)`, and plain sqlx *encoding* of `Uuid`, `DateTime<Utc>`
/// and `Json` does not produce Django's text.
#[tokio::test]
async fn plain_sqlx_formats_differ_from_django() {
    let p = mem().await;
    let err = sqlx::query_scalar::<_, Uuid>("SELECT '0257cee881f4496891765ac2d144988f'")
        .fetch_one(&p)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("invalid length"), "{err}");

    let u = Uuid::parse_str("0257cee8-81f4-4968-9176-5ac2d144988f").unwrap();
    let ty: String = sqlx::query_scalar("SELECT typeof($1)")
        .bind(u)
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(ty, "blob", "sqlx binds Uuid as a 16-byte BLOB");

    let t = Utc.with_ymd_and_hms(2024, 1, 15, 9, 30, 0).unwrap();
    let s: String = sqlx::query_scalar("SELECT $1")
        .bind(t)
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(
        s, "2024-01-15T09:30:00+00:00",
        "sqlx binds DateTime<Utc> as RFC 3339"
    );
    // ... which does not compare equal to Django's stored text:
    let eq: bool = sqlx::query_scalar("SELECT $1 = '2024-01-15 09:30:00'")
        .bind(t)
        .fetch_one(&p)
        .await
        .unwrap();
    assert!(!eq);

    let s: String = sqlx::query_scalar("SELECT $1")
        .bind(Json(json!({"a": 1.0, "b": [1, 2]})))
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(s, r#"{"a":1.0,"b":[1,2]}"#, "compact, not json.dumps");
}

/// Decoding vs Django's declared column types. sqlx-sqlite checks
/// `compatible()` against the value's *storage class*
/// (`sqlite3_value_type`), not the declared type, and skips the check for
/// NULL; so `bool` / chrono / ints decode from every Django decltype. The
/// real traps are storage-class mismatches in expressions (an INTEGER where
/// `f64` is expected) and `Uuid`.
#[tokio::test]
async fn django_decltypes_decode() {
    let p = mem().await;
    sqlx::query(
        "CREATE TABLE dj (big bigint, i integer, ui integer unsigned, dt datetime, d date, \
           b bool, id char(32), t text, r real, rr REAL, v varchar(64), blob BLOB)",
    )
    .execute(&p)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO dj VALUES (9000000000, 7, 3, '2026-10-06 06:38:17.128839', '2024-01-15', 1, \
           '0257cee881f4496891765ac2d144988f', 'txt', 2, 0.1, 'vc', x'00ff'), \
           (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
    )
    .execute(&p)
    .await
    .unwrap();

    #[derive(FromRow, Debug)]
    struct Dj {
        big: Option<i64>,
        i: Option<i32>,
        ui: Option<i64>,
        dt: Option<DateTime<Utc>>,
        d: Option<NaiveDate>,
        b: Option<bool>,
        #[sqlx(try_from = "DjUuidOpt")]
        id: Option<Uuid>,
        t: Option<String>,
        r: Option<f64>,
        rr: Option<f64>,
        v: Option<String>,
        blob: Option<Vec<u8>>,
    }
    let rows: Vec<Dj> = sqlx::query_as("SELECT * FROM dj ORDER BY big IS NULL")
        .fetch_all(&p)
        .await
        .unwrap();
    let r = &rows[0];
    assert_eq!(r.big, Some(9_000_000_000));
    assert_eq!(r.i, Some(7));
    assert_eq!(r.ui, Some(3));
    assert_eq!(
        r.dt.unwrap(),
        Utc.with_ymd_and_hms(2026, 10, 6, 6, 38, 17).unwrap()
            + chrono::Duration::microseconds(128_839)
    );
    assert_eq!(r.d, NaiveDate::from_ymd_opt(2024, 1, 15));
    assert_eq!(r.b, Some(true));
    assert_eq!(
        r.id.unwrap().simple().to_string(),
        "0257cee881f4496891765ac2d144988f"
    );
    assert_eq!(r.t.as_deref(), Some("txt"));
    // REAL affinity turns the stored integer 2 into a FLOAT on read.
    assert_eq!(r.r, Some(2.0));
    assert_eq!(r.rr, Some(0.1));
    assert_eq!(r.v.as_deref(), Some("vc"));
    assert_eq!(r.blob.as_deref(), Some(&[0u8, 255][..]));
    let n = &rows[1];
    assert!(n.big.is_none() && n.dt.is_none() && n.b.is_none() && n.id.is_none() && n.r.is_none());

    // Expressions have no decltype; the storage class decides.
    let e = sqlx::query_scalar::<_, f64>("SELECT coalesce(NULL, 0)")
        .fetch_one(&p)
        .await
        .unwrap_err();
    assert!(e.to_string().contains("mismatched types"), "{e}");
    let ok: f64 = sqlx::query_scalar("SELECT coalesce(NULL, 0.0)")
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(ok, 0.0);
    // bool from comparisons / EXISTS (INTEGER 0/1) and from the bool column.
    let b: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM dj WHERE b)")
        .fetch_one(&p)
        .await
        .unwrap();
    assert!(b);
    // DateTime<Utc> from max() over a datetime column (TEXT).
    let m: DateTime<Utc> = sqlx::query_scalar("SELECT max(dt) FROM dj")
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(Some(m), r.dt);
}

/// `begin_with("BEGIN IMMEDIATE")` takes the write lock at BEGIN: a second
/// connection cannot start a write transaction until it commits.
#[tokio::test]
async fn begin_immediate_takes_write_lock() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("x.sqlite3");
    let opts = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_millis(100));
    let mut a = SqliteConnection::connect_with(&opts).await.unwrap();
    let mut b = SqliteConnection::connect_with(&opts).await.unwrap();
    sqlx::query("CREATE TABLE t (x integer)")
        .execute(&mut a)
        .await
        .unwrap();

    let mut tx = a.begin_with("BEGIN IMMEDIATE").await.unwrap();
    // No statement ran yet, but the RESERVED lock is held:
    let err = b.begin_with("BEGIN IMMEDIATE").await.unwrap_err();
    assert!(err.to_string().contains("database is locked"), "{err}");
    // Readers still work (WAL).
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM t")
        .fetch_one(&mut b)
        .await
        .unwrap();
    assert_eq!(n, 0);
    sqlx::query("INSERT INTO t VALUES (1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let tx2 = b.begin_with("BEGIN IMMEDIATE").await.unwrap();
    tx2.rollback().await.unwrap();

    // A deferred BEGIN does not lock: the conflict shows up only at the write.
    let mut tx = a.begin().await.unwrap();
    let _ = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM t")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let tx_b = b.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let err = sqlx::query("INSERT INTO t VALUES (2)")
        .execute(&mut *tx)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    drop(tx_b);
    drop(tx);
    a.close().await.unwrap();
    b.close().await.unwrap();
}

/// The `now()` UDF registered in `after_connect` returns Django's text.
#[tokio::test]
async fn now_udf_after_connect() {
    let p = SqlitePoolOptions::new()
        .max_connections(1)
        .after_connect(|c, _| Box::pin(async move { lp_db::db::lite::install_now(c).await }))
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .unwrap();
    let s: String = sqlx::query_scalar("SELECT now()")
        .fetch_one(&p)
        .await
        .unwrap();
    let re = regex::Regex::new(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{6})?$").unwrap();
    assert!(re.is_match(&s), "{s}");
    let t: DateTime<Utc> = sqlx::query_scalar("SELECT now()")
        .fetch_one(&p)
        .await
        .unwrap();
    assert!((Utc::now() - t).num_seconds().abs() < 5);
}

/// Bundled SQLite (libsqlite3-sys 0.30.1) has what the portable subset needs.
#[tokio::test]
async fn sqlite_features() {
    let p = mem().await;
    let v: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&p)
        .await
        .unwrap();
    let parts: Vec<u32> = v.split('.').map(|x| x.parse().unwrap()).collect();
    assert!(
        parts[0] == 3 && parts[1] >= 44,
        "need >= 3.44 for ORDER BY in aggregates, got {v}"
    );

    sqlx::query("CREATE TABLE t (id integer PRIMARY KEY AUTOINCREMENT, g integer, x text)")
        .execute(&p)
        .await
        .unwrap();
    // RETURNING
    let ids: Vec<i64> =
        sqlx::query_scalar("INSERT INTO t (g, x) VALUES (1, 'b'), (1, 'a'), (2, 'c') RETURNING id")
            .fetch_all(&p)
            .await
            .unwrap();
    assert_eq!(ids, vec![1, 2, 3]);
    // json_group_array(.. ORDER BY ..)
    let agg: String =
        sqlx::query_scalar("SELECT json_group_array(x ORDER BY x) FROM t WHERE g = 1")
            .fetch_one(&p)
            .await
            .unwrap();
    assert_eq!(agg, r#"["a","b"]"#);
    // UPDATE .. FROM
    sqlx::query("CREATE TABLE u (g integer, y text)")
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("INSERT INTO u VALUES (1, 'one'), (2, 'two')")
        .execute(&p)
        .await
        .unwrap();
    let n = sqlx::query("UPDATE t SET x = u.y FROM u WHERE u.g = t.g AND t.id > 1")
        .execute(&p)
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(n, 2);
    // Window functions (the DISTINCT ON replacement).
    let firsts: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT g, id FROM (SELECT g, id, ROW_NUMBER() OVER (PARTITION BY g ORDER BY id DESC) AS rn \
         FROM t) WHERE rn = 1 ORDER BY g",
    )
    .fetch_all(&p)
    .await
    .unwrap();
    assert_eq!(firsts, vec![(1, 2), (2, 3)]);
    // FILTER, IS DISTINCT FROM (spelled IS NOT), json_each with key = ordinal.
    let c: i64 = sqlx::query_scalar("SELECT count(*) FILTER (WHERE g = 1) FROM t")
        .fetch_one(&p)
        .await
        .unwrap();
    assert_eq!(c, 2);
    let ord: Vec<(String, i64)> =
        sqlx::query_as("SELECT value, key FROM json_each('[\"z\",\"y\"]') ORDER BY key")
            .fetch_all(&p)
            .await
            .unwrap();
    assert_eq!(ord, vec![("z".into(), 0), ("y".into(), 1)]);
    // INSERT .. SELECT .. ON CONFLICT needs a WHERE before ON CONFLICT.
    sqlx::query("CREATE TABLE k (a integer PRIMARY KEY, b text)")
        .execute(&p)
        .await
        .unwrap();
    sqlx::query("INSERT INTO k SELECT g, x FROM t WHERE true ON CONFLICT (a) DO NOTHING")
        .execute(&p)
        .await
        .unwrap();
}

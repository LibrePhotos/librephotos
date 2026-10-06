//! The dual-dialect layer (`lp_db::db`) on both backends: codecs, query
//! methods, transactions, executor routing, list binds, `now()`, and real
//! rows of the Django-built SQLite fixture.

#![allow(clippy::disallowed_methods)]

mod db_common;

use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};
use db_common::{LiteTestDb, PgTestDb};
use futures::TryStreamExt;
use lp_db::db::sql::{self, JsonKind};
use lp_db::db::{
    Arg, Backend, Db, DbSettings, Dialect, DjDateTime, DjList, DjUuid, DjUuidOpt, Exec, PyJson, Qb,
    py_json_dumps,
};
use serde_json::{Value, json};
use sqlx::FromRow;
use sqlx::types::Json;
use uuid::Uuid;

/// Runs `$body` against a fresh Postgres database and a fresh SQLite file.
macro_rules! both {
    ($body:ident) => {{
        let pg = PgTestDb::new().await;
        $body(&pg.db()).await;
        pg.cleanup().await;
        let lite = LiteTestDb::new().await;
        $body(&lite.db).await;
        lite.cleanup().await;
    }};
}

fn u(s: &str) -> Uuid {
    Uuid::parse_str(s).unwrap()
}

fn ts(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32, micros: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, mo, d, h, mi, s).unwrap() + chrono::Duration::microseconds(micros)
}

async fn ddl(db: &Db, pg: &str, lite: &str) {
    let s = match db.dialect() {
        Dialect::Pg => pg,
        Dialect::Sqlite => lite,
    };
    for stmt in s.split(';').filter(|s| !s.trim().is_empty()) {
        sql::query(stmt).execute(db).await.unwrap();
    }
}

// ------------------------------------------------------------------ codecs

#[derive(Debug, Clone, PartialEq, FromRow)]
struct CodecRow {
    #[sqlx(try_from = "DjUuid")]
    id: Uuid,
    #[sqlx(try_from = "DjUuidOpt")]
    parent: Option<Uuid>,
    at: DateTime<Utc>,
    at_opt: Option<DateTime<Utc>>,
    nat: NaiveDateTime,
    day: NaiveDate,
    flag: bool,
    n: i32,
    big: i64,
    r: f64,
    t: String,
    j: Value,
    jn: Option<Value>,
    tags: Json<Vec<String>>,
    b: Vec<u8>,
}

fn codec_rows() -> Vec<CodecRow> {
    vec![
        CodecRow {
            id: u("0257cee8-81f4-4968-9176-5ac2d144988f"),
            parent: Some(u("0b435f38-aa99-41e4-b069-415a708ba205")),
            at: ts(2026, 10, 6, 6, 38, 17, 128_839),
            at_opt: None,
            nat: ts(2024, 1, 15, 9, 30, 0, 0).naive_utc(),
            day: NaiveDate::from_ymd_opt(2024, 2, 29).unwrap(),
            flag: true,
            n: -7,
            big: 9_000_000_000,
            r: 0.1,
            t: "Zoë's \"quote\" \\ 100%_".into(),
            j: json!({"k": [1, 2.5, null, true], "s": "é😀", "f": 1e-5}),
            jn: Some(Value::Null),
            tags: Json(vec!["a".into(), "b".into()]),
            b: vec![0, 255, 7],
        },
        CodecRow {
            id: u("0f4e861c-12c2-41a3-b102-e8f4e847f822"),
            parent: None,
            at: ts(2023, 8, 3, 16, 12, 0, 0),
            at_opt: Some(ts(1999, 12, 31, 23, 59, 59, 1)),
            nat: ts(2024, 1, 15, 9, 30, 0, 500_000).naive_utc(),
            day: NaiveDate::from_ymd_opt(1970, 1, 1).unwrap(),
            flag: false,
            n: 0,
            big: -1,
            r: -2.0,
            t: String::new(),
            j: json!([]),
            jn: None,
            tags: Json(vec![]),
            b: vec![],
        },
    ]
}

async fn codec_body(db: &Db) {
    ddl(
        db,
        "CREATE TABLE c (id uuid PRIMARY KEY, parent uuid, at timestamptz NOT NULL, \
           at_opt timestamptz, nat timestamp NOT NULL, day date NOT NULL, flag bool NOT NULL, \
           n integer NOT NULL, big bigint NOT NULL, r double precision NOT NULL, t text NOT NULL, \
           j jsonb NOT NULL, jn jsonb, tags jsonb NOT NULL, b bytea NOT NULL)",
        // Django's SQLite DDL types.
        "CREATE TABLE c (id char(32) NOT NULL PRIMARY KEY, parent char(32), at datetime NOT NULL, \
           at_opt datetime, nat datetime NOT NULL, day date NOT NULL, flag bool NOT NULL, \
           n integer NOT NULL, big bigint NOT NULL, r real NOT NULL, t text NOT NULL, \
           j text NOT NULL CHECK ((JSON_VALID(j) OR j IS NULL)), jn text CHECK ((JSON_VALID(jn) OR jn IS NULL)), \
           tags text NOT NULL, b BLOB NOT NULL)",
    )
    .await;
    for r in codec_rows() {
        let n = sql::query(
            "INSERT INTO c (id, parent, at, at_opt, nat, day, flag, n, big, r, t, j, jn, tags, b) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        )
        .bind(r.id)
        .bind(r.parent)
        .bind(r.at)
        .bind(r.at_opt)
        .bind(r.nat)
        .bind(r.day)
        .bind(r.flag)
        .bind(r.n)
        .bind(r.big)
        .bind(r.r)
        .bind(&r.t)
        .bind(&r.j)
        .bind(&r.jn)
        .bind(Json(&r.tags.0))
        .bind(&r.b)
        .execute(db)
        .await
        .unwrap()
        .rows_affected();
        assert_eq!(n, 1);
    }
    let got: Vec<CodecRow> = sql::query_as::<_, CodecRow>("SELECT * FROM c ORDER BY big DESC")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(got, codec_rows(), "{:?}", db.dialect());

    // Lookups by every encoded type hit the stored values exactly.
    let r = &codec_rows()[0];
    let hit: i64 = sql::query_scalar(
        "SELECT count(*) FROM c WHERE id = $1 AND parent = $2 AND at = $3 AND nat = $4 \
         AND day = $5 AND flag = $6",
    )
    .bind(r.id)
    .bind(r.parent)
    .bind(r.at)
    .bind(r.nat)
    .bind(r.day)
    .bind(true)
    .fetch_one(db)
    .await
    .unwrap();
    assert_eq!(hit, 1);

    if db.dialect() == Dialect::Sqlite {
        // The stored bytes are Django's formats.
        let raw = sql::query(
            "SELECT id, parent, at, nat, day, flag, typeof(flag) AS tf, j, jn, tags, typeof(b) AS tb \
             FROM c WHERE big = 9000000000",
        )
        .fetch_one(db)
        .await
        .unwrap();
        assert_eq!(
            raw.get::<String, _>("id"),
            "0257cee881f4496891765ac2d144988f"
        );
        assert_eq!(
            raw.get::<String, _>("parent"),
            "0b435f38aa9941e4b069415a708ba205"
        );
        assert_eq!(raw.get::<String, _>("at"), "2026-10-06 06:38:17.128839");
        assert_eq!(raw.get::<String, _>("nat"), "2024-01-15 09:30:00");
        assert_eq!(raw.get::<String, _>("day"), "2024-02-29");
        assert_eq!(raw.get::<i64, _>("flag"), 1);
        assert_eq!(raw.get::<String, _>("tf"), "integer");
        assert_eq!(
            raw.get::<String, _>("j"),
            r#"{"k": [1, 2.5, null, true], "s": "\u00e9\ud83d\ude00", "f": 1e-05}"#
        );
        assert_eq!(raw.get::<String, _>("jn"), "null");
        assert_eq!(raw.get::<String, _>("tags"), r#"["a", "b"]"#);
        assert_eq!(raw.get::<String, _>("tb"), "blob");
        let at_opt: String = sql::query_scalar("SELECT at_opt FROM c WHERE big = -1")
            .fetch_one(db)
            .await
            .unwrap();
        assert_eq!(at_opt, "1999-12-31 23:59:59.000001");
    }
}

#[tokio::test]
async fn codecs_round_trip() {
    both!(codec_body);
}

// ------------------------------------------------------------ query methods

#[derive(Debug, PartialEq, FromRow)]
struct Item {
    id: i64,
    name: String,
    #[sqlx(try_from = "DjUuid")]
    ext: Uuid,
}

async fn items_table(db: &Db) {
    ddl(
        db,
        "CREATE TABLE item (id bigserial PRIMARY KEY, name text NOT NULL, ext uuid NOT NULL, \
           g integer NOT NULL DEFAULT 0)",
        "CREATE TABLE item (id integer NOT NULL PRIMARY KEY AUTOINCREMENT, name text NOT NULL, \
           ext char(32) NOT NULL, g integer NOT NULL DEFAULT 0)",
    )
    .await;
}

fn ext(i: u8) -> Uuid {
    Uuid::from_bytes([i; 16])
}

async fn methods_body(db: &Db) {
    items_table(db).await;
    // query_scalar + RETURNING on both.
    let mut ids = Vec::new();
    for (i, name) in ["a", "b", "c", "d"].iter().enumerate() {
        let id: i64 =
            sql::query_scalar("INSERT INTO item (name, ext, g) VALUES ($1, $2, $3) RETURNING id")
                .bind(*name)
                .bind(ext(i as u8))
                .bind((i % 2) as i32)
                .fetch_one(db)
                .await
                .unwrap();
        ids.push(id);
    }
    assert_eq!(ids, vec![1, 2, 3, 4]);

    // fetch_all / fetch_one / fetch_optional on query_as.
    let all = sql::query_as::<_, Item>("SELECT id, name, ext FROM item ORDER BY id")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(all.len(), 4);
    assert_eq!(
        all[2],
        Item {
            id: 3,
            name: "c".into(),
            ext: ext(2)
        }
    );
    let one: Item = sql::query_as("SELECT id, name, ext FROM item WHERE name = $1")
        .bind("b")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(one.id, 2);
    let none: Option<Item> = sql::query_as("SELECT id, name, ext FROM item WHERE name = $1")
        .bind("zz")
        .fetch_optional(db)
        .await
        .unwrap();
    assert!(none.is_none());
    let missing = sql::query_as::<_, Item>("SELECT id, name, ext FROM item WHERE id = -1")
        .fetch_one(db)
        .await
        .unwrap_err();
    assert!(matches!(missing, sqlx::Error::RowNotFound));

    // Tuples (DjUuid for uuid columns).
    let pairs: Vec<(i64, DjUuid)> =
        sql::query_as("SELECT id, ext FROM item WHERE g = $1 ORDER BY id")
            .bind(1)
            .fetch_all(db)
            .await
            .unwrap();
    assert_eq!(
        pairs.iter().map(|p| p.1.0).collect::<Vec<_>>(),
        vec![ext(1), ext(3)]
    );

    // query_scalar of Uuid / Option / Vec<Uuid> (aggregates).
    let e: Uuid = sql::query_scalar("SELECT ext FROM item WHERE id = $1")
        .bind(2i64)
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(e, ext(1));
    let e: Option<Uuid> = sql::query_scalar("SELECT ext FROM item WHERE id = $1")
        .bind(99i64)
        .fetch_optional(db)
        .await
        .unwrap();
    assert!(e.is_none());
    let agg_sql = match db.dialect() {
        Dialect::Pg => "SELECT array_agg(ext ORDER BY id DESC) FROM item",
        Dialect::Sqlite => "SELECT json_group_array(ext ORDER BY id DESC) FROM item",
    };
    let exts: Vec<Uuid> = sql::query_scalar(agg_sql).fetch_one(db).await.unwrap();
    assert_eq!(exts, vec![ext(3), ext(2), ext(1), ext(0)]);
    let names_sql = match db.dialect() {
        Dialect::Pg => "SELECT array_agg(name ORDER BY name) AS names FROM item",
        Dialect::Sqlite => "SELECT json_group_array(name ORDER BY name) AS names FROM item",
    };
    #[derive(FromRow)]
    struct Agg {
        #[sqlx(try_from = "DjList<String>")]
        names: Vec<String>,
    }
    let agg: Agg = sql::query_as(names_sql).fetch_one(db).await.unwrap();
    assert_eq!(agg.names, vec!["a", "b", "c", "d"]);

    // Untyped rows.
    let rows = sql::query("SELECT id, name, ext, NULL AS nada FROM item ORDER BY id")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(rows[0].get::<i64, _>("id"), 1);
    assert_eq!(rows[0].get::<String, _>(1usize), "a");
    assert_eq!(rows[0].get::<Uuid, _>("ext"), ext(0));
    assert_eq!(rows[0].get::<Option<String>, _>("nada"), None);
    assert!(rows[0].is_null("nada").unwrap());
    let it: Item = rows[3].decode().unwrap();
    assert_eq!(it.name, "d");
    let r = sql::query("SELECT 1 AS x WHERE false")
        .fetch_optional(db)
        .await
        .unwrap();
    assert!(r.is_none());

    // execute -> rows_affected; $N reused and out of order.
    let n = sql::query("UPDATE item SET name = $2 || name || $2 WHERE g = $1 AND name <> $2")
        .bind(0)
        .bind("_")
        .execute(db)
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(n, 2);
    let names: Vec<String> = sql::query_scalar("SELECT name FROM item ORDER BY id")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(names, vec!["_a_", "b", "_c_", "d"]);
    let s: String = sql::query_scalar("SELECT $3 || $1 || $2 || $1")
        .bind("x")
        .bind("y")
        .bind("z")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(s, "zxyx");

    // Streams.
    let streamed: Vec<Item> =
        sql::query_as::<_, Item>("SELECT id, name, ext FROM item ORDER BY id")
            .fetch(db)
            .try_collect()
            .await
            .unwrap();
    assert_eq!(streamed.len(), 4);
    let mut conn = db.acquire_read().await.unwrap();
    let ids: Vec<i64> =
        sql::query_scalar::<_, i64>("SELECT id FROM item WHERE id > $1 ORDER BY id")
            .bind(2i64)
            .fetch(&mut *conn)
            .try_collect()
            .await
            .unwrap();
    assert_eq!(ids, vec![3, 4]);
    drop(conn);

    // Typed NULL binds (Postgres needs the declared type).
    if db.dialect().is_pg() {
        let c: i64 =
            sql::query_scalar("SELECT count(*) FROM item WHERE ($1::bigint IS NULL OR id = $1)")
                .bind(None::<i64>)
                .fetch_one(db)
                .await
                .unwrap();
        assert_eq!(c, 4);
    }
    let c: i64 = sql::query_scalar("SELECT count(*) FROM item WHERE COALESCE($1, id) = id")
        .bind(None::<i64>)
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(c, 4);
}

#[tokio::test]
async fn query_methods() {
    both!(methods_body);
}

// ------------------------------------------------------------ query builder

async fn qb_body(db: &Db) {
    items_table(db).await;
    let rows = vec![("p", ext(10), 1), ("q", ext(11), 2), ("r", ext(12), 1)];
    let mut qb = Qb::new("INSERT INTO item (name, ext, g) ");
    qb.push_values(&rows, |mut b, (name, e, g)| {
        b.push_bind(*name).push_bind(*e).push_bind(*g);
    });
    let n = qb.build().execute(db).await.unwrap().rows_affected();
    assert_eq!(n, 3);

    // separated + sql::any with a dialect fragment.
    let mut qb = Qb::new("SELECT id, name, ext FROM item WHERE ");
    sql::any(&mut qb, "ext", vec![ext(10), ext(12), ext(99)]);
    qb.push(" AND g = ").push_bind(1).push(" ORDER BY ");
    let mut sep = qb.separated(", ");
    sep.push("g").push("id DESC");
    let got: Vec<Item> = qb.build_query_as().fetch_all(db).await.unwrap();
    assert_eq!(
        got.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(),
        vec!["r", "p"]
    );
    assert!(qb.sql().contains("ext = ANY($1)"), "{}", qb.sql());
    assert!(
        qb.sql_for(Dialect::Sqlite)
            .contains("ext IN (SELECT value FROM json_each($1))"),
        "{}",
        qb.sql_for(Dialect::Sqlite)
    );

    // Empty list, integer and text lists, NOT IN.
    let mut qb = Qb::new("SELECT count(*) FROM item WHERE ");
    sql::any(&mut qb, "id", Vec::<i64>::new());
    assert_eq!(
        qb.build_query_scalar::<i64>().fetch_one(db).await.unwrap(),
        0
    );
    let mut qb = Qb::new("SELECT count(*) FROM item WHERE ");
    sql::any(&mut qb, "id", &[1i64, 3][..]);
    qb.push(" OR ");
    sql::any(&mut qb, "name", vec!["q".to_string()]);
    assert_eq!(
        qb.build_query_scalar::<i64>().fetch_one(db).await.unwrap(),
        3
    );
    let mut qb = Qb::new("SELECT count(*) FROM item WHERE ");
    sql::not_any(&mut qb, "g", [1i32]);
    assert_eq!(
        qb.build_query_scalar::<i64>().fetch_one(db).await.unwrap(),
        1
    );

    // String query with an explicit dialect fragment.
    let d = db.dialect();
    let names: Vec<String> = sql::query_scalar(format!(
        "SELECT name FROM item WHERE {} AND {} ORDER BY name",
        sql::any_sql(d, "ext", 1),
        sql::like(d, "name", "$2")
    ))
    .bind(vec![ext(11), ext(12)])
    .bind("%")
    .fetch_all(db)
    .await
    .unwrap();
    assert_eq!(names, vec!["q", "r"]);

    // Ordinality: rows come back in list order.
    let order = vec![ext(12), ext(10), ext(11)];
    let got: Vec<String> = sql::query_scalar(format!(
        "SELECT i.name FROM {} JOIN item i ON i.ext = sel.value ORDER BY sel.ord",
        sql::list_rows(d, 1, "sel")
    ))
    .bind(&order)
    .fetch_all(db)
    .await
    .unwrap();
    assert_eq!(got, vec!["r", "p", "q"]);

    // push_with + push_tuples.
    let mut qb = Qb::new("SELECT count(*) FROM item WHERE (name, g) IN ");
    qb.push_tuples([("p", 1), ("q", 2), ("q", 1)], |mut b, (n, g)| {
        b.push_bind(n).push_bind(g);
    });
    qb.push(" AND ")
        .push_with(|d| sql::json_type_is(d, "'{\"a\":1}'", JsonKind::Object));
    assert_eq!(
        qb.build_query_scalar::<i64>().fetch_one(db).await.unwrap(),
        2
    );
    qb.reset();
    assert_eq!(qb.sql(), "");
}

#[tokio::test]
async fn query_builder_and_lists() {
    both!(qb_body);
}

// ------------------------------------------------------------- transactions

async fn tx_body(db: &Db) {
    items_table(db).await;
    async fn insert<'e>(ex: impl Exec<'e>, name: &str) -> u64 {
        sql::query("INSERT INTO item (name, ext) VALUES ($1, $2)")
            .bind(name)
            .bind(ext(1))
            .execute(ex)
            .await
            .unwrap()
            .rows_affected()
    }
    async fn count(db: &Db) -> i64 {
        sql::query_scalar("SELECT count(*) FROM item")
            .fetch_one(db)
            .await
            .unwrap()
    }

    // Commit: several statements through `&mut *tx` and a helper taking `&mut Conn`.
    let mut tx = db.begin().await.unwrap();
    insert(&mut *tx, "a").await;
    insert(&mut tx, "b").await;
    async fn via_conn(conn: &mut lp_db::db::Conn) -> i64 {
        sql::query_scalar("SELECT count(*) FROM item")
            .fetch_one(&mut *conn)
            .await
            .unwrap()
    }
    assert_eq!(via_conn(&mut tx).await, 2);
    tx.commit().await.unwrap();
    assert_eq!(count(db).await, 2);

    // Rollback, explicit and by drop.
    let mut tx = db.begin().await.unwrap();
    insert(&mut *tx, "c").await;
    tx.rollback().await.unwrap();
    {
        let mut tx = db.begin().await.unwrap();
        insert(&mut *tx, "d").await;
    }
    assert_eq!(count(db).await, 2);

    // now() is fixed within a transaction (Postgres: transaction start;
    // SQLite: the first call), and decodes as DateTime<Utc>.
    let mut tx = db.begin().await.unwrap();
    let a: DateTime<Utc> = sql::query_scalar("SELECT now()")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    let b: DateTime<Utc> = sql::query_scalar("SELECT now()")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(a, b);
    tx.commit().await.unwrap();
    let c: DateTime<Utc> = sql::query_scalar("SELECT now()")
        .fetch_one(db)
        .await
        .unwrap();
    assert!(c > a);
    assert!((Utc::now() - c).num_seconds().abs() < 5);
}

#[tokio::test]
async fn transactions() {
    both!(tx_body);
}

// ---------------------------------------------------------- SQLite specifics

#[tokio::test]
async fn sqlite_routing_and_pragmas() {
    let lite = LiteTestDb::new().await;
    let db = &lite.db;
    items_table(db).await;

    // A reader rejects writes; `&Db` routes the same INSERT to the writer.
    let err = sql::query("INSERT INTO item (name, ext) VALUES ('x', 'y')")
        .execute(db.read())
        .await
        .unwrap_err();
    assert!(err.to_string().contains("readonly"), "{err}");
    sql::query("INSERT INTO item (name, ext) VALUES ('x', 'y')")
        .execute(db)
        .await
        .unwrap();
    // `WITH .. INSERT` and `INSERT .. RETURNING` also go to the writer.
    let id: i64 = sql::query_scalar("WITH v AS (SELECT 'w' AS n) INSERT INTO item (name, ext) SELECT n, 'z' FROM v RETURNING id")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(id, 2);
    let mut r = db.acquire_read().await.unwrap();
    let err = sql::query("DELETE FROM item")
        .execute(&mut *r)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("readonly"), "{err}");
    drop(r);

    assert!(sql::is_read_only("  -- c\n /* x */ select 1"));
    assert!(sql::is_read_only("WITH a AS (SELECT 1) SELECT * FROM a"));
    assert!(sql::is_read_only("SELECT 'INSERT INTO x' AS s"));
    assert!(!sql::is_read_only(
        "WITH a AS (SELECT 1) UPDATE t SET x = 1"
    ));
    assert!(!sql::is_read_only("INSERT INTO t VALUES (1)"));
    assert!(!sql::is_read_only("PRAGMA foreign_keys"));

    // Connection settings.
    let mut w = db.acquire().await.unwrap();
    let jm: String = sql::query_scalar("PRAGMA journal_mode")
        .fetch_one(&mut *w)
        .await
        .unwrap();
    assert_eq!(jm, "wal");
    let fk: i64 = sql::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut *w)
        .await
        .unwrap();
    assert_eq!(fk, 1);
    let sync: i64 = sql::query_scalar("PRAGMA synchronous")
        .fetch_one(&mut *w)
        .await
        .unwrap();
    assert_eq!(sync, 1, "NORMAL");
    let busy: i64 = sql::query_scalar("PRAGMA busy_timeout")
        .fetch_one(&mut *w)
        .await
        .unwrap();
    assert_eq!(busy, 2_000);
    let qo: i64 = sql::query_scalar("PRAGMA query_only")
        .fetch_one(&mut *w)
        .await
        .unwrap();
    assert_eq!(qo, 0);
    drop(w);
    let mut r = db.acquire_read().await.unwrap();
    let qo: i64 = sql::query_scalar("PRAGMA query_only")
        .fetch_one(&mut *r)
        .await
        .unwrap();
    assert_eq!(qo, 1);
    drop(r);

    // The writer transaction is IMMEDIATE: a second writer (another
    // process) gets SQLITE_BUSY while it is open.
    let other = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(lp_db::db::lite::connect_options(&lite.path, 50))
        .await
        .unwrap();
    sqlx::query("SELECT 1").execute(&other).await.unwrap();
    let tx = db.begin().await.unwrap();
    let err = sqlx::query("INSERT INTO item (name, ext) VALUES ('o', 'o')")
        .execute(&other)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    tx.rollback().await.unwrap();
    sqlx::query("INSERT INTO item (name, ext) VALUES ('o', 'o')")
        .execute(&other)
        .await
        .unwrap();
    other.close().await;

    // now(): Django text, from readers and the writer, outside transactions.
    let re = regex::Regex::new(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{6})?$").unwrap();
    for _ in 0..3 {
        let s: String = sql::query_scalar("SELECT now()")
            .fetch_one(db)
            .await
            .unwrap();
        assert!(re.is_match(&s), "{s}");
        let s: String = sql::query_scalar("SELECT now()")
            .fetch_one(&mut *db.acquire().await.unwrap())
            .await
            .unwrap();
        assert!(re.is_match(&s), "{s}");
    }
    // A column defaulted with now() through the writer compares with bound DjDateTimes.
    sql::query("CREATE TABLE ev (at datetime NOT NULL)")
        .execute(db)
        .await
        .unwrap();
    sql::query("INSERT INTO ev VALUES (now())")
        .execute(db)
        .await
        .unwrap();
    let n: i64 = sql::query_scalar("SELECT count(*) FROM ev WHERE at < $1 AND at > $2")
        .bind(Utc::now() + chrono::Duration::seconds(5))
        .bind(Utc::now() - chrono::Duration::seconds(60))
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(n, 1);
    lite.cleanup().await;
}

#[tokio::test]
async fn dialect_helpers_run() {
    async fn body(db: &Db) {
        let d = db.dialect();
        let day: NaiveDate = sql::query_scalar(format!("SELECT {}", sql::date_of(d, "$1")))
            .bind(ts(2024, 3, 1, 23, 59, 0, 5))
            .fetch_one(db)
            .await
            .unwrap();
        assert_eq!(day, NaiveDate::from_ymd_opt(2024, 3, 1).unwrap());
        let m: String = sql::query_scalar(format!("SELECT {}", sql::month_of(d, "$1")))
            .bind(ts(2024, 3, 1, 0, 0, 0, 0))
            .fetch_one(db)
            .await
            .unwrap();
        assert_eq!(m, "2024-03");
        let json_expr = match d {
            Dialect::Pg => "$1::jsonb",
            Dialect::Sqlite => "$1",
        };
        for (v, kind) in [
            (json!({"a": 1}), JsonKind::Object),
            (json!([1]), JsonKind::Array),
            (json!("s"), JsonKind::String),
            (json!(1.5), JsonKind::Number),
            (json!(2), JsonKind::Number),
            (json!(false), JsonKind::Bool),
            (Value::Null, JsonKind::Null),
        ] {
            let ok: bool =
                sql::query_scalar(format!("SELECT {}", sql::json_type_is(d, json_expr, kind)))
                    .bind(&v)
                    .fetch_one(db)
                    .await
                    .unwrap();
            assert!(ok, "{v} is {kind:?} on {d:?}");
        }
        // like / ilike with Django's escaping.
        let hits: bool = sql::query_scalar(format!(
            "SELECT {} AND NOT {} AND {}",
            sql::like(d, "'100%_done'", "$1"),
            sql::like(d, "'100x_done'", "$1"),
            sql::ilike(d, "'ABC'", "$2"),
        ))
        .bind("100\\%\\_%")
        .bind("%b%")
        .fetch_one(db)
        .await
        .unwrap();
        assert!(hits);
        assert_eq!(
            sql::for_update(d),
            if d.is_pg() { " FOR UPDATE" } else { "" }
        );
    }
    both!(body);
}

// ---------------------------------------------------------------- formats

#[test]
fn py_json_matches_python() {
    // Expected strings from CPython 3.11 `json.dumps`.
    let cases = [
        (
            json!({"a": 1, "b": [1.5, 2, null], "c": "x"}),
            r#"{"a": 1, "b": [1.5, 2, null], "c": "x"}"#,
        ),
        (
            json!([0.1, 1e-5, 1e16, 123456789.0, -0.0, 1.0, 3.14e-10]),
            "[0.1, 1e-05, 1e+16, 123456789.0, -0.0, 1.0, 3.14e-10]",
        ),
        (
            json!("é\u{7f}\n\t\"\\/😀\u{1}"),
            r#""\u00e9\u007f\n\t\"\\/\ud83d\ude00\u0001""#,
        ),
        (json!({}), "{}"),
        (json!([]), "[]"),
        (json!(true), "true"),
        (json!(u64::MAX), "18446744073709551615"),
    ];
    for (v, want) in cases {
        assert_eq!(py_json_dumps(&v), want);
        assert_eq!(PyJson(&v).to_string(), want);
    }
}

#[test]
fn dj_datetime_text() {
    assert_eq!(
        DjDateTime(ts(2024, 1, 15, 9, 30, 0, 0)).to_string(),
        "2024-01-15 09:30:00"
    );
    assert_eq!(
        DjDateTime(ts(2024, 1, 15, 9, 30, 0, 123)).to_string(),
        "2024-01-15 09:30:00.000123"
    );
    let nanos = ts(2024, 1, 15, 9, 30, 0, 0) + chrono::Duration::nanoseconds(1_999);
    assert_eq!(DjDateTime(nanos).to_string(), "2024-01-15 09:30:00.000001");
    for s in [
        "2024-01-15 09:30:00.000123",
        "2024-01-15T09:30:00.000123",
        "2024-01-15T09:30:00.000123+00:00",
        "2024-01-15 09:30:00.000123+00",
        "2024-01-15T10:30:00.000123+01:00",
    ] {
        assert_eq!(
            DjDateTime::parse(s).unwrap().0,
            ts(2024, 1, 15, 9, 30, 0, 123),
            "{s}"
        );
    }
    assert!(DjDateTime::parse("yesterday").is_err());
}

#[test]
fn list_args_json() {
    use lp_db::db::IntoArg;
    let Arg::List(l) = vec![ext(1)].into_arg() else {
        panic!()
    };
    assert_eq!(l.to_json_text(), format!("[\"{}\"]", ext(1).simple()));
    let Arg::List(l) = vec![1i64, -2].into_arg() else {
        panic!()
    };
    assert_eq!(l.to_json_text(), "[1,-2]");
    let Arg::List(l) = vec!["a\"b"].into_arg() else {
        panic!()
    };
    assert_eq!(l.to_json_text(), r#"["a\"b"]"#);
    assert_eq!(None::<Uuid>.into_arg(), Arg::Null(lp_db::db::Kind::Uuid));
    assert_eq!((&Some(3i32)).into_arg(), Arg::I32(3));
}

#[test]
fn settings_from_env() {
    let env = |pairs: &'static [(&'static str, &'static str)]| {
        move |k: &str| {
            pairs
                .iter()
                .find(|(n, _)| *n == k)
                .map(|(_, v)| (*v).to_owned())
        }
    };
    let s = DbSettings::from_lookup(env(&[("BASE_DATA", "/data")])).unwrap();
    assert_eq!(s.backend, Backend::Postgres);
    assert_eq!(
        s.sqlite_path,
        std::path::Path::new("/data")
            .join("db")
            .join("librephotos.sqlite3")
    );
    assert_eq!(s.busy_ms, 10_000);
    let s = DbSettings::from_lookup(env(&[
        ("DB_BACKEND", "sqlite"),
        ("LP_SQLITE_PATH", "/x/y.db"),
        ("LP_SQLITE_BUSY_MS", "250"),
        ("LP_DB_POOL", "3"),
    ]))
    .unwrap();
    assert_eq!(
        (
            s.backend,
            s.sqlite_path.to_str().unwrap(),
            s.busy_ms,
            s.readers
        ),
        (Backend::Sqlite, "/x/y.db", 250, 3)
    );
    assert!(DbSettings::from_lookup(env(&[("DB_BACKEND", "mysql")])).is_err());
}

// ------------------------------------------------------- Django's fixture

const FIXTURE: &str = r"C:\Users\Niaz\librephotos\rust-pg\fixture-sqlite\lp_fixture.sqlite3";

/// Opens a copy of the Django-built SQLite fixture (never the original).
async fn fixture_copy() -> Option<LiteTestDb> {
    let src = std::env::var("LP_SQLITE_FIXTURE").unwrap_or_else(|_| FIXTURE.to_owned());
    if !std::path::Path::new(&src).exists() {
        eprintln!("skipping: no SQLite fixture at {src}");
        return None;
    }
    let dir = tempfile::tempdir().unwrap();
    let dst = dir.path().join("lp_fixture.sqlite3");
    std::fs::copy(&src, &dst).unwrap();
    Some(LiteTestDb::open(dst, dir).await)
}

#[derive(Debug, FromRow)]
struct FxPhoto {
    #[sqlx(try_from = "DjUuid")]
    id: Uuid,
    image_hash: String,
    added_on: DateTime<Utc>,
    exif_timestamp: Option<DateTime<Utc>>,
    last_modified: DateTime<Utc>,
    hidden: bool,
    in_trashcan: bool,
    rating: i32,
    size: i64,
    owner_id: i32,
    exif_gps_lat: Option<f64>,
    video_length: Option<String>,
    exif_json: Option<Value>,
    clip_embeddings: Option<Value>,
}

#[derive(Debug, FromRow)]
struct FxUser {
    id: i32,
    username: String,
    date_joined: DateTime<Utc>,
    last_login: Option<DateTime<Utc>>,
    is_superuser: bool,
    confidence: f64,
    favorite_min_rating: i32,
    llm_settings: Value,
    datetime_rules: Value,
    nextcloud_app_password: Option<Vec<u8>>,
}

#[derive(Debug, FromRow)]
struct FxJob {
    id: i64,
    job_type: i32,
    finished: bool,
    failed: bool,
    #[sqlx(try_from = "DjUuid")]
    job_id: Uuid,
    queued_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    started_by_id: Option<i32>,
    progress_current: i64,
    result: Option<Value>,
}

#[tokio::test]
async fn django_fixture_rows() {
    let Some(fx) = fixture_copy().await else {
        return;
    };
    let db = &fx.db;

    let photos: Vec<FxPhoto> = sql::query_as(
        "SELECT id, image_hash, added_on, exif_timestamp, last_modified, hidden, in_trashcan, rating, \
           size, owner_id, exif_gps_lat, video_length, exif_json, clip_embeddings \
         FROM api_photo ORDER BY id",
    )
    .fetch_all(db)
    .await
    .unwrap();
    assert!(photos.len() >= 10, "{}", photos.len());
    let p = &photos[0];
    assert!(p.size > 0 && p.owner_id > 0 && !p.image_hash.is_empty());
    assert!(p.rating >= 0 && p.added_on.timestamp() > 1_700_000_000);
    assert!(photos.iter().all(|p| !p.hidden && !p.in_trashcan) || photos.len() > 1);
    let _ = (
        &p.exif_gps_lat,
        &p.video_length,
        &p.exif_json,
        &p.clip_embeddings,
    );

    // Re-encoding a decoded row matches Django's stored text exactly.
    for p in photos.iter().take(10) {
        let n: i64 = sql::query_scalar(
            "SELECT count(*) FROM api_photo WHERE id = $1 AND added_on = $2 AND last_modified = $3 \
             AND exif_timestamp IS $4",
        )
        .bind(p.id)
        .bind(p.added_on)
        .bind(p.last_modified)
        .bind(p.exif_timestamp)
        .fetch_one(db)
        .await
        .unwrap();
        assert_eq!(n, 1, "{p:?}");
    }
    // Lists of ids bind as JSON for json_each.
    let ids: Vec<Uuid> = photos.iter().map(|p| p.id).take(5).collect();
    let mut qb = Qb::new("SELECT count(*) FROM api_photo WHERE ");
    sql::any(&mut qb, "id", &ids);
    assert_eq!(
        qb.build_query_scalar::<i64>().fetch_one(db).await.unwrap(),
        5
    );

    let users: Vec<FxUser> = sql::query_as(
        "SELECT id, username, date_joined, last_login, is_superuser, confidence, favorite_min_rating, \
           llm_settings, datetime_rules, nextcloud_app_password FROM api_user ORDER BY id",
    )
    .fetch_all(db)
    .await
    .unwrap();
    let admin = &users[0];
    assert_eq!(
        (admin.id, admin.username.as_str(), admin.is_superuser),
        (1, "admin", true)
    );
    assert!(users.iter().skip(1).any(|u| !u.is_superuser));
    assert!(admin.confidence > 0.0 && admin.favorite_min_rating >= 0);
    assert!(admin.date_joined.timestamp() > 1_700_000_000 && admin.last_login.is_none());
    assert!(admin.llm_settings.is_object());
    // A double-encoded JSONField (`json.dumps` of a JSON string) stays a string.
    assert!(admin.datetime_rules.is_string(), "{}", admin.datetime_rules);
    let _ = &admin.nextcloud_app_password;
    // PyJson reproduces Django's JSONField bytes.
    for u in &users {
        let stored: String = sql::query_scalar("SELECT llm_settings FROM api_user WHERE id = $1")
            .bind(u.id)
            .fetch_one(db)
            .await
            .unwrap();
        assert_eq!(py_json_dumps(&u.llm_settings), stored);
        let stored: String = sql::query_scalar("SELECT datetime_rules FROM api_user WHERE id = $1")
            .bind(u.id)
            .fetch_one(db)
            .await
            .unwrap();
        assert_eq!(py_json_dumps(&u.datetime_rules), stored);
    }

    let jobs: Vec<FxJob> = sql::query_as(
        "SELECT id, job_type, finished, failed, job_id, queued_at, started_at, started_by_id, \
           progress_current, result FROM api_longrunningjob ORDER BY id",
    )
    .fetch_all(db)
    .await
    .unwrap();
    assert!(!jobs.is_empty() && jobs.windows(2).all(|w| w[0].id < w[1].id));
    let j = &jobs[0];
    assert!(j.finished && !j.failed && j.job_type > 0 && j.started_at.unwrap() >= j.queued_at);
    assert!(j.started_by_id.is_some() && j.progress_current >= 0);
    assert_eq!(j.result, Some(json!({})));
    // job_id is a dashed varchar(36): DjUuid reads it, and `.hyphenated()` finds it again.
    let n: i64 = sql::query_scalar("SELECT count(*) FROM api_longrunningjob WHERE job_id = $1")
        .bind(j.job_id.hyphenated().to_string())
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(n, 1);

    // A write through the writer, read back through a reader.
    let mut tx = db.begin().await.unwrap();
    let changed = sql::query("UPDATE api_user SET last_login = now() WHERE id = $1")
        .bind(admin.id)
        .execute(&mut *tx)
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(changed, 1);
    tx.commit().await.unwrap();
    let ll: Option<DateTime<Utc>> =
        sql::query_scalar("SELECT last_login FROM api_user WHERE id = $1")
            .bind(admin.id)
            .fetch_one(db.read())
            .await
            .unwrap();
    assert!(ll.is_some());
    fx.cleanup().await;
}

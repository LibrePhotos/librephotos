# `lp_db::db`: one SQL, two drivers

The same query runs on Postgres and on the SQLite file Django's SQLite mode
writes (`DB_BACKEND=sqlite`). Design: `rust-pg/workflows/sqlite_design.md`
(§2 architecture, §3 concurrency, §9 P0 results).

## Writing a query

```rust
use lp_db::db::{Db, DjUuid, DjUuidOpt, Exec, Qb, sql};

#[derive(sqlx::FromRow)]
struct PhotoRow {
    #[sqlx(try_from = "DjUuid")] id: Uuid,            // uuid / char(32)
    #[sqlx(try_from = "DjUuidOpt")] stack: Option<Uuid>,
    added_on: DateTime<Utc>,                             // plain chrono decodes on both
    hidden: bool,
}

let rows: Vec<PhotoRow> = sql::query_as::<_, PhotoRow>(
    "SELECT id, stack_id AS stack, added_on, hidden FROM api_photo WHERE owner_id = $1 AND added_on > $2",
)
.bind(user_id)
.bind(cutoff)                 // DateTime<Utc> -> timestamptz / 'YYYY-MM-DD HH:MM:SS[.ffffff]'
.fetch_all(db)                // &Db, db.read(), &mut *tx, &mut *conn
.await?;

let mut tx = db.begin().await?;                       // SQLite: the writer, BEGIN IMMEDIATE
sql::query("UPDATE api_photo SET hidden = $2, last_modified = now() WHERE id = $1")
    .bind(id).bind(true).execute(&mut *tx).await?.rows_affected();
tx.commit().await?;
```

- Placeholders are `$N` on both (reuse and any order are fine).
- `.bind()` takes [`IntoArg`]: scalars, `&str`, `&T`, `Option<T>` (typed NULL),
  `Uuid`, chrono, `Value` / `Json<T>`, `Vec<T>` / `&[T]` lists. SQLite gets
  Django's formats: `char(32)` hex UUIDs, `YYYY-MM-DD HH:MM:SS[.ffffff]`,
  `json.dumps` text, 0/1, JSON arrays for lists.
- Rows: any `#[derive(FromRow)]` struct. `Uuid` fields need
  `#[sqlx(try_from = "DjUuid")]` (`DjUuidOpt` for `Option<Uuid>`, `DjList<T>`
  for aggregated lists). In tuples write `DjUuid` instead of `Uuid`.
  `query_scalar::<_, Uuid>` and `row.get::<Uuid, _>` work as is (`Scalar`).
- Dynamic SQL: `Qb` (= `QueryBuilder`): `push`, `push_bind`, `separated`,
  `push_values`, `push_tuples`, `build`, `build_query_as`, `build_query_scalar`.
- Functions generic over the executor: `async fn f<'e>(ex: impl Exec<'e>)`
  (was `impl PgExecutor<'e>`); several statements: `conn: &mut Conn` and
  `&mut *conn` per statement (was `&mut PgConnection`).

## Portable SQL subset

Works unchanged on both: `SELECT/INSERT/UPDATE/DELETE`, joins, subqueries,
`EXISTS`, `IN (SELECT ..)`, CTEs (read-only bodies), `RETURNING`,
`UPDATE .. FROM`, `ON CONFLICT (cols) DO UPDATE/NOTHING`, window functions
(`ROW_NUMBER() OVER (PARTITION BY ..)`), `count(*) FILTER (WHERE ..)`,
`COALESCE`, `CASE`, `lower/upper`, `length`, `substr`, `->` / `->>` on JSON,
`now()` (a registered function on SQLite), row values, `IS NULL`.

Rules that keep it portable:

- Lists: `sql::any(&mut qb, "p.id", &ids)` or `sql::any_sql(d, "p.id", n)`,
  never `= ANY($n)` by hand. Ordered id lists: `sql::list_rows(d, n, "sel")`
  (`sel.value`, `sel.ord`).
- No casts (`::uuid`, `::text[]`, `::jsonb`, `::date`): the bound type decides.
  Dates: `sql::date_of(d, col)`, `sql::month_of(d, col)`.
- `LIKE` always via `sql::like` / `sql::ilike` (adds `ESCAPE '\'`; SQLite has
  no default escape character). `ilike` = Django `icontains` per backend.
- `FOR UPDATE`: `sql::for_update(d)` / `for_update_of(d, t)` (empty on SQLite,
  where the IMMEDIATE transaction already holds the write lock).
- JSON type tests: `sql::json_type_is(d, expr, JsonKind::..)`.
- Intervals: compute the cutoff in Rust and bind a `DateTime<Utc>`.
- Float literals in expressions decoded as `f64` (`COALESCE(x, 0.0)`): SQLite
  decodes by storage class and an INTEGER does not decode into `f64`.
- `INSERT .. SELECT .. ON CONFLICT` needs `WHERE true` before `ON CONFLICT`.
- `ON CONFLICT (cols)`, never `ON CONFLICT ON CONSTRAINT name`.
- `DISTINCT ON` → `ROW_NUMBER() OVER (PARTITION BY ..) = 1` (on both).
- `GREATEST/LEAST` → `max(a, b)` / `min(a, b)` is SQLite only: branch, or
  `CASE WHEN`.
- Empty aggregates: `array_agg` over no rows is NULL, `json_group_array` is
  `'[]'`; decode `Option<DjList<T>>` or `COALESCE`.
- Column aliases must not be SQLite keywords (`nothing`, `action`, ..).

## When to branch on the dialect

Branch (`match db.dialect() { Dialect::Pg => .., Dialect::Sqlite => .. }`,
both arms next to each other) only when no helper covers it:
`LATERAL`, DML inside a CTE (`WITH x AS (DELETE .. RETURNING)`: split into
statements in one transaction), `DELETE .. USING`, `jsonb_set`
(`json_set(x, '$.k', json(v))`), `array_agg` vs `json_group_array`,
`unnest` of several arrays (chunked `push_values` on SQLite), full-text
search, `to_regclass` (`sqlite_master`), `pg_notify` / `LISTEN`,
`pg_advisory_xact_lock` (a no-op on SQLite: single writer), `make_interval`.

## Concurrency (SQLite)

- `&Db` sends statements that cannot write (`sql::is_read_only`) to a
  `query_only` reader and everything else to the single writer.
- `db.begin()` and `db.acquire()` hold the single writer. While holding it,
  never write through `&Db` or call `db.begin()` again in the same task: it
  waits for itself. Long reads and streams: `db.acquire_read()` / `db.read()`.
- Keep write transactions short (< 100 ms; Django gives up after 5 s) and do
  no file, ML or HTTP work inside them.
- `now()` returns Django's text; fixed within a transaction, per call in
  autocommit. Other SQLite clients (DDL defaults, triggers) use
  `sql::NOW_SQLITE_BUILTIN`.

## Lint list (design §2)

`tests/dialect_lint.rs` (P2) rejects these in SQL literals outside a
`Dialect::Pg` arm: `::uuid`, `ANY(`, `ILIKE`, `jsonb`, `LATERAL`,
`DISTINCT ON`, `make_interval`, `FOR UPDATE`, `unnest`. Worth adding:
`::` casts in general, `interval '`, `GREATEST(`, `LEAST(`, `ON CONSTRAINT`,
`USING (` after `DELETE`, `pg_`, `to_regclass`, `AT TIME ZONE`, and a `LIKE`
without `ESCAPE`.

//! Queries: [`Q`] (`sqlx::query`), [`QueryAs`] (`sqlx::query_as`),
//! [`QueryScalar`] (`sqlx::query_scalar`), untyped [`Row`]s and the
//! [`Scalar`] decode trait.

use std::borrow::Cow;
use std::fmt;
use std::marker::PhantomData;

use futures::stream::BoxStream;
use futures::{StreamExt, TryStreamExt};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sqlx::postgres::{PgArguments, PgHasArrayType, PgRow};
use sqlx::sqlite::{SqliteArguments, SqliteRow};
use sqlx::types::Json;
use sqlx::{
    ColumnIndex, Decode, Executor, FromRow, Postgres, Row as _, Sqlite, SqlitePool, Type, ValueRef,
};
use uuid::Uuid;

use super::arg::{Arg, IntoArg, ListElem};
use super::codec::{DjDateTime, DjList, DjUuid, DjUuidOpt};
use super::exec::{Dialect, Exec, Lite, Target};
use super::sql::is_read_only;

/// SQL text: one string for both dialects, or one per dialect when a
/// [`Qb`](super::Qb) pushed dialect fragments.
#[derive(Debug, Clone)]
pub(crate) enum SqlText<'q> {
    One(Cow<'q, str>),
    Two {
        pg: Cow<'q, str>,
        lite: Cow<'q, str>,
    },
}

impl SqlText<'_> {
    pub(crate) fn get(&self, d: Dialect) -> &str {
        match (self, d) {
            (SqlText::One(s), _) => s,
            (SqlText::Two { pg, .. }, Dialect::Pg) => pg,
            (SqlText::Two { lite, .. }, Dialect::Sqlite) => lite,
        }
    }
}

/// Rows decodable on both drivers: every `#[derive(FromRow)]` struct (the
/// derive is generic over the row type) and tuples of sqlx-decodable types.
///
/// Tuples containing `Uuid` compile but fail on SQLite (sqlx-sqlite decodes a
/// UUID from a 16-byte BLOB); use `DjUuid` in tuples, or [`query_scalar`].
pub trait FromDbRow:
    for<'r> FromRow<'r, PgRow> + for<'r> FromRow<'r, SqliteRow> + Send + Unpin
{
}

impl<T> FromDbRow for T where
    T: for<'r> FromRow<'r, PgRow> + for<'r> FromRow<'r, SqliteRow> + Send + Unpin
{
}

/// Result of [`Q::execute`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct QueryResult {
    rows_affected: u64,
    last_insert_id: Option<i64>,
}

impl QueryResult {
    pub fn rows_affected(&self) -> u64 {
        self.rows_affected
    }
    /// SQLite `last_insert_rowid()`; `None` on Postgres (use `RETURNING`).
    pub fn last_insert_id(&self) -> Option<i64> {
        self.last_insert_id
    }
}

// ------------------------------------------------------------------ rows

/// Column index accepted by [`Row::get`]: a name or a position.
pub trait RowIndex: ColumnIndex<PgRow> + ColumnIndex<SqliteRow> + Copy + fmt::Debug {}
impl RowIndex for usize {}
impl RowIndex for &str {}

/// A row of either driver (`sqlx::query(..).fetch_*` result).
pub enum Row {
    Pg(PgRow),
    Lite(SqliteRow),
}

impl fmt::Debug for Row {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Row::Pg(r) => f.debug_tuple("Row::Pg").field(r).finish(),
            Row::Lite(r) => write!(f, "Row::Lite({} columns)", r.len()),
        }
    }
}

impl Row {
    pub fn try_get<T: Scalar, I: RowIndex>(&self, index: I) -> sqlx::Result<T> {
        match self {
            Row::Pg(r) => T::from_pg(r, index),
            Row::Lite(r) => T::from_lite(r, index),
        }
    }

    /// Like `sqlx::Row::get`: panics on a missing column or a decode error.
    #[track_caller]
    pub fn get<T: Scalar, I: RowIndex>(&self, index: I) -> T {
        self.try_get(index)
            .unwrap_or_else(|e| panic!("Row::get({index:?}): {e}"))
    }

    pub fn is_null<I: RowIndex>(&self, index: I) -> sqlx::Result<bool> {
        Ok(match self {
            Row::Pg(r) => r.try_get_raw(index)?.is_null(),
            Row::Lite(r) => r.try_get_raw(index)?.is_null(),
        })
    }

    pub fn len(&self) -> usize {
        match self {
            Row::Pg(r) => r.len(),
            Row::Lite(r) => r.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Decodes the whole row into a `FromRow` type.
    pub fn decode<T: FromDbRow>(&self) -> sqlx::Result<T> {
        match self {
            Row::Pg(r) => T::from_row(r),
            Row::Lite(r) => T::from_row(r),
        }
    }
}

/// One column value decodable on both drivers (`query_scalar`, [`Row::get`]).
/// `Uuid` goes through [`DjUuid`], `Vec<T>` through [`DjList`].
pub trait Scalar: Sized + Send + Unpin {
    fn from_pg<I: RowIndex>(row: &PgRow, index: I) -> sqlx::Result<Self>;
    fn from_lite<I: RowIndex>(row: &SqliteRow, index: I) -> sqlx::Result<Self>;
}

macro_rules! native_scalar {
    ($($t:ty),* $(,)?) => {$(
        impl Scalar for $t {
            fn from_pg<I: RowIndex>(row: &PgRow, index: I) -> sqlx::Result<Self> {
                row.try_get(index)
            }
            fn from_lite<I: RowIndex>(row: &SqliteRow, index: I) -> sqlx::Result<Self> {
                row.try_get(index)
            }
        }
    )*};
}

native_scalar!(
    bool,
    i16,
    i32,
    i64,
    f32,
    f64,
    String,
    Value,
    Vec<u8>,
    chrono::DateTime<chrono::Utc>,
    chrono::NaiveDateTime,
    chrono::NaiveDate,
    DjUuid,
    DjUuidOpt,
    DjDateTime,
);

impl Scalar for Uuid {
    fn from_pg<I: RowIndex>(row: &PgRow, index: I) -> sqlx::Result<Self> {
        row.try_get(index)
    }
    fn from_lite<I: RowIndex>(row: &SqliteRow, index: I) -> sqlx::Result<Self> {
        row.try_get::<DjUuid, _>(index).map(|u| u.0)
    }
}

impl<T: DeserializeOwned + Send + Unpin> Scalar for Json<T> {
    fn from_pg<I: RowIndex>(row: &PgRow, index: I) -> sqlx::Result<Self> {
        row.try_get(index)
    }
    fn from_lite<I: RowIndex>(row: &SqliteRow, index: I) -> sqlx::Result<Self> {
        row.try_get(index)
    }
}

impl<T> Scalar for DjList<T>
where
    T: ListElem + PgHasArrayType + for<'a> Decode<'a, Postgres> + Type<Postgres>,
{
    fn from_pg<I: RowIndex>(row: &PgRow, index: I) -> sqlx::Result<Self> {
        row.try_get(index)
    }
    fn from_lite<I: RowIndex>(row: &SqliteRow, index: I) -> sqlx::Result<Self> {
        row.try_get(index)
    }
}

impl<T> Scalar for Vec<T>
where
    T: ListElem + PgHasArrayType + for<'a> Decode<'a, Postgres> + Type<Postgres>,
{
    fn from_pg<I: RowIndex>(row: &PgRow, index: I) -> sqlx::Result<Self> {
        row.try_get::<DjList<T>, _>(index).map(|l| l.0)
    }
    fn from_lite<I: RowIndex>(row: &SqliteRow, index: I) -> sqlx::Result<Self> {
        row.try_get::<DjList<T>, _>(index).map(|l| l.0)
    }
}

impl<T: Scalar> Scalar for Option<T> {
    fn from_pg<I: RowIndex>(row: &PgRow, index: I) -> sqlx::Result<Self> {
        if row.try_get_raw(index)?.is_null() {
            return Ok(None);
        }
        T::from_pg(row, index).map(Some)
    }
    fn from_lite<I: RowIndex>(row: &SqliteRow, index: I) -> sqlx::Result<Self> {
        if row.try_get_raw(index)?.is_null() {
            return Ok(None);
        }
        T::from_lite(row, index).map(Some)
    }
}

// --------------------------------------------------------------- running

#[derive(Debug, Clone, Copy)]
enum Mode {
    All,
    One,
    Optional,
}

fn pg_args(args: Vec<Arg>) -> sqlx::Result<PgArguments> {
    let mut a = PgArguments::default();
    for x in args {
        x.add_pg(&mut a).map_err(sqlx::Error::Encode)?;
    }
    Ok(a)
}

fn lite_args(args: Vec<Arg>) -> sqlx::Result<SqliteArguments<'static>> {
    let mut a = SqliteArguments::default();
    for x in args {
        x.add_lite(&mut a).map_err(sqlx::Error::Encode)?;
    }
    Ok(a)
}

fn lite_pool<'a>(lite: &'a Lite, read_only: bool, sql: &str) -> &'a SqlitePool {
    if read_only || is_read_only(sql) {
        &lite.read
    } else {
        &lite.write
    }
}

async fn pg_as<'c, T, E>(
    e: E,
    sql: &str,
    args: PgArguments,
    persistent: bool,
    mode: Mode,
) -> sqlx::Result<Vec<T>>
where
    T: FromDbRow,
    E: Executor<'c, Database = Postgres>,
{
    let q = sqlx::query_as_with::<Postgres, T, _>(sql, args).persistent(persistent);
    match mode {
        Mode::All => q.fetch_all(e).await,
        Mode::One => Ok(vec![q.fetch_one(e).await?]),
        Mode::Optional => Ok(q.fetch_optional(e).await?.into_iter().collect()),
    }
}

async fn lite_as<'c, T, E>(
    e: E,
    sql: &str,
    args: SqliteArguments<'static>,
    persistent: bool,
    mode: Mode,
) -> sqlx::Result<Vec<T>>
where
    T: FromDbRow,
    E: Executor<'c, Database = Sqlite>,
{
    let q = sqlx::query_as_with::<Sqlite, T, _>(sql, args).persistent(persistent);
    match mode {
        Mode::All => q.fetch_all(e).await,
        Mode::One => Ok(vec![q.fetch_one(e).await?]),
        Mode::Optional => Ok(q.fetch_optional(e).await?.into_iter().collect()),
    }
}

async fn pg_rows<'c, E>(
    e: E,
    sql: &str,
    args: PgArguments,
    persistent: bool,
    mode: Mode,
) -> sqlx::Result<Vec<Row>>
where
    E: Executor<'c, Database = Postgres>,
{
    let q = sqlx::query_with::<Postgres, _>(sql, args).persistent(persistent);
    Ok(match mode {
        Mode::All => q.fetch_all(e).await?.into_iter().map(Row::Pg).collect(),
        Mode::One => vec![Row::Pg(q.fetch_one(e).await?)],
        Mode::Optional => q
            .fetch_optional(e)
            .await?
            .into_iter()
            .map(Row::Pg)
            .collect(),
    })
}

async fn lite_rows<'c, E>(
    e: E,
    sql: &str,
    args: SqliteArguments<'static>,
    persistent: bool,
    mode: Mode,
) -> sqlx::Result<Vec<Row>>
where
    E: Executor<'c, Database = Sqlite>,
{
    let q = sqlx::query_with::<Sqlite, _>(sql, args).persistent(persistent);
    Ok(match mode {
        Mode::All => q.fetch_all(e).await?.into_iter().map(Row::Lite).collect(),
        Mode::One => vec![Row::Lite(q.fetch_one(e).await?)],
        Mode::Optional => q
            .fetch_optional(e)
            .await?
            .into_iter()
            .map(Row::Lite)
            .collect(),
    })
}

async fn run_as<T: FromDbRow>(
    t: Target<'_>,
    sql: &SqlText<'_>,
    args: Vec<Arg>,
    persistent: bool,
    mode: Mode,
) -> sqlx::Result<Vec<T>> {
    let s = sql.get(t.dialect());
    match t {
        Target::PgPool(p) => pg_as(p, s, pg_args(args)?, persistent, mode).await,
        Target::PgConn(c) => pg_as(c, s, pg_args(args)?, persistent, mode).await,
        Target::LitePool { lite, read_only } => {
            lite_as(
                lite_pool(lite, read_only, s),
                s,
                lite_args(args)?,
                persistent,
                mode,
            )
            .await
        }
        Target::LiteConn(c) => lite_as(c, s, lite_args(args)?, persistent, mode).await,
    }
}

async fn run_rows(
    t: Target<'_>,
    sql: &SqlText<'_>,
    args: Vec<Arg>,
    persistent: bool,
    mode: Mode,
) -> sqlx::Result<Vec<Row>> {
    let s = sql.get(t.dialect());
    match t {
        Target::PgPool(p) => pg_rows(p, s, pg_args(args)?, persistent, mode).await,
        Target::PgConn(c) => pg_rows(c, s, pg_args(args)?, persistent, mode).await,
        Target::LitePool { lite, read_only } => {
            lite_rows(
                lite_pool(lite, read_only, s),
                s,
                lite_args(args)?,
                persistent,
                mode,
            )
            .await
        }
        Target::LiteConn(c) => lite_rows(c, s, lite_args(args)?, persistent, mode).await,
    }
}

async fn run_execute(
    t: Target<'_>,
    sql: &SqlText<'_>,
    args: Vec<Arg>,
    persistent: bool,
) -> sqlx::Result<QueryResult> {
    let s = sql.get(t.dialect());
    match t {
        Target::PgPool(p) => {
            let r = sqlx::query_with(s, pg_args(args)?)
                .persistent(persistent)
                .execute(p)
                .await?;
            Ok(QueryResult {
                rows_affected: r.rows_affected(),
                last_insert_id: None,
            })
        }
        Target::PgConn(c) => {
            let r = sqlx::query_with(s, pg_args(args)?)
                .persistent(persistent)
                .execute(c)
                .await?;
            Ok(QueryResult {
                rows_affected: r.rows_affected(),
                last_insert_id: None,
            })
        }
        Target::LitePool { lite, read_only } => {
            let pool = lite_pool(lite, read_only, s);
            let r = sqlx::query_with(s, lite_args(args)?)
                .persistent(persistent)
                .execute(pool)
                .await?;
            Ok(QueryResult {
                rows_affected: r.rows_affected(),
                last_insert_id: Some(r.last_insert_rowid()),
            })
        }
        Target::LiteConn(c) => {
            let r = sqlx::query_with(s, lite_args(args)?)
                .persistent(persistent)
                .execute(c)
                .await?;
            Ok(QueryResult {
                rows_affected: r.rows_affected(),
                last_insert_id: Some(r.last_insert_rowid()),
            })
        }
    }
}

fn stream_as<'e, T: FromDbRow + 'e>(
    t: Target<'e>,
    sql: SqlText<'e>,
    args: Vec<Arg>,
    persistent: bool,
) -> BoxStream<'e, sqlx::Result<T>> {
    Box::pin(async_stream::try_stream! {
        let s = sql.get(t.dialect()).to_owned();
        match t {
            Target::PgPool(p) => {
                let mut rows = sqlx::query_as_with::<Postgres, T, _>(&s, pg_args(args)?)
                    .persistent(persistent)
                    .fetch(p);
                while let Some(r) = rows.try_next().await? {
                    yield r;
                }
            }
            Target::PgConn(c) => {
                let mut rows = sqlx::query_as_with::<Postgres, T, _>(&s, pg_args(args)?)
                    .persistent(persistent)
                    .fetch(c);
                while let Some(r) = rows.try_next().await? {
                    yield r;
                }
            }
            Target::LitePool { lite, read_only } => {
                let pool = lite_pool(lite, read_only, &s);
                let mut rows = sqlx::query_as_with::<Sqlite, T, _>(&s, lite_args(args)?)
                    .persistent(persistent)
                    .fetch(pool);
                while let Some(r) = rows.try_next().await? {
                    yield r;
                }
            }
            Target::LiteConn(c) => {
                let mut rows = sqlx::query_as_with::<Sqlite, T, _>(&s, lite_args(args)?)
                    .persistent(persistent)
                    .fetch(c);
                while let Some(r) = rows.try_next().await? {
                    yield r;
                }
            }
        }
    })
}

fn one<T>(mut v: Vec<T>) -> T {
    v.pop().expect("Mode::One yields exactly one row")
}

fn opt<T>(mut v: Vec<T>) -> Option<T> {
    v.pop()
}

// ---------------------------------------------------------------- builders

/// `sqlx::query`: a statement with `$N` placeholders. The first generic
/// parameter is the SQL type, so `query::<_>`-style turbofish keeps working.
pub fn query<'q, S: Into<Cow<'q, str>>>(sql: S) -> Q<'q> {
    Q::new(SqlText::One(sql.into()))
}

/// `sqlx::query_as::<_, T>`: rows decoded into `T` ([`FromDbRow`]).
pub fn query_as<'q, S: Into<Cow<'q, str>>, T: FromDbRow>(sql: S) -> QueryAs<'q, T> {
    QueryAs {
        q: query(sql),
        _t: PhantomData,
    }
}

/// `sqlx::query_scalar::<_, T>`: the first column of each row.
pub fn query_scalar<'q, S: Into<Cow<'q, str>>, T: Scalar>(sql: S) -> QueryScalar<'q, T> {
    QueryScalar {
        q: query(sql),
        _t: PhantomData,
    }
}

/// A statement plus its arguments (`sqlx::query::Query`).
#[derive(Debug, Clone)]
#[must_use = "a query does nothing until executed"]
pub struct Q<'q> {
    sql: SqlText<'q>,
    args: Vec<Arg>,
    persistent: bool,
}

impl<'q> Q<'q> {
    pub(crate) fn new(sql: SqlText<'q>) -> Q<'q> {
        Q {
            sql,
            args: Vec::new(),
            persistent: true,
        }
    }

    pub(crate) fn with_args(sql: SqlText<'q>, args: Vec<Arg>) -> Q<'q> {
        Q {
            sql,
            args,
            persistent: true,
        }
    }

    /// Binds the next `$N`.
    pub fn bind<T: IntoArg>(mut self, value: T) -> Self {
        self.args.push(value.into_arg());
        self
    }

    /// `false` skips the prepared-statement cache (as in sqlx).
    pub fn persistent(mut self, value: bool) -> Self {
        self.persistent = value;
        self
    }

    /// The Postgres SQL text.
    pub fn sql(&self) -> &str {
        self.sql.get(Dialect::Pg)
    }

    pub fn sql_for(&self, d: Dialect) -> &str {
        self.sql.get(d)
    }

    pub fn args(&self) -> &[Arg] {
        &self.args
    }

    pub async fn execute<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<QueryResult> {
        run_execute(ex.into_target(), &self.sql, self.args, self.persistent).await
    }

    pub async fn fetch_all<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<Vec<Row>> {
        run_rows(
            ex.into_target(),
            &self.sql,
            self.args,
            self.persistent,
            Mode::All,
        )
        .await
    }

    pub async fn fetch_one<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<Row> {
        run_rows(
            ex.into_target(),
            &self.sql,
            self.args,
            self.persistent,
            Mode::One,
        )
        .await
        .map(one)
    }

    pub async fn fetch_optional<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<Option<Row>> {
        run_rows(
            ex.into_target(),
            &self.sql,
            self.args,
            self.persistent,
            Mode::Optional,
        )
        .await
        .map(opt)
    }

    /// Row stream (`Query::fetch`).
    pub fn fetch<'e, E>(self, ex: E) -> BoxStream<'e, sqlx::Result<Row>>
    where
        'q: 'e,
        E: Exec<'e>,
    {
        stream_rows(ex.into_target(), self.sql, self.args, self.persistent)
    }

    /// Decodes into `T` (`Query::try_map(T::from_row)` shorthand).
    pub fn into_as<T: FromDbRow>(self) -> QueryAs<'q, T> {
        QueryAs {
            q: self,
            _t: PhantomData,
        }
    }
}

/// `sqlx::query::QueryAs`.
#[must_use = "a query does nothing until executed"]
pub struct QueryAs<'q, T> {
    q: Q<'q>,
    _t: PhantomData<fn() -> T>,
}

impl<'q, T: FromDbRow> QueryAs<'q, T> {
    pub(crate) fn from_q(q: Q<'q>) -> Self {
        QueryAs { q, _t: PhantomData }
    }

    pub fn bind<V: IntoArg>(mut self, value: V) -> Self {
        self.q = self.q.bind(value);
        self
    }

    pub fn persistent(mut self, value: bool) -> Self {
        self.q = self.q.persistent(value);
        self
    }

    pub fn sql(&self) -> &str {
        self.q.sql()
    }

    pub async fn fetch_all<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<Vec<T>> {
        let Q {
            sql,
            args,
            persistent,
        } = self.q;
        run_as(ex.into_target(), &sql, args, persistent, Mode::All).await
    }

    pub async fn fetch_one<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<T> {
        let Q {
            sql,
            args,
            persistent,
        } = self.q;
        run_as(ex.into_target(), &sql, args, persistent, Mode::One)
            .await
            .map(one)
    }

    pub async fn fetch_optional<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<Option<T>> {
        let Q {
            sql,
            args,
            persistent,
        } = self.q;
        run_as(ex.into_target(), &sql, args, persistent, Mode::Optional)
            .await
            .map(opt)
    }

    /// Row stream (`QueryAs::fetch`). On SQLite, stream from a reader
    /// (`db.read()` / `acquire_read`) when other writes happen meanwhile.
    pub fn fetch<'e, E>(self, ex: E) -> BoxStream<'e, sqlx::Result<T>>
    where
        'q: 'e,
        T: 'e,
        E: Exec<'e>,
    {
        let Q {
            sql,
            args,
            persistent,
        } = self.q;
        stream_as(ex.into_target(), sql, args, persistent)
    }
}

/// `sqlx::query::QueryScalar`.
#[must_use = "a query does nothing until executed"]
pub struct QueryScalar<'q, T> {
    q: Q<'q>,
    _t: PhantomData<fn() -> T>,
}

impl<'q, T: Scalar> QueryScalar<'q, T> {
    pub(crate) fn from_q(q: Q<'q>) -> Self {
        QueryScalar { q, _t: PhantomData }
    }

    pub fn bind<V: IntoArg>(mut self, value: V) -> Self {
        self.q = self.q.bind(value);
        self
    }

    pub fn persistent(mut self, value: bool) -> Self {
        self.q = self.q.persistent(value);
        self
    }

    pub fn sql(&self) -> &str {
        self.q.sql()
    }

    pub async fn fetch_all<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<Vec<T>> {
        self.q
            .fetch_all(ex)
            .await?
            .iter()
            .map(|r| r.try_get(0usize))
            .collect()
    }

    pub async fn fetch_one<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<T> {
        self.q.fetch_one(ex).await?.try_get(0usize)
    }

    pub async fn fetch_optional<'e, E: Exec<'e>>(self, ex: E) -> sqlx::Result<Option<T>> {
        match self.q.fetch_optional(ex).await? {
            Some(r) => r.try_get(0usize).map(Some),
            None => Ok(None),
        }
    }

    /// Value stream (first column of each row).
    pub fn fetch<'e, E>(self, ex: E) -> BoxStream<'e, sqlx::Result<T>>
    where
        'q: 'e,
        T: 'e,
        E: Exec<'e>,
    {
        let Q {
            sql,
            args,
            persistent,
        } = self.q;
        Box::pin(
            stream_rows(ex.into_target(), sql, args, persistent)
                .map(|r| r.and_then(|row| row.try_get(0usize))),
        )
    }
}

fn stream_rows<'e>(
    t: Target<'e>,
    sql: SqlText<'e>,
    args: Vec<Arg>,
    persistent: bool,
) -> BoxStream<'e, sqlx::Result<Row>> {
    Box::pin(async_stream::try_stream! {
        let s = sql.get(t.dialect()).to_owned();
        match t {
            Target::PgPool(p) => {
                let mut rows = sqlx::query_with::<Postgres, _>(&s, pg_args(args)?).persistent(persistent).fetch(p);
                while let Some(r) = rows.try_next().await? { yield Row::Pg(r); }
            }
            Target::PgConn(c) => {
                let mut rows = sqlx::query_with::<Postgres, _>(&s, pg_args(args)?).persistent(persistent).fetch(c);
                while let Some(r) = rows.try_next().await? { yield Row::Pg(r); }
            }
            Target::LitePool { lite, read_only } => {
                let pool = lite_pool(lite, read_only, &s);
                let mut rows = sqlx::query_with::<Sqlite, _>(&s, lite_args(args)?).persistent(persistent).fetch(pool);
                while let Some(r) = rows.try_next().await? { yield Row::Lite(r); }
            }
            Target::LiteConn(c) => {
                let mut rows = sqlx::query_with::<Sqlite, _>(&s, lite_args(args)?).persistent(persistent).fetch(c);
                while let Some(r) = rows.try_next().await? { yield Row::Lite(r); }
            }
        }
    })
}

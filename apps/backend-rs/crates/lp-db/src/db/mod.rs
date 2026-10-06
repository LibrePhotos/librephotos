//! Dual-dialect database layer: "one SQL, two drivers" (design
//! `rust-pg/workflows/sqlite_design.md` §2).
//!
//! A [`Db`] is either a Postgres pool or a pair of SQLite pools (readers with
//! `query_only`, one writer whose transactions all run `BEGIN IMMEDIATE`).
//! Queries are written once with `$N` placeholders and run on both: arguments
//! are [`Arg`] values that encode Django's storage formats per backend
//! (`char(32)` hex UUIDs, `YYYY-MM-DD HH:MM:SS[.ffffff]` datetimes,
//! `json.dumps` JSON on SQLite; native types on Postgres), and rows decode
//! through the same `#[derive(FromRow)]` structs on both drivers.
//!
//! The query API mirrors sqlx (`sql::query`, `sql::query_as::<_, T>`,
//! `sql::query_scalar`, `.bind`, `.fetch_all(ex)`, `.execute(ex)`, [`Qb`] for
//! `QueryBuilder`), so porting a call site is mostly a path swap. See
//! `README.md` next to this file for the portable SQL subset.

mod arg;
mod codec;
pub mod config;
mod exec;
pub mod lite;
mod pyjson;
mod qb;
mod query;
pub mod sql;

pub use arg::{Arg, IntoArg, Kind, ListArg, ListElem};
pub use codec::{DjDateTime, DjList, DjUuid, DjUuidOpt};
pub use config::{Backend, DbSettings};
pub use exec::{Conn, Db, Dialect, Exec, Lite, PoolConn, ReadOnly, Target, Tx};
pub use lite::LiteOptions;
pub use pyjson::{PyJson, float_repr, py_json_dumps};
pub use qb::{Qb, Separated};
pub use query::{FromDbRow, Q, QueryAs, QueryResult, QueryScalar, Row, RowIndex, Scalar};

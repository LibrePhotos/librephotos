//! Query entry points (`sql::query`, `sql::query_as`, `sql::query_scalar`)
//! and dialect fragments for the constructs that differ (design §1.1).
//!
//! Fragment helpers come in two shapes: `fn x(d: Dialect, ..) -> String` for
//! `format!`-built SQL (take `d` from `db.dialect()` / `ex.dialect()`), and
//! `fn x(qb: &mut Qb, ..)` pushers that defer the choice to execution time.

use super::arg::IntoArg;
use super::exec::Dialect;

pub use super::qb::{Qb, Separated};
pub use super::query::{FromDbRow, query, query_as, query_scalar};

/// `expr = ANY($n)` (Postgres array) / `expr IN (SELECT value FROM
/// json_each($n))` (SQLite JSON array), for parameter number `n`.
pub fn any_sql(d: Dialect, expr: &str, n: usize) -> String {
    match d {
        Dialect::Pg => format!("{expr} = ANY(${n})"),
        Dialect::Sqlite => format!("{expr} IN (SELECT value FROM json_each(${n}))"),
    }
}

/// Negation of [`any_sql`]: `expr <> ALL($n)` / `expr NOT IN (..)`.
pub fn not_any_sql(d: Dialect, expr: &str, n: usize) -> String {
    match d {
        Dialect::Pg => format!("{expr} <> ALL(${n})"),
        Dialect::Sqlite => format!("{expr} NOT IN (SELECT value FROM json_each(${n}))"),
    }
}

/// Pushes `expr = ANY($n)` / `expr IN (SELECT value FROM json_each($n))`
/// and binds `list` (a `Vec<T>` / `&[T]`).
pub fn any(qb: &mut Qb<'_>, expr: &str, list: impl IntoArg) {
    let n = qb.bind_arg(list.into_arg());
    qb.push_dialect(
        any_sql(Dialect::Pg, expr, n),
        any_sql(Dialect::Sqlite, expr, n),
    );
}

/// Pushes the negation of [`any`].
pub fn not_any(qb: &mut Qb<'_>, expr: &str, list: impl IntoArg) {
    let n = qb.bind_arg(list.into_arg());
    qb.push_dialect(
        not_any_sql(Dialect::Pg, expr, n),
        not_any_sql(Dialect::Sqlite, expr, n),
    );
}

/// The rows of a list parameter with their 0-based position, as a FROM item
/// `alias(value, ord)`: `unnest($n) WITH ORDINALITY` / `json_each($n)`.
/// Postgres' ordinality is 1-based; both sort the same way.
pub fn list_rows(d: Dialect, n: usize, alias: &str) -> String {
    match d {
        Dialect::Pg => format!("unnest(${n}) WITH ORDINALITY AS {alias}(value, ord)"),
        Dialect::Sqlite => {
            format!("(SELECT value, key AS ord FROM json_each(${n})) AS {alias}")
        }
    }
}

/// `" FOR UPDATE"` on Postgres, `""` on SQLite (an IMMEDIATE transaction
/// already holds the database write lock).
pub fn for_update(d: Dialect) -> &'static str {
    match d {
        Dialect::Pg => " FOR UPDATE",
        Dialect::Sqlite => "",
    }
}

/// `" FOR UPDATE OF <tables>"` / `""`.
pub fn for_update_of(d: Dialect, tables: &str) -> String {
    match d {
        Dialect::Pg => format!(" FOR UPDATE OF {tables}"),
        Dialect::Sqlite => String::new(),
    }
}

/// Django `contains` / `startswith` per backend: `col LIKE pat ESCAPE '\'`.
/// Case-sensitive on Postgres, ASCII case-insensitive on SQLite (both as
/// Django). Escape the pattern with `scope::like_escape`.
pub fn like(_d: Dialect, col: &str, pat: &str) -> String {
    format!("{col} LIKE {pat} ESCAPE '\\'")
}

/// Django `icontains` / `istartswith` per backend:
/// `UPPER(col::text) LIKE UPPER(pat) ESCAPE '\'` / `col LIKE pat ESCAPE '\'`.
pub fn ilike(d: Dialect, col: &str, pat: &str) -> String {
    match d {
        Dialect::Pg => format!("UPPER({col}::text) LIKE UPPER({pat}) ESCAPE '\\'"),
        Dialect::Sqlite => format!("{col} LIKE {pat} ESCAPE '\\'"),
    }
}

/// The UTC calendar date of a datetime column: `(col AT TIME ZONE 'UTC')::date`
/// / `substr(col, 1, 10)` (the stored text is already UTC). Decodes as
/// `NaiveDate` on both.
pub fn date_of(d: Dialect, col: &str) -> String {
    match d {
        Dialect::Pg => format!("({col} AT TIME ZONE 'UTC')::date"),
        Dialect::Sqlite => format!("substr({col}, 1, 10)"),
    }
}

/// `YYYY-MM` of a datetime column (`date_trunc('month', ..)` grouping key).
pub fn month_of(d: Dialect, col: &str) -> String {
    match d {
        Dialect::Pg => format!("to_char({col} AT TIME ZONE 'UTC', 'YYYY-MM')"),
        Dialect::Sqlite => format!("substr({col}, 1, 7)"),
    }
}

/// JSON value kinds for [`json_type_is`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsonKind {
    Object,
    Array,
    String,
    Number,
    Bool,
    Null,
}

/// `jsonb_typeof(expr) = '<kind>'` / the `json_type(expr)` equivalent
/// (SQLite says `text`, `integer`/`real`, `true`/`false`). `expr` is a JSON
/// value expression (`col`, `col->'k'`).
pub fn json_type_is(d: Dialect, expr: &str, kind: JsonKind) -> String {
    match d {
        Dialect::Pg => {
            let k = match kind {
                JsonKind::Object => "object",
                JsonKind::Array => "array",
                JsonKind::String => "string",
                JsonKind::Number => "number",
                JsonKind::Bool => "boolean",
                JsonKind::Null => "null",
            };
            format!("jsonb_typeof({expr}) = '{k}'")
        }
        Dialect::Sqlite => match kind {
            JsonKind::Object => format!("json_type({expr}) = 'object'"),
            JsonKind::Array => format!("json_type({expr}) = 'array'"),
            JsonKind::String => format!("json_type({expr}) = 'text'"),
            JsonKind::Number => format!("json_type({expr}) IN ('integer', 'real')"),
            JsonKind::Bool => format!("json_type({expr}) IN ('true', 'false')"),
            JsonKind::Null => format!("json_type({expr}) = 'null'"),
        },
    }
}

/// The current time. `now()` on both: SQLite connections of this layer
/// register a `now()` function returning Django's datetime text (stable
/// within a transaction). Other SQLite clients (DDL defaults) should use
/// [`NOW_SQLITE_BUILTIN`].
pub fn now(_d: Dialect) -> &'static str {
    "now()"
}

/// Built-in SQLite expression for the current UTC time, millisecond
/// precision (`YYYY-MM-DD HH:MM:SS.SSS`), for DDL defaults and triggers.
pub const NOW_SQLITE_BUILTIN: &str = "(strftime('%Y-%m-%d %H:%M:%f', 'now'))";

/// Whether a statement can only read, so `&Db` may run it on a SQLite
/// reader: it starts with `SELECT` / `VALUES` / `EXPLAIN`, or is a `WITH`
/// whose body contains no `INSERT` / `UPDATE` / `DELETE` / `REPLACE`.
/// Anything else (including `PRAGMA`) goes to the writer.
pub fn is_read_only(sql: &str) -> bool {
    let words = keywords(sql);
    match words.first().map(String::as_str) {
        Some("SELECT" | "VALUES" | "EXPLAIN") => true,
        Some("WITH") => !words
            .iter()
            .any(|w| matches!(w.as_str(), "INSERT" | "UPDATE" | "DELETE" | "REPLACE")),
        _ => false,
    }
}

/// Upper-cased bare words outside comments, string literals and quoted
/// identifiers (only what [`is_read_only`] needs).
fn keywords(sql: &str) -> Vec<String> {
    let b = sql.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'-' && b.get(i + 1) == Some(&b'-') {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if c == b'/' && b.get(i + 1) == Some(&b'*') {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
        } else if c == b'\'' || c == b'"' || c == b'`' {
            i += 1;
            while i < b.len() && b[i] != c {
                i += 1;
            }
            i += 1;
        } else if c.is_ascii_alphabetic() || c == b'_' {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'$') {
                i += 1;
            }
            out.push(sql[start..i].to_ascii_uppercase());
        } else {
            i += 1;
        }
    }
    out
}

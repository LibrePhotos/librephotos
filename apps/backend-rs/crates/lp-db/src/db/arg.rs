//! Bind values: [`Arg`] holds one parameter and encodes it per backend.
//!
//! | Rust | Postgres | SQLite (Django's storage format) |
//! |---|---|---|
//! | `Uuid` | `uuid` | `char(32)` lowercase hex (`Uuid::simple`) |
//! | `DateTime<Utc>` | `timestamptz` | `YYYY-MM-DD HH:MM:SS[.ffffff]`, naive UTC |
//! | `NaiveDateTime` | `timestamp` | same text as `DateTime<Utc>` |
//! | `NaiveDate` | `date` | `YYYY-MM-DD` |
//! | `bool` | `bool` | integer 0 / 1 |
//! | `serde_json::Value`, `Json<T>` | `jsonb` | `json.dumps` text ([`py_json_dumps`]) |
//! | `Vec<T>` / `&[T]` (lists) | `T[]` (for `= ANY($n)`, `unnest`) | JSON array text (for `json_each($n)`) |
//! | `Option<T>` | typed NULL | NULL |

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::error::BoxDynError;
use sqlx::postgres::PgArguments;
use sqlx::sqlite::SqliteArguments;
use sqlx::types::Json;
use sqlx::{Arguments, Postgres};
use uuid::Uuid;

use super::codec::{DjDateTime, DjUuid, DjUuidOpt};
use super::pyjson::{float_repr, py_json_dumps};

/// The declared type of a parameter. Postgres needs it for a typed NULL
/// (`None::<i32>` is an `int4` NULL, as with plain sqlx).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Bool,
    I16,
    I32,
    I64,
    F32,
    F64,
    Text,
    Uuid,
    Ts,
    NaiveTs,
    Date,
    Json,
    Bytes,
    List(ListKind),
}

/// Element type of a list parameter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListKind {
    Bool,
    I16,
    I32,
    I64,
    F32,
    F64,
    Text,
    Uuid,
    Ts,
    Json,
}

/// One bound parameter.
#[derive(Debug, Clone, PartialEq)]
pub enum Arg {
    Null(Kind),
    Bool(bool),
    I16(i16),
    I32(i32),
    I64(i64),
    F32(f32),
    F64(f64),
    Text(String),
    Uuid(Uuid),
    Ts(DateTime<Utc>),
    NaiveTs(NaiveDateTime),
    Date(NaiveDate),
    Json(Value),
    Bytes(Vec<u8>),
    List(ListArg),
    /// A value that failed to convert (e.g. `Json<T>` serialization); the
    /// query fails with `sqlx::Error::Encode` when it runs, like sqlx.
    Invalid(String),
}

/// A list parameter: a Postgres array, or a JSON array on SQLite.
#[derive(Debug, Clone, PartialEq)]
pub enum ListArg {
    Bool(Vec<bool>),
    I16(Vec<i16>),
    I32(Vec<i32>),
    I64(Vec<i64>),
    F32(Vec<f32>),
    F64(Vec<f64>),
    Text(Vec<String>),
    Uuid(Vec<Uuid>),
    Ts(Vec<DateTime<Utc>>),
    Json(Vec<Value>),
}

impl ListArg {
    pub fn len(&self) -> usize {
        match self {
            ListArg::Bool(v) => v.len(),
            ListArg::I16(v) => v.len(),
            ListArg::I32(v) => v.len(),
            ListArg::I64(v) => v.len(),
            ListArg::F32(v) => v.len(),
            ListArg::F64(v) => v.len(),
            ListArg::Text(v) => v.len(),
            ListArg::Uuid(v) => v.len(),
            ListArg::Ts(v) => v.len(),
            ListArg::Json(v) => v.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The SQLite form: a JSON array whose elements compare equal to the
    /// stored column values (`json_each(..).value`).
    pub fn to_json_text(&self) -> String {
        fn join<T>(items: &[T], f: impl Fn(&T) -> String) -> String {
            let mut s = String::from("[");
            for (i, x) in items.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                s.push_str(&f(x));
            }
            s.push(']');
            s
        }
        fn quoted(s: &str) -> String {
            py_json_dumps(&Value::String(s.to_owned()))
        }
        fn float(f: f64) -> String {
            if f.is_finite() {
                float_repr(f)
            } else {
                "null".into()
            }
        }
        match self {
            ListArg::Bool(v) => join(v, |b| if *b { "1".into() } else { "0".into() }),
            ListArg::I16(v) => join(v, |x| x.to_string()),
            ListArg::I32(v) => join(v, |x| x.to_string()),
            ListArg::I64(v) => join(v, |x| x.to_string()),
            ListArg::F32(v) => join(v, |x| float(f64::from(*x))),
            ListArg::F64(v) => join(v, |x| float(*x)),
            ListArg::Text(v) => join(v, |s| quoted(s)),
            ListArg::Uuid(v) => join(v, |u| format!("\"{}\"", u.simple())),
            ListArg::Ts(v) => join(v, |t| format!("\"{}\"", DjDateTime(*t))),
            ListArg::Json(v) => join(v, py_json_dumps),
        }
    }

    fn kind(&self) -> ListKind {
        match self {
            ListArg::Bool(_) => ListKind::Bool,
            ListArg::I16(_) => ListKind::I16,
            ListArg::I32(_) => ListKind::I32,
            ListArg::I64(_) => ListKind::I64,
            ListArg::F32(_) => ListKind::F32,
            ListArg::F64(_) => ListKind::F64,
            ListArg::Text(_) => ListKind::Text,
            ListArg::Uuid(_) => ListKind::Uuid,
            ListArg::Ts(_) => ListKind::Ts,
            ListArg::Json(_) => ListKind::Json,
        }
    }
}

impl Arg {
    /// A `uuid[]` / JSON list of ids (design §2 port example).
    pub fn uuids(ids: &[Uuid]) -> Arg {
        Arg::List(ListArg::Uuid(ids.to_vec()))
    }

    pub fn kind(&self) -> Option<Kind> {
        Some(match self {
            Arg::Null(k) => *k,
            Arg::Bool(_) => Kind::Bool,
            Arg::I16(_) => Kind::I16,
            Arg::I32(_) => Kind::I32,
            Arg::I64(_) => Kind::I64,
            Arg::F32(_) => Kind::F32,
            Arg::F64(_) => Kind::F64,
            Arg::Text(_) => Kind::Text,
            Arg::Uuid(_) => Kind::Uuid,
            Arg::Ts(_) => Kind::Ts,
            Arg::NaiveTs(_) => Kind::NaiveTs,
            Arg::Date(_) => Kind::Date,
            Arg::Json(_) => Kind::Json,
            Arg::Bytes(_) => Kind::Bytes,
            Arg::List(l) => Kind::List(l.kind()),
            Arg::Invalid(_) => return None,
        })
    }

    pub(crate) fn add_pg(self, a: &mut PgArguments) -> Result<(), BoxDynError> {
        match self {
            Arg::Null(k) => add_pg_null(a, k),
            Arg::Bool(v) => a.add(v),
            Arg::I16(v) => a.add(v),
            Arg::I32(v) => a.add(v),
            Arg::I64(v) => a.add(v),
            Arg::F32(v) => a.add(v),
            Arg::F64(v) => a.add(v),
            Arg::Text(v) => a.add(v),
            Arg::Uuid(v) => a.add(v),
            Arg::Ts(v) => a.add(v),
            Arg::NaiveTs(v) => a.add(v),
            Arg::Date(v) => a.add(v),
            Arg::Json(v) => a.add(v),
            Arg::Bytes(v) => a.add(v),
            Arg::List(l) => match l {
                ListArg::Bool(v) => a.add(v),
                ListArg::I16(v) => a.add(v),
                ListArg::I32(v) => a.add(v),
                ListArg::I64(v) => a.add(v),
                ListArg::F32(v) => a.add(v),
                ListArg::F64(v) => a.add(v),
                ListArg::Text(v) => a.add(v),
                ListArg::Uuid(v) => a.add(v),
                ListArg::Ts(v) => a.add(v),
                ListArg::Json(v) => a.add(v),
            },
            Arg::Invalid(e) => Err(e.into()),
        }
    }

    pub(crate) fn add_lite(self, a: &mut SqliteArguments<'_>) -> Result<(), BoxDynError> {
        match self {
            Arg::Null(_) => a.add(None::<i64>),
            Arg::Bool(v) => a.add(v),
            Arg::I16(v) => a.add(v),
            Arg::I32(v) => a.add(v),
            Arg::I64(v) => a.add(v),
            Arg::F32(v) => a.add(v),
            Arg::F64(v) => a.add(v),
            Arg::Text(v) => a.add(v),
            Arg::Uuid(v) => a.add(v.simple().to_string()),
            Arg::Ts(v) => a.add(DjDateTime(v).to_string()),
            Arg::NaiveTs(v) => a.add(DjDateTime(v.and_utc()).to_string()),
            Arg::Date(v) => a.add(v.format("%Y-%m-%d").to_string()),
            Arg::Json(v) => a.add(py_json_dumps(&v)),
            Arg::Bytes(v) => a.add(v),
            Arg::List(l) => a.add(l.to_json_text()),
            Arg::Invalid(e) => Err(e.into()),
        }
    }
}

fn add_pg_null(a: &mut PgArguments, k: Kind) -> Result<(), BoxDynError> {
    fn n<T>(a: &mut PgArguments) -> Result<(), BoxDynError>
    where
        for<'q> T: sqlx::Encode<'q, Postgres> + sqlx::Type<Postgres>,
    {
        a.add(None::<T>)
    }
    match k {
        Kind::Bool => n::<bool>(a),
        Kind::I16 => n::<i16>(a),
        Kind::I32 => n::<i32>(a),
        Kind::I64 => n::<i64>(a),
        Kind::F32 => n::<f32>(a),
        Kind::F64 => n::<f64>(a),
        Kind::Text => n::<String>(a),
        Kind::Uuid => n::<Uuid>(a),
        Kind::Ts => n::<DateTime<Utc>>(a),
        Kind::NaiveTs => n::<NaiveDateTime>(a),
        Kind::Date => n::<NaiveDate>(a),
        Kind::Json => n::<Value>(a),
        Kind::Bytes => n::<Vec<u8>>(a),
        Kind::List(l) => match l {
            ListKind::Bool => n::<Vec<bool>>(a),
            ListKind::I16 => n::<Vec<i16>>(a),
            ListKind::I32 => n::<Vec<i32>>(a),
            ListKind::I64 => n::<Vec<i64>>(a),
            ListKind::F32 => n::<Vec<f32>>(a),
            ListKind::F64 => n::<Vec<f64>>(a),
            ListKind::Text => n::<Vec<String>>(a),
            ListKind::Uuid => n::<Vec<Uuid>>(a),
            ListKind::Ts => n::<Vec<DateTime<Utc>>>(a),
            ListKind::Json => n::<Vec<Value>>(a),
        },
    }
}

/// Anything `.bind()` / `push_bind()` accept: the sqlx `Encode` of this layer.
///
/// Implemented for the scalar types above, `&str`, references (`&T` clones),
/// `Option<T>` (typed NULL), lists (`Vec<T>`, `&[T]` of [`ListElem`]),
/// `Json<T>`, the codecs and [`Arg`] itself.
pub trait IntoArg {
    fn into_arg(self) -> Arg;
    /// Declared type, for `None`.
    fn kind() -> Kind
    where
        Self: Sized;
}

impl IntoArg for Arg {
    fn into_arg(self) -> Arg {
        self
    }
    fn kind() -> Kind {
        Kind::Text
    }
}

macro_rules! scalar_arg {
    ($($t:ty => $v:ident),* $(,)?) => {$(
        impl IntoArg for $t {
            fn into_arg(self) -> Arg {
                Arg::$v(self)
            }
            fn kind() -> Kind {
                Kind::$v
            }
        }
    )*};
}

scalar_arg!(
    bool => Bool, i16 => I16, i32 => I32, i64 => I64, f32 => F32, f64 => F64,
    String => Text, Uuid => Uuid, DateTime<Utc> => Ts, NaiveDateTime => NaiveTs,
    NaiveDate => Date, Value => Json, Vec<u8> => Bytes,
);

impl IntoArg for &str {
    fn into_arg(self) -> Arg {
        Arg::Text(self.to_owned())
    }
    fn kind() -> Kind {
        Kind::Text
    }
}

impl IntoArg for &[u8] {
    fn into_arg(self) -> Arg {
        Arg::Bytes(self.to_vec())
    }
    fn kind() -> Kind {
        Kind::Bytes
    }
}

impl<T: IntoArg + Clone> IntoArg for &T {
    fn into_arg(self) -> Arg {
        self.clone().into_arg()
    }
    fn kind() -> Kind {
        T::kind()
    }
}

impl<T: IntoArg> IntoArg for Option<T> {
    fn into_arg(self) -> Arg {
        match self {
            Some(v) => v.into_arg(),
            None => Arg::Null(T::kind()),
        }
    }
    fn kind() -> Kind {
        T::kind()
    }
}

impl<T: Serialize> IntoArg for Json<T> {
    fn into_arg(self) -> Arg {
        match serde_json::to_value(&self.0) {
            Ok(v) => Arg::Json(v),
            Err(e) => Arg::Invalid(e.to_string()),
        }
    }
    fn kind() -> Kind {
        Kind::Json
    }
}

impl IntoArg for DjUuid {
    fn into_arg(self) -> Arg {
        Arg::Uuid(self.0)
    }
    fn kind() -> Kind {
        Kind::Uuid
    }
}

impl IntoArg for DjUuidOpt {
    fn into_arg(self) -> Arg {
        self.0.into_arg()
    }
    fn kind() -> Kind {
        Kind::Uuid
    }
}

impl IntoArg for DjDateTime {
    fn into_arg(self) -> Arg {
        Arg::Ts(self.0)
    }
    fn kind() -> Kind {
        Kind::Ts
    }
}

/// Element types of list parameters and of [`DjList`](super::DjList) columns.
pub trait ListElem: Sized + Clone + Send + Unpin + 'static {
    const KIND: ListKind;
    fn list(items: Vec<Self>) -> ListArg;
    /// One element of a SQLite JSON array (`json_group_array`).
    fn from_json(v: &Value) -> Result<Self, BoxDynError>;
}

fn bad(v: &Value, what: &str) -> BoxDynError {
    format!("expected {what} in JSON list, got {v}").into()
}

macro_rules! list_elem {
    ($t:ty, $v:ident, |$j:ident| $from:expr) => {
        impl ListElem for $t {
            const KIND: ListKind = ListKind::$v;
            fn list(items: Vec<Self>) -> ListArg {
                ListArg::$v(items)
            }
            fn from_json($j: &Value) -> Result<Self, BoxDynError> {
                $from
            }
        }
    };
}

list_elem!(bool, Bool, |v| match v {
    Value::Bool(b) => Ok(*b),
    Value::Number(n) => Ok(n.as_i64().ok_or_else(|| bad(v, "bool"))? != 0),
    _ => Err(bad(v, "bool")),
});
list_elem!(i16, I16, |v| v
    .as_i64()
    .and_then(|x| i16::try_from(x).ok())
    .ok_or_else(|| bad(v, "i16")));
list_elem!(i32, I32, |v| v
    .as_i64()
    .and_then(|x| i32::try_from(x).ok())
    .ok_or_else(|| bad(v, "i32")));
list_elem!(i64, I64, |v| v.as_i64().ok_or_else(|| bad(v, "i64")));
list_elem!(f32, F32, |v| v
    .as_f64()
    .map(|x| x as f32)
    .ok_or_else(|| bad(v, "f32")));
list_elem!(f64, F64, |v| v.as_f64().ok_or_else(|| bad(v, "f64")));
list_elem!(String, Text, |v| v
    .as_str()
    .map(str::to_owned)
    .ok_or_else(|| bad(v, "string")));
list_elem!(Uuid, Uuid, |v| {
    let s = v.as_str().ok_or_else(|| bad(v, "uuid"))?;
    Ok(Uuid::parse_str(s)?)
});
list_elem!(DateTime<Utc>, Ts, |v| {
    let s = v.as_str().ok_or_else(|| bad(v, "datetime"))?;
    DjDateTime::parse(s).map(|d| d.0)
});
list_elem!(Value, Json, |v| Ok(v.clone()));

impl<T: ListElem> IntoArg for Vec<T> {
    fn into_arg(self) -> Arg {
        Arg::List(T::list(self))
    }
    fn kind() -> Kind {
        Kind::List(T::KIND)
    }
}

impl<T: ListElem> IntoArg for &[T] {
    fn into_arg(self) -> Arg {
        Arg::List(T::list(self.to_vec()))
    }
    fn kind() -> Kind {
        Kind::List(T::KIND)
    }
}

impl<T: ListElem, const N: usize> IntoArg for [T; N] {
    fn into_arg(self) -> Arg {
        Arg::List(T::list(self.to_vec()))
    }
    fn kind() -> Kind {
        Kind::List(T::KIND)
    }
}

impl IntoArg for &[&str] {
    fn into_arg(self) -> Arg {
        Arg::List(ListArg::Text(
            self.iter().map(|s| (*s).to_owned()).collect(),
        ))
    }
    fn kind() -> Kind {
        Kind::List(ListKind::Text)
    }
}

impl IntoArg for Vec<&str> {
    fn into_arg(self) -> Arg {
        self.as_slice().into_arg()
    }
    fn kind() -> Kind {
        Kind::List(ListKind::Text)
    }
}

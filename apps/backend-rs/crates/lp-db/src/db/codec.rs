//! Column codecs for Django's storage formats, decodable from both drivers.
//!
//! Use them where sqlx's own SQLite codec disagrees with Django:
//! - `Uuid`: sqlx-sqlite decodes a 16-byte BLOB, Django stores `char(32)`
//!   hex text. Row fields: `#[sqlx(try_from = "DjUuid")] id: Uuid`,
//!   `#[sqlx(try_from = "DjUuidOpt")] x: Option<Uuid>`; tuples: `(DjUuid, ..)`.
//! - lists (`array_agg` on Postgres, `json_group_array` on SQLite):
//!   `#[sqlx(try_from = "DjList<Uuid>")] ids: Vec<Uuid>`.
//! - `DateTime<Utc>` *decodes* fine with plain sqlx on both (sqlx-sqlite parses
//!   `%F %T%.f`); [`DjDateTime`] exists for its Django `Display` and encoding.

use std::fmt;

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Timelike, Utc};
use serde_json::Value;
use sqlx::encode::IsNull;
use sqlx::error::BoxDynError;
use sqlx::postgres::{PgHasArrayType, PgTypeInfo, PgValueRef};
use sqlx::sqlite::{SqliteArgumentValue, SqliteTypeInfo, SqliteValueRef};
use sqlx::{Decode, Encode, Postgres, Sqlite, Type, TypeInfo, ValueRef};
use uuid::Uuid;

use super::arg::ListElem;

// ---------------------------------------------------------------- DjUuid

/// A UUID column: Postgres `uuid` (or text), SQLite `char(32)` hex / dashed
/// text, or a 16-byte BLOB. Encodes as `uuid` / 32-char lowercase hex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DjUuid(pub Uuid);

impl From<DjUuid> for Uuid {
    fn from(v: DjUuid) -> Uuid {
        v.0
    }
}

impl From<Uuid> for DjUuid {
    fn from(v: Uuid) -> DjUuid {
        DjUuid(v)
    }
}

fn uuid_from_bytes(b: &[u8]) -> Result<Uuid, BoxDynError> {
    if b.len() == 16 {
        return Ok(Uuid::from_slice(b)?);
    }
    Ok(Uuid::try_parse_ascii(b)?)
}

impl Type<Postgres> for DjUuid {
    fn type_info() -> PgTypeInfo {
        <Uuid as Type<Postgres>>::type_info()
    }
    fn compatible(ty: &PgTypeInfo) -> bool {
        <Uuid as Type<Postgres>>::compatible(ty) || <String as Type<Postgres>>::compatible(ty)
    }
}

impl<'r> Decode<'r, Postgres> for DjUuid {
    fn decode(value: PgValueRef<'r>) -> Result<Self, BoxDynError> {
        if <Uuid as Type<Postgres>>::compatible(&value.type_info()) {
            Ok(DjUuid(<Uuid as Decode<Postgres>>::decode(value)?))
        } else {
            let s = <&str as Decode<Postgres>>::decode(value)?;
            Ok(DjUuid(Uuid::parse_str(s.trim())?))
        }
    }
}

impl Type<Sqlite> for DjUuid {
    fn type_info() -> SqliteTypeInfo {
        <String as Type<Sqlite>>::type_info()
    }
    fn compatible(ty: &SqliteTypeInfo) -> bool {
        <Uuid as Type<Sqlite>>::compatible(ty)
    }
}

impl<'r> Decode<'r, Sqlite> for DjUuid {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        let b = <&[u8] as Decode<Sqlite>>::decode(value)?;
        Ok(DjUuid(uuid_from_bytes(b)?))
    }
}

impl<'q> Encode<'q, Sqlite> for DjUuid {
    fn encode_by_ref(&self, buf: &mut Vec<SqliteArgumentValue<'q>>) -> Result<IsNull, BoxDynError> {
        <String as Encode<Sqlite>>::encode(self.0.simple().to_string(), buf)
    }
}

/// `Option<Uuid>` columns: `#[sqlx(try_from = "DjUuidOpt")] x: Option<Uuid>`
/// (`Option<DjUuid>` cannot convert into `Option<Uuid>` under the orphan rule).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct DjUuidOpt(pub Option<Uuid>);

impl From<DjUuidOpt> for Option<Uuid> {
    fn from(v: DjUuidOpt) -> Option<Uuid> {
        v.0
    }
}

impl Type<Postgres> for DjUuidOpt {
    fn type_info() -> PgTypeInfo {
        <DjUuid as Type<Postgres>>::type_info()
    }
    fn compatible(ty: &PgTypeInfo) -> bool {
        <DjUuid as Type<Postgres>>::compatible(ty)
    }
}

impl<'r> Decode<'r, Postgres> for DjUuidOpt {
    fn decode(value: PgValueRef<'r>) -> Result<Self, BoxDynError> {
        if value.is_null() {
            return Ok(DjUuidOpt(None));
        }
        Ok(DjUuidOpt(Some(
            <DjUuid as Decode<Postgres>>::decode(value)?.0,
        )))
    }
}

impl Type<Sqlite> for DjUuidOpt {
    fn type_info() -> SqliteTypeInfo {
        <DjUuid as Type<Sqlite>>::type_info()
    }
    fn compatible(ty: &SqliteTypeInfo) -> bool {
        <DjUuid as Type<Sqlite>>::compatible(ty)
    }
}

impl<'r> Decode<'r, Sqlite> for DjUuidOpt {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        if value.is_null() {
            return Ok(DjUuidOpt(None));
        }
        Ok(DjUuidOpt(Some(
            <DjUuid as Decode<Sqlite>>::decode(value)?.0,
        )))
    }
}

// ------------------------------------------------------------ DjDateTime

/// A Django `DateTimeField` value. `Display` is Django's SQLite storage text:
/// `YYYY-MM-DD HH:MM:SS[.ffffff]`, naive UTC, the fraction omitted when it is
/// zero (`str(datetime)`); sub-microsecond digits are truncated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct DjDateTime(pub DateTime<Utc>);

impl DjDateTime {
    /// Parses Django's text (also `T` separators, RFC 3339 offsets and the
    /// Postgres `+00` suffix), as stored by Django, sqlx or `now()`.
    pub fn parse(s: &str) -> Result<DjDateTime, BoxDynError> {
        let s = s.trim();
        if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
            return Ok(DjDateTime(dt.with_timezone(&Utc)));
        }
        for fmt in ["%Y-%m-%d %H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M:%S%.f%#z"] {
            if let Ok(dt) = DateTime::parse_from_str(s, fmt) {
                return Ok(DjDateTime(dt.with_timezone(&Utc)));
            }
        }
        for fmt in [
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y-%m-%d %H:%M",
        ] {
            if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
                return Ok(DjDateTime(dt.and_utc()));
            }
        }
        Err(format!("invalid datetime: {s:?}").into())
    }

    pub fn now() -> DjDateTime {
        DjDateTime(Utc::now())
    }
}

impl fmt::Display for DjDateTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let t = self.0.naive_utc();
        let micros = t.nanosecond() / 1_000 % 1_000_000;
        write!(f, "{}", t.format("%Y-%m-%d %H:%M:%S"))?;
        if micros != 0 {
            write!(f, ".{micros:06}")?;
        }
        Ok(())
    }
}

impl From<DjDateTime> for DateTime<Utc> {
    fn from(v: DjDateTime) -> Self {
        v.0
    }
}

impl From<DateTime<Utc>> for DjDateTime {
    fn from(v: DateTime<Utc>) -> Self {
        DjDateTime(v)
    }
}

impl Type<Postgres> for DjDateTime {
    fn type_info() -> PgTypeInfo {
        <DateTime<Utc> as Type<Postgres>>::type_info()
    }
    fn compatible(ty: &PgTypeInfo) -> bool {
        <DateTime<Utc> as Type<Postgres>>::compatible(ty)
            || <NaiveDateTime as Type<Postgres>>::compatible(ty)
            || <String as Type<Postgres>>::compatible(ty)
    }
}

impl<'r> Decode<'r, Postgres> for DjDateTime {
    fn decode(value: PgValueRef<'r>) -> Result<Self, BoxDynError> {
        let ty = value.type_info().into_owned();
        if <DateTime<Utc> as Type<Postgres>>::compatible(&ty) {
            Ok(DjDateTime(<DateTime<Utc> as Decode<Postgres>>::decode(
                value,
            )?))
        } else if <NaiveDateTime as Type<Postgres>>::compatible(&ty) {
            Ok(DjDateTime(
                <NaiveDateTime as Decode<Postgres>>::decode(value)?.and_utc(),
            ))
        } else {
            DjDateTime::parse(<&str as Decode<Postgres>>::decode(value)?)
        }
    }
}

impl Type<Sqlite> for DjDateTime {
    fn type_info() -> SqliteTypeInfo {
        <DateTime<Utc> as Type<Sqlite>>::type_info()
    }
    fn compatible(ty: &SqliteTypeInfo) -> bool {
        <DateTime<Utc> as Type<Sqlite>>::compatible(ty)
    }
}

impl<'r> Decode<'r, Sqlite> for DjDateTime {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        if value.type_info().name() == "TEXT" {
            return DjDateTime::parse(<&str as Decode<Sqlite>>::decode(value)?);
        }
        Ok(DjDateTime(<DateTime<Utc> as Decode<Sqlite>>::decode(
            value,
        )?))
    }
}

impl<'q> Encode<'q, Sqlite> for DjDateTime {
    fn encode_by_ref(&self, buf: &mut Vec<SqliteArgumentValue<'q>>) -> Result<IsNull, BoxDynError> {
        <String as Encode<Sqlite>>::encode(self.to_string(), buf)
    }
}

/// RFC 3339 with microseconds (for logs / debugging only).
impl DjDateTime {
    pub fn rfc3339(&self) -> String {
        self.0.to_rfc3339_opts(SecondsFormat::Micros, true)
    }
}

// ---------------------------------------------------------------- DjList

/// An aggregated list column: a Postgres array (`array_agg`) or a SQLite JSON
/// array text (`json_group_array`). Converts into `Vec<T>`.
///
/// Note the empty case differs: `array_agg` over no rows is NULL,
/// `json_group_array` is `'[]'`. Use `Option<..>` / `COALESCE` accordingly.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DjList<T>(pub Vec<T>);

impl<T> From<DjList<T>> for Vec<T> {
    fn from(v: DjList<T>) -> Vec<T> {
        v.0
    }
}

impl<T> Type<Postgres> for DjList<T>
where
    T: ListElem + PgHasArrayType,
{
    fn type_info() -> PgTypeInfo {
        T::array_type_info()
    }
    fn compatible(ty: &PgTypeInfo) -> bool {
        T::array_compatible(ty)
    }
}

impl<'r, T> Decode<'r, Postgres> for DjList<T>
where
    T: ListElem + PgHasArrayType + for<'a> Decode<'a, Postgres> + Type<Postgres>,
{
    fn decode(value: PgValueRef<'r>) -> Result<Self, BoxDynError> {
        Ok(DjList(<Vec<T> as Decode<Postgres>>::decode(value)?))
    }
}

impl<T: ListElem> Type<Sqlite> for DjList<T> {
    fn type_info() -> SqliteTypeInfo {
        <String as Type<Sqlite>>::type_info()
    }
    fn compatible(ty: &SqliteTypeInfo) -> bool {
        <String as Type<Sqlite>>::compatible(ty)
    }
}

impl<'r, T: ListElem> Decode<'r, Sqlite> for DjList<T> {
    fn decode(value: SqliteValueRef<'r>) -> Result<Self, BoxDynError> {
        let s = <&str as Decode<Sqlite>>::decode(value)?;
        let items: Vec<Value> = serde_json::from_str(s)?;
        Ok(DjList(
            items.iter().map(T::from_json).collect::<Result<_, _>>()?,
        ))
    }
}

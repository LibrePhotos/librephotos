use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use rusqlite::ToSql;
use rusqlite::types::{ToSqlOutput, ValueRef};
use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde::ser::{SerializeMap, Serializer};
use serde::{Deserialize, Serialize};

pub const MAX_SAFE_INT: i64 = (1 << 53) - 1;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CellRef<'a>(pub ValueRef<'a>);

impl CellRef<'_> {
    pub fn is_tagged(&self) -> bool {
        match self.0 {
            ValueRef::Integer(i) => !(-MAX_SAFE_INT..=MAX_SAFE_INT).contains(&i),
            ValueRef::Real(f) => !f.is_finite(),
            ValueRef::Blob(_) => true,
            ValueRef::Null | ValueRef::Text(_) => false,
        }
    }

    pub fn write_json(&self, out: &mut Vec<u8>) -> serde_json::Result<()> {
        match self.0 {
            ValueRef::Null => out.extend_from_slice(b"null"),
            ValueRef::Integer(i) if (-MAX_SAFE_INT..=MAX_SAFE_INT).contains(&i) => {
                out.extend_from_slice(itoa::Buffer::new().format(i).as_bytes());
            }
            ValueRef::Text(t)
                if !t.iter().any(|&b| b < 0x20 || b == b'"' || b == b'\\')
                    && std::str::from_utf8(t).is_ok() =>
            {
                out.reserve(t.len() + 2);
                out.push(b'"');
                out.extend_from_slice(t);
                out.push(b'"');
            }
            _ => serde_json::to_writer(&mut *out, self)?,
        }
        Ok(())
    }
}

fn tag<S: Serializer>(s: S, key: &str, value: &str) -> Result<S::Ok, S::Error> {
    let mut m = s.serialize_map(Some(1))?;
    m.serialize_entry(key, value)?;
    m.end()
}

impl Serialize for CellRef<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            ValueRef::Null => s.serialize_unit(),
            ValueRef::Integer(i) if (-MAX_SAFE_INT..=MAX_SAFE_INT).contains(&i) => {
                s.serialize_i64(i)
            }
            ValueRef::Integer(i) => tag(s, "$bigint", &i.to_string()),
            ValueRef::Real(f) if f.is_finite() => s.serialize_f64(f),
            ValueRef::Real(f) => tag(s, "$real", if f > 0.0 { "Infinity" } else { "-Infinity" }),
            ValueRef::Text(t) => match std::str::from_utf8(t) {
                Ok(t) => s.serialize_str(t),
                Err(_) => s.serialize_str(&String::from_utf8_lossy(t)),
            },
            ValueRef::Blob(b) => tag(s, "$blob", &B64.encode(b)),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Param {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl ToSql for Param {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(match self {
            Param::Null => ValueRef::Null,
            Param::Int(i) => ValueRef::Integer(*i),
            Param::Real(f) => ValueRef::Real(*f),
            Param::Text(t) => ValueRef::Text(t.as_bytes()),
            Param::Blob(b) => ValueRef::Blob(b),
        }))
    }
}

fn from_tag<E: de::Error>(key: &str, value: &str) -> Result<Param, E> {
    match key {
        "$bigint" => value
            .parse()
            .map(Param::Int)
            .map_err(|_| E::custom(format!("not a 64-bit integer: {value}"))),
        "$blob" => B64
            .decode(value)
            .map(Param::Blob)
            .map_err(|e| E::custom(format!("bad $blob: {e}"))),
        "$real" => match value {
            "Infinity" => Ok(Param::Real(f64::INFINITY)),
            "-Infinity" => Ok(Param::Real(f64::NEG_INFINITY)),
            "NaN" => Ok(Param::Null),
            _ => Err(E::custom(format!("bad $real: {value}"))),
        },
        _ => Err(E::custom(format!("unknown parameter tag {key}"))),
    }
}

struct ParamVisitor;

impl<'de> Visitor<'de> for ParamVisitor {
    type Value = Param;

    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("null, a boolean, a number, a string or a {$bigint|$blob|$real} tag")
    }
    fn visit_unit<E>(self) -> Result<Param, E> {
        Ok(Param::Null)
    }
    fn visit_none<E>(self) -> Result<Param, E> {
        Ok(Param::Null)
    }
    fn visit_bool<E>(self, v: bool) -> Result<Param, E> {
        Ok(Param::Int(i64::from(v)))
    }
    fn visit_i64<E>(self, v: i64) -> Result<Param, E> {
        Ok(Param::Int(v))
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Param, E> {
        i64::try_from(v)
            .map(Param::Int)
            .map_err(|_| E::custom(format!("{v} does not fit a 64-bit integer")))
    }
    fn visit_f64<E>(self, v: f64) -> Result<Param, E> {
        Ok(Param::Real(v))
    }
    fn visit_str<E>(self, v: &str) -> Result<Param, E> {
        Ok(Param::Text(v.to_string()))
    }
    fn visit_string<E>(self, v: String) -> Result<Param, E> {
        Ok(Param::Text(v))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Param, A::Error> {
        let Some((key, value)) =
            map.next_entry::<std::borrow::Cow<'_, str>, std::borrow::Cow<'_, str>>()?
        else {
            return Err(de::Error::custom("an empty object is not a parameter"));
        };
        if map.next_key::<de::IgnoredAny>()?.is_some() {
            return Err(de::Error::custom("a parameter tag has one key"));
        }
        from_tag(&key, &value)
    }
}

impl<'de> Deserialize<'de> for Param {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Param, D::Error> {
        d.deserialize_any(ParamVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(v: ValueRef<'_>) -> String {
        let mut fast = Vec::new();
        CellRef(v).write_json(&mut fast).unwrap();
        let slow = serde_json::to_string(&CellRef(v)).unwrap();
        assert_eq!(String::from_utf8(fast).unwrap(), slow, "both paths agree");
        slow
    }

    #[test]
    fn cells_serialise_faithfully() {
        use ValueRef::{Blob, Integer, Null, Real, Text};
        assert_eq!(json(Null), "null");
        assert_eq!(json(Integer(MAX_SAFE_INT)), "9007199254740991");
        assert_eq!(json(Integer(-MAX_SAFE_INT)), "-9007199254740991");
        assert_eq!(
            json(Integer(MAX_SAFE_INT + 2)),
            r#"{"$bigint":"9007199254740993"}"#
        );
        assert_eq!(
            json(Integer(i64::MIN)),
            r#"{"$bigint":"-9223372036854775808"}"#
        );
        assert_eq!(json(Real(1.5)), "1.5");
        assert_eq!(json(Real(2.0)), "2.0");
        assert_eq!(json(Real(1e300)), "1e+300");
        assert_eq!(json(Real(f64::NEG_INFINITY)), r#"{"$real":"-Infinity"}"#);
        assert_eq!(json(Text("é\"x".as_bytes())), r#""é\"x""#);
        assert_eq!(json(Text(b"a\xffb")), "\"a\u{fffd}b\"", "invalid UTF-8");
        assert_eq!(json(Blob(&[0, 1, 2, 255])), r#"{"$blob":"AAEC/w=="}"#);
        assert!(CellRef(Blob(&[])).is_tagged());
        assert!(!CellRef(Integer(5)).is_tagged());
    }

    #[test]
    fn params_parse_faithfully() {
        let ps: Vec<Param> = serde_json::from_str(
            r#"[null, true, false, 7, -9223372036854775808, 9223372036854775807, 1.25, "té",
                {"$bigint":"9223372036854775807"}, {"$blob":"AAEC/w=="}, {"$real":"Infinity"},
                {"$real":"NaN"}]"#,
        )
        .unwrap();
        assert_eq!(
            ps,
            [
                Param::Null,
                Param::Int(1),
                Param::Int(0),
                Param::Int(7),
                Param::Int(i64::MIN),
                Param::Int(i64::MAX),
                Param::Real(1.25),
                Param::Text("té".into()),
                Param::Int(i64::MAX),
                Param::Blob(vec![0, 1, 2, 255]),
                Param::Real(f64::INFINITY),
                Param::Null,
            ]
        );
        for bad in [
            r#"{"$other":"1"}"#,
            r#"{"$bigint":"1","$blob":""}"#,
            "{}",
            "[1]",
            r#"{"$bigint":"99999999999999999999"}"#,
            "18446744073709551615",
            r#"{"$blob":"!!"}"#,
            r#"{"$bigint":1}"#,
        ] {
            assert!(serde_json::from_str::<Param>(bad).is_err(), "{bad}");
        }
    }
}

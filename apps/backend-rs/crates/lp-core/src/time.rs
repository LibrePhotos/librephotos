//! Python/DRF datetime string formats.
//!
//! * [`py_isoformat`]: `datetime.isoformat()` on an aware UTC value, e.g.
//!   `2020-01-02T03:04:05+00:00` / `2020-01-02T03:04:05.123456+00:00`.
//!   Used where Django serializers call `.isoformat()` themselves
//!   (PigPhoto `date`, album-date `date`).
//! * [`drf_datetime`]: DRF `DateTimeField` / JSON encoder output: the same
//!   but with `Z` instead of `+00:00`. Used for plain model datetime fields
//!   and datetimes returned from `SerializerMethodField`s.
//!
//! Microseconds are printed only when non-zero, as Python does.

use chrono::{DateTime, NaiveDate, SecondsFormat, Timelike, Utc};

pub fn py_isoformat(dt: &DateTime<Utc>) -> String {
    let mut s = base(dt);
    s.push_str("+00:00");
    s
}

pub fn drf_datetime(dt: &DateTime<Utc>) -> String {
    let mut s = base(dt);
    s.push('Z');
    s
}

pub fn py_date_isoformat(d: &NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn base(dt: &DateTime<Utc>) -> String {
    let micros = dt.nanosecond() / 1000 % 1_000_000;
    let mut s = dt.format("%Y-%m-%dT%H:%M:%S").to_string();
    if micros != 0 {
        s.push_str(&format!(".{micros:06}"));
    }
    s
}

/// RFC 3339 with `Z`, whole seconds (for our own new fields, not Django parity).
pub fn rfc3339(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// `#[serde(serialize_with = "lp_core::time::ser_drf")]` for `DateTime<Utc>`.
pub fn ser_drf<S: serde::Serializer>(dt: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&drf_datetime(dt))
}

/// `#[serde(serialize_with = "lp_core::time::ser_drf_opt")]` for `Option<DateTime<Utc>>` (None → null).
pub fn ser_drf_opt<S: serde::Serializer>(
    dt: &Option<DateTime<Utc>>,
    s: S,
) -> Result<S::Ok, S::Error> {
    match dt {
        Some(dt) => s.serialize_str(&drf_datetime(dt)),
        None => s.serialize_none(),
    }
}

/// `#[serde(serialize_with = "lp_core::time::ser_iso")]` for `DateTime<Utc>` (`+00:00`).
pub fn ser_iso<S: serde::Serializer>(dt: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&py_isoformat(dt))
}

/// `#[serde(serialize_with = "lp_core::time::ser_iso_opt")]` for `Option<DateTime<Utc>>` (None → null).
pub fn ser_iso_opt<S: serde::Serializer>(
    dt: &Option<DateTime<Utc>>,
    s: S,
) -> Result<S::Ok, S::Error> {
    match dt {
        Some(dt) => s.serialize_str(&py_isoformat(dt)),
        None => s.serialize_none(),
    }
}

/// Parse what Django's `DateTimeField` accepts from clients: ISO 8601 with
/// `Z`/offset, or naive (taken as UTC, Django's `TIME_ZONE`).
pub fn parse_client_datetime(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f%:z",
        "%Y-%m-%d %H:%M:%S%.f%:z",
        "%Y-%m-%dT%H:%M:%S%.f%z",
        "%Y-%m-%d %H:%M:%S%.f%z",
    ] {
        if let Ok(dt) = DateTime::parse_from_str(s, fmt) {
            return Some(dt.with_timezone(&Utc));
        }
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Some(ndt.and_utc());
        }
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|n| n.and_utc())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn formats() {
        let dt = Utc.with_ymd_and_hms(2020, 1, 2, 3, 4, 5).unwrap();
        assert_eq!(py_isoformat(&dt), "2020-01-02T03:04:05+00:00");
        assert_eq!(drf_datetime(&dt), "2020-01-02T03:04:05Z");
        let dt = dt + chrono::Duration::microseconds(1234);
        assert_eq!(py_isoformat(&dt), "2020-01-02T03:04:05.001234+00:00");
        assert_eq!(drf_datetime(&dt), "2020-01-02T03:04:05.001234Z");
        assert_eq!(
            py_date_isoformat(&NaiveDate::from_ymd_opt(2021, 3, 4).unwrap()),
            "2021-03-04"
        );
    }

    #[test]
    fn parse() {
        let want = Utc.with_ymd_and_hms(2020, 1, 2, 3, 4, 5).unwrap();
        assert_eq!(parse_client_datetime("2020-01-02T03:04:05Z"), Some(want));
        assert_eq!(
            parse_client_datetime("2020-01-02T04:04:05+01:00"),
            Some(want)
        );
        assert_eq!(parse_client_datetime("2020-01-02 03:04:05"), Some(want));
        assert!(parse_client_datetime("nope").is_none());
    }
}

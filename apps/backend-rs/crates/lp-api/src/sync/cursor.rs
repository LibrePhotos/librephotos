//! The sync cursor token and the Python parsing rules the Django views
//! apply to query parameters.
//!
//! A cursor is `urlsafe_b64encode(f"{last_modified.isoformat()}|{pk}")`.
//! Decoding follows `decode_cursor`: lenient base64 (`binascii.a2b_base64`,
//! non-strict), strict UTF-8, split on the first `|`, then
//! `datetime.fromisoformat` (CPython 3.11).

use base64::Engine;
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use lp_core::time::py_isoformat;

/// `encode_cursor(last_modified, pk)`.
pub fn encode(last_modified: &DateTime<Utc>, pk: &str) -> String {
    let raw = format!("{}|{pk}", py_isoformat(last_modified));
    base64::engine::general_purpose::URL_SAFE.encode(raw.as_bytes())
}

/// The datetime half of a decoded cursor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorTime {
    Aware(DateTime<Utc>),
    /// No UTC offset: Django compares it with an aware horizon and raises
    /// `TypeError` (a 500).
    Naive(NaiveDateTime),
}

/// `decode_cursor`: `None` where Django answers 400 `invalid_cursor`.
pub fn decode(cursor: &str) -> Option<(CursorTime, String)> {
    let translated: Vec<u8> = cursor
        .bytes()
        .map(|b| match b {
            b'-' => b'+',
            b'_' => b'/',
            b => b,
        })
        .collect();
    let bytes = a2b_base64(&translated)?;
    let raw = String::from_utf8(bytes).ok()?;
    let (iso, pk) = raw.split_once('|')?;
    let dt = fromisoformat(iso)?;
    Some((dt, pk.to_string()))
}

/// CPython `binascii.a2b_base64(data, strict_mode=False)`: characters outside
/// the alphabet are skipped, a complete pad sequence ends the input, and a
/// dangling quad is an error.
fn a2b_base64(data: &[u8]) -> Option<Vec<u8>> {
    fn value(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(data.len() * 3 / 4);
    let mut quad_pos = 0u8;
    let mut left: u8 = 0;
    let mut pads = 0u8;
    for &c in data {
        if c == b'=' {
            if quad_pos >= 2 {
                pads += 1;
                if quad_pos + pads >= 4 {
                    return Some(out);
                }
            }
            continue;
        }
        let Some(v) = value(c) else { continue };
        pads = 0;
        match quad_pos {
            0 => {
                quad_pos = 1;
                left = v;
            }
            1 => {
                quad_pos = 2;
                out.push((left << 2) | (v >> 4));
                left = v & 0x0f;
            }
            2 => {
                quad_pos = 3;
                out.push((left << 4) | (v >> 2));
                left = v & 0x03;
            }
            _ => {
                quad_pos = 0;
                out.push((left << 6) | v);
                left = 0;
            }
        }
    }
    if quad_pos != 0 {
        return None;
    }
    Some(out)
}

fn digits(s: &[u8], n: usize) -> Option<u32> {
    if s.len() < n || !s[..n].iter().all(u8::is_ascii_digit) {
        return None;
    }
    Some(
        s[..n]
            .iter()
            .fold(0u32, |a, d| a * 10 + u32::from(d - b'0')),
    )
}

/// `datetime.fromisoformat` (CPython 3.11) for calendar dates: `YYYY-MM-DD`
/// or `YYYYMMDD`, then optionally any one separator character and a time
/// `HH[:MM[:SS[.f+]]]` (or basic `HHMM[SS[.f+]]`, `,` also separates the
/// fraction; digits past the sixth are dropped) with an optional offset `Z`
/// / `±HH[:MM[:SS[.f]]]` / `±HHMM`. ISO week dates are not accepted (a 400
/// here, a naive datetime and so a 500 on Django).
pub fn fromisoformat(s: &str) -> Option<CursorTime> {
    let b = s.as_bytes();
    let (date, rest) = if b.len() >= 10 && b[4] == b'-' && b[7] == b'-' {
        let d = NaiveDate::from_ymd_opt(
            digits(b, 4)? as i32,
            digits(&b[5..], 2)?,
            digits(&b[8..], 2)?,
        )?;
        (d, &s[10..])
    } else if b.len() >= 8 && b[..8].iter().all(u8::is_ascii_digit) {
        let d = NaiveDate::from_ymd_opt(
            digits(b, 4)? as i32,
            digits(&b[4..], 2)?,
            digits(&b[6..], 2)?,
        )?;
        (d, &s[8..])
    } else {
        return None;
    };
    if digits(b, 4)? == 0 {
        return None;
    }
    if rest.is_empty() {
        return Some(CursorTime::Naive(date.and_hms_opt(0, 0, 0)?));
    }
    // One separator character (any), then the time.
    let mut chars = rest.chars();
    chars.next()?;
    let time_str = chars.as_str();
    let (time, offset) = parse_time(time_str)?;
    let naive = date.and_time(time);
    match offset {
        None => Some(CursorTime::Naive(naive)),
        Some(off) => {
            let local = off.from_local_datetime(&naive).single()?;
            Some(CursorTime::Aware(local.with_timezone(&Utc)))
        }
    }
}

/// `HH[:MM[:SS[.ffffff]]]` + offset, as `_parse_isoformat_time`.
fn parse_time(s: &str) -> Option<(NaiveTime, Option<FixedOffset>)> {
    let b = s.as_bytes();
    let tz_at = b.iter().position(|c| matches!(c, b'+' | b'-' | b'Z'));
    let (time_b, tz_b) = match tz_at {
        Some(i) => (&b[..i], Some(&b[i..])),
        None => (b, None),
    };
    let (h, m, sec, us) = parse_hms(time_b)?;
    let time = NaiveTime::from_hms_micro_opt(h, m, sec, us)?;
    let offset = match tz_b {
        None => None,
        Some(tz) if tz == b"Z" => Some(FixedOffset::east_opt(0)?),
        Some(tz) => {
            let sign: i32 = if tz[0] == b'-' { -1 } else { 1 };
            let body = &tz[1..];
            if body.is_empty() {
                return None;
            }
            let (oh, om, os, ous) = parse_hms(body)?;
            if oh >= 24 {
                return None;
            }
            let total = Duration::hours(i64::from(oh))
                + Duration::minutes(i64::from(om))
                + Duration::seconds(i64::from(os))
                + Duration::microseconds(i64::from(ous));
            if ous != 0 {
                // A fractional-second offset cannot be a FixedOffset.
                return None;
            }
            Some(FixedOffset::east_opt(sign * total.num_seconds() as i32)?)
        }
    };
    Some((time, offset))
}

/// `HH[:MM[:SS[(.|,)f+]]]` or basic `HH[MM[SS[(.|,)f+]]]`.
fn parse_hms(b: &[u8]) -> Option<(u32, u32, u32, u32)> {
    let extended = b.len() > 2 && b[2] == b':';
    let mut pos = 0usize;
    let mut parts = [0u32; 3];
    let mut n = 0;
    while n < 3 && pos < b.len() {
        if n > 0 && extended {
            if b[pos] != b':' {
                return None;
            }
            pos += 1;
        }
        parts[n] = digits(&b[pos..], 2)?;
        pos += 2;
        n += 1;
        if pos < b.len() && matches!(b[pos], b'.' | b',') {
            break;
        }
    }
    if n == 0 {
        return None;
    }
    let mut us = 0u32;
    if pos < b.len() {
        if !matches!(b[pos], b'.' | b',') || n < 3 {
            return None;
        }
        let frac = &b[pos + 1..];
        if frac.is_empty() || !frac.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let take = frac.len().min(6);
        us = digits(frac, take)?;
        for _ in take..6 {
            us *= 10;
        }
    }
    Some((parts[0], parts[1], parts[2], us))
}

/// Python `int(text)` for a `str`: surrounding whitespace, a sign, ASCII
/// digits with single underscores between them. Values past `i64` saturate.
pub fn py_int(text: &str) -> Option<i64> {
    let t = text.trim();
    let (neg, digits) = match t.as_bytes().first()? {
        b'-' => (true, &t[1..]),
        b'+' => (false, &t[1..]),
        _ => (false, t),
    };
    let b = digits.as_bytes();
    if b.is_empty() || !b[0].is_ascii_digit() || !b[b.len() - 1].is_ascii_digit() {
        return None;
    }
    let mut v: i128 = 0;
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'0'..=b'9' => {
                v = (v * 10 + i128::from(c - b'0')).min(i128::from(u64::MAX));
            }
            b'_' if b[i - 1].is_ascii_digit() && b[i + 1].is_ascii_digit() => {}
            _ => return None,
        }
    }
    if neg {
        v = -v;
    }
    Some(v.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64)
}

/// Python `float(text)` for a `str`: surrounding whitespace, underscores
/// between digits, `inf` / `infinity` / `nan` in any case.
pub fn py_float(text: &str) -> Option<f64> {
    let t = text.trim();
    let b = t.as_bytes();
    if t.contains('_') {
        for (i, &c) in b.iter().enumerate() {
            if c == b'_'
                && !(i > 0
                    && b[i - 1].is_ascii_digit()
                    && b.get(i + 1).is_some_and(u8::is_ascii_digit))
            {
                return None;
            }
        }
    }
    t.replace('_', "").parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aware(s: &str) -> DateTime<Utc> {
        match fromisoformat(s) {
            Some(CursorTime::Aware(d)) => d,
            other => panic!("{s}: {other:?}"),
        }
    }

    #[test]
    fn cursor_round_trip() {
        let dt =
            Utc.with_ymd_and_hms(2026, 10, 6, 12, 0, 1).unwrap() + Duration::microseconds(123_456);
        let c = encode(&dt, "5");
        // Python: urlsafe_b64encode(b"2026-10-06T12:00:01.123456+00:00|5")
        assert_eq!(c, "MjAyNi0xMC0wNlQxMjowMDowMS4xMjM0NTYrMDA6MDB8NQ==");
        assert_eq!(decode(&c), Some((CursorTime::Aware(dt), "5".into())));
    }

    #[test]
    fn lenient_base64() {
        // Characters outside the alphabet are skipped; "!!!not-base64!!!"
        // leaves 9 data characters ("not+base64" minus one), a dangling quad.
        assert_eq!(decode("!!!not-base64!!!"), None);
        assert_eq!(a2b_base64(b"YQ=="), Some(b"a".to_vec()));
        assert_eq!(a2b_base64(b"YQ==YWJj"), Some(b"a".to_vec()));
        assert_eq!(a2b_base64(b"Y Q = ="), Some(b"a".to_vec()));
        assert_eq!(a2b_base64(b"YQ"), None);
        assert_eq!(a2b_base64(b"Y"), None);
        assert_eq!(a2b_base64(b"YWJj"), Some(b"abc".to_vec()));
    }

    #[test]
    fn isoformat_variants() {
        let base = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
        assert_eq!(aware("2026-01-02T03:04:05+00:00"), base);
        assert_eq!(aware("2026-01-02 03:04:05Z"), base);
        assert_eq!(aware("20260102T030405Z"), base);
        assert_eq!(aware("2026-01-02T05:04:05+02:00"), base);
        assert_eq!(aware("2026-01-02T05:04:05+0200"), base);
        assert_eq!(aware("2026-01-02T05:04:05+02"), base);
        assert_eq!(
            aware("2026-01-02T03:04:05.1234567+00:00"),
            base + Duration::microseconds(123_456)
        );
        assert_eq!(
            aware("2026-01-02T03:04:05,5Z"),
            base + Duration::microseconds(500_000)
        );
        assert_eq!(
            aware("2026-01-02T03:04Z"),
            Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 0).unwrap()
        );
        assert!(matches!(
            fromisoformat("2026-01-02T03:04:05"),
            Some(CursorTime::Naive(_))
        ));
        assert!(matches!(
            fromisoformat("2026-01-02"),
            Some(CursorTime::Naive(_))
        ));
        assert_eq!(fromisoformat("2026-13-02T03:04:05Z"), None);
        assert_eq!(fromisoformat("garbage"), None);
        assert_eq!(fromisoformat("2026-01-02T25:00:00Z"), None);
        assert_eq!(fromisoformat("2026-01-02T03:04:05+24:00"), None);
    }

    #[test]
    fn python_numbers() {
        assert_eq!(py_int(" 42 "), Some(42));
        assert_eq!(py_int("1_000"), Some(1000));
        assert_eq!(py_int("-3"), Some(-3));
        assert_eq!(py_int("+7"), Some(7));
        assert_eq!(py_int("1__0"), None);
        assert_eq!(py_int("_1"), None);
        assert_eq!(py_int(""), None);
        assert_eq!(py_int("1.5"), None);
        assert_eq!(py_int("99999999999999999999999"), Some(i64::MAX));
        assert_eq!(py_float(" 1.5 "), Some(1.5));
        assert_eq!(py_float("1_0.5"), Some(10.5));
        assert!(py_float("inf").unwrap().is_infinite());
        assert!(py_float("NaN").unwrap().is_nan());
        assert_eq!(py_float("abc"), None);
        assert_eq!(py_float("_1"), None);
    }
}

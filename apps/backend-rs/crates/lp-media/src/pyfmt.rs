//! Python/Django string behaviour the media views' headers depend on:
//! `os.path.basename/splitext`, `urllib.parse.quote`, `iri_to_uri`, and how
//! Django turns a header value into bytes.

use axum::http::HeaderValue;
use base64::Engine;

fn is_sep(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// `os.path.basename` (ntpath on Windows: both separators).
pub fn basename(path: &str) -> &str {
    match path.rfind(is_sep) {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

/// `os.path.dirname`.
pub fn dirname(path: &str) -> &str {
    match path.rfind(is_sep) {
        Some(i) => {
            let head = &path[..i];
            let trimmed = head.trim_end_matches(is_sep);
            if trimmed.is_empty() || trimmed.ends_with(':') {
                &path[..i + 1]
            } else {
                trimmed
            }
        }
        None => "",
    }
}

/// The extension `os.path.splitext` reports (with its dot), or `""`.
pub fn ext(path: &str) -> &str {
    let base = basename(path);
    let stripped = base.trim_start_matches('.');
    match stripped.rfind('.') {
        Some(i) => &stripped[i..],
        None => "",
    }
}

const UNRESERVED: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~";

/// `urllib.parse.quote(s, safe=safe)` on the UTF-8 bytes of `s`.
pub fn quote(s: &str, safe: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if UNRESERVED.contains(&b) || (b.is_ascii() && safe.as_bytes().contains(&b)) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `django.utils.encoding.iri_to_uri`.
pub fn iri_to_uri(iri: &str) -> String {
    quote(iri, "/#%[]=:;$&()+,!?*@'~")
}

/// A header value the way Django emits it: latin-1 when the text fits,
/// else RFC 2047 (`email.header.Header(value, "utf-8").encode()`).
pub fn header_value(text: &str) -> HeaderValue {
    let latin1: Option<Vec<u8>> = text
        .chars()
        .map(|c| u8::try_from(u32::from(c)).ok())
        .collect();
    let bytes = match latin1 {
        Some(b) => b,
        None => mime_encode_utf8(text).into_bytes(),
    };
    HeaderValue::from_bytes(&bytes)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"))
}

/// `Header(value, "utf-8", maxlinelen=sys.maxsize).encode()`: one encoded
/// word, quoted-printable unless base64 is strictly shorter (the utf-8
/// charset's SHORTEST header encoding).
fn mime_encode_utf8(text: &str) -> String {
    let bytes = text.as_bytes();
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let mut qp = String::with_capacity(bytes.len() * 3);
    for &b in bytes {
        if b.is_ascii_alphanumeric() || b"-!*+/".contains(&b) {
            qp.push(b as char);
        } else if b == b' ' {
            qp.push('_');
        } else {
            qp.push_str(&format!("={b:02X}"));
        }
    }
    if b64.len() < qp.len() {
        format!("=?utf-8?b?{b64}?=")
    } else {
        format!("=?utf-8?q?{qp}?=")
    }
}

/// `django.utils.http.content_disposition_header(False, filename)`.
pub fn inline_disposition(filename: &str) -> String {
    let quotable = filename
        .bytes()
        .all(|b| b == b'\t' || b == b' ' || (0x21..=0x7e).contains(&b));
    if quotable {
        format!(
            "inline; filename=\"{}\"",
            filename.replace('\\', "\\\\").replace('"', "\\\"")
        )
    } else {
        format!("inline; filename*=utf-8''{}", quote(filename, "/"))
    }
}

/// Python's `str(float)` for the values ffmpeg options take.
pub fn py_float(x: f64) -> String {
    if x.fract() == 0.0 && x.abs() < 1e16 {
        format!("{x:.1}")
    } else {
        format!("{x}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_matches_python() {
        assert_eq!(quote("/a b/ü.jpg", "/"), "/a%20b/%C3%BC.jpg");
        assert_eq!(iri_to_uri("C:\\x\\a b.mp4"), "C:%5Cx%5Ca%20b.mp4");
        assert_eq!(iri_to_uri("/original/100%25"), "/original/100%25");
    }

    #[test]
    fn splitext_and_basename() {
        assert_eq!(ext("thumbnails_big/x.webp"), ".webp");
        assert_eq!(ext(".hidden"), "");
        assert_eq!(ext("a.b/c"), "");
        assert_eq!(basename("faces/x_0.jpg"), "x_0.jpg");
        assert_eq!(dirname("transcoded/x.mp4"), "transcoded");
        assert_eq!(dirname("/x"), "/");
    }

    #[test]
    fn header_encoding_matches_django() {
        let v =
            header_value("inline; filename=\"C:\\x\\Stra\u{df}e \u{2600} \u{6771}\u{4eac}.jpg\"");
        assert_eq!(
            v.as_bytes(),
            b"=?utf-8?b?aW5saW5lOyBmaWxlbmFtZT0iQzpceFxTdHJhw59lIOKYgCDmnbHkuqwuanBnIg==?="
        );
        let long = format!("{}\u{2600}", "a".repeat(300));
        let v = header_value(&long);
        assert!(v.as_bytes().starts_with(b"=?utf-8?q?aaa"));
        assert!(v.as_bytes().ends_with(b"a=E2=98=80?="));
        assert_eq!(header_value("Stra\u{df}e").as_bytes(), b"Stra\xdfe");
    }

    #[test]
    fn disposition() {
        assert_eq!(
            inline_disposition("a\"b.jpg"),
            "inline; filename=\"a\\\"b.jpg\""
        );
        assert_eq!(
            inline_disposition("Stra\u{df}e.jpg"),
            "inline; filename*=utf-8''Stra%C3%9Fe.jpg"
        );
        assert_eq!(py_float(2.0), "2.0");
        assert_eq!(py_float(1.5), "1.5");
    }
}

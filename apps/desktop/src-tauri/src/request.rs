//! Parsing of `lpview` URLs: `<scheme>://<host>/<kind>?path=..&w=..&h=..&v=..`.

use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Thumb,
    Screen,
    Full,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "thumb" => Some(Kind::Thumb),
            "screen" => Some(Kind::Screen),
            "full" => Some(Kind::Full),
            _ => None,
        }
    }
}

/// Long edge of a `thumb`.
pub const THUMB_EDGE: u32 = 320;
/// `screen` box when the URL carries no (or a zero) size.
pub const DEFAULT_SCREEN: (u32, u32) = (1920, 1080);
const MAX_SCREEN_EDGE: u32 = 16384;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageRequest {
    pub kind: Kind,
    pub path: PathBuf,
    /// Bounding box in device pixels (thumb: 320x320, full: unbounded).
    pub w: u32,
    pub h: u32,
}

pub fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        // URLSearchParams encodes spaces as '+'.
        (k == key).then(|| {
            let v = v.replace('+', " ");
            percent_encoding::percent_decode_str(&v)
                .decode_utf8_lossy()
                .into_owned()
        })
    })
}

/// Parse the path and query of an `lpview` URL. Errors are plain-text reasons (answered 400).
pub fn parse(uri_path: &str, query: Option<&str>) -> Result<ImageRequest, String> {
    let kind_str = uri_path.trim_matches('/');
    let kind = Kind::parse(kind_str).ok_or_else(|| format!("unknown kind '{kind_str}'"))?;
    let query = query.unwrap_or("");
    let path = query_param(query, "path")
        .filter(|p| !p.is_empty())
        .ok_or("missing path")?;
    let num = |k: &str| {
        query_param(query, k)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    let (w, h) = match kind {
        Kind::Thumb => (THUMB_EDGE, THUMB_EDGE),
        Kind::Full => (u32::MAX, u32::MAX),
        Kind::Screen => {
            let (w, h) = (num("w").round(), num("h").round());
            if w < 1.0 || h < 1.0 {
                DEFAULT_SCREEN
            } else {
                (
                    (w as u32).min(MAX_SCREEN_EDGE),
                    (h as u32).min(MAX_SCREEN_EDGE),
                )
            }
        }
    };
    Ok(ImageRequest {
        kind,
        path: PathBuf::from(path),
        w,
        h,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_screen_url() {
        let r = parse(
            "/screen",
            Some("path=C%3A%5CUsers%5Cme%5CIMG%201.jpg&v=1700000000000&w=2560&h=1440"),
        )
        .unwrap();
        assert_eq!(r.kind, Kind::Screen);
        assert_eq!(r.path, PathBuf::from(r"C:\Users\me\IMG 1.jpg"));
        assert_eq!((r.w, r.h), (2560, 1440));
    }

    #[test]
    fn plus_is_space_and_utf8_survives() {
        let r = parse("thumb", Some("v=1&path=C%3A%5Cf%C3%BCr+mich%5Ca%2Bb.jpg")).unwrap();
        assert_eq!(r.path, PathBuf::from(r"C:\für mich\a+b.jpg"));
        assert_eq!((r.w, r.h), (THUMB_EDGE, THUMB_EDGE));
    }

    #[test]
    fn defaults_and_errors() {
        let r = parse("/screen", Some("path=x.jpg&w=0")).unwrap();
        assert_eq!((r.w, r.h), DEFAULT_SCREEN);
        let r = parse("/screen", Some("path=x.jpg&w=99999&h=1080.4")).unwrap();
        assert_eq!((r.w, r.h), (16384, 1080));
        assert_eq!(parse("/full", Some("path=x.jpg")).unwrap().w, u32::MAX);
        assert!(parse("/nope", Some("path=x.jpg")).is_err());
        assert!(parse("/full", Some("v=1")).is_err());
        assert!(parse("/full", None).is_err());
    }
}

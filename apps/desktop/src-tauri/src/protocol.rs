//! The `lpview` URI scheme handler (CONTRACT.md "The lpview URI scheme").

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{Request, Response, StatusCode};

use crate::decode::RenderError;
use crate::formats::{FileKind, ext_of, kind_of_ext, mime_for_ext};
use crate::pipeline::{Pipeline, Reply};
use crate::request::{self, Kind};

/// Longest chunk served for an open-ended video range request.
const MAX_RANGE_CHUNK: u64 = 8 * 1024 * 1024;

fn base(status: StatusCode, mime: &str) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", "x-lp-width, x-lp-height")
}

pub fn text(status: StatusCode, msg: impl Into<String>) -> Response<Vec<u8>> {
    base(status, "text/plain; charset=utf-8")
        .body(msg.into().into_bytes())
        .unwrap()
}

fn error_response(e: &RenderError) -> Response<Vec<u8>> {
    let status = match e {
        RenderError::NotFound(_) => StatusCode::NOT_FOUND,
        RenderError::Unsupported(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        RenderError::Failed(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    text(status, e.to_string())
}

pub fn reply_response(r: Reply) -> Response<Vec<u8>> {
    match r {
        Ok(e) => base(StatusCode::OK, e.mime)
            .header("Cache-Control", "max-age=31536000, immutable")
            .header("x-lp-width", e.width)
            .header("x-lp-height", e.height)
            .body(e.bytes.clone())
            .unwrap(),
        Err(e) => error_response(&e),
    }
}

/// Handle one request; `respond` is called exactly once, possibly on another thread.
pub fn handle(
    pipeline: &Pipeline,
    request: &Request<Vec<u8>>,
    respond: impl FnOnce(Response<Vec<u8>>) + Send + 'static,
) {
    let uri = request.uri();
    let req = match request::parse(uri.path(), uri.query()) {
        Ok(r) => r,
        Err(e) => return respond(text(StatusCode::BAD_REQUEST, e)),
    };
    let ext = ext_of(&req.path);
    let Some(fk) = kind_of_ext(&ext) else {
        return respond(text(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            format!("unsupported file type '.{ext}'"),
        ));
    };
    if fk == FileKind::Video && req.kind == Kind::Full {
        let range = request
            .headers()
            .get("range")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        std::thread::spawn(move || respond(serve_range(&req.path, range.as_deref())));
        return;
    }
    pipeline.submit_with(
        req.path,
        req.kind,
        req.w,
        req.h,
        request::priority(uri.query()),
        Box::new(move |r| respond(reply_response(r))),
    );
}

/// Parse a single `bytes=` range against a file of `len` bytes into an inclusive range.
pub fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.trim().strip_prefix("bytes=")?;
    let spec = spec.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return None;
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() {
            start + MAX_RANGE_CHUNK - 1
        } else {
            b.parse().ok()?
        };
        (start, end.min(len.checked_sub(1)?))
    };
    (start <= end && start < len).then_some((start, end))
}

/// A video (or any file) with `Range` support so `<video>` can seek.
pub fn serve_range(path: &Path, range: Option<&str>) -> Response<Vec<u8>> {
    let mime = mime_for_ext(&ext_of(path));
    let Ok(mut f) = std::fs::File::open(path) else {
        return text(
            StatusCode::NOT_FOUND,
            format!("{} not found", path.display()),
        );
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let (status, start, end) = match range {
        Some(r) => match parse_range(r, len) {
            Some((s, e)) => (StatusCode::PARTIAL_CONTENT, s, e),
            None => {
                return base(StatusCode::RANGE_NOT_SATISFIABLE, "text/plain")
                    .header("Content-Range", format!("bytes */{len}"))
                    .body(Vec::new())
                    .unwrap();
            }
        },
        None if len > MAX_RANGE_CHUNK => (StatusCode::PARTIAL_CONTENT, 0, MAX_RANGE_CHUNK - 1),
        None => (StatusCode::OK, 0, len.saturating_sub(1)),
    };
    let n = if len == 0 { 0 } else { end - start + 1 };
    let mut buf = vec![0u8; n as usize];
    if f.seek(SeekFrom::Start(start))
        .and_then(|_| f.read_exact(&mut buf))
        .is_err()
    {
        return text(StatusCode::INTERNAL_SERVER_ERROR, "read failed");
    }
    let mut b = base(status, mime)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-cache");
    if status == StatusCode::PARTIAL_CONTENT {
        b = b.header("Content-Range", format!("bytes {start}-{end}/{len}"));
    }
    b.body(buf).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(
            parse_range("bytes=0-", 100 << 20),
            Some((0, MAX_RANGE_CHUNK - 1))
        );
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=500-5000", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-1", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-1", 0), None);
    }

    #[test]
    fn serves_partial_content() {
        let dir = std::env::temp_dir().join(format!("lpview-range-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("v.mp4");
        std::fs::write(&p, (0..=255u8).collect::<Vec<_>>()).unwrap();
        let r = serve_range(&p, Some("bytes=10-19"));
        assert_eq!(r.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(r.body(), &(10..20u8).collect::<Vec<_>>());
        assert_eq!(r.headers()["content-range"], "bytes 10-19/256");
        assert_eq!(r.headers()["content-type"], "video/mp4");
        let r = serve_range(&p, None);
        assert_eq!((r.status(), r.body().len()), (StatusCode::OK, 256));
        assert_eq!(
            serve_range(&p, Some("bytes=300-")).status(),
            StatusCode::RANGE_NOT_SATISFIABLE
        );
        assert_eq!(
            serve_range(&dir.join("x.mp4"), None).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn handles_bad_requests() {
        let pipe = Pipeline::new(2, 1 << 20);
        let (tx, rx) = std::sync::mpsc::channel();
        let req = |u: &str| Request::builder().uri(u).body(Vec::new()).unwrap();
        for (u, status) in [
            ("http://lpview.localhost/nope?path=a.jpg", 400),
            ("http://lpview.localhost/thumb?path=C%3A%5Cnotes.txt", 415),
            (
                "http://lpview.localhost/thumb?path=C%3A%5Cmissing%5Cx.jpg&v=1",
                404,
            ),
        ] {
            let tx = tx.clone();
            handle(&pipe, &req(u), move |r| _ = tx.send(r.status().as_u16()));
            assert_eq!(rx.recv().unwrap(), status, "{u}");
        }
    }
}

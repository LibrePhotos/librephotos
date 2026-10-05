//! Response builders shared by the media routes: Django's empty status
//! responses, X-Accel hand-offs, and direct file serving with a single byte
//! range (`api/http_range.py`), confined to the roots the file may live in.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::header::{
    ACCEPT_RANGES, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use tokio_util::io::ReaderStream;

use crate::mime;
use crate::pyfmt;

const DJANGO_DEFAULT_TYPE: &str = "text/html; charset=utf-8";
/// Files up to this size are read in one go on the blocking pool; larger
/// ones are streamed in 64 KiB chunks.
const INLINE_READ_MAX: u64 = 1024 * 1024;
const CHUNK: usize = 64 * 1024;

pub static X_ACCEL_REDIRECT: HeaderName = HeaderName::from_static("x-accel-redirect");
pub static X_MEDIA_ERROR: HeaderName = HeaderName::from_static("x-media-error");

/// Django's `HttpResponse(status=...)`: no body, the default content type.
pub fn empty(status: StatusCode) -> Response {
    let mut res = Response::new(Body::empty());
    *res.status_mut() = status;
    res.headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(DJANGO_DEFAULT_TYPE));
    res.headers_mut()
        .insert(CONTENT_LENGTH, HeaderValue::from_static("0"));
    res
}

/// `_forbidden_unauthenticated`: a 403 marked as a missing session, so the
/// frontend can tell it from a web server refusing to read the file.
pub fn forbidden_unauthenticated() -> Response {
    let mut res = empty(StatusCode::FORBIDDEN);
    res.headers_mut().insert(
        X_MEDIA_ERROR.clone(),
        HeaderValue::from_static("authentication"),
    );
    res
}

/// `_refuse`: anonymous callers are asked to sign in, everyone else gets the
/// same 404 as for a hash matching nothing.
pub fn refuse(signed_in: bool) -> Response {
    if signed_in {
        empty(StatusCode::NOT_FOUND)
    } else {
        forbidden_unauthenticated()
    }
}

/// An empty 200 carrying `Content-Type` and `X-Accel-Redirect` for nginx.
pub fn x_accel(content_type: &str, target: &str) -> Response {
    let mut res = empty(StatusCode::OK);
    res.headers_mut()
        .insert(CONTENT_TYPE, pyfmt::header_value(content_type));
    res.headers_mut()
        .insert(X_ACCEL_REDIRECT.clone(), pyfmt::header_value(target));
    res
}

/// A file to serve directly and the roots it must resolve inside of.
#[derive(Debug, Clone)]
pub struct FileRequest {
    /// The path as Django would open it (its basename names the download).
    pub path: PathBuf,
    /// The canonical file must lie under one of these (after canonicalizing).
    pub roots: Vec<PathBuf>,
    /// `None` = sniff it (`api.mime.mime_type`).
    pub content_type: Option<String>,
}

impl FileRequest {
    pub fn new(
        path: impl Into<PathBuf>,
        root: impl Into<PathBuf>,
        content_type: Option<&str>,
    ) -> Self {
        FileRequest {
            path: path.into(),
            roots: vec![root.into()],
            content_type: content_type.map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Range {
    Whole,
    Part(u64, u64),
    Unsatisfiable,
}

fn digits(s: &str) -> Option<Option<u64>> {
    if s.is_empty() {
        return Some(None);
    }
    if !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(Some(s.parse::<u64>().unwrap_or(u64::MAX)))
}

/// `parse_byte_range`: one `bytes=a-b` range, anything else = whole file.
fn parse_range(header: Option<&str>, size: u64) -> Range {
    let Some(header) = header else {
        return Range::Whole;
    };
    if size == 0 {
        return Range::Whole;
    }
    let Some(spec) = header.trim().strip_prefix("bytes=") else {
        return Range::Whole;
    };
    let Some((first, last)) = spec.split_once('-') else {
        return Range::Whole;
    };
    let (Some(first), Some(last)) = (digits(first), digits(last)) else {
        return Range::Whole;
    };
    match (first, last) {
        (None, None) => Range::Whole,
        (None, Some(n)) => {
            let length = n.min(size);
            if length == 0 {
                Range::Unsatisfiable
            } else {
                Range::Part(size - length, size - 1)
            }
        }
        (Some(start), last) => {
            if start >= size {
                return Range::Unsatisfiable;
            }
            let end = last.map_or(size - 1, |l| l.min(size - 1));
            if end < start {
                Range::Unsatisfiable
            } else {
                Range::Part(start, end)
            }
        }
    }
}

enum Opened {
    Status(StatusCode),
    Ready {
        file: File,
        size: u64,
        content_type: String,
        inline: Option<Vec<u8>>,
        range: Range,
    },
}

/// `path` made absolute, symlinks left alone; on Windows also case-folded
/// with one separator style. None for a path with `..` in it: behind a link
/// `..` climbs from the link's target, so it cannot be resolved as text.
fn lexical(path: &Path) -> Option<PathBuf> {
    use std::path::Component;
    if path.components().any(|c| c == Component::ParentDir) {
        return None;
    }
    let out = std::path::absolute(path).ok()?;
    if cfg!(windows) {
        let folded = out.to_string_lossy().replace('/', "\\").to_lowercase();
        let folded = folded.strip_prefix(r"\\?\").unwrap_or(&folded).to_string();
        return Some(PathBuf::from(folded));
    }
    Some(out)
}

/// Whether `path` lies under one of `roots`. The scanner follows symlinks
/// and installs link thumbnail or library folders to other disks, so a path
/// passes when it is inside a root as written (with no `..`), or after
/// resolving every link on both sides.
fn confined(path: &Path, roots: &[PathBuf]) -> bool {
    if let Some(p) = lexical(path)
        && roots
            .iter()
            .filter_map(|r| lexical(r))
            .any(|root| p.starts_with(&root))
    {
        return true;
    }
    let Ok(real) = path.canonicalize() else {
        return false;
    };
    roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|root| real.starts_with(&root))
}

fn open_blocking(req: &FileRequest, range_header: Option<&str>, head: bool) -> Opened {
    if !req.path.exists() {
        return Opened::Status(StatusCode::NOT_FOUND);
    }
    if !confined(&req.path, &req.roots) {
        tracing::warn!(path = %req.path.display(), "media path outside its root; refused");
        return Opened::Status(StatusCode::NOT_FOUND);
    }
    let mut file = match File::open(&req.path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Opened::Status(StatusCode::NOT_FOUND);
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Opened::Status(StatusCode::FORBIDDEN);
        }
        Err(_) => return Opened::Status(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let meta = match file.metadata() {
        Ok(m) if m.is_file() => m,
        Ok(_) => return Opened::Status(StatusCode::NOT_FOUND),
        Err(_) => return Opened::Status(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let size = meta.len();
    let content_type = req
        .content_type
        .clone()
        .unwrap_or_else(|| mime::mime_type(&req.path));
    let range = parse_range(range_header, size);
    let wanted = match range {
        Range::Whole => size,
        Range::Part(a, b) => b - a + 1,
        Range::Unsatisfiable => 0,
    };
    let mut inline = None;
    if !head && wanted > 0 && wanted <= INLINE_READ_MAX {
        let mut buf = Vec::with_capacity(wanted as usize);
        if let Range::Part(a, _) = range
            && file.seek(SeekFrom::Start(a)).is_err()
        {
            return Opened::Status(StatusCode::INTERNAL_SERVER_ERROR);
        }
        if (&mut file).take(wanted).read_to_end(&mut buf).is_err() {
            return Opened::Status(StatusCode::INTERNAL_SERVER_ERROR);
        }
        inline = Some(buf);
    }
    Opened::Ready {
        file,
        size,
        content_type,
        inline,
        range,
    }
}

/// `_serve_file_direct` + `ranged_response`. `head` skips reading the body.
pub async fn serve_file(req: FileRequest, range_header: Option<String>, head: bool) -> Response {
    let disposition = pyfmt::inline_disposition(pyfmt::basename(&req.path.to_string_lossy()));
    let opened = match tokio::task::spawn_blocking(move || {
        open_blocking(&req, range_header.as_deref(), head)
    })
    .await
    {
        Ok(o) => o,
        Err(_) => return empty(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let (file, size, content_type, inline, range) = match opened {
        Opened::Status(s) => return empty(s),
        Opened::Ready {
            file,
            size,
            content_type,
            inline,
            range,
        } => (file, size, content_type, inline, range),
    };

    let (status, start, length) = match range {
        Range::Unsatisfiable => {
            let mut res = empty(StatusCode::RANGE_NOT_SATISFIABLE);
            let h = res.headers_mut();
            h.insert(CONTENT_RANGE, header(&format!("bytes */{size}")));
            h.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            return res;
        }
        Range::Whole => (StatusCode::OK, 0, size),
        Range::Part(a, b) => (StatusCode::PARTIAL_CONTENT, a, b - a + 1),
    };

    let body = if head {
        Body::empty()
    } else if let Some(bytes) = inline {
        Body::from(bytes)
    } else {
        let mut file = tokio::fs::File::from_std(file);
        if start > 0 {
            use tokio::io::AsyncSeekExt;
            if file.seek(SeekFrom::Start(start)).await.is_err() {
                return empty(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
        use tokio::io::AsyncReadExt;
        Body::from_stream(ReaderStream::with_capacity(file.take(length), CHUNK))
    };

    let mut res = Response::new(body);
    *res.status_mut() = status;
    let h = res.headers_mut();
    h.insert(CONTENT_TYPE, pyfmt::header_value(&content_type));
    h.insert(CONTENT_LENGTH, header(&length.to_string()));
    if status == StatusCode::OK {
        h.insert(CONTENT_DISPOSITION, header(&disposition));
    } else {
        h.insert(
            CONTENT_RANGE,
            header(&format!("bytes {start}-{}/{size}", start + length - 1)),
        );
    }
    h.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    res
}

fn header(s: &str) -> HeaderValue {
    HeaderValue::from_str(s).unwrap_or_else(|_| HeaderValue::from_static(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_follow_django() {
        assert_eq!(parse_range(None, 10), Range::Whole);
        assert_eq!(parse_range(Some("bytes=0-3"), 10), Range::Part(0, 3));
        assert_eq!(parse_range(Some("bytes=4-"), 10), Range::Part(4, 9));
        assert_eq!(parse_range(Some("bytes=-3"), 10), Range::Part(7, 9));
        assert_eq!(parse_range(Some("bytes=-30"), 10), Range::Part(0, 9));
        assert_eq!(parse_range(Some("bytes=5-99"), 10), Range::Part(5, 9));
        assert_eq!(parse_range(Some("bytes=10-"), 10), Range::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=5-4"), 10), Range::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=-0"), 10), Range::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=0-1,4-5"), 10), Range::Whole);
        assert_eq!(parse_range(Some("items=0-1"), 10), Range::Whole);
        assert_eq!(parse_range(Some("bytes=-"), 10), Range::Whole);
        assert_eq!(parse_range(Some("bytes=0-1"), 0), Range::Whole);
        assert_eq!(parse_range(Some(" bytes=1-2 "), 10), Range::Part(1, 2));
        assert_eq!(
            parse_range(Some("bytes=99999999999999999999999-"), 10),
            Range::Unsatisfiable
        );
    }
}

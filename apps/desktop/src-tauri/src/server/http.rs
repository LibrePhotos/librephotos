//! The api-client's native transport (`createNativeFetch` in `packages/api-client`): the UI
//! encodes a request (JSON, multipart with its boundary, bytes) and Rust sends it, so CORS and the
//! webview's limits never apply. Both directions are one binary IPC message (CONTRACT.md "Server",
//! `http_fetch`):
//!
//! ```text
//! request:  u32 LE n | n bytes of JSON {id, url, method, headers: [[name, value]]} | body
//! response: u32 LE n | n bytes of JSON {status, statusText, headers: [[name, value]]} | body
//! ```
//!
//! Any HTTP status is an answer; only a network failure or an abort rejects (with a string).
//!
//! `fileParts` (the api-client's `nativeFilePart`): each `marker` in the body is replaced by the
//! bytes of a library file's range, read here, so an upload chunk never crosses IPC.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use super::Server;

#[derive(Deserialize, Debug, PartialEq)]
pub struct RequestMeta {
    /// Names the request for `http_fetch_abort`.
    pub id: String,
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    #[serde(default, rename = "fileParts")]
    pub file_parts: Vec<FilePart>,
}

/// A `nativeFilePart` of the body: `marker` stands for `len` bytes from `offset` of library file
/// `id` (the Rust library's row) or of the file at `path` (a supported picture or video; what the
/// TypeScript library hands over, since its rows are not Rust's).
#[derive(Deserialize, Debug, PartialEq)]
pub struct FilePart {
    pub marker: String,
    #[serde(rename = "ref")]
    pub file: FileRange,
}

#[derive(Deserialize, Debug, PartialEq)]
pub struct FileRange {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub path: Option<String>,
    pub offset: i64,
    pub len: i64,
}

/// `body` with its one `marker` replaced by `bytes`.
pub fn splice(body: &[u8], marker: &[u8], bytes: &[u8]) -> Result<Vec<u8>, String> {
    let at = body
        .windows(marker.len().max(1))
        .position(|w| w == marker)
        .ok_or("a file part's marker is not in the body")?;
    let mut out = Vec::with_capacity(body.len() - marker.len() + bytes.len());
    out.extend_from_slice(&body[..at]);
    out.extend_from_slice(bytes);
    out.extend_from_slice(&body[at + marker.len()..]);
    Ok(out)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMeta {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
}

/// Requests in flight, by id, for aborting them.
#[derive(Default)]
pub struct InFlight(Mutex<HashMap<String, Arc<Notify>>>);

impl InFlight {
    pub fn abort(&self, id: &str) {
        if let Some(n) = self.0.lock().unwrap().remove(id) {
            n.notify_one();
        }
    }
}

/// Splits a framed message into its JSON head and its body.
pub fn unframe(raw: &[u8]) -> Result<(&[u8], &[u8]), String> {
    let n = raw
        .get(..4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("truncated request")?;
    let head = raw.get(4..4 + n).ok_or("truncated request")?;
    Ok((head, &raw[4 + n..]))
}

pub fn frame(head: &[u8], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + head.len() + body.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(head);
    out.extend_from_slice(body);
    out
}

/// Headers the HTTP stack sets itself.
fn skip_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host" | "content-length" | "connection" | "transfer-encoding"
    )
}

impl Server {
    /// Sends one request of the UI's api-client and answers the framed response.
    pub async fn http(
        self: &Arc<Self>,
        meta: RequestMeta,
        mut body: Vec<u8>,
    ) -> Result<Vec<u8>, String> {
        if !self.allows(&meta.url) {
            return Err(format!("not a URL of the connected server: {}", meta.url));
        }
        for part in &meta.file_parts {
            let me = self.clone();
            let FileRange {
                id,
                ref path,
                offset,
                len,
            } = part.file;
            let path = path.clone();
            let bytes = crate::blocking(move || match (path, id) {
                (Some(p), _) => super::backup::read_chunk_at(&p, offset, len),
                (None, Some(id)) => me.read_chunk(id, offset, len),
                (None, None) => Err("a file part names neither a path nor an id".into()),
            })
            .await?;
            body = splice(&body, part.marker.as_bytes(), &bytes)?;
        }
        let method = reqwest::Method::from_bytes(meta.method.as_bytes())
            .map_err(|_| format!("bad method {}", meta.method))?;
        let mut req = self.http.request(method, &meta.url);
        for (k, v) in &meta.headers {
            if !skip_header(k) {
                req = req.header(k, v);
            }
        }
        if !body.is_empty() {
            req = req.body(body);
        }
        let cancel = Arc::new(Notify::new());
        self.requests
            .0
            .lock()
            .unwrap()
            .insert(meta.id.clone(), cancel.clone());
        let host = meta.url.split('/').take(3).collect::<Vec<_>>().join("/");
        let send = async {
            let res = req
                .send()
                .await
                .map_err(|e| format!("couldn't reach {host}: {e}"))?;
            let head = ResponseMeta {
                status: res.status().as_u16(),
                status_text: res.status().canonical_reason().unwrap_or("").to_string(),
                headers: res
                    .headers()
                    .iter()
                    .filter_map(|(k, v)| Some((k.to_string(), v.to_str().ok()?.to_string())))
                    .collect(),
            };
            let bytes = res
                .bytes()
                .await
                .map_err(|e| format!("couldn't reach {host}: {e}"))?;
            let head = serde_json::to_vec(&head).map_err(|e| e.to_string())?;
            Ok(frame(&head, &bytes))
        };
        let out = tokio::select! {
            r = send => r,
            () = cancel.notified() => Err("aborted".to_string()),
        };
        self.requests.0.lock().unwrap().remove(&meta.id);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let head = br#"{"id":"1","url":"http://h/api/x","method":"POST","headers":[["content-type","application/json"]]}"#;
        let raw = frame(head, b"{}");
        let (h, b) = unframe(&raw).unwrap();
        let meta: RequestMeta = serde_json::from_slice(h).unwrap();
        assert_eq!(meta.method, "POST");
        assert_eq!(meta.headers[0].0, "content-type");
        assert_eq!(b, b"{}");
        assert!(unframe(&[1, 0]).is_err());
        assert!(unframe(&[9, 0, 0, 0, b'{']).is_err());
        assert!(skip_header("Content-Length"));
        assert_eq!(splice(b"a--M--b", b"M", b"xyz").unwrap(), b"a--xyz--b");
        assert!(splice(b"a--b", b"M", b"xyz").is_err());
        let by_path = br#"{"id":"3","url":"u","method":"POST","headers":[],"fileParts":[{"marker":"M","ref":{"path":"C:/p/a.jpg","offset":0,"len":4}}]}"#;
        let meta: RequestMeta = serde_json::from_slice(by_path).unwrap();
        assert_eq!(meta.file_parts[0].file.path.as_deref(), Some("C:/p/a.jpg"));
        assert_eq!(meta.file_parts[0].file.id, None);
        let with_part = br#"{"id":"2","url":"u","method":"POST","headers":[],"fileParts":[{"marker":"M","ref":{"id":4,"offset":8,"len":16}}]}"#;
        let meta: RequestMeta = serde_json::from_slice(with_part).unwrap();
        assert_eq!(
            meta.file_parts[0].file,
            FileRange {
                id: Some(4),
                path: None,
                offset: 8,
                len: 16
            }
        );
        assert!(!skip_header("content-range"));
    }
}

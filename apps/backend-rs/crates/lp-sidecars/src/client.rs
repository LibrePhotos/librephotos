//! The one request path every sidecar call goes through (`api/sidecars.py`).

use std::time::Duration;

use bytes::Bytes;
use reqwest::Method;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::{CONNECT_TIMEOUT, Sidecar, Sidecars};

/// Three attempts in all (`MAX_RETRIES = 2`), urllib3's backoff with factor
/// 0.5: no wait before the first retry, 1 s before the second.
const RETRY_DELAYS: [Duration; 2] = [Duration::ZERO, Duration::from_secs(1)];
const PREVIEW_CHARS: usize = 500;

#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    /// Refused or dropped connections, still failing after the retries.
    #[error("{sidecar} sidecar unreachable at {url}: {message}")]
    Unreachable {
        sidecar: &'static str,
        url: String,
        message: String,
    },
    /// The read budget ran out (never retried).
    #[error("{sidecar} sidecar timed out after {secs} s at {url}")]
    Timeout {
        sidecar: &'static str,
        url: String,
        secs: u64,
    },
    /// Any non-2xx answer (a 503 only after the retries).
    #[error("{sidecar} sidecar returned status {status} for {url}: {detail}")]
    Status {
        sidecar: &'static str,
        url: String,
        status: u16,
        detail: String,
        body: Option<Box<serde_json::Value>>,
    },
    /// A 2xx whose body is not the JSON the contract promises.
    #[error("{sidecar} sidecar returned an unusable reply for {url}: {message}")]
    Body {
        sidecar: &'static str,
        url: String,
        message: String,
    },
}

impl SidecarError {
    pub fn status(&self) -> Option<u16> {
        match self {
            SidecarError::Status { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// The sidecar's own reason (`sidecars.error_detail`), else the error text.
    pub fn detail(&self) -> String {
        match self {
            SidecarError::Status { detail, .. } => detail.clone(),
            other => other.to_string(),
        }
    }

    pub fn is_timeout(&self) -> bool {
        matches!(self, SidecarError::Timeout { .. })
    }
}

/// `sidecars.error_detail` + `face_recognition._get_response_preview`: the
/// `"error"` field of a JSON reply, else the body as readable text (HTML
/// error pages reduced to their text), at most 500 characters.
pub fn error_detail(body: &[u8], content_type: Option<&str>) -> String {
    if let Ok(serde_json::Value::Object(map)) = serde_json::from_slice::<serde_json::Value>(body)
        && let Some(err) = map.get("error")
    {
        match err {
            serde_json::Value::String(s) if !s.is_empty() => return s.clone(),
            serde_json::Value::Null | serde_json::Value::Bool(false) => {}
            serde_json::Value::String(_) => {}
            other => return other.to_string(),
        }
    }
    let text = String::from_utf8_lossy(body).trim().to_string();
    if text.is_empty() {
        return "<empty body>".into();
    }
    let html = content_type.is_some_and(|c| c.contains("html")) || text.starts_with('<');
    let text = if html { strip_html(&text) } else { text };
    if text.is_empty() {
        return "<empty body>".into();
    }
    let count = text.chars().count();
    if count > PREVIEW_CHARS {
        let head: String = text.chars().take(PREVIEW_CHARS).collect();
        return format!("{head}... [truncated {} chars]", count - PREVIEW_CHARS);
    }
    text
}

fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&amp;", "&")
}

pub(crate) struct Reply {
    pub status: u16,
    pub body: Bytes,
}

impl Sidecars {
    /// One logical call: retries per the policy above, errors for non-2xx.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn call(
        &self,
        sidecar: Sidecar,
        method: Method,
        path: &str,
        json: Option<Vec<u8>>,
        read: Duration,
        retry: bool,
        accept: &[u16],
    ) -> Result<Reply, SidecarError> {
        let url = self.url(sidecar, path);
        let name = sidecar.name();
        let attempts = if retry { RETRY_DELAYS.len() + 1 } else { 1 };
        let mut last_unreachable = String::new();
        for attempt in 0..attempts {
            if attempt > 0 {
                let delay = RETRY_DELAYS[attempt - 1];
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
            }
            let mut req = self
                .http()
                .request(method.clone(), &url)
                .timeout(CONNECT_TIMEOUT + read);
            if let Some(body) = &json {
                req = req
                    .header(reqwest::header::CONTENT_TYPE, "application/json")
                    .body(body.clone());
            }
            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) if e.is_connect() || (e.is_request() && !e.is_timeout()) => {
                    last_unreachable = error_chain(&e);
                    tracing::debug!(sidecar = name, attempt, error = %last_unreachable, "sidecar connection failed");
                    continue;
                }
                Err(e) if e.is_timeout() => {
                    return Err(SidecarError::Timeout {
                        sidecar: name,
                        url,
                        secs: read.as_secs(),
                    });
                }
                Err(e) => {
                    return Err(SidecarError::Unreachable {
                        sidecar: name,
                        url,
                        message: error_chain(&e),
                    });
                }
            };
            let status = resp.status().as_u16();
            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            if status == 503 && attempt + 1 < attempts {
                let _ = resp.bytes().await;
                tracing::debug!(sidecar = name, attempt, "sidecar busy (503), retrying");
                continue;
            }
            let body = match resp.bytes().await {
                Ok(b) => b,
                Err(e) if e.is_timeout() => {
                    return Err(SidecarError::Timeout {
                        sidecar: name,
                        url,
                        secs: read.as_secs(),
                    });
                }
                Err(e) => {
                    last_unreachable = error_chain(&e);
                    continue;
                }
            };
            if (200..300).contains(&status) || accept.contains(&status) {
                return Ok(Reply { status, body });
            }
            return Err(SidecarError::Status {
                sidecar: name,
                url,
                status,
                detail: error_detail(&body, content_type.as_deref()),
                body: serde_json::from_slice(&body).ok().map(Box::new),
            });
        }
        Err(SidecarError::Unreachable {
            sidecar: name,
            url,
            message: last_unreachable,
        })
    }

    pub(crate) async fn post_json<Req, Resp>(
        &self,
        sidecar: Sidecar,
        path: &str,
        body: &Req,
    ) -> Result<Resp, SidecarError>
    where
        Req: Serialize + ?Sized,
        Resp: DeserializeOwned,
    {
        let bytes = serde_json::to_vec(body).map_err(|e| SidecarError::Body {
            sidecar: sidecar.name(),
            url: self.url(sidecar, path),
            message: format!("request not serializable: {e}"),
        })?;
        let reply = self
            .call(
                sidecar,
                Method::POST,
                path,
                Some(bytes),
                self.timeout(sidecar),
                true,
                &[],
            )
            .await?;
        self.parse(sidecar, path, &reply.body)
    }

    pub(crate) fn parse<Resp: DeserializeOwned>(
        &self,
        sidecar: Sidecar,
        path: &str,
        body: &[u8],
    ) -> Result<Resp, SidecarError> {
        serde_json::from_slice(body).map_err(|e| SidecarError::Body {
            sidecar: sidecar.name(),
            url: self.url(sidecar, path),
            message: format!("{e}: {}", error_detail(body, None)),
        })
    }
}

fn error_chain(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut source = e.source();
    while let Some(s) = source {
        let text = s.to_string();
        if !out.contains(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        source = s.source();
    }
    out
}

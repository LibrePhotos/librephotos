//! `LP_DEV_FALLBACK`: forward requests no Rust route matched to a running
//! Django, so the frontend works end to end while areas are being ported.
//! Dev only: no header hygiene beyond hop-by-hop, no body timeouts.

use std::sync::OnceLock;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, HeaderName, StatusCode};
use axum::response::{IntoResponse, Response};
use futures::TryStreamExt;

use crate::RawPath;

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("reqwest client")
    })
}

fn hop_by_hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "content-length"
    )
}

fn copy_headers(from: &HeaderMap, to: &mut HeaderMap) {
    for (k, v) in from {
        if !hop_by_hop(k) {
            to.append(k.clone(), v.clone());
        }
    }
}

/// Forward `req` to `target` using the path as the client sent it
/// (trailing slash included: Django needs it).
pub async fn forward(target: &str, req: Request) -> Response {
    let raw = req
        .extensions()
        .get::<RawPath>()
        .map(|p| p.0.clone())
        .unwrap_or_else(|| req.uri().path().to_string());
    let url = match req.uri().query() {
        Some(q) => format!("{target}{raw}?{q}"),
        None => format!("{target}{raw}"),
    };
    let (parts, body) = req.into_parts();
    let mut headers = HeaderMap::new();
    copy_headers(&parts.headers, &mut headers);
    let upstream = client()
        .request(parts.method, &url)
        .headers(headers)
        .body(reqwest::Body::wrap_stream(body.into_data_stream()))
        .send()
        .await;
    match upstream {
        Ok(resp) => {
            let status = resp.status();
            let mut out_headers = HeaderMap::new();
            copy_headers(resp.headers(), &mut out_headers);
            let stream = resp.bytes_stream().map_err(std::io::Error::other);
            let mut out = Response::new(Body::from_stream(stream));
            *out.status_mut() = status;
            *out.headers_mut() = out_headers;
            out
        }
        Err(e) => {
            tracing::warn!(%url, error = %e, "dev fallback proxy failed");
            (StatusCode::BAD_GATEWAY, format!("dev fallback proxy: {e}")).into_response()
        }
    }
}

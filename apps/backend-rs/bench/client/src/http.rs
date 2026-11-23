use std::time::{Duration, Instant};

use bytes::Bytes;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, LOCATION};

pub fn client(max_idle: usize, timeout_s: u64) -> reqwest::Client {
    let mut headers = HeaderMap::new();
    headers.insert("accept", HeaderValue::from_static("application/json, text/plain, */*"));
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(max_idle)
        .tcp_nodelay(true)
        .timeout(Duration::from_secs(timeout_s))
        .default_headers(headers)
        .build()
        .expect("reqwest client")
}

#[derive(Debug)]
pub struct Resp {
    pub status: u16,
    pub body: Bytes,
    pub latency: Duration,
    pub location: Option<String>,
}

/// One GET, timed until the last body byte.
pub async fn get(c: &reqwest::Client, base: &str, path: &str, token: &str) -> Result<Resp, String> {
    let t0 = Instant::now();
    let r = c
        .get(format!("{base}{path}"))
        .header(AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| err_kind(&e))?;
    let status = r.status().as_u16();
    let location = r.headers().get(LOCATION).and_then(|v| v.to_str().ok()).map(str::to_string);
    let body = r.bytes().await.map_err(|e| err_kind(&e))?;
    Ok(Resp { status, body, latency: t0.elapsed(), location })
}

fn err_kind(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timeout".into()
    } else if e.is_connect() {
        "connect".into()
    } else if e.is_body() || e.is_decode() {
        "body".into()
    } else {
        "request".into()
    }
}

/// Path part of a Location header (absolute or relative).
pub fn location_path(loc: &str) -> String {
    if let Some(rest) = loc.strip_prefix("http://").or_else(|| loc.strip_prefix("https://")) {
        match rest.find('/') {
            Some(i) => rest[i..].to_string(),
            None => "/".into(),
        }
    } else {
        loc.to_string()
    }
}

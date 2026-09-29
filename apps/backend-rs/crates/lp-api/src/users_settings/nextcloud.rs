//! `GET /api/nextcloud/listdir/?fpath=` (WebDAV `PROPFIND`, Depth 1) and
//! `POST /api/nextcloud/scanphotos/` (answers 501: the Nextcloud scan job is
//! not ported). Server addresses go through the same SSRF guard as
//! `nextcloud/server_address.py`.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::OnceLock;
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::django_crypto::DjangoCrypto;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use regex::Regex;
use serde_json::{Value, json};

/// `NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES` (Django `_env_flag`, default on).
fn private_addresses_allowed() -> bool {
    match std::env::var("NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES") {
        Err(_) => true,
        Ok(v) => matches!(
            v.trim().to_lowercase().as_str(),
            "true" | "1" | "yes" | "on"
        ),
    }
}

fn embedded_v4(v6: &Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(v4) = v6.to_ipv4_mapped() {
        return Some(v4);
    }
    let s = v6.segments();
    if s[0] == 0x2002 {
        return Some(Ipv4Addr::new(
            (s[1] >> 8) as u8,
            s[1] as u8,
            (s[2] >> 8) as u8,
            s[2] as u8,
        ));
    }
    if s[0] == 0x64 && s[1] == 0xff9b && s[2..6] == [0, 0, 0, 0] {
        return Some(Ipv4Addr::new(
            (s[6] >> 8) as u8,
            s[6] as u8,
            (s[7] >> 8) as u8,
            s[7] as u8,
        ));
    }
    None
}

/// Python `ipaddress.IPv4Address.is_private`/`is_global` networks.
fn v4_is_global(a: &Ipv4Addr) -> bool {
    let o = a.octets();
    let private = o[0] == 0
        || o[0] == 10
        || o[0] == 127
        || (o[0] == 100 && (64..128).contains(&o[1]))
        || (o[0] == 169 && o[1] == 254)
        || (o[0] == 172 && (16..32).contains(&o[1]))
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        || (o[0] == 192 && o[1] == 0 && o[2] == 2)
        || (o[0] == 192 && o[1] == 168)
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
        || (o[0] == 198 && o[1] == 51 && o[2] == 100)
        || (o[0] == 203 && o[1] == 0 && o[2] == 113)
        || o[0] >= 240;
    !private
}

fn v6_is_global(a: &Ipv6Addr) -> bool {
    let s = a.segments();
    let private = a.is_loopback()
        || a.is_unspecified()
        || (s[0] & 0xfe00) == 0xfc00
        || (s[0] & 0xffc0) == 0xfe80
        || (s[0] == 0x2001 && s[1] < 0x200)
        || (s[0] == 0x2001 && s[1] == 0xdb8)
        || s[0] == 0x100 && s[1..4] == [0, 0, 0];
    !private
}

fn v6_is_reserved(a: &Ipv6Addr) -> bool {
    let s0 = a.segments()[0];
    // ::/8, 100::/8, 200::/7, 400::/6, 800::/5, 1000::/4, 4000::/3 .. c000::/3,
    // e000::/4, f000::/5, f800::/6, fe00::/9
    s0 < 0x2000
        || (0x4000..0xe000).contains(&s0)
        || (0xe000..0xf000).contains(&s0)
        || (0xf000..0xf800).contains(&s0)
        || (0xf800..0xfc00).contains(&s0)
        || (0xfe00..0xfe80).contains(&s0)
}

/// `_refusal`: the kind of address that must not be contacted, if any.
fn refusal(addr: IpAddr, allow_private: bool) -> Option<&'static str> {
    let addr = match addr {
        IpAddr::V6(v6) => embedded_v4(&v6).map(IpAddr::V4).unwrap_or(addr),
        other => other,
    };
    match addr {
        IpAddr::V4(a) => {
            if a.is_unspecified() || a.octets()[0] == 0 {
                Some("an unspecified")
            } else if a.is_loopback() {
                Some("a loopback")
            } else if a.is_link_local() {
                Some("a link-local")
            } else if a.is_multicast() {
                Some("a multicast")
            } else if a.octets()[0] >= 240 {
                Some("a reserved")
            } else if !v4_is_global(&a) && !allow_private {
                Some("a private network")
            } else {
                None
            }
        }
        IpAddr::V6(a) => {
            if a.is_unspecified() {
                Some("an unspecified")
            } else if a.is_loopback() {
                Some("a loopback")
            } else if (a.segments()[0] & 0xffc0) == 0xfe80 {
                Some("a link-local")
            } else if a.is_multicast() {
                Some("a multicast")
            } else if v6_is_reserved(&a) {
                Some("a reserved")
            } else if !v6_is_global(&a) && !allow_private {
                Some("a private network")
            } else {
                None
            }
        }
    }
}

/// `validate_server_address`: Err(message) when `url` must not be contacted.
pub async fn validate_server_address(url: &str) -> Result<(), String> {
    check_address(url).await.map(|_| ())
}

/// Resolve `host` and refuse it when any address must not be contacted.
async fn resolve_checked(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    let unresolved = || format!("The Nextcloud server address could not be resolved: {host}");
    let addrs: Vec<SocketAddr> = match tokio::net::lookup_host((host, port)).await {
        Ok(it) => it.collect(),
        Err(_) => return Err(unresolved()),
    };
    if addrs.is_empty() {
        return Err(unresolved());
    }
    let allow_private = private_addresses_allowed();
    for addr in &addrs {
        if let Some(kind) = refusal(addr.ip(), allow_private) {
            let hint = if kind == "a private network" {
                " An administrator can allow it with NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES=true."
            } else {
                ""
            };
            return Err(format!(
                "The Nextcloud server address points to {kind} address, which LibrePhotos \
                 does not connect to.{hint}"
            ));
        }
    }
    Ok(addrs)
}

/// A checked address: the URL as reqwest parses it, and the addresses its
/// host resolved to (the connection is pinned to them).
struct Checked {
    url: reqwest::Url,
    addrs: Vec<SocketAddr>,
}

/// The Django checks on the host Python's `urlparse` sees, then the same
/// checks on the host reqwest (WHATWG) would dial. The two parsers disagree on
/// inputs like `http://127.0.0.1\@example.com/`, so both hosts must pass.
async fn check_address(url: &str) -> Result<Checked, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("No Nextcloud server address is set.".into());
    }
    let scheme = url
        .split_once(':')
        .map(|(s, _)| s)
        .filter(|s| {
            s.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
        })
        .unwrap_or("")
        .to_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err("The Nextcloud server address has to start with http:// or https://.".into());
    }
    let after = &url[scheme.len() + 1..];
    let Some(authority) = after.strip_prefix("//") else {
        return Err("The Nextcloud server address has no host name.".into());
    };
    let authority = authority
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .rsplit('@')
        .next()
        .unwrap_or("");
    let (host, port) = split_host_port(authority)?;
    if host.is_empty() {
        return Err("The Nextcloud server address has no host name.".into());
    }
    let port = port.unwrap_or(if scheme == "https" { 443 } else { 80 });
    let python_addrs = resolve_checked(&host, port).await?;

    let parsed =
        reqwest::Url::parse(url).map_err(|_| "The Nextcloud server address is not a URL.")?;
    let Some(dial_host) = parsed.host_str() else {
        return Err("The Nextcloud server address has no host name.".into());
    };
    let dial_host = dial_host.trim_start_matches('[').trim_end_matches(']');
    let dial_port = parsed.port_or_known_default().unwrap_or(port);
    let addrs = if dial_host.eq_ignore_ascii_case(&host) && dial_port == port {
        python_addrs
    } else {
        resolve_checked(dial_host, dial_port).await?
    };
    Ok(Checked { url: parsed, addrs })
}

/// Host (lower-cased, IPv6 brackets removed) and port of an authority.
fn split_host_port(authority: &str) -> Result<(String, Option<u16>), String> {
    let not_url = || "The Nextcloud server address is not a URL.".to_string();
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (h, tail) = rest.split_once(']').ok_or_else(not_url)?;
        (h, tail.strip_prefix(':'))
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (authority, None),
        }
    };
    let port = match port {
        None | Some("") => None,
        Some(p) => Some(p.parse::<u16>().map_err(|_| not_url())?),
    };
    Ok((host.to_lowercase(), port))
}

/// A client that dials only the addresses `checked` resolved to, so a DNS
/// answer that changes after the check cannot redirect the request.
fn pinned_client(checked: &Checked) -> Result<reqwest::Client, DavError> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60));
    if let Some(host) = checked.url.host_str()
        && !host.starts_with('[')
        && host.parse::<IpAddr>().is_err()
    {
        builder = builder.resolve_to_addrs(host, &checked.addrs);
    }
    builder.build().map_err(|_| DavError::Unreachable)
}

fn rejected(message: String) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"status": false, "message": message})),
    )
        .into_response()
}

fn nextcloud_enabled(state: &AppState) -> Result<(), ApiError> {
    if state.settings().nextcloud_enabled {
        Ok(())
    } else {
        Err(ApiError::permission_denied())
    }
}

enum DavError {
    Unsafe(String),
    Status(u16),
    Unreachable,
}

/// PROPFIND `path` (Depth 1) below the user's WebDAV root. Every hop,
/// redirects included, is checked and pinned before it is dialled.
async fn propfind(base: &str, user: &str, password: &str, path: &str) -> Result<String, DavError> {
    let base = if base.ends_with('/') {
        base.to_string()
    } else {
        format!("{base}/")
    };
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    const PATH_SET: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'/')
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'~');
    let mut url = format!(
        "{base}remote.php/webdav{}",
        percent_encoding::utf8_percent_encode(&path, PATH_SET)
    );
    let method = reqwest::Method::from_bytes(b"PROPFIND").expect("method");
    for _ in 0..10 {
        let checked = check_address(&url).await.map_err(DavError::Unsafe)?;
        let res = pinned_client(&checked)?
            .request(method.clone(), checked.url.clone())
            .basic_auth(user, Some(password))
            .header("Depth", "1")
            .send()
            .await
            .map_err(|_| DavError::Unreachable)?;
        let status = res.status();
        if status.is_redirection() {
            let loc = res
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|l| l.to_str().ok())
                .ok_or(DavError::Status(status.as_u16()))?;
            url = res
                .url()
                .join(loc)
                .map_err(|_| DavError::Unreachable)?
                .to_string();
            continue;
        }
        if status.as_u16() != 207 && !status.is_success() {
            return Err(DavError::Status(status.as_u16()));
        }
        return res.text().await.map_err(|_| DavError::Unreachable);
    }
    Err(DavError::Unreachable)
}

/// Directory paths (relative to the WebDAV root, with trailing `/`) of a
/// multistatus body, without the listed directory itself (pyocclient `list`).
pub fn parse_multistatus(body: &str, dav_root_path: &str) -> Vec<String> {
    static RESPONSE: OnceLock<Regex> = OnceLock::new();
    static HREF: OnceLock<Regex> = OnceLock::new();
    static COLLECTION: OnceLock<Regex> = OnceLock::new();
    let response = RESPONSE.get_or_init(|| {
        Regex::new(r"(?s)<(?:[\w-]+:)?response\b[^>]*>(.*?)</(?:[\w-]+:)?response>").expect("re")
    });
    let href =
        HREF.get_or_init(|| Regex::new(r"(?s)<(?:[\w-]+:)?href\b[^>]*>(.*?)</").expect("re"));
    let collection =
        COLLECTION.get_or_init(|| Regex::new(r"<(?:[\w-]+:)?collection\b").expect("re"));
    let mut out = Vec::new();
    for (i, cap) in response.captures_iter(body).enumerate() {
        if i == 0 {
            continue;
        }
        let block = &cap[1];
        let Some(h) = href.captures(block) else {
            continue;
        };
        let raw = h[1]
            .trim()
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'");
        let decoded = percent_encoding::percent_decode_str(&raw)
            .decode_utf8_lossy()
            .into_owned();
        let path = match decoded.find(dav_root_path) {
            Some(i) => decoded[i + dav_root_path.len()..].to_string(),
            None => decoded,
        };
        if collection.is_match(block) {
            out.push(path);
        }
    }
    out
}

pub async fn listdir(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
) -> ApiResult<Response> {
    nextcloud_enabled(&state)?;
    let Some(path) = q.non_empty("fpath").map(str::to_string) else {
        return Ok(Json(json!([])).into_response());
    };
    if user.nextcloud_server_address.is_empty() {
        return Ok(Json(json!([])).into_response());
    }
    let address = user.nextcloud_server_address.trim().to_string();
    if let Err(m) = validate_server_address(&address).await {
        return Ok(rejected(m));
    }
    let password = match lp_db::users_settings::nextcloud_app_password(&state.db, user.id).await? {
        Some(token) => DjangoCrypto::new(&state.config.secret_key)
            .decrypt_str(&token)
            .unwrap_or_default(),
        None => String::new(),
    };
    let body = match propfind(&address, &user.nextcloud_username, &password, &path).await {
        Ok(b) => b,
        Err(DavError::Unsafe(m)) => return Ok(rejected(m)),
        Err(DavError::Status(code)) => {
            tracing::warn!("Nextcloud responded with an error: HTTP error: {code}");
            return Ok(rejected(format!("HTTP error: {code}")));
        }
        Err(DavError::Unreachable) => {
            return Ok(rejected(
                "Could not reach the nextcloud server. Check the server address.".into(),
            ));
        }
    };
    let root_path = {
        let after_scheme = address.split_once("://").map(|(_, r)| r).unwrap_or("");
        let p = after_scheme
            .find('/')
            .map(|i| &after_scheme[i..])
            .unwrap_or("/");
        let p = if p.ends_with('/') {
            p.to_string()
        } else {
            format!("{p}/")
        };
        format!("{p}remote.php/webdav")
    };
    let dirs: Vec<Value> = parse_multistatus(&body, &root_path)
        .into_iter()
        .map(|p| {
            let parts: Vec<&str> = p.split('/').collect();
            let title = if parts.len() >= 2 {
                parts[parts.len() - 2].to_string()
            } else {
                String::new()
            };
            json!({"absolute_path": p, "title": title, "children": []})
        })
        .collect();
    Ok(Json(Value::Array(dirs)).into_response())
}

pub async fn scanphotos(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> ApiResult<Response> {
    nextcloud_enabled(&state)?;
    if let Err(m) = validate_server_address(&user.nextcloud_server_address).await {
        return Ok(rejected(m));
    }
    Ok((
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "status": false,
            "message": "Scanning a Nextcloud library is not available on this server."
        })),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refusals() {
        assert_eq!(
            refusal("127.0.0.1".parse().unwrap(), true),
            Some("a loopback")
        );
        assert_eq!(
            refusal("::ffff:127.0.0.1".parse().unwrap(), true),
            Some("a loopback")
        );
        assert_eq!(
            refusal("169.254.169.254".parse().unwrap(), true),
            Some("a link-local")
        );
        assert_eq!(
            refusal("0.1.2.3".parse().unwrap(), true),
            Some("an unspecified")
        );
        assert_eq!(refusal("192.168.1.2".parse().unwrap(), true), None);
        assert_eq!(
            refusal("192.168.1.2".parse().unwrap(), false),
            Some("a private network")
        );
        assert_eq!(refusal("8.8.8.8".parse().unwrap(), false), None);
    }

    #[tokio::test]
    async fn address_shapes() {
        assert_eq!(
            validate_server_address("").await.unwrap_err(),
            "No Nextcloud server address is set."
        );
        assert!(
            validate_server_address("ftp://x")
                .await
                .unwrap_err()
                .contains("http:// or https://")
        );
        assert!(
            validate_server_address("http://127.0.0.1:8080")
                .await
                .unwrap_err()
                .contains("a loopback address")
        );
        assert!(
            validate_server_address("http://host:99999")
                .await
                .unwrap_err()
                .contains("not a URL")
        );
    }

    #[tokio::test]
    async fn parser_differential_is_refused() {
        // Python's urlparse sees host 8.8.8.8 here, reqwest dials 127.0.0.1.
        assert!(
            validate_server_address(r"http://127.0.0.1:8000\@8.8.8.8/")
                .await
                .unwrap_err()
                .contains("a loopback address")
        );
        let checked = check_address("http://8.8.8.8:8080/nc").await.unwrap();
        assert_eq!(checked.url.host_str(), Some("8.8.8.8"));
        assert!(checked.addrs.iter().all(|a| a.port() == 8080));
    }

    #[test]
    fn multistatus() {
        let body = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>/nc/remote.php/webdav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/nc/remote.php/webdav/Photos%20Old/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/nc/remote.php/webdav/a.jpg</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
</d:multistatus>"#;
        assert_eq!(
            parse_multistatus(body, "/nc/remote.php/webdav"),
            vec!["/Photos Old/".to_string()]
        );
    }
}

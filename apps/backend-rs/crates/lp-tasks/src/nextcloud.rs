//! Nextcloud: the WebDAV client behind `/api/nextcloud/listdir/` and the
//! `nextcloud.scan` job (`nextcloud/directory_watcher.py` `scan_photos`),
//! with the SSRF guard of `nextcloud/server_address.py`.
//!
//! The scan lists the user's `nextcloud_scan_directory` recursively, downloads
//! every media file not yet on disk into `DATA_ROOT/nextcloud_media/<username>/`
//! (`.part` + rename), runs the scan pipeline over the downloaded files and
//! rebuilds the similarity index, like Django (no ML follow-ups).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::anyhow;
use futures::StreamExt;
use lp_core::AppState;
use lp_core::django_crypto::DjangoCrypto;
use lp_jobs::{JobCtx, JobType};
use regex::Regex;
use serde::Deserialize;
use tokio::io::AsyncWriteExt;

use crate::run;

pub const KIND: &str = "nextcloud.scan";

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

/// Debug builds only: lets integration tests talk to a WebDAV mock on
/// 127.0.0.1. Release builds never honour it.
fn test_loopback_allowed() -> bool {
    cfg!(debug_assertions) && std::env::var_os("LP_NEXTCLOUD_TEST_ALLOW_LOOPBACK").is_some()
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
pub fn refusal(addr: IpAddr, allow_private: bool) -> Option<&'static str> {
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
        if addr.ip().is_loopback() && test_loopback_allowed() {
            continue;
        }
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
pub struct Checked {
    pub url: reqwest::Url,
    pub addrs: Vec<SocketAddr>,
}

/// The Django checks on the host Python's `urlparse` sees, then the same
/// checks on the host reqwest (WHATWG) would dial. The two parsers disagree on
/// inputs like `http://127.0.0.1\@example.com/`, so both hosts must pass.
pub async fn check_address(url: &str) -> Result<Checked, String> {
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
fn pinned_client(checked: &Checked, timeout: Duration) -> Result<reqwest::Client, DavError> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout);
    if let Some(host) = checked.url.host_str()
        && !host.starts_with('[')
        && host.parse::<IpAddr>().is_err()
    {
        builder = builder.resolve_to_addrs(host, &checked.addrs);
    }
    builder.build().map_err(|_| DavError::Unreachable)
}

#[derive(Debug)]
pub enum DavError {
    Unsafe(String),
    Status(u16),
    Unreachable,
    TooDeep(String),
}

impl std::fmt::Display for DavError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DavError::Unsafe(m) => f.write_str(m),
            DavError::Status(code) => write!(f, "HTTP error: {code}"),
            DavError::Unreachable => {
                f.write_str("Could not reach the nextcloud server. Check the server address.")
            }
            DavError::TooDeep(dir) => write!(f, "Nextcloud folders nest too deeply at {dir}"),
        }
    }
}

impl std::error::Error for DavError {}

/// One entry of a WebDAV listing (pyocclient `FileInfo`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DavEntry {
    /// Relative to the WebDAV root, with a leading `/` (and a trailing one
    /// for directories).
    pub path: String,
    pub is_dir: bool,
    pub content_type: String,
}

/// A logged-in WebDAV client for one user (pyocclient `Client`).
pub struct Dav {
    base: String,
    user: String,
    password: String,
}

const PATH_SET: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'/')
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

impl Dav {
    pub fn new(address: &str, user: &str, password: &str) -> Self {
        let address = address.trim();
        let base = if address.ends_with('/') {
            address.to_string()
        } else {
            format!("{address}/")
        };
        Dav {
            base,
            user: user.to_string(),
            password: password.to_string(),
        }
    }

    /// The user's Nextcloud client: server address, username and the
    /// decrypted app password.
    pub async fn for_user(state: &AppState, user: &lp_db::users::User) -> sqlx::Result<Self> {
        let password =
            match lp_db::users_settings::nextcloud_app_password(&state.db, user.id).await? {
                Some(token) => DjangoCrypto::new(&state.config.secret_key)
                    .decrypt_str(&token)
                    .unwrap_or_default(),
                None => String::new(),
            };
        Ok(Dav::new(
            &user.nextcloud_server_address,
            &user.nextcloud_username,
            &password,
        ))
    }

    /// The path part of the WebDAV root as hrefs spell it (`/nc/remote.php/webdav`).
    pub fn root_path(&self) -> String {
        let after_scheme = self.base.split_once("://").map(|(_, r)| r).unwrap_or("");
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
    }

    fn url_for(&self, path: &str) -> String {
        let path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{path}")
        };
        format!(
            "{}remote.php/webdav{}",
            self.base,
            percent_encoding::utf8_percent_encode(&path, PATH_SET)
        )
    }

    /// Send `method` to `path`. Every hop, redirects included, is checked
    /// and pinned before it is dialled. The app password goes only to the
    /// origin it was set for: once a redirect leaves it, like `requests`
    /// (which pyocclient runs on), later hops are sent without credentials.
    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        depth: Option<&str>,
        timeout: Duration,
    ) -> Result<reqwest::Response, DavError> {
        let mut url = self.url_for(path);
        let mut send_auth = true;
        for _ in 0..10 {
            let checked = check_address(&url).await.map_err(DavError::Unsafe)?;
            let mut req =
                pinned_client(&checked, timeout)?.request(method.clone(), checked.url.clone());
            if send_auth {
                req = req.basic_auth(&self.user, Some(&self.password));
            }
            if let Some(d) = depth {
                req = req.header("Depth", d);
            }
            let res = req.send().await.map_err(|_| DavError::Unreachable)?;
            let status = res.status();
            if status.is_redirection() {
                let loc = res
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|l| l.to_str().ok())
                    .ok_or(DavError::Status(status.as_u16()))?;
                let next = res.url().join(loc).map_err(|_| DavError::Unreachable)?;
                if should_strip_auth(res.url(), &next) {
                    send_auth = false;
                }
                url = next.to_string();
                continue;
            }
            if status.as_u16() != 207 && !status.is_success() {
                return Err(DavError::Status(status.as_u16()));
            }
            return Ok(res);
        }
        Err(DavError::Unreachable)
    }

    /// PROPFIND `path` (Depth 1): the raw multistatus body.
    pub async fn propfind(&self, path: &str) -> Result<String, DavError> {
        let method = reqwest::Method::from_bytes(b"PROPFIND").expect("method");
        self.request(method, path, Some("1"), Duration::from_secs(60))
            .await?
            .text()
            .await
            .map_err(|_| DavError::Unreachable)
    }

    /// pyocclient `list`: the entries of directory `path`, without itself.
    pub async fn list(&self, path: &str) -> Result<Vec<DavEntry>, DavError> {
        let body = self.propfind(path).await?;
        Ok(parse_entries(&body, &self.root_path()))
    }

    /// pyocclient `get_file`: stream `remote` into `local`. False when the
    /// server did not answer 200.
    pub async fn get_file(&self, remote: &str, local: &Path) -> anyhow::Result<bool> {
        let res = match self
            .request(
                reqwest::Method::GET,
                remote,
                None,
                Duration::from_secs(3600),
            )
            .await
        {
            Ok(r) => r,
            Err(DavError::Status(_)) => return Ok(false),
            Err(e) => return Err(e.into()),
        };
        if res.status().as_u16() != 200 {
            return Ok(false);
        }
        let mut file = tokio::fs::File::create(local).await?;
        let mut stream = res.bytes_stream();
        while let Some(chunk) = stream.next().await {
            file.write_all(&chunk?).await?;
        }
        file.flush().await?;
        Ok(true)
    }
}

/// `requests.Session.should_strip_auth`: credentials survive a redirect only
/// on the same host, scheme and port (http -> https on the default ports
/// included).
pub fn should_strip_auth(old: &reqwest::Url, new: &reqwest::Url) -> bool {
    if old.host_str() != new.host_str() {
        return true;
    }
    if old.scheme() == "http"
        && matches!(old.port(), None | Some(80))
        && new.scheme() == "https"
        && matches!(new.port(), None | Some(443))
    {
        return false;
    }
    old.scheme() != new.scheme() || old.port_or_known_default() != new.port_or_known_default()
}

fn unescape_xml(s: &str) -> String {
    s.trim()
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Every entry of a multistatus body except the listed directory itself.
pub fn parse_entries(body: &str, dav_root_path: &str) -> Vec<DavEntry> {
    static RESPONSE: OnceLock<Regex> = OnceLock::new();
    static HREF: OnceLock<Regex> = OnceLock::new();
    static COLLECTION: OnceLock<Regex> = OnceLock::new();
    static CONTENT_TYPE: OnceLock<Regex> = OnceLock::new();
    let response = RESPONSE.get_or_init(|| {
        Regex::new(r"(?s)<(?:[\w-]+:)?response\b[^>]*>(.*?)</(?:[\w-]+:)?response>").expect("re")
    });
    let href =
        HREF.get_or_init(|| Regex::new(r"(?s)<(?:[\w-]+:)?href\b[^>]*>(.*?)</").expect("re"));
    let collection =
        COLLECTION.get_or_init(|| Regex::new(r"<(?:[\w-]+:)?collection\b").expect("re"));
    let content_type = CONTENT_TYPE
        .get_or_init(|| Regex::new(r"(?s)<(?:[\w-]+:)?getcontenttype\b[^>]*>(.*?)</").expect("re"));
    let mut out = Vec::new();
    for (i, cap) in response.captures_iter(body).enumerate() {
        if i == 0 {
            continue;
        }
        let block = &cap[1];
        let Some(h) = href.captures(block) else {
            continue;
        };
        let decoded = percent_encoding::percent_decode_str(&unescape_xml(&h[1]))
            .decode_utf8_lossy()
            .into_owned();
        let path = match decoded.find(dav_root_path) {
            Some(i) => decoded[i + dav_root_path.len()..].to_string(),
            None => decoded,
        };
        out.push(DavEntry {
            path,
            is_dir: collection.is_match(block),
            content_type: content_type
                .captures(block)
                .map(|c| unescape_xml(&c[1]))
                .unwrap_or_default(),
        });
    }
    out
}

/// Directory paths (relative to the WebDAV root, with trailing `/`) of a
/// multistatus body, without the listed directory itself.
pub fn parse_multistatus(body: &str, dav_root_path: &str) -> Vec<String> {
    parse_entries(body, dav_root_path)
        .into_iter()
        .filter(|e| e.is_dir)
        .map(|e| e.path)
        .collect()
}

/// `isValidNCMedia`: images, videos, raw files and XMP sidecars.
pub fn is_valid_media(entry: &DavEntry) -> bool {
    let ct = &entry.content_type;
    if ct.starts_with("image/") || ct.starts_with("video/") {
        return true;
    }
    if lp_ingest::fsutil::is_raw(&entry.path) || lp_ingest::fsutil::is_metadata(&entry.path) {
        return true;
    }
    tracing::info!(
        "Skipping {}, because '{}' is not a media type",
        entry.path,
        ct
    );
    false
}

/// Folder nesting the scan follows (Django's recursion gives up near 1000).
const MAX_DEPTH: usize = 256;

/// `collect_photos`: every media file below `path`, depth first.
pub async fn collect_photos(dav: &Dav, path: &str) -> Result<Vec<String>, DavError> {
    let mut photos = Vec::new();
    let mut stack = vec![(path.to_string(), 0usize)];
    // A listing that names the directory itself (or an ancestor) again would
    // otherwise be walked forever, and one that invents ever deeper folders
    // too; Django dies of RecursionError on both.
    let mut seen = std::collections::HashSet::new();
    while let Some((dir, depth)) = stack.pop() {
        if !seen.insert(dir.trim_end_matches('/').to_string()) {
            continue;
        }
        if depth > MAX_DEPTH {
            return Err(DavError::TooDeep(dir));
        }
        let entries = dav.list(&dir).await?;
        // Depth first in listing order, like the recursive original.
        let mut subdirs = Vec::new();
        for e in entries {
            if e.is_dir {
                subdirs.push((e.path, depth + 1));
            } else if is_valid_media(&e) {
                photos.push(e.path);
            }
        }
        stack.extend(subdirs.into_iter().rev());
    }
    Ok(photos)
}

/// `user_media_root`: `DATA_ROOT/nextcloud_media/<username>`.
pub fn user_media_root(data_root: &Path, username: &str) -> anyhow::Result<PathBuf> {
    let base = data_root.join("nextcloud_media");
    let mut parts = Path::new(username).components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(_)), None) if !username.contains(['/', '\\']) => {
            Ok(base.join(username))
        }
        _ => Err(anyhow!(
            "User name {username:?} does not make a directory of its own"
        )),
    }
}

/// `local_path_for`: the download location of `remote`, or None when it
/// would leave `root` (`..` segments, absolute paths, symlinks inside root).
pub fn local_path_for(root: &Path, remote: &str) -> Option<PathBuf> {
    let relative = remote.trim_start_matches(['/', '\\']);
    if relative.is_empty() {
        return None;
    }
    let mut candidate = root.to_path_buf();
    for part in relative.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                if !candidate.pop() {
                    return None;
                }
            }
            p => {
                // Win32 drops trailing dots and spaces, so `.. ` or `...`
                // would name the parent (or merge with a sibling) on disk.
                if Path::new(p).is_absolute()
                    || (cfg!(windows) && (p.contains(':') || p.ends_with(['.', ' '])))
                {
                    return None;
                }
                candidate.push(p);
            }
        }
    }
    let real_root = std::fs::canonicalize(root).ok()?;
    // The file (and maybe its folders) does not exist yet: resolve the
    // deepest existing ancestor and re-attach the rest.
    let mut existing = candidate.clone();
    let mut rest = Vec::new();
    while !existing.exists() {
        rest.push(existing.file_name()?.to_os_string());
        if !existing.pop() {
            return None;
        }
    }
    let mut real = std::fs::canonicalize(&existing).ok()?;
    for r in rest.iter().rev() {
        real.push(r);
    }
    (real.starts_with(&real_root) && real != real_root).then_some(candidate)
}

/// `download`: into a `.part` file next to `local`, then renamed, so an
/// interrupted download is fetched again by the next scan.
pub async fn download(dav: &Dav, remote: &str, local: &Path) -> anyhow::Result<bool> {
    let dir = local
        .parent()
        .ok_or_else(|| anyhow!("{} has no parent", local.display()))?;
    tokio::fs::create_dir_all(dir).await?;
    let temp = dir.join(format!(".nextcloud-{}.part", uuid::Uuid::new_v4().simple()));
    let outcome = async {
        if !dav.get_file(remote, &temp).await? || !temp.is_file() {
            return Ok(false);
        }
        tokio::fs::rename(&temp, local).await?;
        Ok(true)
    };
    let result = outcome.await;
    if temp.exists() {
        let _ = tokio::fs::remove_file(&temp).await;
    }
    result
}

#[derive(Debug, Deserialize)]
struct Payload {
    user_id: i32,
}

pub async fn job(ctx: JobCtx) -> anyhow::Result<()> {
    let p: Payload = serde_json::from_value(ctx.job.payload.clone())
        .map_err(|e| anyhow!("{KIND} payload: {e}"))?;
    let job_id = run::begin(
        &ctx.state.db,
        ctx.job.lrj_id.as_deref(),
        JobType::ScanPhotos,
        p.user_id,
    )
    .await?;
    scan_photos(&ctx.state, p.user_id, &job_id).await
}

/// `scan_photos`: a failure anywhere fails the LongRunningJob (never left
/// unfinished), the job itself succeeds.
pub async fn scan_photos(state: &AppState, user_id: i32, job_id: &str) -> anyhow::Result<()> {
    let user = lp_db::users::by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| anyhow!("user {user_id} not found"))?;
    let paths = match fetch(state, &user).await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %format!("{e:#}"), "Nextcloud scan failed");
            run::fail(&state.db, job_id, &format!("{e:#}")).await?;
            return Ok(());
        }
    };
    if paths.is_empty() {
        run::complete(&state.db, job_id).await?;
    } else {
        let pipeline = lp_ingest::Pipeline::new(state.clone());
        lp_ingest::scan::scan_user(
            &pipeline,
            user_id,
            job_id,
            lp_ingest::scan::ScanOptions {
                files: paths.clone(),
                skip_followups: true,
                ..Default::default()
            },
        )
        .await?;
    }
    tracing::info!("Added {} photos", paths.len());
    if let Err(e) = crate::clip::build_index(state, user_id).await {
        tracing::error!(error = %format!("{e:#}"), "similarity index build after the Nextcloud scan failed");
    }
    Ok(())
}

/// List the scan directory and download what is missing; the local paths,
/// sorted.
async fn fetch(state: &AppState, user: &lp_db::users::User) -> anyhow::Result<Vec<PathBuf>> {
    let root = user_media_root(&state.config.photos, &user.username)?;
    validate_server_address(user.nextcloud_server_address.trim())
        .await
        .map_err(|m| anyhow!(m))?;
    let dav = Dav::for_user(state, user).await?;
    let photos = collect_photos(&dav, &user.nextcloud_scan_directory).await?;
    tokio::fs::create_dir_all(&root).await?;
    let mut paths = Vec::new();
    for photo in photos {
        let Some(local) = local_path_for(&root, &photo) else {
            tracing::warn!(
                "Skipping Nextcloud file {photo:?}: it would be stored outside {}",
                root.display()
            );
            continue;
        };
        if !local.exists() {
            if !download(&dav, &photo, &local).await? {
                tracing::warn!("Nextcloud did not return {photo:?}, skipping it");
                continue;
            }
            tracing::info!("Downloaded photo from nextcloud to {}", local.display());
        }
        paths.push(local);
    }
    paths.sort();
    // Names differing only in case share one file on Windows and macOS.
    paths.dedup();
    Ok(paths)
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
        if !test_loopback_allowed() {
            assert!(
                validate_server_address("http://127.0.0.1:8080")
                    .await
                    .unwrap_err()
                    .contains("a loopback address")
            );
        }
        assert!(
            validate_server_address("http://host:99999")
                .await
                .unwrap_err()
                .contains("not a URL")
        );
    }

    #[tokio::test]
    async fn parser_differential_is_refused() {
        if test_loopback_allowed() {
            return;
        }
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
<d:response><d:href>/nc/remote.php/webdav/a.jpg</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontenttype>image/jpeg</d:getcontenttype></d:prop></d:propstat></d:response>
</d:multistatus>"#;
        assert_eq!(
            parse_multistatus(body, "/nc/remote.php/webdav"),
            vec!["/Photos Old/".to_string()]
        );
        let entries = parse_entries(body, "/nc/remote.php/webdav");
        assert_eq!(
            entries[1],
            DavEntry {
                path: "/a.jpg".into(),
                is_dir: false,
                content_type: "image/jpeg".into()
            }
        );
        assert_eq!(
            Dav::new("https://h/nc", "u", "p").root_path(),
            "/nc/remote.php/webdav"
        );
        assert_eq!(
            Dav::new("https://h", "u", "p").root_path(),
            "/remote.php/webdav"
        );
    }

    #[test]
    fn media_filter() {
        let e = |p: &str, ct: &str| DavEntry {
            path: p.into(),
            is_dir: false,
            content_type: ct.into(),
        };
        assert!(is_valid_media(&e("/a.jpg", "image/jpeg")));
        assert!(is_valid_media(&e("/a.mp4", "video/mp4")));
        assert!(is_valid_media(&e("/a.CR2", "application/octet-stream")));
        assert!(is_valid_media(&e("/a.xmp", "")));
        assert!(!is_valid_media(&e("/a.pdf", "application/pdf")));
    }

    #[test]
    fn local_paths_stay_inside_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("nextcloud_media").join("alice");
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(
            local_path_for(&root, "/Photos/a.jpg"),
            Some(root.join("Photos").join("a.jpg"))
        );
        assert_eq!(local_path_for(&root, "/"), None);
        assert_eq!(local_path_for(&root, "/../bob/a.jpg"), None);
        assert_eq!(local_path_for(&root, "/Photos/../../x.jpg"), None);
        if cfg!(windows) {
            assert_eq!(local_path_for(&root, "C:/Windows/x.jpg"), None);
            // Win32 drops trailing dots and spaces: `.. ` and `...` climb too.
            assert_eq!(local_path_for(&root, "/.. /.. /x.jpg"), None);
            assert_eq!(local_path_for(&root, "/Photos/../.. ./x.jpg"), None);
        }
        assert!(user_media_root(dir.path(), "alice").is_ok());
        assert!(user_media_root(dir.path(), "..").is_err());
        assert!(user_media_root(dir.path(), "a/b").is_err());
    }
}

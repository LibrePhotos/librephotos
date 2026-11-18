//! Sign-in pieces that need no network: the server URL, JWT claims and the refresh-token store.

use std::collections::HashMap;
use std::sync::Mutex;

/// "photos.example.com/" -> "https://photos.example.com"; "localhost:8000" -> "http://localhost:8000".
/// A trailing `/api` is dropped (people paste the API root). Plain HTTP is assumed only for
/// addresses that are on this machine or the local network.
pub fn normalize_url(input: &str) -> Result<String, String> {
    let t = input.trim();
    let (scheme, rest) = match t.split_once("://") {
        Some((sc, r)) if sc == "http" || sc == "https" => (Some(sc), r),
        Some(_) => return Err(format!("{input} is not an http(s) address")),
        None => (None, t),
    };
    let s = rest.trim_end_matches('/');
    let s = s.strip_suffix("/api").unwrap_or(s).trim_end_matches('/');
    if s.is_empty() {
        return Err("Enter the address of your LibrePhotos server".into());
    }
    let with_scheme = if let Some(sc) = scheme {
        format!("{sc}://{s}")
    } else {
        let host = s.split(['/', ':']).next().unwrap_or("");
        let local = host == "localhost"
            || host.ends_with(".local")
            || host.ends_with(".lan")
            || host.starts_with("127.")
            || host.starts_with("10.")
            || host.starts_with("192.168.")
            || (host.starts_with("172.")
                && host
                    .split('.')
                    .nth(1)
                    .and_then(|o| o.parse::<u8>().ok())
                    .is_some_and(|o| (16..=31).contains(&o)));
        format!("{}://{s}", if local { "http" } else { "https" })
    };
    let rest = with_scheme.split_once("://").map(|x| x.1).unwrap_or("");
    if rest.is_empty() || rest.contains(char::is_whitespace) {
        return Err(format!("{input} is not a server address"));
    }
    Ok(with_scheme)
}

fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Claims {
    pub user_id: i64,
    /// Expiry, seconds since the epoch.
    pub exp: i64,
}

/// The claims LibrePhotos puts in an access token (`user_id`, `exp`). Not verified: the server
/// does that; the client only needs to know who it is and when to refresh.
pub fn claims(token: &str) -> Option<Claims> {
    let payload = token.split('.').nth(1)?;
    let json: serde_json::Value = serde_json::from_slice(&b64url_decode(payload)?).ok()?;
    let user_id = match &json["user_id"] {
        serde_json::Value::Number(n) => n.as_i64()?,
        serde_json::Value::String(s) => s.parse().ok()?,
        _ => return None,
    };
    Some(Claims {
        user_id,
        exp: json["exp"].as_i64().unwrap_or(0),
    })
}

/// Where the refresh token lives: the OS keychain in the app, memory in tests.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Option<String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, account: &str);
}

/// Windows Credential Manager / macOS Keychain / Linux kernel keyring, via `keyring`.
pub struct Keychain {
    pub service: String,
}

impl SecretStore for Keychain {
    fn get(&self, account: &str) -> Option<String> {
        keyring::Entry::new(&self.service, account)
            .ok()?
            .get_password()
            .ok()
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        keyring::Entry::new(&self.service, account)
            .and_then(|e| e.set_password(secret))
            .map_err(|e| format!("couldn't save the sign-in in the system keychain: {e}"))
    }
    fn delete(&self, account: &str) {
        if let Ok(e) = keyring::Entry::new(&self.service, account) {
            let _ = e.delete_credential();
        }
    }
}

#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Option<String> {
        self.0.lock().unwrap().get(account).cloned()
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.into(), secret.into());
        Ok(())
    }
    fn delete(&self, account: &str) {
        self.0.lock().unwrap().remove(account);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(
            normalize_url("photos.example.com/").unwrap(),
            "https://photos.example.com"
        );
        assert_eq!(
            normalize_url(" localhost:8000 ").unwrap(),
            "http://localhost:8000"
        );
        assert_eq!(
            normalize_url("192.168.1.5:3000/api/").unwrap(),
            "http://192.168.1.5:3000"
        );
        assert_eq!(normalize_url("172.20.0.2").unwrap(), "http://172.20.0.2");
        assert_eq!(normalize_url("172.40.0.2").unwrap(), "https://172.40.0.2");
        assert_eq!(normalize_url("http://x.org/lp").unwrap(), "http://x.org/lp");
        assert!(normalize_url("").is_err());
        assert!(normalize_url("https://").is_err());
    }

    #[test]
    fn reads_claims() {
        // {"token_type":"access","exp":1700000000,"user_id":7}
        let payload = "eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzAwMDAwMDAwLCJ1c2VyX2lkIjo3fQ";
        let c = claims(&format!("x.{payload}.sig")).unwrap();
        assert_eq!(
            c,
            Claims {
                user_id: 7,
                exp: 1_700_000_000
            }
        );
        assert_eq!(claims("garbage"), None);
    }

    #[test]
    fn memory_store() {
        let s = MemoryStore::default();
        s.set("a", "b").unwrap();
        assert_eq!(s.get("a").as_deref(), Some("b"));
        s.delete("a");
        assert_eq!(s.get("a"), None);
    }
}

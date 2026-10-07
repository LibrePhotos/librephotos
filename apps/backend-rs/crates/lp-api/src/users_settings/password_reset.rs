//! `POST /api/auth/password/reset/` and `/confirm/` (`api/views/password_reset.py`).
//!
//! Tokens are Django's `PasswordResetTokenGenerator` format (`<ts36>-<hmac>`,
//! salted HMAC-SHA256 over pk, password hash, last login, timestamp, email),
//! so links issued by either backend work on both. The request endpoint is
//! rate limited per client like DRF's `ScopedRateThrottle("password_reset")`,
//! but the window lives in the database (`rate_limit_hit`) so every process
//! shares it.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::OnceLock;

use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::{Extensions, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::{Duration, NaiveDate, Utc};
use hmac::{Hmac, Mac};
use lp_auth::OptionalUser;
use lp_core::extract::py_truthy;
use lp_core::{ApiError, ApiJson, ApiResult, AppState};
use lp_db::users::User;
use regex::Regex;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const KEY_SALT: &str = "django.contrib.auth.tokens.PasswordResetTokenGenerator";
/// `settings.PASSWORD_RESET_TIMEOUT` (Django default: 3 days).
const RESET_TIMEOUT_SECS: i64 = 259_200;
const THROTTLE_SCOPE: &str = "password_reset";

// ------------------------------------------------------------ tokens

fn int_to_base36(mut n: i64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n <= 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("ascii")
}

fn base36_to_int(s: &str) -> Option<i64> {
    if s.is_empty() || s.len() > 13 {
        return None;
    }
    i64::from_str_radix(s, 36).ok()
}

/// `PasswordResetTokenGenerator._now()`: naive local time, like Django.
fn num_seconds_now() -> i64 {
    let epoch = NaiveDate::from_ymd_opt(2001, 1, 1)
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .expect("valid date");
    (chrono::Local::now().naive_local() - epoch).num_seconds()
}

fn hash_value(user: &User, ts: i64) -> String {
    let login = user
        .last_login
        .map(|l| l.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_default();
    format!("{}{}{login}{ts}{}", user.id, user.password, user.email)
}

fn make_token_at(secret: &str, user: &User, ts: i64) -> String {
    let key = Sha256::digest(format!("{KEY_SALT}{secret}").as_bytes());
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).expect("any key length");
    mac.update(hash_value(user, ts).as_bytes());
    let hex = hex::encode(mac.finalize().into_bytes());
    let short: String = hex.chars().step_by(2).collect();
    format!("{}-{short}", int_to_base36(ts))
}

pub fn make_token(secret: &str, user: &User) -> String {
    make_token_at(secret, user, num_seconds_now())
}

pub fn check_token(secret: &str, user: &User, token: &str) -> bool {
    let Some((ts36, _)) = token.split_once('-') else {
        return false;
    };
    if token.matches('-').count() != 1 {
        return false;
    }
    let Some(ts) = base36_to_int(ts36) else {
        return false;
    };
    let expected = make_token_at(secret, user, ts);
    let same: bool = subtle::ConstantTimeEq::ct_eq(expected.as_bytes(), token.as_bytes()).into();
    same && num_seconds_now() - ts <= RESET_TIMEOUT_SECS
}

/// `urlsafe_base64_encode(force_bytes(pk))`.
pub fn encode_uid(pk: i32) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(pk.to_string())
}

fn decode_uid(uid: &str) -> Option<i32> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(uid.trim_end_matches('='))
        .ok()?;
    String::from_utf8(bytes).ok()?.trim().parse().ok()
}

// ------------------------------------------------------------ validators

fn common_passwords() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        include_str!("data/common-passwords.txt")
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect()
    })
}

/// `SequenceMatcher(a, b).quick_ratio()`.
fn quick_ratio(a: &str, b: &str) -> f64 {
    let (la, lb) = (a.chars().count(), b.chars().count());
    if la + lb == 0 {
        return 1.0;
    }
    let mut avail: std::collections::HashMap<char, i64> = std::collections::HashMap::new();
    for c in b.chars() {
        *avail.entry(c).or_default() += 1;
    }
    let mut matches = 0;
    for c in a.chars() {
        let n = avail.entry(c).or_default();
        if *n > 0 {
            matches += 1;
        }
        *n -= 1;
    }
    2.0 * matches as f64 / (la + lb) as f64
}

/// `AUTH_PASSWORD_VALIDATORS`: similarity, minimum length 8, common, numeric.
pub fn validate_password(password: &str, user: &User) -> Vec<String> {
    let mut errors = Vec::new();
    static SPLIT: OnceLock<Regex> = OnceLock::new();
    let split = SPLIT.get_or_init(|| Regex::new(r"\W+").expect("regex"));
    let pw = password.to_lowercase();
    let pw_len = pw.chars().count();
    'attrs: for (value, verbose) in [
        (&user.username, "username"),
        (&user.first_name, "first name"),
        (&user.last_name, "last name"),
        (&user.email, "email address"),
    ] {
        if value.is_empty() {
            continue;
        }
        let lower = value.to_lowercase();
        let mut parts: Vec<&str> = split.split(&lower).collect();
        parts.push(&lower);
        for part in parts {
            let vlen = part.chars().count();
            if pw_len >= 10 * vlen && (vlen as f64) < 0.7 / 2.0 * pw_len as f64 {
                continue;
            }
            if quick_ratio(&pw, part) >= 0.7 {
                errors.push(format!("The password is too similar to the {verbose}."));
                break 'attrs;
            }
        }
    }
    if password.chars().count() < 8 {
        errors.push("This password is too short. It must contain at least 8 characters.".into());
    }
    if common_passwords().contains(pw.trim()) {
        errors.push("This password is too common.".into());
    }
    if !password.is_empty() && password.chars().all(char::is_numeric) {
        errors.push("This password is entirely numeric.".into());
    }
    errors
}

// ------------------------------------------------------------ throttle

/// `PASSWORD_RESET_THROTTLE_RATE` (`"5/hour"`): (requests, window seconds).
fn throttle_rate() -> Option<(usize, i64)> {
    let raw = std::env::var("PASSWORD_RESET_THROTTLE_RATE").unwrap_or_else(|_| "5/hour".into());
    let (num, period) = raw.split_once('/')?;
    let num: usize = num.trim().parse().ok()?;
    let secs = match period.trim().chars().next()? {
        's' => 1,
        'm' => 60,
        'h' => 3600,
        'd' => 86400,
        _ => return None,
    };
    Some((num, secs))
}

/// DRF `get_ident`: the whole `X-Forwarded-For` value without spaces, else
/// the proxy's `X-Real-IP`, else the peer address (`REMOTE_ADDR`).
fn client_ident(headers: &HeaderMap, extensions: &Extensions) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split_whitespace().collect::<String>())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
        .or_else(|| {
            extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|c| c.0.ip().to_string())
        })
        .unwrap_or_else(|| "unknown".into())
}

async fn throttle(state: &AppState, ident: &str) -> Result<(), ApiError> {
    let Some((num, secs)) = throttle_rate() else {
        return Ok(());
    };
    let now = Utc::now();
    let window_start = now - Duration::seconds(secs);
    let history =
        lp_db::users_settings::throttle_hits_since(&state.db, THROTTLE_SCOPE, ident, window_start)
            .await?;
    if history.len() >= num {
        let oldest = history.last().copied().unwrap_or(now);
        let remaining = secs as f64 - (now - oldest).num_milliseconds() as f64 / 1000.0;
        let available = num as i64 - history.len() as i64 + 1;
        let wait = if available <= 0 {
            None
        } else {
            Some((remaining / available as f64).ceil().max(0.0) as i64)
        };
        let mut msg = "Request was throttled.".to_string();
        if let Some(w) = wait {
            let unit = if w == 1 { "second" } else { "seconds" };
            msg.push_str(&format!(" Expected available in {w} {unit}."));
        }
        let mut err = ApiError::new(StatusCode::TOO_MANY_REQUESTS, "detail", msg);
        if let Some(w) = wait
            && let Ok(v) = HeaderValue::from_str(&w.to_string())
        {
            err = err.with_header(axum::http::header::RETRY_AFTER, v);
        }
        return Err(err);
    }
    lp_db::write::users_settings::record_throttle_hit(
        &state.db,
        THROTTLE_SCOPE,
        ident,
        now,
        window_start,
    )
    .await?;
    Ok(())
}

// ------------------------------------------------------------ views

/// `django.http.request.split_domain_port`: the domain of a well-formed Host
/// header, None otherwise. Django answers 400 (`DisallowedHost`) before any
/// view runs when this fails; here it keeps the Host out of the emailed link,
/// e.g. `localhost:80@evil.example`, which a browser opens on `evil.example`.
fn split_domain(host: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"^([a-z0-9.-]+|\[[a-f0-9]*:[a-f0-9.:]+\])(:[0-9]+)?$").expect("regex")
    });
    let lower = host.to_lowercase();
    let caps = re.captures(&lower)?;
    Some(caps[1].trim_end_matches('.').to_string())
}

/// `trusted_public_base_url`: `FRONTEND_BASE_URL`, else the request origin
/// only when its host is one Django's concrete `ALLOWED_HOSTS` would accept
/// or an entry of `CSRF_TRUSTED_ORIGINS`.
fn trusted_base_url(headers: &HeaderMap) -> String {
    let configured = std::env::var("FRONTEND_BASE_URL").unwrap_or_default();
    let configured = configured.trim_end_matches('/');
    if !configured.is_empty() {
        return configured.to_string();
    }
    let Some(host) = headers
        .get(axum::http::header::HOST)
        .and_then(|h| h.to_str().ok())
    else {
        return String::new();
    };
    let backend = std::env::var("BACKEND_HOST").unwrap_or_else(|_| "backend".into());
    if let Some(domain) = split_domain(host)
        && (domain == "localhost" || domain == backend.to_lowercase())
    {
        return super::serialize::request_origin(headers);
    }
    let mut origins = vec!["http://localhost:3000".to_string()];
    if let Ok(extra) = std::env::var("CSRF_TRUSTED_ORIGINS") {
        origins.extend(
            extra
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        );
    }
    for origin in origins {
        let netloc = origin
            .split_once("://")
            .map_or(origin.as_str(), |(_, r)| r)
            .split('/')
            .next()
            .unwrap_or("");
        if netloc == host && !origin.contains('*') {
            return origin.trim_end_matches('/').to_string();
        }
    }
    String::new()
}

async fn send_reset_email(state: AppState, user: User, base: String) {
    if base.is_empty() {
        tracing::error!(
            "Password reset for user {} not sent: set FRONTEND_BASE_URL to the address users \
             browse to, so the emailed link can be trusted.",
            user.id
        );
        return;
    }
    let cfg = match super::email::sending_config(&state).await {
        Ok(Some(cfg)) => cfg,
        Ok(None) => {
            tracing::warn!("Outgoing email is not configured; 1 message(s) not sent.");
            return;
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to send password-reset email");
            return;
        }
    };
    let uid = encode_uid(user.id);
    let token = make_token(&state.config.secret_key, &user);
    let link = format!("{base}/password-reset/confirm/{uid}/{token}");
    let body = format!(
        "Hello {},\n\nWe received a request to reset the password for your LibrePhotos \
         account. Open the link below to choose a new password:\n\n{link}\n\nIf you did not \
         request this, you can safely ignore this email; your password will not change.\n",
        user.username
    );
    if let Err(e) =
        super::email::send_mail(&cfg, "Reset your LibrePhotos password", &body, &user.email).await
    {
        tracing::error!(error = %e, "Failed to send password-reset email");
    }
}

pub async fn request_reset(
    State(state): State<AppState>,
    OptionalUser(viewer): OptionalUser,
    headers: HeaderMap,
    extensions: Extensions,
    ApiJson(data): ApiJson<Value>,
) -> ApiResult<Response> {
    let mut ident = match &viewer {
        Some(u) => u.id.to_string(),
        None => client_ident(&headers, &extensions),
    };
    // `rate_limit_hit.ident` is varchar(255); X-Forwarded-For can be longer.
    if let Some((cut, _)) = ident.char_indices().nth(255) {
        ident.truncate(cut);
    }
    throttle(&state, &ident).await?;
    let email = data
        .get("email")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if !email.is_empty()
        && let Some(user) = lp_db::users_settings::user_by_email_iexact(&state.db, &email).await?
        && !user.email.is_empty()
    {
        // Sent in the background: the answer must not reveal (by its timing)
        // whether the address exists.
        tokio::spawn(send_reset_email(
            state.clone(),
            user,
            trusted_base_url(&headers),
        ));
    }
    Ok(Json(json!({
        "status": true,
        "message": "If an account exists for that email, a reset link has been sent."
    }))
    .into_response())
}

fn failure(message: impl Into<String>) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"status": false, "message": message.into()})),
    )
        .into_response()
}

pub async fn confirm_reset(
    State(state): State<AppState>,
    OptionalUser(_viewer): OptionalUser,
    ApiJson(data): ApiJson<Value>,
) -> ApiResult<Response> {
    let get = |k: &str| data.get(k).filter(|v| py_truthy(v));
    let (Some(uid), Some(token), Some(new_password)) =
        (get("uid"), get("token"), get("new_password"))
    else {
        return Ok(failure("Missing parameters"));
    };
    let invalid = || failure("Invalid or expired reset link");
    let (Some(uid), Some(token), Some(new_password)) =
        (uid.as_str(), token.as_str(), new_password.as_str())
    else {
        return Ok(invalid());
    };
    let Some(pk) = decode_uid(uid) else {
        return Ok(invalid());
    };
    let Some(user) = lp_db::users::by_id(&state.db, pk).await? else {
        return Ok(invalid());
    };
    if !check_token(&state.config.secret_key, &user, token) {
        return Ok(invalid());
    }
    let problems = validate_password(new_password, &user);
    if !problems.is_empty() {
        return Ok(failure(problems.join(" ")));
    }
    let pw = new_password.to_string();
    let hash = state.blocking(move || lp_auth::password::hash(&pw)).await?;
    lp_db::write::users::set_password(&state.db, user.id, &hash).await?;
    Ok(Json(json!({"status": true, "message": "Password has been reset"})).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base36_roundtrip() {
        assert_eq!(int_to_base36(0), "0");
        assert_eq!(int_to_base36(35), "z");
        assert_eq!(int_to_base36(36), "10");
        assert_eq!(base36_to_int("10"), Some(36));
        assert_eq!(base36_to_int("x!"), None);
    }

    #[test]
    fn uid_roundtrip() {
        assert_eq!(encode_uid(2), "Mg");
        assert_eq!(decode_uid("Mg"), Some(2));
        assert_eq!(decode_uid("Mg=="), Some(2));
        assert_eq!(decode_uid("!!"), None);
    }

    #[test]
    fn reset_link_base_ignores_malformed_hosts() {
        let base = |host: &str| {
            let mut h = HeaderMap::new();
            h.insert(
                axum::http::header::HOST,
                HeaderValue::from_str(host).unwrap(),
            );
            trusted_base_url(&h)
        };
        if std::env::var_os("FRONTEND_BASE_URL").is_some() {
            return;
        }
        assert_eq!(base("localhost:3000"), "http://localhost:3000");
        assert_eq!(base("LOCALHOST"), "http://LOCALHOST");
        assert_eq!(base("localhost:80@evil.example"), "");
        assert_eq!(base("localhost:1/@evil.example"), "");
        assert_eq!(base("evil.example"), "");
        assert_eq!(split_domain("[::1]:8000").as_deref(), Some("[::1]"));
        assert_eq!(split_domain("localhost."), Some("localhost".into()));
    }

    #[test]
    fn quick_ratio_like_difflib() {
        assert_eq!(quick_ratio("abc", "abc"), 1.0);
        assert_eq!(quick_ratio("", ""), 1.0);
        assert!((quick_ratio("abcd", "bcde") - 0.75).abs() < 1e-9);
    }
}

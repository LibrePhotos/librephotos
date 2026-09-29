//! `GET /api/geocode/search?q=[&limit=]` → bare array of `{display_name, lat, lon}`
//! (api/views/geocode.py + api/geocode `search_location`, forward geocoding
//! with geopy). Every failure is an empty list, like Django. Nothing is cached.
//!
//! geopy's Mapbox, MapTiler and OpenCage `geocode()` take no `limit`, so
//! Django's call raises a TypeError and answers `[]` for those providers
//! without a request; only Nominatim and TomTom ever return results.
//!
//! `LP_GEOCODE_NOMINATIM_URL` / `LP_GEOCODE_TOMTOM_URL` override the provider
//! origins (tests point them at a local stub).

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use axum::Json;
use axum::extract::State;
use lp_auth::AuthUser;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::Mutex;

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize, PartialEq)]
pub(super) struct GeocodeResult {
    display_name: Option<String>,
    lat: f64,
    lon: f64,
}

fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// Python `int(str)`: surrounding whitespace, a sign, `_` between digits.
fn py_int(s: &str) -> Option<i64> {
    let t = s.trim_matches(py_space);
    let (neg, digits) = match t.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
        || !digits.chars().all(|c| c.is_ascii_digit() || c == '_')
    {
        return None;
    }
    let v: i64 = digits.replace('_', "").parse().ok()?;
    Some(if neg { -v } else { v })
}

pub(super) async fn geocode_search(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    q: QueryMap,
) -> ApiResult<Json<Vec<GeocodeResult>>> {
    let query = q.get("q").unwrap_or("").trim_matches(py_space).to_string();
    if query.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let limit = match q.get("limit") {
        None => 5,
        Some(raw) => py_int(raw).ok_or_else(|| {
            ApiError::internal(format!("invalid literal for int() with base 10: '{raw}'"))
        })?,
    };
    let settings = state.settings();
    let provider = settings.map_api_provider.clone();
    let api_key = settings.map_api_key.clone();
    wait_for_provider(&provider).await;
    let results = match provider.as_str() {
        "nominatim" => nominatim(&state, &query, limit).await,
        "tomtom" => tomtom(&state, &query, limit, &api_key).await,
        _ => None,
    };
    Ok(Json(results.unwrap_or_default()))
}

/// Minimum spacing between calls per provider (api/geocode/rate_limit.py),
/// within this process.
fn min_delay(provider: &str) -> Duration {
    Duration::from_millis(match provider {
        "nominatim" => 1100,
        _ => 50,
    })
}

static LAST_CALL: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

async fn wait_for_provider(provider: &str) {
    let delay = min_delay(provider);
    let mut last = LAST_CALL.lock().await;
    if let Some(prev) = last.get(provider) {
        let elapsed = prev.elapsed();
        if elapsed < delay {
            tokio::time::sleep(delay - elapsed).await;
        }
    }
    last.insert(provider.to_string(), Instant::now());
}

fn origin(env: &str, default: &str) -> String {
    std::env::var(env)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_string())
        .trim_end_matches('/')
        .to_string()
}

async fn get_json(req: reqwest::RequestBuilder) -> Option<Value> {
    let res = req.timeout(TIMEOUT).send().await.ok()?;
    if !res.status().is_success() {
        tracing::warn!("Error while searching location: status {}", res.status());
        return None;
    }
    res.json().await.ok()
}

fn number(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// geopy `Nominatim.geocode(query, exactly_one=False, limit=limit)`.
async fn nominatim(state: &AppState, query: &str, limit: i64) -> Option<Vec<GeocodeResult>> {
    if limit < 1 {
        return None;
    }
    let url = format!(
        "{}/search",
        origin(
            "LP_GEOCODE_NOMINATIM_URL",
            "https://nominatim.openstreetmap.org"
        )
    );
    let req = state
        .http
        .get(url)
        .header(reqwest::header::USER_AGENT, "librephotos")
        .query(&[
            ("q", query),
            ("format", "json"),
            ("limit", &limit.to_string()),
        ]);
    let body = get_json(req).await?;
    let places = match body {
        Value::Array(a) if a.is_empty() => return None,
        Value::Array(a) => a,
        Value::Object(ref o) if o.is_empty() => return None,
        Value::Object(ref o) if o.contains_key("error") => return None,
        v @ Value::Object(_) => vec![v],
        _ => return None,
    };
    places
        .iter()
        .map(|p| {
            Some(GeocodeResult {
                display_name: p
                    .get("display_name")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                lat: number(p.get("lat"))?,
                lon: number(p.get("lon"))?,
            })
        })
        .collect()
}

/// Characters `urllib.parse.quote` (default `safe="/"`) leaves alone.
const QUOTE: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'_')
    .remove(b'.')
    .remove(b'-')
    .remove(b'~')
    .remove(b'/');

/// geopy `TomTom.geocode(query, exactly_one=False, limit=limit)`.
async fn tomtom(
    state: &AppState,
    query: &str,
    limit: i64,
    api_key: &str,
) -> Option<Vec<GeocodeResult>> {
    let url = format!(
        "{}/search/2/geocode/{}.json",
        origin("LP_GEOCODE_TOMTOM_URL", "https://api.tomtom.com"),
        utf8_percent_encode(query, QUOTE)
    );
    let mut params: Vec<(&str, String)> =
        vec![("key", api_key.to_string()), ("typeahead", "false".into())];
    if limit != 0 {
        params.push(("limit", limit.to_string()));
    }
    let body = get_json(state.http.get(url).query(&params)).await?;
    let results = body.get("results").and_then(Value::as_array)?;
    if results.is_empty() {
        return None;
    }
    results
        .iter()
        .map(|r| {
            Some(GeocodeResult {
                display_name: Some(
                    r.get("address")
                        .and_then(|a| a.get("freeformAddress"))
                        .and_then(Value::as_str)?
                        .to_string(),
                ),
                lat: number(r.get("position").and_then(|p| p.get("lat")))?,
                lon: number(r.get("position").and_then(|p| p.get("lon")))?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::py_int;

    #[test]
    fn python_int() {
        assert_eq!(py_int("5"), Some(5));
        assert_eq!(py_int(" +7 "), Some(7));
        assert_eq!(py_int("-2"), Some(-2));
        assert_eq!(py_int("1_0"), Some(10));
        assert_eq!(py_int(""), None);
        assert_eq!(py_int("x"), None);
        assert_eq!(py_int("_1"), None);
        assert_eq!(py_int("1.5"), None);
    }
}

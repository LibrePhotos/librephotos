//! `api.geocode.geocode.reverse_geocode` for the GPS edit. Only the default
//! provider (nominatim) is ported; the others answer nothing, as Django does
//! for a provider it cannot reach. Kept in one function so the integrator can
//! swap it for a shared geocoder client.

use std::time::Duration;

use lp_core::AppState;
use serde_json::{Value, json};

const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/reverse";
const PROPS: [&str; 10] = [
    "road",
    "town",
    "neighbourhood",
    "suburb",
    "hamlet",
    "borough",
    "city",
    "county",
    "state",
    "country",
];

/// `parsers.nominatim.parse` on the raw reverse answer.
pub fn parse_nominatim(raw: &Value) -> Option<Value> {
    let address = raw.get("address")?.as_object()?;
    let places: Vec<Value> = PROPS
        .iter()
        .filter_map(|p| address.get(*p).cloned())
        .collect();
    let num = |k: &str| -> Option<f64> {
        match raw.get(k)? {
            Value::String(s) => s.parse().ok(),
            Value::Number(n) => n.as_f64(),
            _ => None,
        }
    };
    let center = json!([num("lat")?, num("lon")?]);
    Some(json!({
        "features": places.iter().map(|p| json!({"text": p, "center": center})).collect::<Vec<_>>(),
        "places": places,
        "address": raw.get("display_name").cloned().unwrap_or(Value::Null),
        "center": center,
        "_v": "1",
    }))
}

/// `None` = "no result" (feature off, unsupported provider, network error).
pub async fn reverse_geocode(state: &AppState, lat: f64, lon: f64) -> Option<Value> {
    if !state.config.features.reverse_geocoding {
        return None;
    }
    let provider = state.settings().map_api_provider.clone();
    if provider != "nominatim" {
        tracing::warn!(provider, "reverse geocoding provider not ported; no result");
        return None;
    }
    let res = state
        .http
        .get(NOMINATIM_URL)
        .query(&[
            ("lat", lat.to_string()),
            ("lon", lon.to_string()),
            ("format", "json".to_string()),
            ("addressdetails", "1".to_string()),
        ])
        .header("User-Agent", "librephotos")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .and_then(|r| r.error_for_status());
    match res {
        Ok(r) => match r.json::<Value>().await {
            Ok(raw) => parse_nominatim(&raw),
            Err(e) => {
                tracing::warn!(error = %e, "Error while reverse geocoding");
                None
            }
        },
        Err(e) => {
            tracing::warn!(error = %e, "Error while reverse geocoding");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nominatim_shape() {
        let raw = json!({"lat": "52.5", "lon": "13.4", "display_name": "Berlin, Germany",
                         "address": {"city": "Berlin", "country": "Germany", "postcode": "10117"}});
        let got = parse_nominatim(&raw).unwrap();
        assert_eq!(got["places"], json!(["Berlin", "Germany"]));
        assert_eq!(
            got["features"][1],
            json!({"text": "Germany", "center": [52.5, 13.4]})
        );
        assert_eq!(got["address"], "Berlin, Germany");
    }
}

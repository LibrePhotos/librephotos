//! The map providers `api/geocode` reaches through geopy, spoken directly:
//! the same URLs and parameters geopy sends, and the same parsers
//! (`api/geocode/parsers/*`) over the raw replies.

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};
use std::time::Duration;

use serde_json::{Value, json};

/// `GEOCODE_VERSION`: stored as `_v` in `geolocation_json`.
pub const GEOCODE_VERSION: &str = "1";
/// `GEOCODE_TIMEOUT_SECONDS`.
pub const TIMEOUT: Duration = Duration::from_secs(10);
const USER_AGENT: &str = "librephotos";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Nominatim,
    Mapbox,
    Maptiler,
    Tomtom,
    Opencage,
}

impl Provider {
    pub fn parse(name: &str) -> Option<Provider> {
        Some(match name {
            "nominatim" => Provider::Nominatim,
            "mapbox" => Provider::Mapbox,
            "maptiler" => Provider::Maptiler,
            "tomtom" => Provider::Tomtom,
            "opencage" => Provider::Opencage,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Provider::Nominatim => "nominatim",
            Provider::Mapbox => "mapbox",
            Provider::Maptiler => "maptiler",
            Provider::Tomtom => "tomtom",
            Provider::Opencage => "opencage",
        }
    }

    fn default_base(self) -> &'static str {
        match self {
            Provider::Nominatim => "https://nominatim.openstreetmap.org",
            Provider::Mapbox => "https://api.mapbox.com",
            Provider::Maptiler => "https://api.maptiler.com",
            Provider::Tomtom => "https://api.tomtom.com",
            Provider::Opencage => "https://api.opencagedata.com",
        }
    }

    fn needs_key(self) -> bool {
        !matches!(self, Provider::Nominatim)
    }
}

static BASE_OVERRIDES: LazyLock<RwLock<HashMap<&'static str, String>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Point a provider at another origin (tests, a self-hosted Nominatim).
/// `LP_GEOCODE_<PROVIDER>_URL` does the same from the environment.
pub fn set_base_url(provider: Provider, base: &str) {
    BASE_OVERRIDES
        .write()
        .expect("geocode overrides")
        .insert(provider.name(), base.trim_end_matches('/').to_string());
}

fn base_url(provider: Provider) -> String {
    if let Some(b) = BASE_OVERRIDES
        .read()
        .expect("geocode overrides")
        .get(provider.name())
    {
        return b.clone();
    }
    let env = format!("LP_GEOCODE_{}_URL", provider.name().to_uppercase());
    std::env::var(env)
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| provider.default_base().to_string())
}

/// geopy's `"%(lat)s,%(lon)s"` formatting of a point.
fn coord(v: f64) -> String {
    let s = format!("{v}");
    if s.contains('.') || s.contains('e') || s.contains("inf") || s.contains("NaN") {
        s
    } else {
        format!("{s}.0")
    }
}

fn path_escape(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, percent_encoding::NON_ALPHANUMERIC)
        .to_string()
        .replace("%2C", ",")
        .replace("%2D", "-")
        .replace("%2E", ".")
        .replace("%5F", "_")
        .replace("%7E", "~")
}

async fn get_json(
    http: &reqwest::Client,
    url: &str,
    query: &[(&str, String)],
) -> anyhow::Result<Value> {
    let resp = http
        .get(url)
        .query(query)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .timeout(TIMEOUT)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("{} answered {status}", url);
    }
    Ok(resp.json().await?)
}

/// `Geocode(provider).reverse(lat, lon)`: the parsed place, `{}` when the
/// provider knows nothing there or no key is configured.
pub async fn reverse(
    http: &reqwest::Client,
    provider: Provider,
    api_key: &str,
    lat: f64,
    lon: f64,
) -> anyhow::Result<Value> {
    if provider.needs_key() && api_key.is_empty() {
        tracing::warn!(
            "No API key found for map provider. Please set MAP_API_KEY in the admin panel or switch map provider."
        );
    }
    let base = base_url(provider);
    let raw = match provider {
        Provider::Nominatim => {
            let v = get_json(
                http,
                &format!("{base}/reverse"),
                &[
                    ("lat", coord(lat)),
                    ("lon", coord(lon)),
                    ("format", "json".into()),
                    ("addressdetails", "1".into()),
                ],
            )
            .await?;
            if v.get("error").is_some() {
                None
            } else {
                Some(v)
            }
        }
        Provider::Mapbox | Provider::Maptiler => {
            let point = path_escape(&format!("{},{}", coord(lon), coord(lat)));
            let (url, key_param) = if provider == Provider::Mapbox {
                (
                    format!("{base}/geocoding/v5/mapbox.places/{point}.json/"),
                    "access_token",
                )
            } else {
                (format!("{base}/geocoding/{point}.json"), "key")
            };
            let v = get_json(http, &url, &[(key_param, api_key.to_string())]).await?;
            v.get("features")
                .and_then(Value::as_array)
                .and_then(|f| f.first())
                .cloned()
        }
        Provider::Tomtom => {
            let point = path_escape(&format!("{},{}", coord(lat), coord(lon)));
            let v = get_json(
                http,
                &format!("{base}/search/2/reverseGeocode/{point}.json"),
                &[("key", api_key.to_string())],
            )
            .await?;
            v.get("addresses")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .cloned()
        }
        Provider::Opencage => {
            let v = get_json(
                http,
                &format!("{base}/geocode/v1/json"),
                &[
                    ("key", api_key.to_string()),
                    ("q", format!("{},{}", coord(lat), coord(lon))),
                ],
            )
            .await?;
            v.get("results")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
                .cloned()
        }
    };
    let Some(raw) = raw else {
        return Ok(json!({}));
    };
    parse(provider, &raw).ok_or_else(|| anyhow::anyhow!("unexpected {} reply", provider.name()))
}

fn text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Null => None,
        other => Some(other.to_string()),
    }
}

fn number(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn place_result(places: Vec<String>, address: Option<String>, center: [f64; 2]) -> Value {
    json!({
        "features": places.iter().map(|p| json!({"text": p, "center": center})).collect::<Vec<_>>(),
        "places": places,
        "address": address,
        "center": center,
        "_v": GEOCODE_VERSION,
    })
}

/// The provider's parser over one raw result.
pub fn parse(provider: Provider, raw: &Value) -> Option<Value> {
    match provider {
        Provider::Nominatim => {
            let data = raw.get("address")?.as_object()?;
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
            let places = PROPS
                .iter()
                .filter_map(|p| data.get(*p).and_then(text))
                .collect();
            let center = [number(raw.get("lat"))?, number(raw.get("lon"))?];
            Some(place_result(
                places,
                raw.get("display_name").and_then(text),
                center,
            ))
        }
        Provider::Mapbox | Provider::Maptiler => {
            let c = raw.get("center")?.as_array()?;
            let center = [number(c.get(1))?, number(c.first())?];
            let mut places = vec![raw.get("text").and_then(text)?];
            for item in raw.get("context")?.as_array()? {
                let id = item.get("id").and_then(Value::as_str).unwrap_or("");
                if !id.starts_with("post")
                    && let Some(t) = item.get("text").and_then(text)
                {
                    places.push(t);
                }
            }
            Some(place_result(
                places,
                raw.get("place_name").and_then(text),
                center,
            ))
        }
        Provider::Tomtom => {
            let data = raw.get("address")?.as_object()?;
            let position = raw.get("position")?.as_str()?;
            let mut parts = position.split(',').map(|p| p.trim().parse::<f64>());
            let center = [parts.next()?.ok()?, parts.next()?.ok()?];
            const PROPS: [&str; 8] = [
                "street",
                "streetName",
                "municipalitySubdivision",
                "countrySubdivision",
                "countrySecondarySubdivision",
                "municipality",
                "municipalitySubdivision",
                "country",
            ];
            let mut places: Vec<String> = Vec::new();
            for p in PROPS {
                if let Some(v) = data.get(p).and_then(text)
                    && v.chars().count() > 2
                    && !places.contains(&v)
                {
                    places.push(v);
                }
            }
            let address = data.get("freeformAddress").and_then(text);
            Some(place_result(places, address, center))
        }
        Provider::Opencage => {
            let data = raw.get("components")?.as_object()?;
            let geometry = raw.get("geometry")?;
            let center = [number(geometry.get("lat"))?, number(geometry.get("lng"))?];
            let first = data
                .get("_type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let props = [
                first.as_str(),
                "road",
                "suburb",
                "municipality",
                "hamlet",
                "towncity",
                "borough",
                "state",
                "county",
                "country",
            ];
            let places = props
                .iter()
                .filter_map(|p| data.get(*p).and_then(text))
                .collect();
            Some(place_result(
                places,
                raw.get("formatted").and_then(text),
                center,
            ))
        }
    }
}

/// `Geocode(provider).search(query, limit)`: `[{display_name, lat, lon}]`.
pub async fn search(
    http: &reqwest::Client,
    provider: Provider,
    api_key: &str,
    query: &str,
    limit: usize,
) -> anyhow::Result<Vec<Value>> {
    let base = base_url(provider);
    let item = |name: Option<String>, lat: Option<f64>, lon: Option<f64>| -> Option<Value> {
        Some(json!({"display_name": name?, "lat": lat?, "lon": lon?}))
    };
    let out: Vec<Value> = match provider {
        Provider::Nominatim => {
            let v = get_json(
                http,
                &format!("{base}/search"),
                &[
                    ("q", query.to_string()),
                    ("format", "json".into()),
                    ("limit", limit.to_string()),
                ],
            )
            .await?;
            v.as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| {
                    item(
                        r.get("display_name").and_then(text),
                        number(r.get("lat")),
                        number(r.get("lon")),
                    )
                })
                .collect()
        }
        Provider::Mapbox | Provider::Maptiler => {
            let q = path_escape(query);
            let (url, key_param) = if provider == Provider::Mapbox {
                (
                    format!("{base}/geocoding/v5/mapbox.places/{q}.json/"),
                    "access_token",
                )
            } else {
                (format!("{base}/geocoding/{q}.json"), "key")
            };
            let v = get_json(
                http,
                &url,
                &[
                    (key_param, api_key.to_string()),
                    ("limit", limit.to_string()),
                ],
            )
            .await?;
            v.get("features")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|f| {
                    let c = f.get("geometry")?.get("coordinates")?.as_array()?;
                    item(
                        f.get("place_name").and_then(text),
                        number(c.get(1)),
                        number(c.first()),
                    )
                })
                .collect()
        }
        Provider::Tomtom => {
            let q = path_escape(query);
            let v = get_json(
                http,
                &format!("{base}/search/2/geocode/{q}.json"),
                &[("key", api_key.to_string()), ("limit", limit.to_string())],
            )
            .await?;
            v.get("results")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|r| {
                    let pos = r.get("position")?;
                    item(
                        r.get("address")?.get("freeformAddress").and_then(text),
                        number(pos.get("lat")),
                        number(pos.get("lon")),
                    )
                })
                .collect()
        }
        Provider::Opencage => {
            let v = get_json(
                http,
                &format!("{base}/geocode/v1/json"),
                &[
                    ("key", api_key.to_string()),
                    ("q", query.to_string()),
                    ("limit", limit.to_string()),
                ],
            )
            .await?;
            v.get("results")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|r| {
                    let g = r.get("geometry")?;
                    item(
                        r.get("formatted").and_then(text),
                        number(g.get("lat")),
                        number(g.get("lng")),
                    )
                })
                .collect()
        }
    };
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nominatim_parser() {
        let raw = json!({
            "lat": "52.5163", "lon": "13.3777", "display_name": "Pariser Platz, Berlin, Deutschland",
            "address": {"road": "Pariser Platz", "suburb": "Mitte", "city": "Berlin",
                        "state": "Berlin", "country": "Deutschland", "postcode": "10117"}
        });
        let p = parse(Provider::Nominatim, &raw).unwrap();
        assert_eq!(
            p["places"],
            json!(["Pariser Platz", "Mitte", "Berlin", "Berlin", "Deutschland"])
        );
        assert_eq!(p["center"], json!([52.5163, 13.3777]));
        assert_eq!(p["_v"], "1");
        assert_eq!(
            p["features"][2],
            json!({"text": "Berlin", "center": [52.5163, 13.3777]})
        );
    }

    #[test]
    fn mapbox_and_tomtom_parsers() {
        let raw = json!({"text": "Unter den Linden", "center": [13.38, 52.51], "place_name": "x",
            "context": [{"id": "postcode.1", "text": "10117"}, {"id": "place.2", "text": "Berlin"}]});
        let p = parse(Provider::Mapbox, &raw).unwrap();
        assert_eq!(p["places"], json!(["Unter den Linden", "Berlin"]));
        assert_eq!(p["center"], json!([52.51, 13.38]));
        let raw = json!({"position": "52.5,13.4", "address": {"streetName": "Linden",
            "municipality": "Berlin", "municipalitySubdivision": "Mitte", "country": "DE",
            "freeformAddress": "Linden, Berlin"}});
        let p = parse(Provider::Tomtom, &raw).unwrap();
        assert_eq!(p["places"], json!(["Linden", "Mitte", "Berlin"]));
    }

    #[test]
    fn coords_like_python() {
        assert_eq!(coord(52.0), "52.0");
        assert_eq!(coord(13.4049), "13.4049");
        assert_eq!(coord(-0.5), "-0.5");
    }
}

//! The one geocoder (`api/geocode`): `geo.locate` (`processing_jobs.add_geolocation`
//! and `geocode/photo_location.py`), [`reverse_geocode`] for the GPS edit and
//! [`search_location`] for `/api/geocode/search`, over every provider Django
//! configures (nominatim, mapbox, maptiler, tomtom, opencage; `photon` was
//! migrated to nominatim by Django and is "not found" here as there).

pub mod providers;

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use lp_core::AppState;
use lp_jobs::JobType;
use serde_json::{Value, json};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

pub use providers::{GEOCODE_VERSION, Place, Provider};

use crate::fanout::{PHOTO_CONCURRENCY, for_each_photo};
use crate::{exif, run};

/// Minimum seconds between two calls to a provider (`geocode/rate_limit.py`):
/// Nominatim's terms ask for at most one per second. One process now, so
/// the diskcache coordination became a mutex.
fn min_delay(provider: &str) -> Duration {
    Duration::from_secs_f64(match provider {
        "nominatim" => 1.1,
        _ => 0.05,
    })
}

static LAST_CALL: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// `rate_limit.wait`: block until the provider's window is open, then claim it.
pub async fn wait_for_provider(provider: &str) {
    let delay = min_delay(provider);
    loop {
        let remaining = {
            let mut last = LAST_CALL.lock().expect("geocode rate limit");
            let now = Instant::now();
            match last.get(provider) {
                Some(t) if now.duration_since(*t) < delay => delay - now.duration_since(*t),
                _ => {
                    last.insert(provider.to_string(), now);
                    return;
                }
            }
        };
        tokio::time::sleep(remaining).await;
    }
}

/// `reverse_geocode`: `{}` when the feature is off, the provider unknown or
/// the call failed (logged).
pub async fn reverse_geocode(state: &AppState, lat: f64, lon: f64) -> Value {
    if !state.config.features.reverse_geocoding {
        return json!({});
    }
    let settings = state.settings();
    let name = settings.map_api_provider.clone();
    wait_for_provider(&name).await;
    let Some(provider) = Provider::parse(&name) else {
        tracing::warn!("Error while reverse geocoding: Map provider not found: {name}.");
        return json!({});
    };
    match providers::reverse(&state.http, provider, &settings.map_api_key, lat, lon).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Error while reverse geocoding: {e}");
            json!({})
        }
    }
}

/// `search_location` for `GET /api/geocode/search?q=`: empty on any
/// provider error (logged), like Django.
pub async fn search_location(state: &AppState, query: &str, limit: i64) -> Vec<Place> {
    let settings = state.settings();
    let name = settings.map_api_provider.clone();
    wait_for_provider(&name).await;
    let Some(provider) = Provider::parse(&name) else {
        tracing::warn!("Error while searching location: Map provider not found: {name}.");
        return Vec::new();
    };
    match providers::search(&state.http, provider, &settings.map_api_key, query, limit).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Error while searching location: {e}");
            Vec::new()
        }
    }
}

pub async fn locate(
    state: &AppState,
    user_id: i32,
    full_scan: bool,
    job_id: &str,
) -> anyhow::Result<()> {
    let since = if full_scan {
        None
    } else {
        run::last_finished_start(&state.db, user_id, JobType::AddGeolocation, false).await?
    };
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM api_photo p WHERE p.owner_id = $1 \
           AND ($2::boolean IS FALSE OR p.added_on > $3) ORDER BY p.id",
    )
    .bind(user_id)
    .bind(since.is_some())
    .bind(since.flatten())
    .fetch_all(&state.db)
    .await?;
    if !run::start_items(&state.db, job_id, ids.len() as i64).await? {
        return Ok(());
    }
    for_each_photo(state, job_id, ids, PHOTO_CONCURRENCY, |id| async move {
        geolocate_photo(state, id).await.map_err(|e| e.to_string())
    })
    .await?;
    Ok(())
}

#[derive(Debug, FromRow)]
struct GeoPhoto {
    image_hash: String,
    owner_id: i32,
    exif_gps_lat: Option<f64>,
    exif_gps_lon: Option<f64>,
    exif_timestamp: Option<DateTime<Utc>>,
    geolocation_json: Option<Value>,
    main_path: Option<String>,
}

fn as_f64(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// `_has_usable_coordinates`: both present and not the (0, 0) null island.
pub fn usable_coordinates(lat: Option<f64>, lon: Option<f64>) -> bool {
    matches!((lat, lon), (Some(a), Some(b)) if !(a == 0.0 && b == 0.0))
}

/// `geolocation_job` for one photo: `geolocate_photo`, then
/// `add_location_to_album_dates` from the stored geolocation, which also
/// runs when the photo was up to date or the geocoder gave nothing.
pub async fn geolocate_photo(state: &AppState, photo_id: Uuid) -> anyhow::Result<()> {
    let Some(photo) = load_geo_photo(&state.db, photo_id).await? else {
        return Ok(());
    };
    geolocate(state, photo_id, &photo).await?;
    let Some(photo) = load_geo_photo(&state.db, photo_id).await? else {
        return Ok(());
    };
    let Some(res) = photo.geolocation_json.clone() else {
        return Ok(());
    };
    let mut tx = state.db.begin().await?;
    add_location_to_album_date(&mut tx, &photo, &res).await?;
    tx.commit().await?;
    Ok(())
}

async fn load_geo_photo(db: &sqlx::PgPool, photo_id: Uuid) -> sqlx::Result<Option<GeoPhoto>> {
    sqlx::query_as::<_, GeoPhoto>(
        "SELECT p.image_hash, p.owner_id, p.exif_gps_lat, p.exif_gps_lon, p.exif_timestamp, \
           p.geolocation_json, f.path AS main_path \
         FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id WHERE p.id = $1",
    )
    .bind(photo_id)
    .fetch_optional(db)
    .await
}

/// `geolocate_photo`.
async fn geolocate(state: &AppState, photo_id: Uuid, photo: &GeoPhoto) -> anyhow::Result<()> {
    let fail = |msg: String| anyhow::anyhow!("Photo {}: {msg}", photo.image_hash);
    let main = photo
        .main_path
        .clone()
        .ok_or_else(|| fail("'NoneType' object has no attribute 'path'".into()))?;
    let values = exif::get_tags(
        &state.exif,
        &main,
        &["Composite:GPSLatitude", "Composite:GPSLongitude"],
        false,
    )
    .await
    .map_err(|e| fail(e.to_string()))?
    .unwrap_or_default();
    let lat = as_f64(values.first().and_then(Option::as_ref));
    let lon = as_f64(values.get(1).and_then(Option::as_ref));
    if !usable_coordinates(lat, lon) {
        return Ok(());
    }
    let (lat, lon) = (lat.expect("usable"), lon.expect("usable"));

    let in_places: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_albumplace_photos WHERE photo_id = $1)",
    )
    .bind(photo_id)
    .fetch_one(&state.db)
    .await?;
    let current = photo
        .geolocation_json
        .as_ref()
        .and_then(|g| g.get("_v"))
        .and_then(Value::as_str)
        == Some(GEOCODE_VERSION);
    if photo.exif_gps_lat == Some(lat) && photo.exif_gps_lon == Some(lon) && in_places && current {
        return Ok(());
    }
    // The coordinates are saved before the geocoder runs, so a geocoder
    // failure still leaves them stored.
    sqlx::query(
        "UPDATE api_photo SET exif_gps_lat = $2, exif_gps_lon = $3, last_modified = now() WHERE id = $1",
    )
    .bind(photo_id)
    .bind(lat)
    .bind(lon)
    .execute(&state.db)
    .await?;

    let res = reverse_geocode(state, lat, lon).await;
    if res.as_object().is_none_or(|o| o.is_empty()) {
        return Ok(());
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE api_photo SET geolocation_json = $2, last_modified = now() WHERE id = $1")
        .bind(photo_id)
        .bind(&res)
        .execute(&mut *tx)
        .await?;
    update_search_location(&mut tx, photo_id, &res).await?;
    move_to_album_places(&mut tx, photo_id, &photo.image_hash, photo.owner_id, &res).await?;
    tx.commit().await?;
    Ok(())
}

/// `PhotoSearch.update_search_location` on a `get_or_create`d row.
async fn update_search_location(
    conn: &mut PgConnection,
    photo_id: Uuid,
    res: &Value,
) -> sqlx::Result<()> {
    let location: Option<String> = if let Some(address) = res.get("address") {
        address.as_str().map(str::to_string)
    } else if let Some(features) = res.get("features").and_then(Value::as_array) {
        let parts: Vec<&str> = features
            .iter()
            .filter_map(|f| f.get("text").and_then(Value::as_str))
            .filter(|t| !t.is_empty())
            .collect();
        Some(parts.join(", "))
    } else {
        Some(String::new())
    };
    sqlx::query(
        "INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at) \
         VALUES ($1, NULL, $2, now(), now()) \
         ON CONFLICT (photo_id) DO UPDATE SET search_location = EXCLUDED.search_location, \
           updated_at = now()",
    )
    .bind(photo_id)
    .bind(location)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn is_numeric(s: &str) -> bool {
    !s.is_empty() && s.chars().all(char::is_numeric)
}

/// `_move_to_album_places`: out of every Places album, then into one per
/// named feature (`geolocation_level` = distance from the end, set when the
/// album does not hold the photo's hash yet).
async fn move_to_album_places(
    conn: &mut PgConnection,
    photo_id: Uuid,
    image_hash: &str,
    owner_id: i32,
    res: &Value,
) -> sqlx::Result<()> {
    let old: Vec<i32> = sqlx::query_scalar(
        "DELETE FROM api_albumplace_photos WHERE photo_id = $1 RETURNING albumplace_id",
    )
    .bind(photo_id)
    .fetch_all(&mut *conn)
    .await?;
    if !old.is_empty() {
        sqlx::query("UPDATE api_albumplace SET last_modified = now() WHERE id = ANY($1)")
            .bind(&old)
            .execute(&mut *conn)
            .await?;
    }
    let features: Vec<Value> = res
        .get("features")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let n = features.len() as i32;
    for (level, feature) in features.iter().enumerate() {
        let Some(title) = feature.get("text") else {
            continue;
        };
        let title = match title {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        if is_numeric(&title) {
            continue;
        }
        sqlx::query(
            "INSERT INTO api_albumplace (title, geolocation_level, favorited, owner_id, last_modified) \
             VALUES ($1, NULL, FALSE, $2, now()) ON CONFLICT (title, owner_id) DO NOTHING",
        )
        .bind(&title)
        .bind(owner_id)
        .execute(&mut *conn)
        .await?;
        let (place_id, has_hash): (i32, bool) = sqlx::query_as(
            "SELECT a.id, EXISTS (SELECT 1 FROM api_albumplace_photos l JOIN api_photo p \
               ON p.id = l.photo_id WHERE l.albumplace_id = a.id AND p.image_hash = $3) \
             FROM api_albumplace a WHERE a.title = $1 AND a.owner_id = $2 FOR UPDATE",
        )
        .bind(&title)
        .bind(owner_id)
        .bind(image_hash)
        .fetch_one(&mut *conn)
        .await?;
        sqlx::query(
            "UPDATE api_albumplace SET last_modified = now(), \
               geolocation_level = CASE WHEN $2 THEN geolocation_level ELSE $3 END WHERE id = $1",
        )
        .bind(place_id)
        .bind(has_hash)
        .bind(n - level as i32)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT INTO api_albumplace_photos (albumplace_id, photo_id) VALUES ($1, $2) \
             ON CONFLICT DO NOTHING",
        )
        .bind(place_id)
        .bind(photo_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// `add_location_to_album_dates`: the city (second-to-last place) joins the
/// location of the day album holding the photo.
async fn add_location_to_album_date(
    conn: &mut PgConnection,
    photo: &GeoPhoto,
    res: &Value,
) -> sqlx::Result<()> {
    let places: Vec<&Value> = res
        .get("places")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    if places.len() < 2 {
        return Ok(());
    }
    let city = places[places.len() - 2].clone();
    let date = photo.exif_timestamp.map(|t| t.date_naive());
    let albums: Vec<(i32, Option<Value>)> = sqlx::query_as(
        "SELECT a.id, a.location FROM api_albumdate a \
         WHERE a.owner_id = $1 AND a.date IS NOT DISTINCT FROM $2 LIMIT 2 FOR UPDATE",
    )
    .bind(photo.owner_id)
    .bind(date)
    .fetch_all(&mut *conn)
    .await?;
    let [(album_id, location)] = albums.as_slice() else {
        return Ok(());
    };
    let holds: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_albumdate_photos l JOIN api_photo p ON p.id = l.photo_id \
          WHERE l.albumdate_id = $1 AND p.image_hash = $2)",
    )
    .bind(album_id)
    .bind(&photo.image_hash)
    .fetch_one(&mut *conn)
    .await?;
    if !holds {
        return Ok(());
    }
    let new_location = match location {
        Some(Value::Object(map)) if !map.is_empty() => {
            let mut map = map.clone();
            let mut list = map
                .get("places")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if !list.contains(&city) {
                list.push(city);
                let mut unique: Vec<Value> = Vec::with_capacity(list.len());
                for v in list {
                    if !unique.contains(&v) {
                        unique.push(v);
                    }
                }
                map.insert("places".into(), Value::Array(unique));
            }
            Value::Object(map)
        }
        _ => json!({"places": [city]}),
    };
    sqlx::query("UPDATE api_albumdate SET location = $2 WHERE id = $1")
        .bind(album_id)
        .bind(new_location)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinates() {
        assert!(!usable_coordinates(None, Some(1.0)));
        assert!(!usable_coordinates(Some(0.0), Some(0.0)));
        assert!(usable_coordinates(Some(0.0), Some(13.4)));
    }

    #[tokio::test]
    async fn rate_limit_spaces_calls() {
        let start = Instant::now();
        wait_for_provider("test-provider").await;
        wait_for_provider("test-provider").await;
        wait_for_provider("test-provider").await;
        assert!(start.elapsed() >= Duration::from_millis(100));
    }
}

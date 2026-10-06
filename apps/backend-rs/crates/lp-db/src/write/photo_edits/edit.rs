//! `PATCH /photos/edit/{h}/` (`PhotoEditSerializer.update`) and
//! `/photosedit/rotate/`.

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use uuid::Uuid;

use crate::db::Conn;

/// `_apply_category_override`: `save(update_fields=[..., "category_source"])`,
/// which leaves `last_modified` alone.
pub async fn set_category(
    conn: &mut Conn,
    photo_id: Uuid,
    is_screenshot: Option<bool>,
    is_document: Option<bool>,
) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE api_photo SET is_screenshot = COALESCE($2, is_screenshot), \
         is_document = COALESCE($3, is_document), category_source = 'user' WHERE id = $1",
    )
    .bind(photo_id)
    .bind(is_screenshot)
    .bind(is_document)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The user-set `timestamp` (`instance.save()`).
pub async fn set_timestamp(
    conn: &mut Conn,
    photo_id: Uuid,
    timestamp: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE api_photo SET \"timestamp\" = $2, last_modified = now() WHERE id = $1",
    )
    .bind(photo_id)
    .bind(timestamp)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `get_album_date(date, owner)`: `.get()`, so exactly one row or nothing.
async fn album_date_exact(
    conn: &mut Conn,
    date: Option<NaiveDate>,
    owner_id: i32,
) -> sqlx::Result<Option<i32>> {
    let ids: Vec<i32> = crate::sql::query_scalar(
        "SELECT id FROM api_albumdate WHERE date IS NOT DISTINCT FROM $1 AND owner_id = $2 LIMIT 2",
    )
    .bind(date)
    .bind(owner_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(if ids.len() == 1 { Some(ids[0]) } else { None })
}

/// `get_or_create_album_date(date, owner)`.
async fn album_date_get_or_create(
    conn: &mut Conn,
    date: Option<NaiveDate>,
    owner_id: i32,
) -> sqlx::Result<i32> {
    let found: Option<i32> = crate::sql::query_scalar(
        "SELECT id FROM api_albumdate WHERE date IS NOT DISTINCT FROM $1 AND owner_id = $2 \
         ORDER BY id LIMIT 1",
    )
    .bind(date)
    .bind(owner_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(id) = found {
        return Ok(id);
    }
    crate::sql::query_scalar(
        "INSERT INTO api_albumdate (title, date, favorited, location, owner_id) \
         VALUES ('', $1, FALSE, NULL, $2) RETURNING id",
    )
    .bind(date)
    .bind(owner_id)
    .fetch_one(&mut *conn)
    .await
}

/// The tail of `extract_date_time`: store the extracted `exif_timestamp` and
/// move the photo from its old day album to the new one.
pub async fn set_exif_timestamp(
    conn: &mut Conn,
    photo_id: Uuid,
    owner_id: i32,
    image_hash: &str,
    old: Option<DateTime<Utc>>,
    new: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    if let Some(old_album) = album_date_exact(conn, old.map(|d| d.date_naive()), owner_id).await? {
        let holds: bool = crate::sql::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM api_albumdate_photos ap JOIN api_photo p ON p.id = ap.photo_id \
             WHERE ap.albumdate_id = $1 AND p.image_hash = $2)",
        )
        .bind(old_album)
        .bind(image_hash)
        .fetch_one(&mut *conn)
        .await?;
        if holds {
            crate::sql::query(
                "DELETE FROM api_albumdate_photos WHERE albumdate_id = $1 AND photo_id = $2",
            )
            .bind(old_album)
            .bind(photo_id)
            .execute(&mut *conn)
            .await?;
        }
    }
    let album = album_date_get_or_create(conn, new.map(|d| d.date_naive()), owner_id).await?;
    crate::sql::query(
        "INSERT INTO api_albumdate_photos (albumdate_id, photo_id) SELECT $1, $2 \
         WHERE NOT EXISTS (SELECT 1 FROM api_albumdate_photos WHERE albumdate_id = $1 AND photo_id = $2)",
    )
    .bind(album)
    .bind(photo_id)
    .execute(&mut *conn)
    .await?;
    crate::sql::query(
        "UPDATE api_photo SET exif_timestamp = $2, last_modified = now() WHERE id = $1",
    )
    .bind(photo_id)
    .bind(new)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `find_album_places(photo)`: every place album holding the photo.
pub async fn album_places_of(conn: &mut Conn, photo_id: Uuid) -> sqlx::Result<Vec<i32>> {
    crate::sql::query_scalar(
        "SELECT DISTINCT albumplace_id FROM api_albumplace_photos WHERE photo_id = $1 ORDER BY 1",
    )
    .bind(photo_id)
    .fetch_all(&mut *conn)
    .await
}

pub async fn set_gps(conn: &mut Conn, photo_id: Uuid, lat: f64, lon: f64) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE api_photo SET exif_gps_lat = $2, exif_gps_lon = $3, last_modified = now() WHERE id = $1",
    )
    .bind(photo_id)
    .bind(lat)
    .bind(lon)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `PhotoSearch.update_search_location`.
pub fn search_location_of(geo: &Value) -> String {
    if let Some(addr) = geo.get("address") {
        return match addr {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        };
    }
    if let Some(Value::Array(features)) = geo.get("features") {
        return features
            .iter()
            .filter_map(|f| f.get("text"))
            .filter(|t| lp_core::extract::py_truthy(t))
            .map(|t| {
                t.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| t.to_string())
            })
            .collect::<Vec<_>>()
            .join(", ");
    }
    String::new()
}

fn py_isnumeric(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_numeric())
}

/// The rest of `_apply_gps_location` once the geocoder answered: store the
/// result, the search location, and rebuild the photo's place albums.
pub async fn apply_geocode(
    conn: &mut Conn,
    photo_id: Uuid,
    owner_id: i32,
    image_hash: &str,
    geo: &Value,
    old_places: &[i32],
) -> sqlx::Result<()> {
    let search_location = search_location_of(geo);
    crate::sql::query(
        "INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at) \
         VALUES ($1, NULL, $2, now(), now()) \
         ON CONFLICT (photo_id) DO UPDATE SET search_location = EXCLUDED.search_location, updated_at = now()",
    )
    .bind(photo_id)
    .bind(&search_location)
    .execute(&mut *conn)
    .await?;

    if !old_places.is_empty() {
        crate::sql::query(
            "DELETE FROM api_albumplace_photos WHERE photo_id = $1 AND albumplace_id = ANY($2)",
        )
        .bind(photo_id)
        .bind(old_places)
        .execute(&mut *conn)
        .await?;
        crate::sql::query("UPDATE api_albumplace SET last_modified = now() WHERE id = ANY($1)")
            .bind(old_places)
            .execute(&mut *conn)
            .await?;
    }

    if let Some(Value::Array(features)) = geo.get("features") {
        let n = features.len() as i32;
        for (level, feature) in features.iter().enumerate() {
            let Some(text) = feature.get("text") else {
                continue;
            };
            let title = match text {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            if py_isnumeric(&title) {
                continue;
            }
            let found: Option<i32> = crate::sql::query_scalar(
                "SELECT id FROM api_albumplace WHERE title = $1 AND owner_id = $2 ORDER BY id LIMIT 1",
            )
            .bind(&title)
            .bind(owner_id)
            .fetch_optional(&mut *conn)
            .await?;
            let place = match found {
                Some(id) => id,
                None => {
                    crate::sql::query_scalar(
                        "INSERT INTO api_albumplace (title, geolocation_level, favorited, owner_id, last_modified) \
                         VALUES ($1, NULL, FALSE, $2, now()) RETURNING id",
                    )
                    .bind(&title)
                    .bind(owner_id)
                    .fetch_one(&mut *conn)
                    .await?
                }
            };
            let holds: bool = crate::sql::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM api_albumplace_photos ap JOIN api_photo p ON p.id = ap.photo_id \
                 WHERE ap.albumplace_id = $1 AND p.image_hash = $2)",
            )
            .bind(place)
            .bind(image_hash)
            .fetch_one(&mut *conn)
            .await?;
            if !holds {
                crate::sql::query("UPDATE api_albumplace SET geolocation_level = $2 WHERE id = $1")
                    .bind(place)
                    .bind(n - level as i32)
                    .execute(&mut *conn)
                    .await?;
            }
            crate::sql::query(
                "INSERT INTO api_albumplace_photos (albumplace_id, photo_id) SELECT $1, $2 \
                 WHERE NOT EXISTS (SELECT 1 FROM api_albumplace_photos WHERE albumplace_id = $1 AND photo_id = $2)",
            )
            .bind(place)
            .bind(photo_id)
            .execute(&mut *conn)
            .await?;
            crate::sql::query("UPDATE api_albumplace SET last_modified = now() WHERE id = $1")
                .bind(place)
                .execute(&mut *conn)
                .await?;
        }
    }

    crate::sql::query(
        "UPDATE api_photo SET geolocation_json = $2, last_modified = now() WHERE id = $1",
    )
    .bind(photo_id)
    .bind(geo)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The current `local_orientation`, row-locked so concurrent rotations
/// compose instead of overwriting each other.
pub async fn lock_local_orientation(conn: &mut Conn, photo_id: Uuid) -> sqlx::Result<i32> {
    crate::sql::query_scalar("SELECT local_orientation FROM api_photo WHERE id = $1 FOR UPDATE")
        .bind(photo_id)
        .fetch_one(&mut *conn)
        .await
}

/// `_adopt_written_orientation`: the file now carries the whole rotation.
/// Both saves use `update_fields`, so no `last_modified`/`updated_at` bump.
pub async fn adopt_written_orientation(
    conn: &mut Conn,
    photo_id: Uuid,
    combined: i32,
) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE api_photo SET local_orientation = 1 WHERE id = $1 AND local_orientation <> 1",
    )
    .bind(photo_id)
    .execute(&mut *conn)
    .await?;
    crate::sql::query(
        "UPDATE api_photometadata SET orientation = $2 \
         WHERE photo_id = $1 AND orientation IS DISTINCT FROM $2",
    )
    .bind(photo_id)
    .bind(combined)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `Photo.rotate`'s DB part; returns the new `last_modified`.
pub async fn set_local_orientation(
    conn: &mut Conn,
    photo_id: Uuid,
    orientation: i32,
) -> sqlx::Result<DateTime<Utc>> {
    crate::sql::query_scalar(
        "UPDATE api_photo SET local_orientation = $2, last_modified = now() WHERE id = $1 \
         RETURNING last_modified",
    )
    .bind(photo_id)
    .bind(orientation)
    .fetch_one(&mut *conn)
    .await
}

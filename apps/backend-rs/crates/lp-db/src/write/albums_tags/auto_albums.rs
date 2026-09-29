//! `AlbumAuto` writes: delete, delete-all, and the event-album generator
//! (port of `api/autoalbum.py` `generate_event_albums` /
//! `regenerate_event_titles` and `AlbumAuto._generate_title`).

use std::collections::HashMap;

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
use sqlx::{FromRow, PgConnection, PgPool};
use uuid::Uuid;

async fn delete_ids(conn: &mut PgConnection, ids: &[i32]) -> sqlx::Result<()> {
    for sql in [
        "DELETE FROM api_albumauto_photos WHERE albumauto_id = ANY($1)",
        "DELETE FROM api_albumauto_shared_to WHERE albumauto_id = ANY($1)",
        "DELETE FROM api_albumauto WHERE id = ANY($1)",
    ] {
        sqlx::query(sql).bind(ids).execute(&mut *conn).await?;
    }
    Ok(())
}

pub async fn delete(db: &PgPool, album_id: i32) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    delete_ids(&mut tx, &[album_id]).await?;
    tx.commit().await
}

/// `AlbumAuto.objects.filter(owner=user).delete()`.
pub async fn delete_all(db: &PgPool, owner_id: i32) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    let ids: Vec<i32> = sqlx::query_scalar("SELECT id FROM api_albumauto WHERE owner_id = $1")
        .bind(owner_id)
        .fetch_all(&mut *tx)
        .await?;
    delete_ids(&mut tx, &ids).await?;
    tx.commit().await
}

/// A photo as the event grouping sees it.
#[derive(Debug, Clone, FromRow)]
pub struct EventPhoto {
    pub id: Uuid,
    pub exif_timestamp: DateTime<Utc>,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
}

#[derive(Debug, Clone, FromRow)]
struct CandidateAlbum {
    id: i32,
    favorited: bool,
    timestamp: DateTime<Utc>,
}

/// Consecutive photos (sorted by time) less than `gap` apart form one group.
fn group_by_gap<T>(items: Vec<T>, ts: impl Fn(&T) -> DateTime<Utc>, gap: Duration) -> Vec<Vec<T>> {
    let mut groups: Vec<Vec<T>> = Vec::new();
    for item in items {
        match groups.last_mut() {
            Some(g) if ts(&item) - ts(g.last().expect("groups are never empty")) < gap => {
                g.push(item)
            }
            _ => groups.push(vec![item]),
        }
    }
    groups
}

/// The owner's timestamped photos in events: runs less than 36 h apart.
pub async fn event_groups(db: &PgPool, owner_id: i32) -> sqlx::Result<Vec<Vec<EventPhoto>>> {
    let mut photos: Vec<EventPhoto> = sqlx::query_as(
        "SELECT id, exif_timestamp, exif_gps_lat, exif_gps_lon FROM api_photo          WHERE owner_id = $1 AND exif_timestamp IS NOT NULL",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await?;
    photos.sort_by_key(|p| p.exif_timestamp);
    Ok(group_by_gap(
        photos,
        |p| p.exif_timestamp,
        Duration::days(1) + Duration::hours(12),
    ))
}

/// One step of `generate_event_albums`: find or create the group's album
/// (merging duplicates), add the photos, re-anchor, locate and retitle it.
/// Groups of fewer than 2 photos are skipped, as in Django.
pub async fn apply_event_group(
    db: &PgPool,
    owner_id: i32,
    group: &[EventPhoto],
) -> sqlx::Result<()> {
    if group.len() < 2 {
        return Ok(());
    }
    let mut tx = db.begin().await?;
    process_group(&mut tx, owner_id, group).await?;
    tx.commit().await
}

/// `generate_event_albums` without progress reporting.
pub async fn generate_event_albums(db: &PgPool, owner_id: i32) -> sqlx::Result<usize> {
    let groups = event_groups(db, owner_id).await?;
    for group in &groups {
        apply_event_group(db, owner_id, group).await?;
    }
    Ok(groups.len())
}

async fn process_group(
    conn: &mut PgConnection,
    owner_id: i32,
    group: &[EventPhoto],
) -> sqlx::Result<()> {
    let first = group[0].exif_timestamp;
    let last = group[group.len() - 1].exif_timestamp;
    let key = first - Duration::hours(11) - Duration::minutes(59);
    let albums: Vec<CandidateAlbum> = sqlx::query_as(
        "SELECT a.id, a.favorited, a.timestamp FROM api_albumauto a WHERE a.owner_id = $1 \
           AND (EXISTS (SELECT 1 FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id \
                  WHERE l.albumauto_id = a.id AND p.exif_timestamp BETWEEN $2 AND $3) \
                OR a.timestamp = $4) \
           AND NOT EXISTS (SELECT 1 FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id \
                  WHERE l.albumauto_id = a.id AND p.exif_timestamp < $2) \
           AND NOT EXISTS (SELECT 1 FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id \
                  WHERE l.albumauto_id = a.id AND p.exif_timestamp > $3) \
         ORDER BY a.created_on, a.id",
    )
    .bind(owner_id)
    .bind(first)
    .bind(last)
    .bind(key)
    .fetch_all(&mut *conn)
    .await?;

    let mut changed = false;
    let (album_id, favorited, mut timestamp) = if let Some(album) = albums.first() {
        let mut favorited = album.favorited;
        for dup in &albums[1..] {
            sqlx::query(
                "INSERT INTO api_albumauto_photos (albumauto_id, photo_id) \
                 SELECT $1, photo_id FROM api_albumauto_photos WHERE albumauto_id = $2 \
                 ON CONFLICT DO NOTHING",
            )
            .bind(album.id)
            .bind(dup.id)
            .execute(&mut *conn)
            .await?;
            favorited = favorited || dup.favorited;
            sqlx::query(
                "INSERT INTO api_albumauto_shared_to (albumauto_id, user_id) \
                 SELECT $1, user_id FROM api_albumauto_shared_to WHERE albumauto_id = $2 \
                 ON CONFLICT DO NOTHING",
            )
            .bind(album.id)
            .bind(dup.id)
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "UPDATE api_albumauto SET favorited = $2, last_modified = now() WHERE id = $1",
            )
            .bind(album.id)
            .bind(favorited)
            .execute(&mut *conn)
            .await?;
            delete_ids(conn, &[dup.id]).await?;
            changed = true;
        }
        (album.id, favorited, album.timestamp)
    } else {
        let id: i32 = sqlx::query_scalar(
            "INSERT INTO api_albumauto (title, timestamp, created_on, gps_lat, gps_lon, favorited, \
               owner_id, last_modified) \
             VALUES ('Untitled Album', $1, now(), NULL, NULL, FALSE, $2, now()) RETURNING id",
        )
        .bind(key)
        .bind(owner_id)
        .fetch_one(&mut *conn)
        .await?;
        changed = true;
        (id, false, key)
    };

    let ids: Vec<Uuid> = group.iter().map(|p| p.id).collect();
    let added = sqlx::query(
        "INSERT INTO api_albumauto_photos (albumauto_id, photo_id) \
         SELECT $1, id FROM unnest($2::uuid[]) AS s(id) ON CONFLICT DO NOTHING",
    )
    .bind(album_id)
    .bind(&ids)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if added > 0 {
        changed = true;
    }
    if timestamp != key {
        timestamp = key;
        changed = true;
    }

    let mut gps: Option<(f64, f64)> = None;
    if changed {
        let locs: Vec<(f64, f64)> = group
            .iter()
            .filter_map(|p| match (p.exif_gps_lat, p.exif_gps_lon) {
                (Some(lat), Some(lon)) if lat != 0.0 && lon != 0.0 => Some((lat, lon)),
                _ => None,
            })
            .collect();
        if !locs.is_empty() {
            let n = locs.len() as f64;
            let (sum_lat, sum_lon) = locs
                .iter()
                .fold((0.0, 0.0), |(a, b), (lat, lon)| (a + lat, b + lon));
            gps = Some((sum_lat / n, sum_lon / n));
        }
    }
    let title = generate_title(conn, album_id, timestamp).await?;
    sqlx::query(
        "UPDATE api_albumauto SET title = $2, timestamp = $3, favorited = $4, \
           gps_lat = CASE WHEN $5 THEN $6 ELSE gps_lat END, \
           gps_lon = CASE WHEN $5 THEN $7 ELSE gps_lon END, last_modified = now() WHERE id = $1",
    )
    .bind(album_id)
    .bind(title)
    .bind(timestamp)
    .bind(favorited)
    .bind(gps.is_some())
    .bind(gps.map(|g| g.0))
    .bind(gps.map(|g| g.1))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Albums `regenerate_event_titles` walks.
pub async fn title_targets(db: &PgPool, owner_id: i32) -> sqlx::Result<Vec<(i32, DateTime<Utc>)>> {
    sqlx::query_as("SELECT id, timestamp FROM api_albumauto WHERE owner_id = $1 ORDER BY id")
        .bind(owner_id)
        .fetch_all(db)
        .await
}

/// `au._generate_title(); au.save()` for one album.
pub async fn retitle(db: &PgPool, album_id: i32, timestamp: DateTime<Utc>) -> sqlx::Result<()> {
    let mut conn = db.acquire().await?;
    let title = generate_title(&mut conn, album_id, timestamp).await?;
    sqlx::query("UPDATE api_albumauto SET title = $2, last_modified = now() WHERE id = $1")
        .bind(album_id)
        .bind(title)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

#[derive(Debug, Clone, FromRow)]
struct TitlePhoto {
    id: Uuid,
    exif_timestamp: Option<DateTime<Utc>>,
    geolocation_json: Option<serde_json::Value>,
}

/// What `_generate_title` reads about an album: every member and the names
/// of its non-deleted, labelled faces. Django iterates both unordered, and
/// ties in the place/people counts go to the first seen, so rows come in
/// heap order (`ctid`), which is what Postgres hands Django's unordered
/// queries.
async fn generate_title(
    conn: &mut PgConnection,
    album_id: i32,
    timestamp: DateTime<Utc>,
) -> sqlx::Result<String> {
    let photos: Vec<TitlePhoto> = sqlx::query_as(
        "SELECT p.id, p.exif_timestamp, p.geolocation_json FROM api_albumauto_photos l \
         JOIN api_photo p ON p.id = l.photo_id WHERE l.albumauto_id = $1 ORDER BY p.ctid",
    )
    .bind(album_id)
    .fetch_all(&mut *conn)
    .await?;
    let ids: Vec<Uuid> = photos.iter().map(|p| p.id).collect();
    let faces: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT f.photo_id, pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id \
         WHERE f.photo_id = ANY($1) AND NOT f.deleted ORDER BY f.ctid",
    )
    .bind(&ids)
    .fetch_all(&mut *conn)
    .await?;
    let mut people_of: HashMap<Uuid, Vec<String>> = HashMap::new();
    for (photo_id, name) in faces {
        people_of.entry(photo_id).or_default().push(name);
    }
    let details: Vec<TitleInput> = photos
        .into_iter()
        .map(|p| TitleInput {
            exif_timestamp: p.exif_timestamp,
            geolocation_json: p.geolocation_json,
            people: people_of.remove(&p.id).unwrap_or_default(),
        })
        .collect();
    Ok(event_title(&details, timestamp))
}

/// One member photo as `_collect_photo_details` sees it.
#[derive(Debug, Clone, Default)]
pub struct TitleInput {
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub geolocation_json: Option<serde_json::Value>,
    pub people: Vec<String>,
}

const UNKNOWN_PERSON_NAME: &str = "Unknown - Other";

fn weekday_name(dt: &DateTime<Utc>) -> &'static str {
    match dt.weekday().number_from_monday() {
        1 => "Monday",
        2 => "Tuesday",
        3 => "Wednesday",
        4 => "Thursday",
        5 => "Friday",
        6 => "Saturday",
        _ => "Sunday",
    }
}

fn time_of_day(hour: u32) -> &'static str {
    if hour == 0 {
        return "";
    }
    for (until, label) in [
        (5, "Early Morning"),
        (12, "Morning"),
        (18, "Afternoon"),
        (25, "Evening"),
    ] {
        if hour < until {
            return label;
        }
    }
    ""
}

/// `Counter(values).most_common(2)` keys: by count, ties in first-seen order.
fn most_common_two(values: &[String]) -> Vec<String> {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for v in values {
        match counts.iter_mut().find(|(k, _)| k == v) {
            Some((_, c)) => *c += 1,
            None => counts.push((v.clone(), 1)),
        }
    }
    counts.sort_by_key(|c| std::cmp::Reverse(c.1));
    counts.into_iter().take(2).map(|(k, _)| k).collect()
}

fn py_strip(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace())
}

fn fallback_title(timestamp: DateTime<Utc>) -> String {
    format!("Album from {}", timestamp.format("%Y-%m-%d"))
}

/// Port of `AlbumAuto._generate_title` (pure part). Any shape Django would
/// raise on (a missing timestamp, non-object geolocation) gives the fallback.
pub fn event_title(photos: &[TitleInput], timestamp: DateTime<Utc>) -> String {
    let mut places: Vec<String> = Vec::new();
    let mut people: Vec<String> = Vec::new();
    let mut timestamps: Vec<DateTime<Utc>> = Vec::new();
    for photo in photos {
        match &photo.geolocation_json {
            None | Some(serde_json::Value::Null) => {}
            Some(serde_json::Value::Object(obj)) => {
                if let Some(list) = obj.get("places") {
                    let Some(arr) = list.as_array() else {
                        return fallback_title(timestamp);
                    };
                    if !arr.is_empty() {
                        let mut strings = Vec::with_capacity(arr.len());
                        for v in arr {
                            match v.as_str() {
                                Some(s) => strings.push(s.to_string()),
                                None => return fallback_title(timestamp),
                            }
                        }
                        places = strings;
                    }
                }
            }
            // Empty containers are falsy in Python; anything else has no `.get`.
            Some(serde_json::Value::Array(a)) if a.is_empty() => {}
            Some(serde_json::Value::String(s)) if s.is_empty() => {}
            Some(_) => return fallback_title(timestamp),
        }
        match photo.exif_timestamp {
            Some(ts) => timestamps.push(ts),
            None => return fallback_title(timestamp),
        }
        people.extend(photo.people.iter().cloned());
    }

    let anchor = timestamps.iter().min().copied().unwrap_or(timestamp);
    let weekday = weekday_name(&anchor);
    let time = time_of_day(anchor.hour());
    let mut when = format!("{weekday} {time}");

    let loc = if places.is_empty() {
        String::new()
    } else {
        format!("in {}", most_common_two(&places).join(" and "))
    };
    let names: Vec<String> = most_common_two(&people)
        .into_iter()
        .filter(|k| {
            let l = k.to_lowercase();
            l != "unknown" && l != UNKNOWN_PERSON_NAME
        })
        .collect();
    let pep = if names.is_empty() {
        String::new()
    } else {
        format!("with {}", names.join(" and "))
    };

    if let (Some(first), Some(last)) = (timestamps.iter().min(), timestamps.iter().max()) {
        let days = (*last - *first).num_seconds().div_euclid(86_400);
        if days >= 3 {
            when = format!("{days} days");
        }
        let (fw, lw) = (
            first.weekday().num_days_from_monday(),
            last.weekday().num_days_from_monday(),
        );
        if lw >= 5 && fw >= 5 && lw != fw {
            when = "Weekend".to_string();
        }
    }

    let title = py_strip(&[when.as_str(), pep.as_str(), loc.as_str()].join(" ")).to_string();
    if title.is_empty() {
        fallback_title(timestamp)
    } else {
        title
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn photo(ts: DateTime<Utc>, places: &[&str], people: &[&str]) -> TitleInput {
        TitleInput {
            exif_timestamp: Some(ts),
            geolocation_json: Some(serde_json::json!({ "places": places })),
            people: people.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn titles() {
        let fri = Utc.with_ymd_and_hms(2022, 6, 10, 9, 15, 0).unwrap();
        let t = event_title(
            &[
                photo(fri, &["Pariser Platz", "Mitte", "Berlin"], &["Anna"]),
                photo(fri + Duration::hours(8), &[], &["Anna", "Unknown - Other"]),
            ],
            fri,
        );
        // Django compares the lower-cased name with "Unknown - Other", so it stays.
        assert_eq!(
            t,
            "Friday Morning with Anna and Unknown - Other in Pariser Platz and Mitte"
        );
        let sat = Utc.with_ymd_and_hms(2022, 6, 11, 0, 30, 0).unwrap();
        let t = event_title(
            &[
                photo(sat, &[], &[]),
                photo(sat + Duration::days(1), &[], &[]),
            ],
            sat,
        );
        assert_eq!(t, "Weekend");
        let t = event_title(
            &[
                photo(fri, &[], &[]),
                photo(fri + Duration::days(4), &[], &[]),
            ],
            fri,
        );
        assert_eq!(t, "4 days");
        // Midnight has no time of day: "Saturday " + "" joins with spaces.
        let t = event_title(&[photo(sat, &["X"], &[])], sat);
        assert_eq!(t, "Saturday   in X");
        let empty = event_title(&[], sat);
        assert_eq!(empty, "Saturday");
    }

    #[test]
    fn grouping() {
        let t0 = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap();
        let g = group_by_gap(
            vec![t0, t0 + Duration::hours(30), t0 + Duration::hours(70)],
            |t| *t,
            Duration::hours(36),
        );
        assert_eq!(g.iter().map(Vec::len).collect::<Vec<_>>(), vec![2, 1]);
    }
}

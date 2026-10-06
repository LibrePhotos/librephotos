//! SQL of the scan pipeline. Rows stay exactly what Django writes: every
//! NOT NULL column supplied, M2M adds skip existing links, `auto_now`
//! columns bumped where Django's `save()` would bump them.

use std::collections::HashSet;

use lp_db::db::{Conn, Db, DjUuid, Qb};

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Value, json};
use sqlx::FromRow;
use uuid::Uuid;

use crate::exifmap::{MetadataUpdate, PhotoUpdate};

#[derive(Debug, Clone, FromRow)]
pub struct FileRow {
    pub hash: String,
    pub path: String,
    #[sqlx(rename = "type")]
    pub kind: i32,
    pub missing: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct PhotoRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub image_hash: String,
    pub owner_id: i32,
    pub main_file_id: Option<String>,
    pub video: bool,
    pub local_orientation: i32,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub exif_gps_lat: Option<f64>,
    pub exif_gps_lon: Option<f64>,
    pub timestamp: Option<DateTime<Utc>>,
    pub category_source: String,
    pub perceptual_hash: Option<String>,
    pub removed: bool,
    pub is_screenshot: bool,
    pub is_document: bool,
}

pub const PHOTO_COLS: &str = "p.id, p.image_hash, p.owner_id, p.main_file_id, p.video, \
    p.local_orientation, p.exif_timestamp, p.exif_gps_lat, p.exif_gps_lon, p.timestamp, \
    p.category_source, p.perceptual_hash, p.removed, p.is_screenshot, p.is_document";

pub async fn photo_by_id(db: &mut Conn, id: Uuid) -> sqlx::Result<Option<PhotoRow>> {
    lp_db::sql::query_as::<_, PhotoRow>(&format!(
        "SELECT {PHOTO_COLS} FROM api_photo p WHERE p.id = $1"
    ))
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn file_by_hash(db: &mut Conn, hash: &str) -> sqlx::Result<Option<FileRow>> {
    lp_db::sql::query_as::<_, FileRow>(
        "SELECT hash, path, type, missing FROM api_file WHERE hash = $1",
    )
    .bind(hash)
    .fetch_optional(db)
    .await
}

pub async fn file_by_path(db: &mut Conn, path: &str) -> sqlx::Result<Option<FileRow>> {
    lp_db::sql::query_as::<_, FileRow>(
        "SELECT hash, path, type, missing FROM api_file WHERE path = $1",
    )
    .bind(path)
    .fetch_optional(db)
    .await
}

/// Paths among `paths` that some photo holds as a variant (`_known_paths`).
pub async fn known_paths(db: &Db, paths: &[String]) -> sqlx::Result<HashSet<String>> {
    let rows: Vec<(String,)> = lp_db::sql::query_as(
        "SELECT f.path FROM api_file f JOIN api_photo_files pf ON pf.file_id = f.hash \
         JOIN api_photo p ON p.id = pf.photo_id WHERE f.path = ANY($1)",
    )
    .bind(paths)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

pub async fn path_is_known(db: &Db, path: &str) -> sqlx::Result<bool> {
    lp_db::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_file f JOIN api_photo_files pf ON pf.file_id = f.hash \
         JOIN api_photo p ON p.id = pf.photo_id WHERE f.path = $1)",
    )
    .bind(path)
    .fetch_one(db)
    .await
}

/// `_last_finished_scan(user).finished_at`.
pub async fn last_scan_finished_at(db: &Db, user_id: i32) -> sqlx::Result<Option<DateTime<Utc>>> {
    lp_db::sql::query_scalar(
        "SELECT finished_at FROM api_longrunningjob WHERE finished AND job_type = 1 \
         AND started_by_id = $1 AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
}

pub async fn is_embedded_media(db: &mut Conn, hash: &str) -> sqlx::Result<bool> {
    lp_db::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_file_embedded_media WHERE to_file_id = $1)",
    )
    .bind(hash)
    .fetch_one(db)
    .await
}

/// `File.create`: the row for `path` (un-flagging a reappeared missing
/// file), else a new row; on a hash collision the existing row by hash.
pub async fn file_create(
    db: &mut Conn,
    path: &str,
    hash: &str,
    kind: i32,
) -> sqlx::Result<FileRow> {
    if let Some(existing) = file_by_path(db, path).await? {
        if existing.missing && std::path::Path::new(path).exists() {
            lp_db::sql::query("UPDATE api_file SET missing = FALSE WHERE hash = $1")
                .bind(&existing.hash)
                .execute(&mut *db)
                .await?;
            return Ok(FileRow {
                missing: false,
                ..existing
            });
        }
        return Ok(existing);
    }
    // Django's `file.save()` on a hash that is already a row is an UPDATE
    // (the pk has no default, so save() tries UPDATE before INSERT): the row
    // moves to the path seen last, and is no longer missing.
    let moved = lp_db::sql::query_as::<_, FileRow>(
        "UPDATE api_file SET path = $2, type = $3, missing = FALSE WHERE hash = $1 \
         AND NOT EXISTS (SELECT 1 FROM api_file WHERE path = $2) RETURNING hash, path, type, missing",
    )
    .bind(hash)
    .bind(path)
    .bind(kind)
    .fetch_optional(&mut *db)
    .await?;
    if let Some(f) = moved {
        return Ok(f);
    }
    let inserted = lp_db::sql::query_as::<_, FileRow>(
        "INSERT INTO api_file (hash, path, type, missing) VALUES ($1, $2, $3, FALSE) \
         ON CONFLICT DO NOTHING RETURNING hash, path, type, missing",
    )
    .bind(hash)
    .bind(path)
    .bind(kind)
    .fetch_optional(&mut *db)
    .await?;
    if let Some(f) = inserted {
        return Ok(f);
    }
    if let Some(f) = file_by_path(db, path).await? {
        return Ok(f);
    }
    file_by_hash(db, hash)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

/// The owner's photo holding any of `hashes` as variant or main file
/// (`.first()` = lowest id).
pub async fn find_photo_with_files(
    db: &mut Conn,
    user_id: i32,
    hashes: &[String],
) -> sqlx::Result<Option<PhotoRow>> {
    lp_db::sql::query_as::<_, PhotoRow>(&format!(
        "SELECT {PHOTO_COLS} FROM api_photo p WHERE p.owner_id = $1 AND ( \
           EXISTS (SELECT 1 FROM api_photo_files pf WHERE pf.photo_id = p.id AND pf.file_id = ANY($2)) \
           OR p.main_file_id = ANY($2)) ORDER BY p.id LIMIT 1"
    ))
    .bind(user_id)
    .bind(hashes)
    .fetch_optional(db)
    .await
}

/// `photo.files.add(file)` unless already linked; true when added.
pub async fn add_photo_file(db: &mut Conn, photo: Uuid, hash: &str) -> sqlx::Result<bool> {
    let r = lp_db::sql::query(
        "INSERT INTO api_photo_files (photo_id, file_id) SELECT $1, $2 \
         WHERE NOT EXISTS (SELECT 1 FROM api_photo_files WHERE photo_id = $1 AND file_id = $2)",
    )
    .bind(photo)
    .bind(hash)
    .execute(db)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn file_type(db: &mut Conn, hash: &str) -> sqlx::Result<Option<i32>> {
    lp_db::sql::query_scalar("SELECT type FROM api_file WHERE hash = $1")
        .bind(hash)
        .fetch_optional(db)
        .await
}

pub async fn set_main_file(db: &mut Conn, photo: Uuid, hash: &str) -> sqlx::Result<()> {
    lp_db::sql::query("UPDATE api_photo SET main_file_id = $2 WHERE id = $1")
        .bind(photo)
        .bind(hash)
        .execute(db)
        .await?;
    Ok(())
}

/// A new `Photo()` with Django's field defaults.
pub async fn insert_photo(
    db: &mut Conn,
    owner: i32,
    image_hash: &str,
    main_file: Option<&str>,
    video: bool,
) -> sqlx::Result<PhotoRow> {
    let id = Uuid::new_v4();
    lp_db::sql::query(
        "INSERT INTO api_photo (id, image_hash, added_on, geolocation_json, hidden, public, \
           owner_id, video, rating, in_trashcan, size, main_file_id, last_modified, removed, \
           local_orientation, is_screenshot, is_document, category_source) \
         VALUES ($1, $2, now(), '{}'::jsonb, FALSE, FALSE, $3, $4, 0, FALSE, 0, $5, now(), FALSE, \
           1, FALSE, FALSE, 'auto')",
    )
    .bind(id)
    .bind(image_hash)
    .bind(owner)
    .bind(video)
    .bind(main_file)
    .execute(&mut *db)
    .await?;
    Ok(PhotoRow {
        id,
        image_hash: image_hash.to_string(),
        owner_id: owner,
        main_file_id: main_file.map(str::to_string),
        video,
        local_orientation: 1,
        exif_timestamp: None,
        exif_gps_lat: None,
        exif_gps_lon: None,
        timestamp: None,
        category_source: "auto".into(),
        perceptual_hash: None,
        removed: false,
        is_screenshot: false,
        is_document: false,
    })
}

pub async fn touch_photo(db: &mut Conn, photo: Uuid) -> sqlx::Result<()> {
    lp_db::sql::query("UPDATE api_photo SET last_modified = now() WHERE id = $1")
        .bind(photo)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn link_embedded(db: &mut Conn, from: &str, to: &str) -> sqlx::Result<()> {
    lp_db::sql::query(
        "INSERT INTO api_file_embedded_media (from_file_id, to_file_id) VALUES ($1, $2) \
         ON CONFLICT DO NOTHING",
    )
    .bind(from)
    .bind(to)
    .execute(db)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, FromRow)]
pub struct ThumbRow {
    pub thumbnail_big: String,
    pub aspect_ratio: Option<f64>,
    pub dominant_color: Option<String>,
}

/// `Thumbnail.objects.get_or_create(photo=photo)`.
pub async fn ensure_thumbnail(db: &mut Conn, photo: Uuid) -> sqlx::Result<ThumbRow> {
    lp_db::sql::query(
        "INSERT INTO api_thumbnail (photo_id, thumbnail_big, square_thumbnail, square_thumbnail_small) \
         VALUES ($1, '', '', '') ON CONFLICT DO NOTHING",
    )
    .bind(photo)
    .execute(&mut *db)
    .await?;
    lp_db::sql::query_as::<_, ThumbRow>(
        "SELECT thumbnail_big, aspect_ratio, dominant_color FROM api_thumbnail WHERE photo_id = $1",
    )
    .bind(photo)
    .fetch_one(db)
    .await
}

pub struct ThumbWrite {
    pub big: String,
    pub square: String,
    pub small: String,
    pub aspect_ratio: Option<f64>,
    pub dominant_color: Option<String>,
}

pub async fn write_thumbnail(db: &mut Conn, photo: Uuid, t: &ThumbWrite) -> sqlx::Result<()> {
    lp_db::sql::query(
        "UPDATE api_thumbnail SET thumbnail_big = $2, square_thumbnail = $3, \
           square_thumbnail_small = $4, aspect_ratio = COALESCE($5, aspect_ratio), \
           dominant_color = COALESCE(dominant_color, $6) WHERE photo_id = $1",
    )
    .bind(photo)
    .bind(&t.big)
    .bind(&t.square)
    .bind(&t.small)
    .bind(t.aspect_ratio)
    .bind(&t.dominant_color)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn set_perceptual_hash(db: &mut Conn, photo: Uuid, phash: &str) -> sqlx::Result<()> {
    lp_db::sql::query("UPDATE api_photo SET perceptual_hash = $2 WHERE id = $1")
        .bind(photo)
        .bind(phash)
        .execute(db)
        .await?;
    Ok(())
}

/// The full `photo.save()` at the end of `extract_date_time`.
pub async fn save_photo_scan_fields(
    db: &mut Conn,
    photo: Uuid,
    u: &PhotoUpdate,
    is_screenshot: Option<bool>,
    exif_timestamp: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    lp_db::sql::query(
        "UPDATE api_photo SET size = COALESCE($2, size), video_length = COALESCE($3, video_length), \
           rating = COALESCE($4, rating), exif_timestamp_subsec = COALESCE($5, exif_timestamp_subsec), \
           image_sequence_number = COALESCE($6, image_sequence_number), \
           is_screenshot = COALESCE($7, is_screenshot), exif_timestamp = $8, last_modified = now() \
         WHERE id = $1",
    )
    .bind(photo)
    .bind(u.size)
    .bind(&u.video_length)
    .bind(u.rating.map(|r| r as i32))
    .bind(&u.exif_timestamp_subsec)
    .bind(u.image_sequence_number.map(|v| v as i32))
    .bind(is_screenshot)
    .bind(exif_timestamp)
    .execute(db)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, FromRow)]
pub struct MetaRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_make: Option<String>,
    pub lens_model: Option<String>,
    pub aperture: Option<f64>,
    pub iso: Option<i32>,
    pub focal_length: Option<f64>,
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub keywords: Option<Value>,
    pub source: String,
}

const META_COLS: &str = "id, camera_make, camera_model, lens_make, lens_model, aperture, iso, \
    focal_length, gps_latitude, gps_longitude, keywords, source";

/// `_user_edited(metadata, "caption")`.
async fn caption_user_edited(db: &mut Conn, photo: Uuid, source: &str) -> sqlx::Result<bool> {
    if source != "user_edit" {
        return Ok(false);
    }
    lp_db::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_metadataedit e WHERE e.photo_id = $1 AND e.field_name = 'caption' \
           AND (e.created_at > (SELECT max(r.created_at) FROM api_metadataedit r \
                                WHERE r.photo_id = $1 AND r.field_name = '_all') \
                OR NOT EXISTS (SELECT 1 FROM api_metadataedit r WHERE r.photo_id = $1 AND r.field_name = '_all')))",
    )
    .bind(photo)
    .fetch_one(db)
    .await
}

/// `PhotoMetadata.objects.get_or_create(photo)` + `_apply_to_metadata` + save.
pub async fn upsert_metadata(
    db: &mut Conn,
    photo: Uuid,
    m: &MetadataUpdate,
) -> sqlx::Result<MetaRow> {
    lp_db::sql::query(
        "INSERT INTO api_photometadata (id, photo_id, source, version, created_at, updated_at) \
         VALUES ($1, $2, 'embedded', 1, now(), now()) ON CONFLICT (photo_id) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(photo)
    .execute(&mut *db)
    .await?;
    let source: String =
        lp_db::sql::query_scalar("SELECT source FROM api_photometadata WHERE photo_id = $1")
            .bind(photo)
            .fetch_one(&mut *db)
            .await?;
    let caption = match &m.description {
        Some(d) if !caption_user_edited(db, photo, &source).await? => Some(d.clone()),
        _ => None,
    };
    lp_db::sql::query_as::<_, MetaRow>(&format!(
        "UPDATE api_photometadata SET aperture = COALESCE($2, aperture), \
           focal_length = COALESCE($3, focal_length), iso = COALESCE($4, iso), \
           width = COALESCE($5, width), height = COALESCE($6, height), \
           focal_length_35mm = COALESCE($7, focal_length_35mm), \
           camera_model = COALESCE($8, camera_model), lens_model = COALESCE($9, lens_model), \
           rating = COALESCE($10, rating), shutter_speed = COALESCE($11, shutter_speed), \
           date_taken_subsec = COALESCE($12, date_taken_subsec), keywords = COALESCE($13, keywords), \
           caption = COALESCE($14, caption), updated_at = now() \
         WHERE photo_id = $1 RETURNING {META_COLS}"
    ))
    .bind(photo)
    .bind(m.aperture)
    .bind(m.focal_length)
    .bind(m.iso.map(|v| v as i32))
    .bind(m.width.map(|v| v as i32))
    .bind(m.height.map(|v| v as i32))
    .bind(m.focal_length_35mm.map(|v| v as i32))
    .bind(&m.camera_model)
    .bind(&m.lens_model)
    .bind(m.rating.map(|v| v as i32))
    .bind(&m.shutter_speed)
    .bind(&m.date_taken_subsec)
    .bind(m.keywords.as_ref().map(|k| json!(k)))
    .bind(caption)
    .fetch_one(db)
    .await
}

/// `link_tags_from_keywords`: get-or-create each tag, link, recount.
pub async fn link_tags(
    db: &mut Conn,
    owner: i32,
    photo: Uuid,
    keywords: &Value,
) -> sqlx::Result<()> {
    let mut names: Vec<String> = keywords
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|k| k.trim().chars().take(512).collect::<String>())
                .filter(|k| !k.is_empty())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names.dedup();
    for name in names {
        lp_db::sql::query(
            "INSERT INTO api_tag (name, owner_id, photo_count, last_modified) VALUES ($1, $2, 0, now()) \
             ON CONFLICT ON CONSTRAINT \"unique Tag\" DO NOTHING",
        )
        .bind(&name)
        .bind(owner)
        .execute(&mut *db)
        .await?;
        let tag_id: i32 =
            lp_db::sql::query_scalar("SELECT id FROM api_tag WHERE name = $1 AND owner_id = $2")
                .bind(&name)
                .bind(owner)
                .fetch_one(&mut *db)
                .await?;
        lp_db::sql::query(
            "INSERT INTO api_tag_photos (tag_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(tag_id)
        .bind(photo)
        .execute(&mut *db)
        .await?;
        // `tag.photos.add(photo)`: recount, and the mobile-sync bump even
        // when the link already existed.
        lp_db::sql::query(
            "UPDATE api_tag SET photo_count = (SELECT count(*) FROM api_tag_photos tp \
               JOIN api_photo p ON p.id = tp.photo_id WHERE tp.tag_id = $1 AND NOT p.hidden \
               AND NOT p.in_trashcan AND NOT p.removed), last_modified = now() WHERE id = $1",
        )
        .bind(tag_id)
        .execute(&mut *db)
        .await?;
    }
    Ok(())
}

/// `_import_description_to_caption` (+ `apply_user_caption`'s hashtag albums).
pub async fn import_description(
    db: &mut Conn,
    owner: i32,
    photo: Uuid,
    image_hash: &str,
    description: &str,
) -> sqlx::Result<()> {
    lp_db::sql::query(
        "INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at) \
         VALUES ($1, NULL, now(), now()) ON CONFLICT DO NOTHING",
    )
    .bind(photo)
    .execute(&mut *db)
    .await?;
    let captions: Option<Value> =
        lp_db::sql::query_scalar("SELECT captions_json FROM api_photo_caption WHERE photo_id = $1")
            .bind(photo)
            .fetch_one(&mut *db)
            .await?;
    let mut captions = match captions {
        Some(Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    };
    let previously = captions.get("imported_description").cloned();
    if previously.as_ref().and_then(Value::as_str) == Some(description) {
        return Ok(());
    }
    let current = captions
        .get("user_caption")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    captions.insert("imported_description".into(), json!(description));
    let keep_current = !current.trim().is_empty()
        && Some(current.as_str()) != previously.as_ref().and_then(Value::as_str);
    if !keep_current {
        let caption = description.replace("<start>", "").replace("<end>", "");
        let caption = caption.trim().to_string();
        captions.insert("user_caption".into(), json!(caption));
        lp_db::sql::query("UPDATE api_photo_caption SET captions_json = $2, updated_at = now() WHERE photo_id = $1")
            .bind(photo)
            .bind(Value::Object(captions))
            .execute(&mut *db)
            .await?;
        sync_hashtags(db, owner, photo, image_hash, &caption).await?;
    } else {
        lp_db::sql::query("UPDATE api_photo_caption SET captions_json = $2 WHERE photo_id = $1")
            .bind(photo)
            .bind(Value::Object(captions))
            .execute(&mut *db)
            .await?;
    }
    Ok(())
}

/// `_sync_hashtag_album_things`: add the photo to a `hashtag_attribute`
/// AlbumThing per `#tag` (with the m2m signal's count/cover refresh).
async fn sync_hashtags(
    db: &mut Conn,
    owner: i32,
    photo: Uuid,
    image_hash: &str,
    caption: &str,
) -> sqlx::Result<()> {
    for tag in caption
        .split_whitespace()
        .filter(|w| w.starts_with('#') && w.chars().count() > 1)
    {
        lp_db::sql::query(
            "INSERT INTO api_albumthing (title, thing_type, favorited, owner_id, photo_count, last_modified) \
             VALUES ($1, 'hashtag_attribute', FALSE, $2, 0, now()) \
             ON CONFLICT ON CONSTRAINT \"unique AlbumThing\" DO NOTHING",
        )
        .bind(tag)
        .bind(owner)
        .execute(&mut *db)
        .await?;
        let thing: i32 = lp_db::sql::query_scalar(
            "SELECT id FROM api_albumthing WHERE title = $1 AND thing_type = 'hashtag_attribute' AND owner_id = $2",
        )
        .bind(tag)
        .bind(owner)
        .fetch_one(&mut *db)
        .await?;
        let has: bool = lp_db::sql::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM api_albumthing_photos tp JOIN api_photo p ON p.id = tp.photo_id \
             WHERE tp.albumthing_id = $1 AND p.image_hash = $2)",
        )
        .bind(thing)
        .bind(image_hash)
        .fetch_one(&mut *db)
        .await?;
        if has {
            continue;
        }
        lp_db::sql::query("INSERT INTO api_albumthing_photos (albumthing_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(thing)
            .bind(photo)
            .execute(&mut *db)
            .await?;
        lp_db::sql::query(
            "UPDATE api_albumthing SET photo_count = (SELECT count(*) FROM api_albumthing_photos tp \
               JOIN api_photo p ON p.id = tp.photo_id WHERE tp.albumthing_id = $1 AND NOT p.hidden), \
               last_modified = now() WHERE id = $1",
        )
        .bind(thing)
        .execute(&mut *db)
        .await?;
        lp_db::sql::query(
            "INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id) \
             SELECT $1, p.id FROM api_albumthing_photos tp JOIN api_photo p ON p.id = tp.photo_id \
             WHERE tp.albumthing_id = $1 AND NOT p.hidden AND p.id NOT IN \
               (SELECT photo_id FROM api_albumthing_cover_photos WHERE albumthing_id = $1 AND photo_id IS NOT NULL) \
             LIMIT GREATEST(0, 4 - (SELECT count(*) FROM api_albumthing_cover_photos WHERE albumthing_id = $1))",
        )
        .bind(thing)
        .execute(&mut *db)
        .await?;
    }
    Ok(())
}

/// Serialize get-or-create of a user's null-date album (NULLs never
/// conflict on the unique constraint).
async fn lock_null_album(db: &mut Conn, owner: i32) -> sqlx::Result<()> {
    if db.dialect().is_sqlite() {
        // SQLite: a no-op, the IMMEDIATE transaction already serializes writers.
        return Ok(());
    }
    lp_db::sql::query("SELECT pg_advisory_xact_lock(7340031, $1)")
        .bind(owner)
        .execute(db)
        .await?;
    Ok(())
}

async fn album_date_id(
    db: &mut Conn,
    owner: i32,
    date: Option<NaiveDate>,
) -> sqlx::Result<Option<i32>> {
    lp_db::sql::query_scalar(
        "SELECT id FROM api_albumdate WHERE owner_id = $1 AND date IS NOT DISTINCT FROM $2 ORDER BY id LIMIT 1",
    )
    .bind(owner)
    .bind(date)
    .fetch_optional(db)
    .await
}

/// `extract_date_time`'s album move: out of the day album the photo was in,
/// into the one of its (new) date.
pub async fn move_to_album_date(
    db: &mut Conn,
    owner: i32,
    photo: Uuid,
    image_hash: &str,
    old: Option<DateTime<Utc>>,
    new: Option<DateTime<Utc>>,
) -> sqlx::Result<()> {
    let old_date = old.map(|d| d.date_naive());
    if old_date.is_none() || new.is_none() {
        lock_null_album(db, owner).await?;
    }
    if let Some(old_album) = album_date_id(db, owner, old_date).await? {
        let holds: bool = lp_db::sql::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM api_albumdate_photos ap JOIN api_photo p ON p.id = ap.photo_id \
             WHERE ap.albumdate_id = $1 AND p.image_hash = $2)",
        )
        .bind(old_album)
        .bind(image_hash)
        .fetch_one(&mut *db)
        .await?;
        if holds {
            lp_db::sql::query(
                "DELETE FROM api_albumdate_photos WHERE albumdate_id = $1 AND photo_id = $2",
            )
            .bind(old_album)
            .bind(photo)
            .execute(&mut *db)
            .await?;
        }
    }
    let new_date = new.map(|d| d.date_naive());
    let album = match new_date {
        Some(d) => {
            lp_db::sql::query(
                "INSERT INTO api_albumdate (title, date, favorited, owner_id) VALUES ('', $1, FALSE, $2) \
                 ON CONFLICT (date, owner_id) DO NOTHING",
            )
            .bind(d)
            .bind(owner)
            .execute(&mut *db)
            .await?;
            album_date_id(db, owner, Some(d)).await?
        }
        None => match album_date_id(db, owner, None).await? {
            Some(id) => Some(id),
            None => Some(
                lp_db::sql::query_scalar(
                    "INSERT INTO api_albumdate (title, date, favorited, owner_id) VALUES ('', NULL, FALSE, $1) RETURNING id",
                )
                .bind(owner)
                .fetch_one(&mut *db)
                .await?,
            ),
        },
    };
    if let Some(album) = album {
        lp_db::sql::query(
            "INSERT INTO api_albumdate_photos (albumdate_id, photo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .bind(album)
        .bind(photo)
        .execute(db)
        .await?;
    }
    Ok(())
}

/// `PhotoSearch.recreate_search_captions` + save.
pub async fn recreate_search(db: &mut Conn, photo: Uuid, tagging_model: &str) -> sqlx::Result<()> {
    #[derive(FromRow)]
    struct Src {
        captions_json: Option<Value>,
        video: bool,
        is_screenshot: bool,
        is_document: bool,
        main_path: Option<String>,
    }
    let src = lp_db::sql::query_as::<_, Src>(
        "SELECT c.captions_json, p.video, p.is_screenshot, p.is_document, mf.path AS main_path \
         FROM api_photo p LEFT JOIN api_photo_caption c ON c.photo_id = p.id \
         LEFT JOIN api_file mf ON mf.hash = p.main_file_id WHERE p.id = $1",
    )
    .bind(photo)
    .fetch_one(&mut *db)
    .await?;
    let mut s = String::new();
    if let Some(Value::Object(c)) = &src.captions_json {
        if let Some(tags) = c
            .get(tagging_model)
            .and_then(|m| m.get("tags"))
            .and_then(Value::as_array)
            && !tags.is_empty()
        {
            let words: Vec<String> = tags.iter().map(crate::pyfmt::value_str).collect();
            s.push_str(&words.join(" "));
            s.push(' ');
        }
        for key in ["user_caption", "im2txt"] {
            if let Some(v) = c.get(key)
                && crate::pyfmt::truthy(v)
            {
                s.push_str(&crate::pyfmt::value_str(v));
                s.push(' ');
            }
        }
    }
    let names: Vec<String> = lp_db::sql::query_scalar(
        "SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id \
         WHERE f.photo_id = $1 ORDER BY f.id",
    )
    .bind(photo)
    .fetch_all(&mut *db)
    .await?;
    for n in names {
        s.push_str(&n);
        s.push(' ');
    }
    if let Some(p) = &src.main_path {
        s.push_str(p);
        s.push(' ');
    }
    let paths: Vec<String> = lp_db::sql::query_scalar(
        "SELECT f.path FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id \
         WHERE pf.photo_id = $1 ORDER BY pf.id",
    )
    .bind(photo)
    .fetch_all(&mut *db)
    .await?;
    for p in paths {
        s.push_str(&p);
        s.push(' ');
    }
    if src.video {
        s.push_str("type: video ");
    }
    if src.is_screenshot {
        s.push_str("type: screenshot ");
    }
    if src.is_document {
        s.push_str("type: document ");
    }
    let meta = lp_db::sql::query_as::<_, MetaRow>(&format!(
        "SELECT {META_COLS} FROM api_photometadata WHERE photo_id = $1"
    ))
    .bind(photo)
    .fetch_optional(&mut *db)
    .await?;
    if let Some(m) = meta {
        if let Some(c) = display(&m.camera_make, &m.camera_model) {
            s.push_str(&c);
            s.push(' ');
        }
        if let Some(l) = display(&m.lens_make, &m.lens_model) {
            s.push_str(&l);
            s.push(' ');
        }
        if let Some(Value::Array(k)) = &m.keywords
            && !k.is_empty()
        {
            let words: Vec<String> = k.iter().map(crate::pyfmt::value_str).collect();
            s.push_str(&words.join(" "));
            s.push(' ');
        }
    }
    let text = s.trim().to_string();
    lp_db::sql::query(
        "INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at) \
         VALUES ($1, $2, NULL, now(), now()) \
         ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, updated_at = now()",
    )
    .bind(photo)
    .bind(text)
    .execute(db)
    .await?;
    Ok(())
}

/// `camera_display` / `lens_display`.
fn display(make: &Option<String>, model: &Option<String>) -> Option<String> {
    let make = make.as_deref().filter(|s| !s.is_empty());
    let model = model.as_deref().filter(|s| !s.is_empty());
    match (make, model) {
        (Some(ma), Some(mo)) => Some(if mo.starts_with(ma) {
            mo.to_string()
        } else {
            format!("{ma} {mo}")
        }),
        (None, Some(mo)) => Some(mo.to_string()),
        (Some(ma), None) => Some(ma.to_string()),
        (None, None) => None,
    }
}

/// Screenshot rule 2 inputs: PNG without camera metadata or GPS.
pub fn has_camera_metadata(m: &MetaRow) -> bool {
    m.camera_model.as_deref().is_some_and(|s| !s.is_empty())
        || m.aperture.is_some_and(|v| v != 0.0)
        || m.iso.is_some_and(|v| v != 0)
        || m.focal_length.is_some_and(|v| v != 0.0)
}

// ---- LongRunningJob bookkeeping -------------------------------------------

/// `update_job_result`-style error record + the sticky `failed` flag.
pub async fn lrj_record_errors(
    db: &Db,
    job_id: &str,
    result: &Value,
    failed: bool,
) -> sqlx::Result<()> {
    lp_db::sql::query(
        "UPDATE api_longrunningjob SET result = $2, failed = failed OR $3 WHERE job_id = $1 AND NOT cancelled",
    )
    .bind(job_id)
    .bind(result)
    .bind(failed)
    .execute(db)
    .await?;
    Ok(())
}

/// `finish_job_if_complete` once all work is done: finished exactly once.
pub async fn lrj_finish(db: &Db, job_id: &str) -> sqlx::Result<bool> {
    let n = lp_db::sql::query(
        "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() \
         WHERE job_id = $1 AND NOT finished AND NOT cancelled",
    )
    .bind(job_id)
    .execute(db)
    .await?
    .rows_affected();
    Ok(n > 0)
}

/// `update_progress(current, target)`.
pub async fn lrj_progress(db: &Db, job_id: &str, current: i32, target: i32) -> sqlx::Result<()> {
    lp_db::sql::query("UPDATE api_longrunningjob SET progress_current = $2, progress_target = $3 WHERE job_id = $1")
        .bind(job_id)
        .bind(current)
        .bind(target)
        .execute(db)
        .await?;
    Ok(())
}

/// `LongRunningJob.complete()`.
pub async fn lrj_complete(db: &Db, job_id: &str) -> sqlx::Result<()> {
    lp_db::sql::query(
        "UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() WHERE job_id = $1",
    )
    .bind(job_id)
    .execute(db)
    .await?;
    Ok(())
}

/// `LongRunningJob.get_or_create_job`: start it, creating it if needed.
pub async fn lrj_get_or_create(
    db: &Db,
    job_id: &str,
    job_type: i32,
    user: i32,
) -> sqlx::Result<()> {
    lp_db::sql::query(
        "INSERT INTO api_longrunningjob (job_type, finished, failed, cancelled, job_id, queued_at, \
           started_at, started_by_id, progress_current, progress_target) \
         SELECT $2, FALSE, FALSE, FALSE, $1, now(), now(), $3, 0, 0 \
         WHERE NOT EXISTS (SELECT 1 FROM api_longrunningjob WHERE job_id = $1)",
    )
    .bind(job_id)
    .bind(job_type)
    .bind(user)
    .execute(db)
    .await?;
    lp_db::sql::query(
        "UPDATE api_longrunningjob SET started_at = COALESCE(started_at, now()) WHERE job_id = $1",
    )
    .bind(job_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn photo_count(db: &Db, owner: i32) -> sqlx::Result<i64> {
    lp_db::sql::query_scalar("SELECT count(*) FROM api_photo WHERE owner_id = $1")
        .bind(owner)
        .fetch_one(db)
        .await
}

pub fn qb<'a>(sql: &str) -> Qb<'a> {
    Qb::new(sql)
}

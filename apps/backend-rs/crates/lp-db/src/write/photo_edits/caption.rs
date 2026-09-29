//! `PhotoCaption.save_user_caption` / `generate_captions_im2txt` storage and
//! their side effects: S19 `PhotoSearch.search_captions` rebuild and the
//! `#hashtag` AlbumThings (S1).

use serde_json::{Map, Value};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use super::album_thing_changed;

/// `PhotoCaption.objects.get_or_create(photo=photo)`.
pub async fn ensure_caption_row(conn: &mut PgConnection, photo_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at) \
         VALUES ($1, NULL, now(), now()) ON CONFLICT (photo_id) DO NOTHING",
    )
    .bind(photo_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The caption as `apply_user_caption` stores it.
pub fn clean_caption(caption: &str) -> String {
    caption
        .replace("<start>", "")
        .replace("<end>", "")
        .trim()
        .to_string()
}

#[derive(Debug, thiserror::Error)]
pub enum CaptionError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("captions_json is not an object")]
    NotAnObject,
}

async fn set_caption_key(
    conn: &mut PgConnection,
    photo_id: Uuid,
    key: &str,
    caption: &str,
    tagging_model: &str,
) -> Result<(), CaptionError> {
    ensure_caption_row(conn, photo_id).await?;
    let current: Option<Value> = sqlx::query_scalar(
        "SELECT captions_json FROM api_photo_caption WHERE photo_id = $1 FOR UPDATE",
    )
    .bind(photo_id)
    .fetch_one(&mut *conn)
    .await?;
    let mut captions = match current {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(m)) => m,
        Some(_) => return Err(CaptionError::NotAnObject),
    };
    captions.insert(key.to_string(), Value::String(caption.to_string()));
    sqlx::query(
        "UPDATE api_photo_caption SET captions_json = $2, updated_at = now() WHERE photo_id = $1",
    )
    .bind(photo_id)
    .bind(Value::Object(captions))
    .execute(&mut *conn)
    .await?;
    rebuild_search_captions(conn, photo_id, tagging_model).await?;
    Ok(())
}

/// `apply_user_caption`: store `user_caption`, reindex, sync hashtag albums.
/// Returns the caption as stored.
pub async fn save_user_caption(
    conn: &mut PgConnection,
    photo_id: Uuid,
    caption: &str,
    tagging_model: &str,
) -> Result<String, CaptionError> {
    let caption = clean_caption(caption);
    set_caption_key(conn, photo_id, "user_caption", &caption, tagging_model).await?;
    sync_hashtag_album_things(conn, photo_id, &caption).await?;
    Ok(caption)
}

/// `_store_generated_caption`: every generated caption lives under `im2txt`.
pub async fn store_generated_caption(
    conn: &mut PgConnection,
    photo_id: Uuid,
    caption: &str,
    tagging_model: &str,
) -> Result<(), CaptionError> {
    set_caption_key(conn, photo_id, "im2txt", caption, tagging_model).await
}

#[derive(FromRow)]
struct SearchSource {
    video: bool,
    is_screenshot: bool,
    is_document: bool,
    captions_json: Option<Value>,
    face_names: Vec<String>,
    main_path: Option<String>,
    file_paths: Vec<String>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens_make: Option<String>,
    lens_model: Option<String>,
    keywords: Option<Value>,
    has_metadata: bool,
}

/// `PhotoMetadata.camera_display` / `lens_display`.
fn display(make: Option<&str>, model: Option<&str>) -> Option<String> {
    let make = make.filter(|s| !s.is_empty());
    let model = model.filter(|s| !s.is_empty());
    match (make, model) {
        (Some(make), Some(model)) => Some(if model.starts_with(make) {
            model.to_string()
        } else {
            format!("{make} {model}")
        }),
        (None, Some(m)) | (Some(m), None) => Some(m.to_string()),
        (None, None) => None,
    }
}

fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// `PhotoSearch.recreate_search_captions` for one photo, then save (S19).
pub async fn rebuild_search_captions(
    conn: &mut PgConnection,
    photo_id: Uuid,
    tagging_model: &str,
) -> sqlx::Result<()> {
    let src: SearchSource = sqlx::query_as(
        "SELECT p.video, p.is_screenshot, p.is_document, c.captions_json, \
            ARRAY(SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id \
                  WHERE f.photo_id = p.id ORDER BY f.id) AS face_names, \
            mf.path AS main_path, \
            ARRAY(SELECT fl.path FROM api_photo_files pf JOIN api_file fl ON fl.hash = pf.file_id \
                  WHERE pf.photo_id = p.id ORDER BY pf.id) AS file_paths, \
            md.camera_make, md.camera_model, md.lens_make, md.lens_model, md.keywords, \
            (md.photo_id IS NOT NULL) AS has_metadata \
         FROM api_photo p \
         LEFT JOIN api_photo_caption c ON c.photo_id = p.id \
         LEFT JOIN api_file mf ON mf.hash = p.main_file_id \
         LEFT JOIN api_photometadata md ON md.photo_id = p.id \
         WHERE p.id = $1",
    )
    .bind(photo_id)
    .fetch_one(&mut *conn)
    .await?;

    let mut s = String::new();
    if let Some(Value::Object(captions)) = &src.captions_json
        && !captions.is_empty()
    {
        if let Some(Value::Array(tags)) = captions
            .get(tagging_model)
            .and_then(|m| m.as_object())
            .and_then(|m| m.get("tags"))
            && !tags.is_empty()
        {
            s.push_str(&tags.iter().map(py_str).collect::<Vec<_>>().join(" "));
            s.push(' ');
        }
        for key in ["user_caption", "im2txt"] {
            if let Some(v) = captions.get(key)
                && lp_core::extract::py_truthy(v)
            {
                s.push_str(&py_str(v));
                s.push(' ');
            }
        }
    }
    for name in &src.face_names {
        s.push_str(name);
        s.push(' ');
    }
    if let Some(p) = &src.main_path {
        s.push_str(p);
        s.push(' ');
    }
    for p in &src.file_paths {
        s.push_str(p);
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
    if src.has_metadata {
        if let Some(c) = display(src.camera_make.as_deref(), src.camera_model.as_deref()) {
            s.push_str(&c);
            s.push(' ');
        }
        if let Some(l) = display(src.lens_make.as_deref(), src.lens_model.as_deref()) {
            s.push_str(&l);
            s.push(' ');
        }
        if let Some(Value::Array(k)) = &src.keywords
            && !k.is_empty()
        {
            s.push_str(&k.iter().map(py_str).collect::<Vec<_>>().join(" "));
            s.push(' ');
        }
    }
    let search_captions = s.trim().to_string();
    sqlx::query(
        "INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at) \
         VALUES ($1, $2, NULL, now(), now()) \
         ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, updated_at = now()",
    )
    .bind(photo_id)
    .bind(search_captions)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Words of `caption` that are hashtags (`#` plus at least one character).
pub fn hashtags(caption: &str) -> Vec<&str> {
    caption
        .split_whitespace()
        .filter(|w| w.starts_with('#') && w.chars().count() > 1)
        .collect()
}

/// `_sync_hashtag_album_things`.
async fn sync_hashtag_album_things(
    conn: &mut PgConnection,
    photo_id: Uuid,
    caption: &str,
) -> sqlx::Result<()> {
    let (owner_id, image_hash): (i32, String) =
        sqlx::query_as("SELECT owner_id, image_hash FROM api_photo WHERE id = $1")
            .bind(photo_id)
            .fetch_one(&mut *conn)
            .await?;
    for tag in hashtags(caption) {
        let existing: Option<i32> = sqlx::query_scalar(
            "SELECT id FROM api_albumthing WHERE title = $1 AND owner_id = $2 \
             AND thing_type = 'hashtag_attribute' ORDER BY id LIMIT 1",
        )
        .bind(tag)
        .bind(owner_id)
        .fetch_optional(&mut *conn)
        .await?;
        let album_id = match existing {
            Some(id) => id,
            None => {
                sqlx::query_scalar(
                    "INSERT INTO api_albumthing (title, thing_type, favorited, owner_id, photo_count, last_modified) \
                     VALUES ($1, 'hashtag_attribute', FALSE, $2, 0, now()) RETURNING id",
                )
                .bind(tag)
                .bind(owner_id)
                .fetch_one(&mut *conn)
                .await?
            }
        };
        let has_hash: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM api_albumthing_photos ap JOIN api_photo p ON p.id = ap.photo_id \
             WHERE ap.albumthing_id = $1 AND p.image_hash = $2)",
        )
        .bind(album_id)
        .bind(&image_hash)
        .fetch_one(&mut *conn)
        .await?;
        if !has_hash {
            sqlx::query(
                "INSERT INTO api_albumthing_photos (albumthing_id, photo_id) VALUES ($1, $2)",
            )
            .bind(album_id)
            .bind(photo_id)
            .execute(&mut *conn)
            .await?;
            album_thing_changed(conn, album_id).await?;
        }
    }

    let linked: Vec<(i32, String)> = sqlx::query_as(
        "SELECT DISTINCT a.id, a.title FROM api_albumthing a \
         JOIN api_albumthing_photos ap ON ap.albumthing_id = a.id \
         WHERE ap.photo_id = $1 AND a.thing_type = 'hashtag_attribute' AND a.owner_id = $2 ORDER BY a.id",
    )
    .bind(photo_id)
    .bind(owner_id)
    .fetch_all(&mut *conn)
    .await?;
    for (album_id, title) in linked {
        if !caption.contains(&title) {
            sqlx::query(
                "DELETE FROM api_albumthing_photos WHERE albumthing_id = $1 AND photo_id = $2",
            )
            .bind(album_id)
            .bind(photo_id)
            .execute(&mut *conn)
            .await?;
            album_thing_changed(conn, album_id).await?;
        }
    }
    Ok(())
}

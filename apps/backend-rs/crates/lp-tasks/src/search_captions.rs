//! `PhotoSearch.recreate_search_captions` (S19), batched: one read for any
//! number of photos, one upsert.
//!
//! Django rebuilds from the rows as stored, and its callers rebuild before
//! saving the caption they just changed, so a new tag or caption only shows
//! up in `search_captions` on the next rebuild. Here the caller commits its
//! change first (same transaction) and the rebuild sees it.

use serde_json::Value;
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct Source {
    id: Uuid,
    video: bool,
    is_screenshot: bool,
    is_document: bool,
    captions_json: Option<Value>,
    main_path: Option<String>,
    person_names: Option<Vec<String>>,
    file_paths: Option<Vec<String>>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens_make: Option<String>,
    lens_model: Option<String>,
    keywords: Option<Value>,
}

/// Recompute and store `api_photo_search.search_captions` for `photo_ids`,
/// creating missing rows (`get_or_create`).
pub async fn rebuild(
    conn: &mut PgConnection,
    photo_ids: &[Uuid],
    tagging_model: &str,
) -> sqlx::Result<()> {
    if photo_ids.is_empty() {
        return Ok(());
    }
    let rows = sqlx::query_as::<_, Source>(
        "SELECT p.id, p.video, p.is_screenshot, p.is_document, pc.captions_json, \
           mf.path AS main_path, \
           (SELECT array_agg(pe.name ORDER BY f.id) FROM api_face f \
              JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = p.id) AS person_names, \
           (SELECT array_agg(fl.path ORDER BY pf.id) FROM api_photo_files pf \
              JOIN api_file fl ON fl.hash = pf.file_id WHERE pf.photo_id = p.id) AS file_paths, \
           md.camera_make, md.camera_model, md.lens_make, md.lens_model, md.keywords \
         FROM api_photo p \
         LEFT JOIN api_photo_caption pc ON pc.photo_id = p.id \
         LEFT JOIN api_file mf ON mf.hash = p.main_file_id \
         LEFT JOIN api_photometadata md ON md.photo_id = p.id \
         WHERE p.id = ANY($1)",
    )
    .bind(photo_ids)
    .fetch_all(&mut *conn)
    .await?;

    let mut ids = Vec::with_capacity(rows.len());
    let mut captions = Vec::with_capacity(rows.len());
    for row in rows {
        captions.push(compose(&row, tagging_model));
        ids.push(row.id);
    }
    sqlx::query(
        "INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at) \
         SELECT u.id, u.captions, NULL, now(), now() FROM unnest($1::uuid[], $2::text[]) AS u(id, captions) \
         ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, \
           updated_at = now()",
    )
    .bind(&ids)
    .bind(&captions)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn truthy_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn compose(row: &Source, tagging_model: &str) -> String {
    let mut out = String::new();
    let mut push = |s: &str| {
        out.push_str(s);
        out.push(' ');
    };
    if let Some(Value::Object(cj)) = &row.captions_json
        && !cj.is_empty()
    {
        let tags: Vec<&str> = cj
            .get(tagging_model)
            .and_then(|m| m.get("tags"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        if !tags.is_empty() {
            push(&tags.join(" "));
        }
        if let Some(s) = truthy_str(cj.get("user_caption")) {
            push(s);
        }
        if let Some(s) = truthy_str(cj.get("im2txt")) {
            push(s);
        }
    }
    for name in row.person_names.iter().flatten() {
        push(name);
    }
    if let Some(p) = &row.main_path {
        push(p);
    }
    for p in row.file_paths.iter().flatten() {
        push(p);
    }
    if row.video {
        push("type: video");
    }
    if row.is_screenshot {
        push("type: screenshot");
    }
    if row.is_document {
        push("type: document");
    }
    if let Some(camera) = display(row.camera_make.as_deref(), row.camera_model.as_deref()) {
        push(&camera);
    }
    if let Some(lens) = display(row.lens_make.as_deref(), row.lens_model.as_deref()) {
        push(&lens);
    }
    if let Some(Value::Array(keywords)) = &row.keywords
        && !keywords.is_empty()
    {
        let words: Vec<&str> = keywords.iter().filter_map(Value::as_str).collect();
        push(&words.join(" "));
    }
    out.trim().to_string()
}

/// `PhotoMetadata.camera_display` / `lens_display`.
fn display(make: Option<&str>, model: Option<&str>) -> Option<String> {
    let make = make.filter(|s| !s.is_empty());
    let model = model.filter(|s| !s.is_empty());
    match (make, model) {
        (Some(make), Some(model)) if model.starts_with(make) => Some(model.to_string()),
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (None, Some(model)) => Some(model.to_string()),
        (Some(make), None) => Some(make.to_string()),
        (None, None) => None,
    }
}

//! Write services for the `people_faces` area. Conventions: see `lp_db::write`.
//!
//! Side effects (02 §5): S3 (person deleted: faces detached), S19 (face
//! labelling: `Person.face_count`, default `cover_photo`/`cover_face`,
//! `PhotoSearch.search_captions`). Faces are only soft-deleted by the API,
//! so S4 (crop file removal) never triggers here.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::db::{Conn, Db, DjListOpt, DjUuid, DjUuidOpt};

/// `instance.name = new_name; instance.save()` (`PersonSerializer.update`),
/// plus S19: the photos the person is labelled on are found by the new name.
/// Django leaves their search captions on the old name.
pub async fn rename_person(
    db: &Db,
    person_id: i32,
    name: &str,
    tagging_model: &str,
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    crate::sql::query("UPDATE api_person SET name = $2, last_modified = now() WHERE id = $1")
        .bind(person_id)
        .bind(name)
        .execute(&mut *tx)
        .await?;
    let photos: Vec<Uuid> = crate::sql::query_scalar(
        "SELECT DISTINCT photo_id FROM api_face WHERE person_id = $1 AND photo_id IS NOT NULL",
    )
    .bind(person_id)
    .fetch_all(&mut *tx)
    .await?;
    rebuild_search_captions(&mut tx, &photos, tagging_model).await?;
    tx.commit().await
}

/// `PersonSerializer.create`: the requester's person already called `name`
/// (of any kind), else a new user-labelled one. Returns its id.
pub async fn create_person(db: &Db, user_id: i32, name: &str) -> sqlx::Result<i32> {
    let mut tx = db.begin().await?;
    let existing: Option<i32> = crate::sql::query_scalar(
        "SELECT id FROM api_person WHERE name = $1 AND cluster_owner_id = $2 ORDER BY id LIMIT 1",
    )
    .bind(name)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let id = match existing {
        Some(id) => id,
        None => get_or_create_user_person(&mut tx, user_id, name).await?,
    };
    tx.commit().await?;
    Ok(id)
}

/// Cover photo + that photo's first face of the person as cover face.
pub async fn set_person_cover(db: &Db, person_id: i32, photo_id: Uuid) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE api_person SET cover_photo_id = $2, \
           cover_face_id = (SELECT id FROM api_face WHERE photo_id = $2 AND person_id = $1 \
             ORDER BY id LIMIT 1), \
           last_modified = now() \
         WHERE id = $1",
    )
    .bind(person_id)
    .bind(photo_id)
    .execute(db)
    .await?;
    Ok(())
}

/// `Person.delete()`: the collector's SET_NULLs (inferred faces, clusters)
/// plus the `reset_person` signal (S3: labelled faces detached) and the
/// mobile-sync tombstone of a `USER` person.
pub async fn delete_person(db: &Db, person_id: i32) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    super::deletion_log::persons_deleted(&mut tx, &[person_id]).await?;
    crate::sql::query(
        "UPDATE api_face SET \
           person_id = CASE WHEN person_id = $1 THEN NULL ELSE person_id END, \
           classification_person_id = CASE WHEN classification_person_id = $1 THEN NULL \
             ELSE classification_person_id END, \
           cluster_person_id = CASE WHEN cluster_person_id = $1 THEN NULL ELSE cluster_person_id END \
         WHERE person_id = $1 OR classification_person_id = $1 OR cluster_person_id = $1",
    )
    .bind(person_id)
    .execute(&mut *tx)
    .await?;
    crate::sql::query("UPDATE api_cluster SET person_id = NULL WHERE person_id = $1")
        .bind(person_id)
        .execute(&mut *tx)
        .await?;
    crate::sql::query("DELETE FROM api_person WHERE id = $1")
        .bind(person_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

/// `get_or_create_person(name, owner, KIND_USER)`; returns the id.
pub async fn get_or_create_user_person(
    conn: &mut Conn,
    user_id: i32,
    name: &str,
) -> sqlx::Result<i32> {
    let existing: Option<i32> = crate::sql::query_scalar(
        "SELECT id FROM api_person WHERE name = $1 AND cluster_owner_id = $2 AND kind = 'USER' \
         ORDER BY id LIMIT 1",
    )
    .bind(name)
    .bind(user_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(id) = existing {
        return Ok(id);
    }
    crate::sql::query_scalar(
        "INSERT INTO api_person (name, kind, cluster_owner_id, face_count, cover_face_id, \
           cover_photo_id, last_modified) \
         VALUES ($1, 'USER', $2, 0, NULL, NULL, now()) RETURNING id",
    )
    .bind(name)
    .bind(user_id)
    .fetch_one(&mut *conn)
    .await
}

/// `Person._calculate_face_count()` then `_set_default_cover_photo()` for
/// each person (S19). Deleted faces count, as in Django.
pub async fn recompute_persons(conn: &mut Conn, person_ids: &[i32]) -> sqlx::Result<()> {
    if person_ids.is_empty() {
        return Ok(());
    }
    crate::sql::query(
        "UPDATE api_person p SET face_count = ( \
             SELECT COUNT(*) FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id \
             WHERE f.person_id = p.id AND NOT ph.hidden AND NOT ph.in_trashcan \
               AND ph.owner_id = p.cluster_owner_id), \
           last_modified = now() \
         WHERE p.id = ANY($1)",
    )
    .bind(person_ids)
    .execute(&mut *conn)
    .await?;
    crate::sql::query(
        "UPDATE api_person p SET cover_photo_id = ff.photo_id, cover_face_id = ff.id, \
           last_modified = now() \
         FROM (SELECT DISTINCT ON (f.person_id) f.person_id, f.id, f.photo_id FROM api_face f \
               WHERE f.person_id = ANY($1) ORDER BY f.person_id, f.id) ff \
         WHERE p.id = ff.person_id AND p.cover_photo_id IS NULL",
    )
    .bind(person_ids)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

#[derive(FromRow)]
struct CaptionSource {
    #[sqlx(try_from = "DjUuid")]
    id: Uuid,
    video: bool,
    is_screenshot: bool,
    is_document: bool,
    captions_json: Option<Value>,
    main_path: Option<String>,
    #[sqlx(try_from = "DjListOpt<String>")]
    file_paths: Option<Vec<String>>,
    #[sqlx(try_from = "DjListOpt<String>")]
    person_names: Option<Vec<String>>,
    has_metadata: bool,
    camera_make: Option<String>,
    camera_model: Option<String>,
    lens_make: Option<String>,
    lens_model: Option<String>,
    keywords: Option<Value>,
}

/// `PhotoMetadata.camera_display` / `lens_display`.
fn make_model_display(make: Option<&str>, model: Option<&str>) -> Option<String> {
    let make = make.filter(|s| !s.is_empty());
    let model = model.filter(|s| !s.is_empty());
    match (make, model) {
        (Some(make), Some(model)) if model.starts_with(make) => Some(model.to_string()),
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (make, model) => model.or(make).map(str::to_string),
    }
}

fn json_str(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// `PhotoSearch.recreate_search_captions` (faces ordered by id, files by
/// link id: Django iterates both unordered).
fn search_captions(src: &CaptionSource, tagging_model: &str) -> String {
    let mut out = String::new();
    if let Some(captions) = src.captions_json.as_ref().filter(|c| is_truthy(c)) {
        if let Some(tags) = captions
            .get(tagging_model)
            .filter(|t| is_truthy(t))
            .and_then(|t| t.get("tags"))
            .and_then(Value::as_array)
            .filter(|t| !t.is_empty())
        {
            let tags: Vec<&str> = tags.iter().filter_map(Value::as_str).collect();
            out.push_str(&tags.join(" "));
            out.push(' ');
        }
        for key in ["user_caption", "im2txt"] {
            if let Some(s) = json_str(captions.get(key)) {
                out.push_str(s);
                out.push(' ');
            }
        }
    }
    for name in src.person_names.iter().flatten() {
        out.push_str(name);
        out.push(' ');
    }
    if let Some(p) = &src.main_path {
        out.push_str(p);
        out.push(' ');
    }
    for p in src.file_paths.iter().flatten() {
        out.push_str(p);
        out.push(' ');
    }
    if src.video {
        out.push_str("type: video ");
    }
    if src.is_screenshot {
        out.push_str("type: screenshot ");
    }
    if src.is_document {
        out.push_str("type: document ");
    }
    if src.has_metadata {
        if let Some(c) = make_model_display(src.camera_make.as_deref(), src.camera_model.as_deref())
        {
            out.push_str(&c);
            out.push(' ');
        }
        if let Some(l) = make_model_display(src.lens_make.as_deref(), src.lens_model.as_deref()) {
            out.push_str(&l);
            out.push(' ');
        }
        if let Some(Value::Array(k)) = &src.keywords
            && !k.is_empty()
        {
            let k: Vec<&str> = k.iter().filter_map(Value::as_str).collect();
            out.push_str(&k.join(" "));
            out.push(' ');
        }
    }
    out.trim().to_string()
}

fn is_truthy(v: &Value) -> bool {
    lp_core::extract::py_truthy(v)
}

/// Rebuild `api_photo_search.search_captions` of these photos in one read
/// and one upsert (S19; `SetFacePersonLabel._recreate_search_captions`).
pub async fn rebuild_search_captions(
    conn: &mut Conn,
    photo_ids: &[Uuid],
    tagging_model: &str,
) -> sqlx::Result<()> {
    if photo_ids.is_empty() {
        return Ok(());
    }
    let sources = crate::sql::query_as::<_, CaptionSource>(
        "SELECT ph.id, ph.video, ph.is_screenshot, ph.is_document, c.captions_json, \
           mf.path AS main_path, \
           (SELECT array_agg(fl.path ORDER BY pf.id) FROM api_photo_files pf \
              JOIN api_file fl ON fl.hash = pf.file_id WHERE pf.photo_id = ph.id) AS file_paths, \
           (SELECT array_agg(pe.name ORDER BY f.id) FROM api_face f \
              JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = ph.id) AS person_names, \
           (m.photo_id IS NOT NULL) AS has_metadata, m.camera_make, m.camera_model, \
           m.lens_make, m.lens_model, m.keywords \
         FROM api_photo ph \
         LEFT JOIN api_photo_caption c ON c.photo_id = ph.id \
         LEFT JOIN api_file mf ON mf.hash = ph.main_file_id \
         LEFT JOIN api_photometadata m ON m.photo_id = ph.id \
         WHERE ph.id = ANY($1)",
    )
    .bind(photo_ids)
    .fetch_all(&mut *conn)
    .await?;
    let ids: Vec<Uuid> = sources.iter().map(|s| s.id).collect();
    let captions: Vec<String> = sources
        .iter()
        .map(|s| search_captions(s, tagging_model))
        .collect();
    crate::sql::query(
        "INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, \
           updated_at) \
         SELECT u.id, u.captions, NULL, now(), now() FROM UNNEST($1::uuid[], $2::text[]) AS u(id, captions) \
         ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, \
           updated_at = now()",
    )
    .bind(&ids)
    .bind(&captions)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// A relabelled face as `FaceListSerializer` renders it.
#[derive(Debug, Clone, FromRow)]
pub struct LabeledFace {
    pub id: i32,
    pub image: Option<String>,
    #[sqlx(try_from = "DjUuidOpt")]
    pub photo_id: Option<Uuid>,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub cluster_probability: f64,
    pub old_person_id: Option<i32>,
}

/// `SetFacePersonLabel.post`: move the requester's faces among `face_ids` to
/// the person called `person_name` (created if needed), or back to unknown
/// (`None`, which also clears the inferred labels). Returns the person
/// `(id, name)` and the relabelled faces, ordered by id.
pub async fn label_faces(
    db: &Db,
    user_id: i32,
    face_ids: &[i32],
    person_name: Option<&str>,
    tagging_model: &str,
) -> sqlx::Result<(Option<(i32, String)>, Vec<LabeledFace>)> {
    let mut tx = db.begin().await?;
    let person = match person_name {
        Some(name) => Some((
            get_or_create_user_person(&mut tx, user_id, name).await?,
            name.to_string(),
        )),
        None => None,
    };
    let faces = if face_ids.is_empty() {
        Vec::new()
    } else {
        crate::sql::query_as::<_, LabeledFace>(
            "SELECT f.id, f.image, f.photo_id, ph.exif_timestamp, f.cluster_probability, \
               f.person_id AS old_person_id \
             FROM api_face f JOIN api_photo ph ON ph.id = f.photo_id \
             WHERE f.id = ANY($1) AND ph.owner_id = $2 ORDER BY f.id FOR UPDATE OF f",
        )
        .bind(face_ids)
        .bind(user_id)
        .fetch_all(&mut *tx)
        .await?
    };
    let ids: Vec<i32> = faces.iter().map(|f| f.id).collect();
    if !ids.is_empty() {
        let sql = if person.is_some() {
            "UPDATE api_face SET person_id = $2 WHERE id = ANY($1)"
        } else {
            "UPDATE api_face SET person_id = $2, cluster_person_id = NULL, \
               classification_person_id = NULL WHERE id = ANY($1)"
        };
        crate::sql::query(sql)
            .bind(&ids)
            .bind(person.as_ref().map(|p| p.0))
            .execute(&mut *tx)
            .await?;
    }
    let mut affected: Vec<i32> = faces.iter().filter_map(|f| f.old_person_id).collect();
    affected.extend(person.as_ref().map(|p| p.0));
    affected.sort_unstable();
    affected.dedup();
    recompute_persons(&mut tx, &affected).await?;
    let mut photos: Vec<Uuid> = faces.iter().filter_map(|f| f.photo_id).collect();
    photos.sort_unstable();
    photos.dedup();
    rebuild_search_captions(&mut tx, &photos, tagging_model).await?;
    tx.commit().await?;
    Ok((person, faces))
}

/// `DeleteFaces.post`: soft-delete the requester's faces among `face_ids`;
/// returns `(id, image)` of each, ordered by id.
pub async fn delete_faces(
    db: &Db,
    user_id: i32,
    face_ids: &[i32],
) -> sqlx::Result<Vec<(i32, Option<String>)>> {
    if face_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut rows: Vec<(i32, Option<String>)> = crate::sql::query_as(
        "UPDATE api_face f SET deleted = TRUE FROM api_photo ph \
         WHERE ph.id = f.photo_id AND ph.owner_id = $2 AND f.id = ANY($1) \
         RETURNING f.id, f.image",
    )
    .bind(face_ids)
    .bind(user_id)
    .fetch_all(db)
    .await?;
    rows.sort_by_key(|r| r.0);
    Ok(rows)
}

pub struct NewManualFace<'a> {
    pub photo_id: Uuid,
    /// Stored name, e.g. `faces/<hash>_manual_<hex8>.jpg`.
    pub image: &'a str,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub left: i32,
    /// `FaceEncoding` hex, or "" when the face service gave none.
    pub encoding: &'a str,
}

/// `AddFaceView.post` after validation: person get-or-create, the face row
/// (a user label: no cluster, no inferred person), then S19. Returns
/// `(face_id, person_id)`.
pub async fn add_manual_face(
    db: &Db,
    user_id: i32,
    person_name: &str,
    face: &NewManualFace<'_>,
    tagging_model: &str,
) -> sqlx::Result<(i32, i32)> {
    let mut tx = db.begin().await?;
    let person_id = get_or_create_user_person(&mut tx, user_id, person_name).await?;
    let face_id: i32 = crate::sql::query_scalar(
        "INSERT INTO api_face (image, cluster_probability, location_top, location_bottom, \
           location_left, location_right, encoding, person_id, cluster_id, \
           classification_probability, deleted, classification_person_id, cluster_person_id, \
           photo_id) \
         VALUES ($1, 0.0, $2, $3, $4, $5, $6, $7, NULL, 0.0, FALSE, NULL, NULL, $8) RETURNING id",
    )
    .bind(face.image)
    .bind(face.top)
    .bind(face.bottom)
    .bind(face.left)
    .bind(face.right)
    .bind(face.encoding)
    .bind(person_id)
    .bind(face.photo_id)
    .fetch_one(&mut *tx)
    .await?;
    recompute_persons(&mut tx, &[person_id]).await?;
    rebuild_search_captions(&mut tx, &[face.photo_id], tagging_model).await?;
    tx.commit().await?;
    Ok((face_id, person_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn src() -> CaptionSource {
        CaptionSource {
            id: Uuid::nil(),
            video: false,
            is_screenshot: false,
            is_document: false,
            captions_json: None,
            main_path: None,
            file_paths: None,
            person_names: None,
            has_metadata: false,
            camera_make: None,
            camera_model: None,
            lens_make: None,
            lens_model: None,
            keywords: None,
        }
    }

    #[test]
    fn captions_like_django() {
        let mut s = src();
        s.captions_json = Some(json!({
            "mobileclip_s2": {"tags": ["sky", "outdoor"]},
            "user_caption": "Summer",
            "im2txt": "a sunny afternoon"
        }));
        s.person_names = Some(vec!["Anna".into()]);
        s.main_path = Some("C:\\a\\b.jpg".into());
        s.file_paths = Some(vec!["C:\\a\\b.jpg".into()]);
        s.video = true;
        s.has_metadata = true;
        s.camera_make = Some("Canon".into());
        s.camera_model = Some("Canon EOS".into());
        s.lens_model = Some("50mm".into());
        s.keywords = Some(json!(["k1", "k2"]));
        assert_eq!(
            search_captions(&s, "mobileclip_s2"),
            "sky outdoor Summer a sunny afternoon Anna C:\\a\\b.jpg C:\\a\\b.jpg type: video \
             Canon EOS 50mm k1 k2"
        );
        assert_eq!(search_captions(&src(), "x"), "");
    }

    #[test]
    fn make_model() {
        assert_eq!(
            make_model_display(Some("Nikon"), Some("D750")).as_deref(),
            Some("Nikon D750")
        );
        assert_eq!(
            make_model_display(Some("Nikon"), None).as_deref(),
            Some("Nikon")
        );
        assert_eq!(make_model_display(Some(""), Some("")), None);
    }
}

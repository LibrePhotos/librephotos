//! Samples for `/searchtermexamples/` (`api.api_util.get_search_term_examples`).

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;
use sqlx::types::Json;

use crate::db::{Dialect, DjList, Exec};

/// One captioned photo of the user with what the examples are built from.
#[derive(Debug, Clone, FromRow)]
pub struct ExampleSample {
    pub geolocation_json: Option<Json<Value>>,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub captions_json: Option<Json<Value>>,
    /// One entry per face (deleted ones too, as Django's `p.faces.all()`),
    /// the person's name or NULL when the face has no person.
    #[sqlx(try_from = "DjList<Option<String>>")]
    pub face_names: Vec<Option<String>>,
}

/// Up to 100 random photos among (at most) 1000 of the user's photos whose
/// caption row holds a non-empty `captions_json`.
pub async fn samples<'e>(db: impl Exec<'e>, user_id: i32) -> sqlx::Result<Vec<ExampleSample>> {
    // The face names as a list (`array_agg` / `json_group_array`, both with
    // the NULLs of faces without a person) and Django's
    // `.exclude(captions_json={})` (jsonb / `JSON()` equality).
    let (names, not_empty) = match db.dialect() {
        Dialect::Pg => (
            "COALESCE((SELECT array_agg(pp.name ORDER BY f.id) FROM api_face f \
               LEFT JOIN api_person pp ON pp.id = f.person_id WHERE f.photo_id = p.id), \
               ARRAY[]::varchar[])",
            "c0.captions_json <> '{}'::jsonb",
        ),
        Dialect::Sqlite => (
            "(SELECT json_group_array(pp.name ORDER BY f.id) FROM api_face f \
               LEFT JOIN api_person pp ON pp.id = f.person_id WHERE f.photo_id = p.id)",
            "json(c0.captions_json) <> '{}'",
        ),
    };
    crate::sql::query_as(format!(
        "SELECT p.geolocation_json, p.exif_timestamp, c.captions_json, {names} AS face_names \
         FROM (SELECT p0.id FROM api_photo p0 JOIN api_photo_caption c0 ON c0.photo_id = p0.id \
               WHERE p0.owner_id = $1 AND c0.captions_json IS NOT NULL AND {not_empty} \
               LIMIT 1000) cand \
         JOIN api_photo p ON p.id = cand.id JOIN api_photo_caption c ON c.photo_id = p.id \
         ORDER BY random() LIMIT 100"
    ))
    .bind(user_id)
    .fetch_all(db)
    .await
}

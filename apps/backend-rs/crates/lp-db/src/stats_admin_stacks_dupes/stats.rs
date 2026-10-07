//! Dashboard reads (`api/stats.py`): counts, month histogram, word cloud,
//! social graph links, location sunburst and timeline inputs.

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::FromRow;

use crate::db::{Db, Qb};
use crate::scope;

use super::UNKNOWN_PERSON_NAME;

/// `get_count_stats`, in response field order.
#[derive(Debug, Clone, FromRow, Serialize, PartialEq, Eq)]
pub struct CountStats {
    pub num_photos: i64,
    pub num_screenshots: i64,
    pub num_documents: i64,
    pub num_missing_photos: i64,
    pub num_faces: i64,
    pub num_people: i64,
    pub num_unknown_faces: i64,
    pub num_labeled_faces: i64,
    pub num_inferred_faces: i64,
    pub num_albumauto: i64,
    pub num_albumdate: i64,
    pub num_albumuser: i64,
}

fn visible_owned(qb: &mut Qb<'_>, user_id: i32, extra: &str) {
    qb.push("(SELECT count(*) FROM api_photo p WHERE ");
    scope::owned_by(qb, "p", user_id);
    qb.push(" AND ");
    scope::visible_manager(qb, "p");
    qb.push(extra);
    qb.push(")");
}

fn non_empty_albums(qb: &mut Qb<'_>, kind: &str, user_id: i32) {
    qb.push(format!(
        "(SELECT count(*) FROM api_album{kind} a WHERE EXISTS (SELECT 1 FROM api_album{kind}_photos ap \
         WHERE ap.album{kind}_id = a.id AND ap.photo_id IS NOT NULL) AND a.owner_id = "
    ));
    qb.push_bind(user_id);
    qb.push(")");
}

/// One round trip: every counter is a scalar subquery.
pub async fn count_stats(db: &Db, user_id: i32) -> sqlx::Result<CountStats> {
    let mut qb = Qb::new("SELECT ");
    visible_owned(&mut qb, user_id, "");
    qb.push(" AS num_photos, ");
    visible_owned(&mut qb, user_id, " AND p.is_screenshot");
    qb.push(" AS num_screenshots, ");
    visible_owned(&mut qb, user_id, " AND p.is_document");
    qb.push(" AS num_documents, ");
    // Q(files=None) | Q(main_file=None) is a LEFT JOIN on the link table, so a
    // photo without a main file counts once per linked file, like Django.
    qb.push(
        "(SELECT count(*) FROM api_photo p LEFT JOIN api_photo_files pf ON pf.photo_id = p.id \
         WHERE (pf.file_id IS NULL OR p.main_file_id IS NULL) AND ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(") AS num_missing_photos, ");
    let faces = |qb: &mut Qb<'_>, join: &str, cond: &str| {
        qb.push(format!(
            "(SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id{join} WHERE {cond}"
        ));
        scope::owned_by(qb, "p", user_id);
        qb.push(")");
    };
    faces(&mut qb, "", "");
    qb.push(" AS num_faces, ");
    qb.push(
        "(SELECT count(DISTINCT f.person_id) FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
         WHERE f.person_id IS NOT NULL AND NOT p.hidden AND ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(") AS num_people, ");
    qb.push(
        "(SELECT count(*) FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
         JOIN api_person pe ON pe.id = f.person_id WHERE pe.name IN ('unknown', ",
    );
    qb.push_bind(UNKNOWN_PERSON_NAME);
    qb.push(") AND ");
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(") AS num_unknown_faces, ");
    faces(&mut qb, "", "f.person_id IS NOT NULL AND NOT p.hidden AND ");
    qb.push(" AS num_labeled_faces, ");
    faces(&mut qb, "", "f.person_id IS NULL AND NOT p.hidden AND ");
    qb.push(" AS num_inferred_faces, ");
    non_empty_albums(&mut qb, "auto", user_id);
    qb.push(" AS num_albumauto, ");
    non_empty_albums(&mut qb, "date", user_id);
    qb.push(" AS num_albumdate, ");
    non_empty_albums(&mut qb, "user", user_id);
    qb.push(" AS num_albumuser");
    qb.build_query_as().fetch_one(db).await
}

/// `TruncMonth(exif_timestamp)` (UTC) -> photo count, unordered.
pub async fn photo_month_counts(db: &Db, user_id: i32) -> sqlx::Result<Vec<(NaiveDateTime, i64)>> {
    let mut qb = Qb::new(
        "SELECT date_trunc('month', p.exif_timestamp AT TIME ZONE 'UTC') AS month, \
         count(p.image_hash) AS c FROM api_photo p WHERE p.exif_timestamp IS NOT NULL AND ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(" GROUP BY 1");
    qb.build_query_as().fetch_all(db).await
}

/// The active tagging model's entry of every captioned photo's
/// `captions_json` (NULL when absent), in table order.
pub async fn caption_tag_entries(
    db: &Db,
    user_id: i32,
    tagging_model: &str,
) -> sqlx::Result<Vec<Option<Value>>> {
    let mut qb = Qb::new("SELECT pc.captions_json -> ");
    qb.push_bind(tagging_model.to_string());
    qb.push(
        " FROM api_photo p JOIN api_photo_caption pc ON pc.photo_id = p.id \
         WHERE pc.captions_json IS NOT NULL AND ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    let rows: Vec<(Option<Value>,)> = qb.build_query_as().fetch_all(db).await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// `geolocation_json -> 'features'` of the user's geotagged photos, in table order.
pub async fn geo_features(db: &Db, user_id: i32) -> sqlx::Result<Vec<Value>> {
    let mut qb = Qb::new(
        "SELECT p.geolocation_json -> 'features' FROM api_photo p \
         WHERE jsonb_typeof(p.geolocation_json -> 'features') = 'array' AND ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    let rows: Vec<(Value,)> = qb.build_query_as().fetch_all(db).await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Face counts per person name, top 100 (`get_searchterms_wordcloud` people).
pub async fn people_face_counts(db: &Db, user_id: i32) -> sqlx::Result<Vec<(String, i64)>> {
    let mut qb = Qb::new(
        "SELECT pe.name, count(f.id) AS c FROM api_face f JOIN api_photo p ON p.id = f.photo_id \
         JOIN api_person pe ON pe.id = f.person_id WHERE ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(" GROUP BY pe.name ORDER BY c DESC LIMIT 100");
    qb.build_query_as().fetch_all(db).await
}

/// Person-name pairs that share a photo (`build_social_graph`), in the order
/// Postgres returns them for the same statement Django runs.
pub async fn social_links(db: &Db, user_id: i32) -> sqlx::Result<Vec<(String, String)>> {
    crate::sql::query_as(
        "WITH face AS (
                SELECT photo_id, person_id, name, owner_id
                FROM api_face
                JOIN api_person ON api_person.id = person_id
                JOIN api_photo ON api_photo.id = photo_id
                WHERE person_id IS NOT NULL
                    AND owner_id = $1
            )
            SELECT f1.name, f2.name
            FROM face f1
            JOIN face f2 USING (photo_id)
            WHERE f1.person_id != f2.person_id
            GROUP BY f1.name, f2.name",
    )
    .bind(user_id)
    .fetch_all(db)
    .await
}

/// `(features[-1].text, exif_timestamp)` of the user's timestamped photos,
/// oldest first (`get_location_timeline`).
pub async fn timeline_locations(
    db: &Db,
    user_id: i32,
) -> sqlx::Result<Vec<(Option<Value>, DateTime<Utc>)>> {
    let mut qb = Qb::new(
        "SELECT p.geolocation_json -> 'features' -> -1 -> 'text', p.exif_timestamp FROM api_photo p \
         WHERE p.exif_timestamp IS NOT NULL AND ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(" ORDER BY p.exif_timestamp");
    qb.build_query_as().fetch_all(db).await
}

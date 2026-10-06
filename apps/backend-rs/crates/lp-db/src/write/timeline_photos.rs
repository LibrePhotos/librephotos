//! Write services for the `timeline_photos` area. Conventions: see `lp_db::write`.
//!
//! `PhotoMetadataViewSet`: the `get_or_create` both GET and PATCH do, and
//! the PATCH itself (`PhotoMetadataUpdateSerializer.update`): one
//! `MetadataEdit` per changed field, `source = user_edit`, `version + 1`,
//! and for a keyword edit `sync_tags_from_keywords` with the tag
//! `photo_count` refresh of its `m2m_changed` receiver (S2).

use std::collections::BTreeSet;

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::timeline_photos::metadata::{METADATA_COLUMNS, MetadataPhoto, MetadataRow};

/// `PhotoMetadata.objects.get_or_create(photo=..., defaults=...)`.
pub async fn get_or_create_metadata(
    conn: &mut PgConnection,
    photo: &MetadataPhoto,
) -> sqlx::Result<MetadataRow> {
    let select = format!("SELECT {METADATA_COLUMNS} FROM api_photometadata WHERE photo_id = $1");
    if let Some(row) = sqlx::query_as::<_, MetadataRow>(&select)
        .bind(photo.id)
        .fetch_optional(&mut *conn)
        .await?
    {
        return Ok(row);
    }
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO api_photometadata (id, photo_id, date_taken, gps_latitude, gps_longitude, rating, \
         source, version, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, 'embedded', 1, $7, $7) ON CONFLICT (photo_id) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(photo.id)
    .bind(photo.exif_timestamp)
    .bind(photo.exif_gps_lat)
    .bind(photo.exif_gps_lon)
    .bind(photo.rating)
    .bind(now)
    .execute(&mut *conn)
    .await?;
    sqlx::query_as::<_, MetadataRow>(&select)
        .bind(photo.id)
        .fetch_one(&mut *conn)
        .await
}

/// A validated value of one editable `PhotoMetadata` column.
#[derive(Debug, Clone, PartialEq)]
pub enum MetaValue {
    Text(Option<String>),
    Int(Option<i32>),
    Float(Option<f64>),
    Json(Option<Value>),
    Time(Option<DateTime<Utc>>),
}

impl MetaValue {
    /// How `MetadataEdit.old_value/new_value` store it (SQL NULL for None).
    fn to_json(&self) -> Option<Value> {
        match self {
            MetaValue::Text(v) => v.clone().map(Value::from),
            MetaValue::Int(v) => v.map(Value::from),
            MetaValue::Float(v) => v.map(Value::from),
            MetaValue::Json(v) => v.clone(),
            MetaValue::Time(v) => v.map(|t| Value::from(lp_core::time::drf_datetime(&t))),
        }
    }

    /// Python `!=` between the stored and the new value (ints equal floats).
    fn differs(&self, other: &MetaValue) -> bool {
        match (self, other) {
            (MetaValue::Float(Some(a)), MetaValue::Int(Some(b)))
            | (MetaValue::Int(Some(b)), MetaValue::Float(Some(a))) => *a != f64::from(*b),
            _ => self != other,
        }
    }

    fn push_bind(&self, qb: &mut QueryBuilder<'_, Postgres>) {
        match self.clone() {
            MetaValue::Text(v) => qb.push_bind(v),
            MetaValue::Int(v) => qb.push_bind(v),
            MetaValue::Float(v) => qb.push_bind(v),
            MetaValue::Json(v) => qb.push_bind(v),
            MetaValue::Time(v) => qb.push_bind(v),
        };
    }
}

/// The current value of an editable column, typed like the patch value.
fn current(row: &MetadataRow, field: &str) -> Option<MetaValue> {
    Some(match field {
        "title" => MetaValue::Text(row.title.clone()),
        "caption" => MetaValue::Text(row.caption.clone()),
        "keywords" => MetaValue::Json(row.keywords.clone()),
        "rating" => MetaValue::Int(row.rating),
        "copyright" => MetaValue::Text(row.copyright.clone()),
        "creator" => MetaValue::Text(row.creator.clone()),
        "gps_latitude" => MetaValue::Float(row.gps_latitude),
        "gps_longitude" => MetaValue::Float(row.gps_longitude),
        "location_country" => MetaValue::Text(row.location_country.clone()),
        "location_state" => MetaValue::Text(row.location_state.clone()),
        "location_city" => MetaValue::Text(row.location_city.clone()),
        "location_address" => MetaValue::Text(row.location_address.clone()),
        "date_taken" => MetaValue::Time(row.date_taken),
        "timezone_offset" => MetaValue::Text(row.timezone_offset.clone()),
        _ => return None,
    })
}

/// `tag_names`: trimmed, non-empty, deduplicated, clipped to 512 chars.
pub fn tag_names(keywords: Option<&Value>) -> BTreeSet<String> {
    let items: Vec<String> = match keywords {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        Some(Value::String(s)) => s.chars().map(String::from).collect(),
        Some(Value::Object(o)) => o.keys().cloned().collect(),
        _ => Vec::new(),
    };
    items
        .iter()
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
        .map(|k| k.chars().take(512).collect())
        .collect()
}

/// `PATCH /photos/{id}/metadata`. `changes` are the validated fields in
/// serializer order. Returns nothing; the caller re-reads the metadata.
pub async fn patch_metadata(
    db: &PgPool,
    photo: &MetadataPhoto,
    user_id: i32,
    changes: &[(&'static str, MetaValue)],
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    let row = get_or_create_metadata(&mut tx, photo).await?;
    let base = Utc::now();
    let mut n_edits = 0i64;
    for (field, new) in changes {
        let Some(old) = current(&row, field) else {
            continue;
        };
        if !old.differs(new) {
            continue;
        }
        sqlx::query(
            "INSERT INTO api_metadataedit (id, field_name, old_value, new_value, synced_to_file, \
             synced_at, created_at, photo_id, user_id) VALUES ($1, $2, $3, $4, FALSE, NULL, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(*field)
        .bind(old.to_json())
        .bind(new.to_json())
        .bind(base + Duration::microseconds(n_edits))
        .bind(photo.id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        n_edits += 1;
    }

    let mut qb: QueryBuilder<'_, Postgres> = QueryBuilder::new("UPDATE api_photometadata SET ");
    for (field, new) in changes {
        if current(&row, field).is_none() {
            continue;
        }
        qb.push(format!("{field} = "));
        new.push_bind(&mut qb);
        qb.push(", ");
    }
    qb.push("source = 'user_edit', version = version + 1, updated_at = ");
    qb.push_bind(base + Duration::microseconds(n_edits));
    qb.push(" WHERE id = ");
    qb.push_bind(row.id);
    qb.build().execute(&mut *tx).await?;

    if let Some((_, MetaValue::Json(new_keywords))) = changes.iter().find(|(f, _)| *f == "keywords")
    {
        sync_tags_from_keywords(
            &mut tx,
            photo.id,
            photo.owner_id,
            new_keywords.as_ref(),
            row.keywords.as_ref(),
        )
        .await?;
    }
    tx.commit().await
}

/// `sync_tags_from_keywords`: detach tags of dropped keywords, then
/// `get_or_create` + attach a tag per keyword (sorted), refreshing the
/// `photo_count` of every tag touched.
async fn sync_tags_from_keywords(
    conn: &mut PgConnection,
    photo_id: Uuid,
    owner_id: i32,
    keywords: Option<&Value>,
    previous: Option<&Value>,
) -> sqlx::Result<()> {
    let new_names = tag_names(keywords);
    let dropped: Vec<String> = tag_names(previous)
        .difference(&new_names)
        .cloned()
        .collect();
    let mut touched: Vec<i32> = Vec::new();
    if !dropped.is_empty() {
        let removed: Vec<i32> = sqlx::query_scalar(
            "DELETE FROM api_tag_photos tp USING api_tag t \
             WHERE t.id = tp.tag_id AND tp.photo_id = $1 AND t.owner_id = $2 AND t.name = ANY($3) \
             RETURNING tp.tag_id",
        )
        .bind(photo_id)
        .bind(owner_id)
        .bind(&dropped)
        .fetch_all(&mut *conn)
        .await?;
        touched.extend(removed);
    }
    for name in &new_names {
        let existing: Option<i32> =
            sqlx::query_scalar("SELECT id FROM api_tag WHERE name = $1 AND owner_id = $2")
                .bind(name)
                .bind(owner_id)
                .fetch_optional(&mut *conn)
                .await?;
        let tag_id = match existing {
            Some(id) => id,
            None => {
                sqlx::query_scalar(
                    "INSERT INTO api_tag (name, owner_id, photo_count, last_modified) \
                     VALUES ($1, $2, 0, now()) RETURNING id",
                )
                .bind(name)
                .bind(owner_id)
                .fetch_one(&mut *conn)
                .await?
            }
        };
        sqlx::query(
            "INSERT INTO api_tag_photos (tag_id, photo_id) SELECT $1, $2 \
             WHERE NOT EXISTS (SELECT 1 FROM api_tag_photos WHERE tag_id = $1 AND photo_id = $2)",
        )
        .bind(tag_id)
        .bind(photo_id)
        .execute(&mut *conn)
        .await?;
        touched.push(tag_id);
    }
    // Each `tag.photos.remove(photo)` / `tag.photos.add(photo)` also bumps
    // the tag's `last_modified` (mobile-sync `m2m_changed`), linked before
    // or not.
    if !touched.is_empty() {
        sqlx::query(
            "UPDATE api_tag t SET photo_count = (SELECT count(*) FROM api_tag_photos tp \
               JOIN api_photo p ON p.id = tp.photo_id \
               WHERE tp.tag_id = t.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), \
               last_modified = now() \
             WHERE t.id = ANY($1)",
        )
        .bind(&touched)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_like_python() {
        let n = tag_names(Some(&json!([" a ", "b", "", 3, "a", "  "])));
        assert_eq!(n.into_iter().collect::<Vec<_>>(), vec!["a", "b"]);
        assert!(tag_names(None).is_empty());
        let long = "x".repeat(600);
        let n = tag_names(Some(&json!([long])));
        assert_eq!(n.iter().next().unwrap().chars().count(), 512);
    }

    #[test]
    fn int_float_equality() {
        assert!(!MetaValue::Float(Some(5.0)).differs(&MetaValue::Int(Some(5))));
        assert!(MetaValue::Int(Some(5)).differs(&MetaValue::Int(Some(4))));
        assert!(MetaValue::Text(None).differs(&MetaValue::Text(Some(String::new()))));
    }
}

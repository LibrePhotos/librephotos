//! `/locclust/` source rows and `/folders/subfolders/` photo counts.

use sqlx::{PgExecutor, Postgres, QueryBuilder, Row};
use uuid::Uuid;

use crate::scope::{folder_path_prefixes, like_escape};

/// `geolocation_json -> 'features'` of every photo of the owner that has
/// geolocation, in table order (the first occurrence of a place wins).
pub async fn geolocation_features<'e>(
    db: impl PgExecutor<'e>,
    owner_id: i32,
) -> sqlx::Result<Vec<Option<serde_json::Value>>> {
    sqlx::query_scalar(
        "SELECT CASE WHEN jsonb_typeof(geolocation_json) = 'object' \
                THEN geolocation_json -> 'features' END \
         FROM api_photo WHERE owner_id = $1 AND geolocation_json IS NOT NULL",
    )
    .bind(owner_id)
    .fetch_all(db)
    .await
}

/// Number of the owner's photos with a file inside each folder, one query.
pub async fn folder_photo_counts<'e>(
    db: impl PgExecutor<'e>,
    owner_id: i32,
    folders: &[String],
) -> sqlx::Result<Vec<i64>> {
    if folders.is_empty() {
        return Ok(Vec::new());
    }
    let mut qb = QueryBuilder::<Postgres>::new("SELECT ");
    for (i, folder) in folders.iter().enumerate() {
        if i > 0 {
            qb.push(", ");
        }
        qb.push("count(DISTINCT p.id) FILTER (WHERE ");
        for (j, prefix) in folder_path_prefixes(folder).into_iter().enumerate() {
            if j > 0 {
                qb.push(" OR ");
            }
            qb.push("f.path LIKE ");
            qb.push_bind(format!("{}%", like_escape(&prefix)));
        }
        qb.push(format!(") AS c{i}"));
    }
    qb.push(
        " FROM api_photo p JOIN api_photo_files pf ON pf.photo_id = p.id \
          JOIN api_file f ON f.hash = pf.file_id WHERE p.owner_id = ",
    );
    qb.push_bind(owner_id);
    let row = qb.build().fetch_one(db).await?;
    (0..folders.len())
        .map(|i| row.try_get::<i64, _>(i))
        .collect()
}

/// Photo ids of `owner_id` among `ids` (the `OwnedPhotoField` queryset).
pub async fn owned_photo_ids<'e>(
    db: impl PgExecutor<'e>,
    owner_id: i32,
    ids: &[Uuid],
) -> sqlx::Result<Vec<Uuid>> {
    sqlx::query_scalar("SELECT id FROM api_photo WHERE owner_id = $1 AND id = ANY($2)")
        .bind(owner_id)
        .bind(ids)
        .fetch_all(db)
        .await
}

//! Write services for the `upload` area (`chunked_upload_chunkedupload`).
//! Conventions: see `lp_db::write`.

use chrono::{DateTime, Utc};

use crate::db::Exec;
use crate::upload::{CHUNKED_COLUMNS, COMPLETE, ChunkedUpload, UPLOADING};

/// A new upload row after its first chunk (`ChunkedUpload.save()`).
pub async fn create_chunked_upload<'e>(
    db: impl Exec<'e>,
    upload_id: &str,
    file: &str,
    filename: &str,
    offset: i64,
    user_id: i32,
) -> sqlx::Result<ChunkedUpload> {
    crate::sql::query_as::<_, ChunkedUpload>(&format!(
        "INSERT INTO chunked_upload_chunkedupload (upload_id, file, filename, \"offset\", created_on, status, user_id) \
         VALUES ($1, $2, $3, $4, now(), $5, $6) RETURNING {CHUNKED_COLUMNS}"
    ))
    .bind(upload_id)
    .bind(file)
    .bind(filename)
    .bind(offset)
    .bind(UPLOADING)
    .bind(user_id)
    .fetch_one(db)
    .await
}

pub async fn set_offset<'e>(db: impl Exec<'e>, id: i32, offset: i64) -> sqlx::Result<()> {
    crate::sql::query("UPDATE chunked_upload_chunkedupload SET \"offset\" = $2 WHERE id = $1")
        .bind(id)
        .bind(offset)
        .execute(db)
        .await?;
    Ok(())
}

/// Mark complete; false if another request completed it first.
pub async fn mark_complete<'e>(
    db: impl Exec<'e>,
    id: i32,
    at: DateTime<Utc>,
) -> sqlx::Result<bool> {
    let n = crate::sql::query(
        "UPDATE chunked_upload_chunkedupload SET status = $2, completed_on = $3 WHERE id = $1 AND status <> $2",
    )
    .bind(id)
    .bind(COMPLETE)
    .bind(at)
    .execute(db)
    .await?
    .rows_affected();
    Ok(n > 0)
}

/// Completion failed: hand the id back so a retry can complete it.
pub async fn reset_uploading<'e>(db: impl Exec<'e>, upload_id: &str) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE chunked_upload_chunkedupload SET status = $2, completed_on = NULL WHERE upload_id = $1",
    )
    .bind(upload_id)
    .bind(UPLOADING)
    .execute(db)
    .await?;
    Ok(())
}

/// Delete the row (the caller removes the staged file after this).
pub async fn delete_chunked_upload<'e>(db: impl Exec<'e>, id: i32) -> sqlx::Result<()> {
    crate::sql::query("DELETE FROM chunked_upload_chunkedupload WHERE id = $1")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

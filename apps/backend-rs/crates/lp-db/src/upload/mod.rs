//! Read queries and row types for the `upload` area: the requester's own
//! photos by hash (`/api/exists`) and `chunked_upload_chunkedupload` rows.

use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::Exec;

/// `ChunkedUpload.UPLOADING` / `COMPLETE`.
pub const UPLOADING: i16 = 1;
pub const COMPLETE: i16 = 2;

#[derive(Debug, Clone, FromRow)]
pub struct ChunkedUpload {
    pub id: i32,
    pub upload_id: String,
    /// Storage name relative to MEDIA_ROOT (`chunked_uploads/...`).
    pub file: String,
    pub filename: String,
    pub offset: i64,
    pub created_on: DateTime<Utc>,
    pub status: i16,
    pub completed_on: Option<DateTime<Utc>>,
    pub user_id: Option<i32>,
}

pub const CHUNKED_COLUMNS: &str =
    "id, upload_id, file, filename, \"offset\", created_on, status, completed_on, user_id";

/// `Photo.objects.owned_by(user).filter(image_hash=h).exists()`.
pub async fn owns_image_hash<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    image_hash: &str,
) -> sqlx::Result<bool> {
    crate::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_photo WHERE owner_id = $1 AND image_hash = $2)",
    )
    .bind(user_id)
    .bind(image_hash)
    .fetch_one(db)
    .await
}

/// The user's upload by `upload_id` (uploads are scoped to their uploader).
pub async fn chunked_upload<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    upload_id: &str,
) -> sqlx::Result<Option<ChunkedUpload>> {
    crate::sql::query_as::<_, ChunkedUpload>(&format!(
        "SELECT {CHUNKED_COLUMNS} FROM chunked_upload_chunkedupload WHERE upload_id = $1 AND user_id = $2"
    ))
    .bind(upload_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

/// Every upload created before `cutoff` (`created_on__lt`), any user.
pub async fn created_before<'e>(
    db: impl Exec<'e>,
    cutoff: DateTime<Utc>,
) -> sqlx::Result<Vec<ChunkedUpload>> {
    crate::sql::query_as::<_, ChunkedUpload>(&format!(
        "SELECT {CHUNKED_COLUMNS} FROM chunked_upload_chunkedupload WHERE created_on < $1 ORDER BY id"
    ))
    .bind(cutoff)
    .fetch_all(db)
    .await
}

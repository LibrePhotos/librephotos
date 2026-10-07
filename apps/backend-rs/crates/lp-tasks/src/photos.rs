//! The photo columns the tasks need, loaded in batches.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use lp_db::db::{Db, DjUuid};

use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct TaskPhoto {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub image_hash: String,
    pub owner_id: i32,
    pub video: bool,
    pub main_path: Option<String>,
    /// `Thumbnail.thumbnail_big` (relative to MEDIA_ROOT); `None` without a
    /// thumbnail row, possibly `""` for an unrendered one.
    pub thumbnail_big: Option<String>,
}

impl TaskPhoto {
    /// `photo.thumbnail.thumbnail_big.path` when the photo has one.
    pub fn thumbnail_path(&self, media_root: &Path) -> Option<PathBuf> {
        self.thumbnail_big
            .as_deref()
            .filter(|t| !t.is_empty())
            .map(|t| media_path(media_root, t))
    }
}

const COLUMNS: &str = "p.id, p.image_hash, p.owner_id, p.video, f.path AS main_path, \
    t.thumbnail_big";

pub async fn load(db: &Db, ids: &[Uuid]) -> sqlx::Result<HashMap<Uuid, TaskPhoto>> {
    let rows = lp_db::sql::query_as::<_, TaskPhoto>(&format!(
        "SELECT {COLUMNS} FROM api_photo p \
         LEFT JOIN api_file f ON f.hash = p.main_file_id \
         LEFT JOIN api_thumbnail t ON t.photo_id = p.id \
         WHERE {}",
        lp_db::sql::any_sql(db.dialect(), "p.id", 1)
    ))
    .bind(ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|r| (r.id, r)).collect())
}

pub async fn load_one(db: &Db, id: Uuid) -> sqlx::Result<Option<TaskPhoto>> {
    Ok(load(db, &[id]).await?.remove(&id))
}

/// A Django `FileField` name (`thumbnails_big/x.webp`) as a path under
/// MEDIA_ROOT, with native separators (what `FieldFile.path` gives).
pub fn media_path(media_root: &Path, name: &str) -> PathBuf {
    let mut p = media_root.to_path_buf();
    for part in name.split(['/', '\\']).filter(|s| !s.is_empty()) {
        p.push(part);
    }
    p
}

pub fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

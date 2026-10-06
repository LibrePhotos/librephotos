//! Photo stack reads (`api/views/stacks.py`).

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::db::{Db, DjUuid, Exec, Qb};
use crate::scope;

/// `PhotoStack.VALID_STACK_TYPES`.
pub const VALID_TYPES: [&str; 3] = ["burst", "bracket", "manual"];
/// Valid plus the deprecated `raw_jpeg` / `live_photo`, in `StackType` order.
pub const ALL_TYPES: [&str; 5] = ["burst", "bracket", "manual", "raw_jpeg", "live_photo"];

/// `get_stack_type_display()`.
pub fn type_display(t: &str) -> String {
    match t {
        "burst" => "Burst Sequence",
        "bracket" => "Exposure Bracket",
        "manual" => "Manual Stack",
        "raw_jpeg" => "RAW + JPEG Pair (Deprecated)",
        "live_photo" => "Live Photo (Deprecated)",
        other => other,
    }
    .to_string()
}

#[derive(Debug, Clone, FromRow)]
pub struct StackRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub stack_type: String,
    pub sequence_start: Option<DateTime<Utc>>,
    pub sequence_end: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub photo_count: i64,
    pub primary_hash: Option<String>,
    pub primary_thumb_small: Option<String>,
}

/// A photo of a stack or duplicate group (preview or detail).
#[derive(Debug, Clone, FromRow)]
pub struct MemberPhoto {
    #[sqlx(try_from = "DjUuid")]
    pub group_id: Uuid,
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub image_hash: String,
    pub size: i64,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub thumb_small: Option<String>,
    pub thumb_big: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub camera: Option<String>,
    pub main_file_hash: Option<String>,
    pub main_file_path: Option<String>,
    pub main_file_type: Option<i32>,
}

#[derive(Debug, Clone, FromRow)]
pub struct PhotoFileRow {
    #[sqlx(try_from = "DjUuid")]
    pub photo_id: Uuid,
    pub hash: String,
    pub path: String,
    pub file_type: i32,
}

const STACK_SELECT: &str = "SELECT s.id, s.stack_type, s.sequence_start, s.sequence_end, \
      s.created_at, s.updated_at, s.photo_count, pp.image_hash AS primary_hash, \
      pth.square_thumbnail_small AS primary_thumb_small \
    FROM stacks s LEFT JOIN api_photo pp ON pp.id = s.primary_photo_id \
    LEFT JOIN api_thumbnail pth ON pth.photo_id = pp.id";

const STACKS_CTE: &str = "WITH stacks AS (SELECT ps.*, \
      (SELECT count(*) FROM api_photo_stacks x WHERE x.photostack_id = ps.id) AS photo_count \
    FROM api_photostack ps WHERE ps.owner_id = $1 AND ps.stack_type = ANY($2))";

/// Stacks of `types` with at least two photos.
pub async fn count_listed(db: &Db, owner: i32, types: &[&str]) -> sqlx::Result<i64> {
    crate::sql::query_scalar(format!(
        "{STACKS_CTE} SELECT count(*) FROM stacks WHERE photo_count >= 2"
    ))
    .bind(owner)
    .bind(types)
    .fetch_one(db)
    .await
}

/// One page of [`count_listed`], newest first.
pub async fn list_page(
    db: &Db,
    owner: i32,
    types: &[&str],
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<StackRow>> {
    crate::sql::query_as(format!(
        "{STACKS_CTE} {STACK_SELECT} WHERE s.photo_count >= 2 \
         ORDER BY s.created_at DESC, s.id LIMIT $3 OFFSET $4"
    ))
    .bind(owner)
    .bind(types)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await
}

pub async fn get(db: &Db, owner: i32, id: Uuid, types: &[&str]) -> sqlx::Result<Option<StackRow>> {
    crate::sql::query_as(format!("{STACKS_CTE} {STACK_SELECT} WHERE s.id = $3"))
        .bind(owner)
        .bind(types)
        .bind(id)
        .fetch_optional(db)
        .await
}

/// Whether `owner` has a stack `id` (of any type).
pub async fn exists(db: &Db, owner: i32, id: Uuid) -> sqlx::Result<bool> {
    crate::sql::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_photostack WHERE id = $1 AND owner_id = $2)",
    )
    .bind(id)
    .bind(owner)
    .fetch_one(db)
    .await
}

const MEMBER_COLUMNS: &str = "p.id, p.image_hash, p.size, p.exif_timestamp, \
    th.square_thumbnail_small AS thumb_small, th.thumbnail_big AS thumb_big, \
    m.width, m.height, m.camera_model AS camera, \
    mf.hash AS main_file_hash, mf.path AS main_file_path, mf.type AS main_file_type";

const MEMBER_JOINS: &str = "LEFT JOIN api_thumbnail th ON th.photo_id = p.id \
    LEFT JOIN api_photometadata m ON m.photo_id = p.id \
    LEFT JOIN api_file mf ON mf.hash = p.main_file_id";

/// Members of groups through a link table (`api_photo_stacks` /
/// `api_photo_duplicates`), in link order; at most `per_group` per group.
pub async fn members<'e>(
    db: impl Exec<'e>,
    link_table: &str,
    group_col: &str,
    group_ids: &[Uuid],
    per_group: Option<i64>,
) -> sqlx::Result<Vec<MemberPhoto>> {
    if group_ids.is_empty() {
        return Ok(Vec::new());
    }
    crate::sql::query_as(format!(
        "SELECT x.group_id, {MEMBER_COLUMNS} FROM ( \
           SELECT l.{group_col} AS group_id, l.photo_id, \
             row_number() OVER (PARTITION BY l.{group_col} ORDER BY l.id) AS rn \
           FROM {link_table} l WHERE l.{group_col} = ANY($1)) x \
         JOIN api_photo p ON p.id = x.photo_id {MEMBER_JOINS} \
         WHERE $2::bigint IS NULL OR x.rn <= $2 ORDER BY x.group_id, x.rn"
    ))
    .bind(group_ids)
    .bind(per_group)
    .fetch_all(db)
    .await
}

pub async fn stack_members(
    db: &Db,
    stack_ids: &[Uuid],
    per_group: Option<i64>,
) -> sqlx::Result<Vec<MemberPhoto>> {
    members(
        db,
        "api_photo_stacks",
        "photostack_id",
        stack_ids,
        per_group,
    )
    .await
}

/// Every file of `photo_ids`, in link order.
pub async fn photo_files(db: &Db, photo_ids: &[Uuid]) -> sqlx::Result<Vec<PhotoFileRow>> {
    crate::sql::query_as(
        "SELECT pf.photo_id, f.hash, f.path, f.type AS file_type FROM api_photo_files pf \
         JOIN api_file f ON f.hash = pf.file_id WHERE pf.photo_id = ANY($1) ORDER BY pf.id",
    )
    .bind(photo_ids)
    .fetch_all(db)
    .await
}

#[derive(Debug, Clone, FromRow)]
pub struct StackStats {
    pub total_stacks: i64,
    pub by_type: sqlx::types::Json<Vec<(String, i64)>>,
    pub photos_in_stacks: i64,
    pub total_photos: i64,
}

pub async fn stats(db: &Db, owner: i32) -> sqlx::Result<StackStats> {
    let types: Vec<String> = ALL_TYPES.iter().map(|t| t.to_string()).collect();
    let mut qb = Qb::new("SELECT (SELECT count(*) FROM api_photostack WHERE owner_id = ");
    qb.push_bind(owner);
    qb.push(" AND stack_type = ANY(");
    qb.push_bind(types.clone());
    qb.push(
        ")) AS total_stacks, (SELECT COALESCE(jsonb_agg(jsonb_build_array(stack_type, n)), '[]'::jsonb)          FROM (SELECT stack_type, count(*) AS n FROM api_photostack WHERE owner_id = ",
    );
    qb.push_bind(owner);
    qb.push(" AND stack_type = ANY(");
    qb.push_bind(types.clone());
    qb.push(
        ") GROUP BY stack_type) t) AS by_type, (SELECT count(DISTINCT p.id) FROM api_photo p          JOIN api_photo_stacks x ON x.photo_id = p.id JOIN api_photostack s ON s.id = x.photostack_id          WHERE s.stack_type = ANY(",
    );
    qb.push_bind(types);
    qb.push(") AND ");
    scope::owned_by(&mut qb, "p", owner);
    qb.push(") AS photos_in_stacks, ");
    push_total_photos(&mut qb, owner);
    qb.push(" AS total_photos");
    qb.build_query_as().fetch_one(db).await
}

/// `(owned, not hidden, not in the trash)` photo count as a scalar subquery.
pub fn push_total_photos(qb: &mut Qb<'_>, owner: i32) {
    qb.push("(SELECT count(*) FROM api_photo p WHERE NOT p.hidden AND NOT p.in_trashcan AND ");
    scope::owned_by(qb, "p", owner);
    qb.push(")");
}

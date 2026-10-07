//! Duplicate group reads (`api/views/duplicates.py`, `api/models/duplicate.py`).

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use super::stacks::{MemberPhoto, members, push_total_photos};
use crate::db::{Conn, Db, DjUuid, Qb};
use crate::scope;

pub const EXACT_COPY: &str = "exact_copy";
pub const VISUAL_DUPLICATE: &str = "visual_duplicate";
/// `Duplicate.DuplicateType.values`.
pub const TYPES: [&str; 2] = [EXACT_COPY, VISUAL_DUPLICATE];

pub fn type_display(t: &str) -> String {
    match t {
        EXACT_COPY => "Exact Copies",
        VISUAL_DUPLICATE => "Visual Duplicates",
        other => other,
    }
    .to_string()
}

pub fn status_display(s: &str) -> String {
    match s {
        "pending" => "Pending Review",
        "resolved" => "Resolved",
        "dismissed" => "Dismissed",
        other => other,
    }
    .to_string()
}

#[derive(Debug, Clone, FromRow)]
pub struct DuplicateRow {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub duplicate_type: String,
    pub review_status: String,
    pub photo_count: i64,
    pub potential_savings: i64,
    pub similarity_score: Option<f64>,
    pub trashed_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub kept_hash: Option<String>,
    pub kept_thumb_small: Option<String>,
}

fn base(owner: i32) -> Qb<'static> {
    let mut qb = Qb::new(
        "WITH dups AS (SELECT d.*, (SELECT count(*) FROM api_photo_duplicates x \
           WHERE x.duplicate_id = d.id) AS photo_count FROM api_duplicate d WHERE d.owner_id = ",
    );
    qb.push_bind(owner);
    qb.push(") ");
    qb
}

const DUP_SELECT: &str = "SELECT d.id, d.duplicate_type, d.review_status, d.photo_count, \
      d.potential_savings, d.similarity_score, d.trashed_count, d.created_at, d.updated_at, \
      kp.image_hash AS kept_hash, kth.square_thumbnail_small AS kept_thumb_small \
    FROM dups d LEFT JOIN api_photo kp ON kp.id = d.kept_photo_id \
    LEFT JOIN api_thumbnail kth ON kth.photo_id = kp.id";

fn push_filters(qb: &mut Qb<'_>, duplicate_type: Option<&str>, status: Option<&str>) {
    qb.push(" WHERE d.photo_count >= 2");
    if let Some(t) = duplicate_type {
        qb.push(" AND d.duplicate_type = ");
        qb.push_bind(t.to_string());
    }
    if let Some(s) = status {
        qb.push(" AND d.review_status = ");
        qb.push_bind(s.to_string());
    }
}

pub async fn count_listed(
    db: &Db,
    owner: i32,
    duplicate_type: Option<&str>,
    status: Option<&str>,
) -> sqlx::Result<i64> {
    let mut qb = base(owner);
    qb.push("SELECT count(*) FROM dups d");
    push_filters(&mut qb, duplicate_type, status);
    let (n,): (i64,) = qb.build_query_as().fetch_one(db).await?;
    Ok(n)
}

pub async fn list_page(
    db: &Db,
    owner: i32,
    duplicate_type: Option<&str>,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<DuplicateRow>> {
    let mut qb = base(owner);
    qb.push(DUP_SELECT);
    push_filters(&mut qb, duplicate_type, status);
    qb.push(" ORDER BY d.created_at DESC, d.id LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);
    qb.build_query_as().fetch_all(db).await
}

pub async fn get(db: &Db, owner: i32, id: Uuid) -> sqlx::Result<Option<DuplicateRow>> {
    let mut qb = base(owner);
    qb.push(DUP_SELECT);
    qb.push(" WHERE d.id = ");
    qb.push_bind(id);
    qb.build_query_as().fetch_optional(db).await
}

pub async fn dup_members(
    db: &Db,
    dup_ids: &[Uuid],
    per_group: Option<i64>,
) -> sqlx::Result<Vec<MemberPhoto>> {
    members(
        db,
        "api_photo_duplicates",
        "duplicate_id",
        dup_ids,
        per_group,
    )
    .await
}

/// `Duplicate.auto_select_best_photo`: exact copies keep the shortest main
/// file path, visual duplicates the largest resolution (`order_by(w*h).last()`,
/// i.e. DESC with NULLs first). Ties go to the earliest link: Django's plan
/// meets the links in insertion order and its top-1 sort keeps the first
/// maximum; `create_or_merge` links photos in Django's order.
pub async fn best_photo(
    conn: &mut Conn,
    dup_id: Uuid,
    duplicate_type: &str,
) -> sqlx::Result<Option<(Uuid, String)>> {
    let sql = if duplicate_type == EXACT_COPY {
        "SELECT p.id, p.image_hash FROM api_photo p          INNER JOIN api_photo_duplicates x ON (p.id = x.photo_id)          LEFT OUTER JOIN api_file mf ON (p.main_file_id = mf.hash)          WHERE x.duplicate_id = $1 ORDER BY length(mf.path) ASC, x.id LIMIT 1"
    } else {
        "SELECT p.id, p.image_hash FROM api_photo p          INNER JOIN api_photo_duplicates x ON (p.id = x.photo_id)          LEFT OUTER JOIN api_photometadata m ON (p.id = m.photo_id)          WHERE x.duplicate_id = $1 ORDER BY (m.width * m.height) DESC, x.id LIMIT 1"
    };
    let row: Option<(DjUuid, String)> = crate::sql::query_as(sql)
        .bind(dup_id)
        .fetch_optional(conn)
        .await?;
    Ok(row.map(|(id, h)| (id.0, h)))
}

#[derive(Debug, Clone, FromRow)]
pub struct DuplicateStats {
    pub total_duplicates: i64,
    pub exact_copy: i64,
    pub visual_duplicate: i64,
    pub pending: i64,
    pub resolved: i64,
    pub dismissed: i64,
    pub pending_savings: Option<i64>,
    pub photos_in_duplicates: i64,
    pub total_photos: i64,
}

pub async fn stats(db: &Db, owner: i32) -> sqlx::Result<DuplicateStats> {
    let mut qb = Qb::new(
        "SELECT count(*) AS total_duplicates, \
           count(*) FILTER (WHERE duplicate_type = 'exact_copy') AS exact_copy, \
           count(*) FILTER (WHERE duplicate_type = 'visual_duplicate') AS visual_duplicate, \
           count(*) FILTER (WHERE review_status = 'pending') AS pending, \
           count(*) FILTER (WHERE review_status = 'resolved') AS resolved, \
           count(*) FILTER (WHERE review_status = 'dismissed') AS dismissed, \
           sum(potential_savings) FILTER (WHERE review_status = 'pending')::bigint AS pending_savings, \
           (SELECT count(*) FROM api_photo p WHERE EXISTS (SELECT 1 FROM api_photo_duplicates x \
              WHERE x.photo_id = p.id) AND ",
    );
    scope::owned_by(&mut qb, "p", owner);
    qb.push(") AS photos_in_duplicates, ");
    push_total_photos(&mut qb, owner);
    qb.push(" AS total_photos FROM api_duplicate WHERE owner_id = ");
    qb.push_bind(owner);
    qb.build_query_as().fetch_one(db).await
}

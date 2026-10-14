//! Per-user figures of `/api/serverstats/` (`_get_user_stats`), fetched for
//! every user at once: one query per figure family, grouped by owner.

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: i32,
    pub date_joined: DateTime<Utc>,
}

/// Photo counters of one owner.
#[derive(Debug, Clone, Default, FromRow)]
pub struct PhotoTotals {
    pub owner_id: i32,
    pub size_sum: Option<i64>,
    pub photos: i64,
    pub videos: i64,
    pub screenshots: i64,
    pub documents: i64,
    pub captions: i64,
    pub generated_captions: i64,
    pub favorites: i64,
    pub hidden: i64,
    pub public: i64,
}

/// One album (or person) and how many photos (faces) it holds.
#[derive(Debug, Clone, FromRow)]
pub struct GroupCount {
    pub kind: String,
    pub owner_id: i32,
    pub count: i64,
    pub videos: i64,
}

/// Every user but the `deleted` placeholder (`get_deleted_user`).
pub async fn real_users(db: &PgPool) -> sqlx::Result<Vec<UserRow>> {
    sqlx::query_as("SELECT id, date_joined FROM api_user WHERE username <> 'deleted' ORDER BY id")
        .fetch_all(db)
        .await
}

pub async fn photo_totals(db: &PgPool) -> sqlx::Result<Vec<PhotoTotals>> {
    sqlx::query_as(
        "SELECT p.owner_id, sum(p.size)::bigint AS size_sum, count(*) AS photos, \
           count(*) FILTER (WHERE p.video) AS videos, \
           count(*) FILTER (WHERE p.is_screenshot) AS screenshots, \
           count(*) FILTER (WHERE p.is_document) AS documents, \
           count(*) FILTER (WHERE pc.captions_json ? 'user_caption') AS captions, \
           count(*) FILTER (WHERE pc.captions_json ? 'im2txt') AS generated_captions, \
           count(*) FILTER (WHERE p.rating >= u.favorite_min_rating) AS favorites, \
           count(*) FILTER (WHERE p.hidden) AS hidden, \
           count(*) FILTER (WHERE p.public) AS public \
         FROM api_photo p JOIN api_user u ON u.id = p.owner_id \
         LEFT JOIN api_photo_caption pc ON pc.photo_id = p.id \
         GROUP BY p.owner_id",
    )
    .fetch_all(db)
    .await
}

/// Photo counts of every album (kinds `user`, `place`, `thing`, `auto`) and
/// face counts of every clustered person (kind `person`).
pub async fn group_counts(db: &PgPool) -> sqlx::Result<Vec<GroupCount>> {
    let album = |kind: &str| {
        format!(
            "SELECT '{kind}'::text AS kind, a.owner_id, count(ap.photo_id) AS count, \
               count(ap.photo_id) FILTER (WHERE ph.video) AS videos \
             FROM api_album{kind} a LEFT JOIN api_album{kind}_photos ap ON ap.album{kind}_id = a.id \
             LEFT JOIN api_photo ph ON ph.id = ap.photo_id GROUP BY a.id, a.owner_id"
        )
    };
    let sql = format!(
        "{} UNION ALL {} UNION ALL {} UNION ALL {} UNION ALL \
         SELECT 'person'::text, pe.cluster_owner_id, count(f.id), 0::bigint \
         FROM api_person pe LEFT JOIN api_face f ON f.person_id = pe.id \
         WHERE pe.cluster_owner_id IS NOT NULL GROUP BY pe.id, pe.cluster_owner_id",
        album("user"),
        album("place"),
        album("thing"),
        album("auto"),
    );
    sqlx::query_as(&sql).fetch_all(db).await
}

/// `Cluster` rows per owner.
pub async fn cluster_counts(db: &PgPool) -> sqlx::Result<Vec<(i32, i64)>> {
    sqlx::query_as(
        "SELECT owner_id, count(*) FROM api_cluster WHERE owner_id IS NOT NULL GROUP BY owner_id",
    )
    .fetch_all(db)
    .await
}

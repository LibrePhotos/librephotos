//! Inputs of the `stacks.detect` and `dupes.detect` jobs
//! (`api/stack_detection.py`, `api/duplicate_detection.py`).

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::db::{Conn, DjList, DjUuid, Qb};
use crate::scope;

/// `hidden=False, in_trashcan=False, removed=False`.
fn push_reviewable(qb: &mut Qb<'_>, owner: i32) {
    qb.push("NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed AND ");
    scope::owned_by(qb, "p", owner);
}

/// A photo considered by burst detection.
#[derive(Debug, Clone, FromRow)]
pub struct BurstCandidate {
    #[sqlx(try_from = "DjUuid")]
    pub id: Uuid,
    pub exif_timestamp: Option<DateTime<Utc>>,
    pub added_on: DateTime<Utc>,
    pub main_file_path: Option<String>,
    pub has_metadata: bool,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub perceptual_hash: Option<String>,
}

const BURST_SELECT: &str = "SELECT p.id, p.exif_timestamp, p.added_on, mf.path AS main_file_path, \
    (m.id IS NOT NULL) AS has_metadata, m.camera_make, m.camera_model, p.perceptual_hash \
    FROM api_photo p LEFT JOIN api_file mf ON mf.hash = p.main_file_id \
    LEFT JOIN api_photometadata m ON m.photo_id = p.id \
    WHERE NOT p.hidden AND NOT p.in_trashcan AND ";

/// Hard-criteria input: every visible-or-removed, untrashed photo.
pub async fn burst_hard_candidates(db: &mut Conn, owner: i32) -> sqlx::Result<Vec<BurstCandidate>> {
    let mut qb = Qb::new(BURST_SELECT);
    scope::owned_by(&mut qb, "p", owner);
    qb.push(" ORDER BY p.id");
    qb.build_query_as().fetch_all(db).await
}

/// Soft-criteria input: timestamped photos, oldest first.
pub async fn burst_soft_candidates(db: &mut Conn, owner: i32) -> sqlx::Result<Vec<BurstCandidate>> {
    let mut qb = Qb::new(BURST_SELECT);
    qb.push("p.exif_timestamp IS NOT NULL AND ");
    scope::owned_by(&mut qb, "p", owner);
    qb.push(" ORDER BY p.exif_timestamp, p.id");
    qb.build_query_as().fetch_all(db).await
}

/// Photos sharing an `image_hash` (one list per hash with 2+ photos).
pub async fn same_image_hash_groups(db: &mut Conn, owner: i32) -> sqlx::Result<Vec<Vec<Uuid>>> {
    let mut qb = Qb::new("SELECT array_agg(p.id ORDER BY p.id) FROM api_photo p WHERE ");
    push_reviewable(&mut qb, owner);
    qb.push(" GROUP BY p.image_hash HAVING count(*) > 1 ORDER BY p.image_hash");
    let rows: Vec<(DjList<Uuid>,)> = qb.build_query_as().fetch_all(db).await?;
    Ok(rows.into_iter().map(|r| r.0.0).collect())
}

/// Photos whose non-metadata files share an MD5 (the first 32 hash
/// characters). As in Django, the photos of a group are those with any file
/// of that MD5 and no metadata file at all.
pub async fn same_content_groups(db: &mut Conn, owner: i32) -> sqlx::Result<Vec<Vec<Uuid>>> {
    let mut qb = Qb::new(
        "WITH g AS (SELECT substring(f.hash, 1, 32) AS ch FROM api_file f \
           JOIN api_photo_files pf ON pf.file_id = f.hash JOIN api_photo p ON p.id = pf.photo_id \
           WHERE f.type <> 3 AND ",
    );
    push_reviewable(&mut qb, owner);
    qb.push(
        " GROUP BY 1 HAVING count(DISTINCT p.id) > 1) \
         SELECT array_agg(DISTINCT p.id) FROM g \
         JOIN api_photo_files pf ON substring(pf.file_id, 1, 32) = g.ch \
         JOIN api_photo p ON p.id = pf.photo_id \
         WHERE NOT EXISTS (SELECT 1 FROM api_photo_files mx JOIN api_file mfx ON mfx.hash = mx.file_id \
           WHERE mx.photo_id = p.id AND mfx.type = 3) AND ",
    );
    push_reviewable(&mut qb, owner);
    qb.push(" GROUP BY g.ch ORDER BY g.ch");
    let rows: Vec<(DjList<Uuid>,)> = qb.build_query_as().fetch_all(db).await?;
    Ok(rows.into_iter().map(|r| r.0.0).collect())
}

/// `(id, perceptual_hash)` of photos not yet in a visual duplicate group.
pub async fn visual_candidates(db: &mut Conn, owner: i32) -> sqlx::Result<Vec<(Uuid, String)>> {
    let mut qb = Qb::new(
        "SELECT p.id, p.perceptual_hash FROM api_photo p WHERE p.perceptual_hash IS NOT NULL \
         AND NOT EXISTS (SELECT 1 FROM api_photo_duplicates x JOIN api_duplicate d ON d.id = x.duplicate_id \
           WHERE x.photo_id = p.id AND d.duplicate_type = 'visual_duplicate') AND ",
    );
    push_reviewable(&mut qb, owner);
    qb.push(" ORDER BY p.id");
    let rows: Vec<(DjUuid, String)> = qb.build_query_as().fetch_all(db).await?;
    Ok(rows.into_iter().map(|(id, h)| (id.0, h)).collect())
}

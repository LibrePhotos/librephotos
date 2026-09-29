//! `Duplicate` writes (`api/views/duplicates.py`, `api/models/duplicate.py`).
//! Group membership is the `api_photo_duplicates` link table.

use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use super::refresh_tags_for_photos;
use crate::stats_admin_stacks_dupes::dupes::best_photo;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveOutcome {
    NotFound,
    PhotoNotInGroup,
    Resolved { trashed_count: i32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevertOutcome {
    NotFound,
    NotResolved,
    Reverted { restored: i64 },
}

async fn owned_status(
    conn: &mut PgConnection,
    owner: i32,
    id: Uuid,
) -> sqlx::Result<Option<(String, i32)>> {
    sqlx::query_as(
        "SELECT review_status, trashed_count FROM api_duplicate WHERE id = $1 AND owner_id = $2 FOR UPDATE",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(conn)
    .await
}

async fn unlink_all(conn: &mut PgConnection, ids: &[Uuid]) -> sqlx::Result<u64> {
    Ok(
        sqlx::query("DELETE FROM api_photo_duplicates WHERE duplicate_id = ANY($1)")
            .bind(ids)
            .execute(conn)
            .await?
            .rows_affected(),
    )
}

async fn delete_groups(conn: &mut PgConnection, ids: &[Uuid]) -> sqlx::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    unlink_all(conn, ids).await?;
    sqlx::query("DELETE FROM api_duplicate WHERE id = ANY($1)")
        .bind(ids)
        .execute(conn)
        .await?;
    Ok(())
}

/// `DELETE /api/duplicates/{id}/delete`: the number of distinct photos
/// unlinked, None if the user has no such group.
pub async fn delete(db: &PgPool, owner: i32, id: Uuid) -> sqlx::Result<Option<i64>> {
    let mut tx = db.begin().await?;
    if owned_status(&mut tx, owner, id).await?.is_none() {
        return Ok(None);
    }
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM api_photo_duplicates WHERE duplicate_id = $1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    delete_groups(&mut tx, &[id]).await?;
    tx.commit().await?;
    Ok(Some(n))
}

/// `POST /api/duplicates/{id}/dismiss`: false if the user has no such group.
pub async fn dismiss(db: &PgPool, owner: i32, id: Uuid) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    if owned_status(&mut tx, owner, id).await?.is_none() {
        return Ok(false);
    }
    unlink_all(&mut tx, &[id]).await?;
    sqlx::query(
        "UPDATE api_duplicate SET review_status = 'dismissed', reviewed_at = now(), updated_at = now() \
         WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// `POST /api/duplicates/{id}/revert`: restore the group's trashed photos
/// and reset it to pending. Unlike Django, the restored photos' tag counts
/// are refreshed too (S20).
pub async fn revert(db: &PgPool, owner: i32, id: Uuid) -> sqlx::Result<RevertOutcome> {
    let mut tx = db.begin().await?;
    let Some((status, _)) = owned_status(&mut tx, owner, id).await? else {
        return Ok(RevertOutcome::NotFound);
    };
    if status != "resolved" {
        return Ok(RevertOutcome::NotResolved);
    }
    let restored: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE api_photo p SET in_trashcan = FALSE, last_modified = now() WHERE p.in_trashcan \
         AND p.id IN (SELECT photo_id FROM api_photo_duplicates WHERE duplicate_id = $1) RETURNING p.id",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    refresh_tags_for_photos(&mut tx, &restored).await?;
    sqlx::query(
        "UPDATE api_duplicate SET review_status = 'pending', kept_photo_id = NULL, trashed_count = 0, \
           reviewed_at = NULL, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(RevertOutcome::Reverted {
        restored: restored.len() as i64,
    })
}

/// `POST /api/duplicates/{id}/resolve`: keep the photo with `keep_hash`,
/// optionally trash the rest (S20: tag counts).
pub async fn resolve(
    db: &PgPool,
    owner: i32,
    id: Uuid,
    keep_hash: &str,
    trash_others: bool,
) -> sqlx::Result<ResolveOutcome> {
    let mut tx = db.begin().await?;
    let Some((_, mut trashed_count)) = owned_status(&mut tx, owner, id).await? else {
        return Ok(ResolveOutcome::NotFound);
    };
    let keep: Option<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM api_photo_duplicates x JOIN api_photo p ON p.id = x.photo_id \
         WHERE x.duplicate_id = $1 AND p.image_hash = $2 ORDER BY x.id LIMIT 1",
    )
    .bind(id)
    .bind(keep_hash)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(keep) = keep else {
        return Ok(ResolveOutcome::PhotoNotInGroup);
    };
    if trash_others {
        let trashed: Vec<Uuid> = sqlx::query_scalar(
            "UPDATE api_photo p SET in_trashcan = TRUE, last_modified = now() \
             WHERE p.id <> $2 AND p.id IN (SELECT photo_id FROM api_photo_duplicates WHERE duplicate_id = $1) \
             RETURNING p.id",
        )
        .bind(id)
        .bind(keep)
        .fetch_all(&mut *tx)
        .await?;
        refresh_tags_for_photos(&mut tx, &trashed).await?;
        trashed_count = trashed.len() as i32;
    }
    sqlx::query(
        "UPDATE api_duplicate SET kept_photo_id = $2, review_status = 'resolved', reviewed_at = now(), \
           trashed_count = $3, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(keep)
    .bind(trashed_count)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(ResolveOutcome::Resolved { trashed_count })
}

/// `Duplicate.calculate_potential_savings`: the size of every photo but the
/// suggested one.
pub async fn calculate_potential_savings(
    conn: &mut PgConnection,
    id: Uuid,
    duplicate_type: &str,
) -> sqlx::Result<i64> {
    let savings: i64 = match best_photo(conn, id, duplicate_type).await? {
        None => 0,
        Some((best, _)) => {
            sqlx::query_scalar(
                "SELECT COALESCE(sum(p.size), 0)::bigint FROM api_photo_duplicates x \
             JOIN api_photo p ON p.id = x.photo_id WHERE x.duplicate_id = $1 AND p.id <> $2",
            )
            .bind(id)
            .bind(best)
            .fetch_one(&mut *conn)
            .await?
        }
    };
    sqlx::query(
        "UPDATE api_duplicate SET potential_savings = $2, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(savings)
    .execute(conn)
    .await?;
    Ok(savings)
}

/// Link `photos` to `group` unless already linked (M2M `add`).
async fn add_photos(conn: &mut PgConnection, group: Uuid, photos: &[Uuid]) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        "INSERT INTO api_photo_duplicates (photo_id, duplicate_id) \
         SELECT DISTINCT u.id, $1::uuid FROM unnest($2::uuid[]) AS u(id) \
         WHERE NOT EXISTS (SELECT 1 FROM api_photo_duplicates x WHERE x.duplicate_id = $1 AND x.photo_id = u.id)",
    )
    .bind(group)
    .bind(photos)
    .execute(conn)
    .await?
    .rows_affected())
}

/// `Duplicate.create_or_merge` for 2+ photos: returns the group.
pub async fn create_or_merge(
    conn: &mut PgConnection,
    owner: i32,
    duplicate_type: &str,
    photos: &[Uuid],
    similarity_score: Option<f64>,
) -> sqlx::Result<Option<Uuid>> {
    if photos.len() < 2 {
        return Ok(None);
    }
    let existing: Vec<Uuid> = sqlx::query_scalar(
        "SELECT d.id FROM api_duplicate d WHERE d.owner_id = $1 AND d.duplicate_type = $2 \
         AND EXISTS (SELECT 1 FROM api_photo_duplicates x WHERE x.duplicate_id = d.id AND x.photo_id = ANY($3)) \
         ORDER BY d.created_at DESC, d.id",
    )
    .bind(owner)
    .bind(duplicate_type)
    .bind(photos)
    .fetch_all(&mut *conn)
    .await?;
    let Some((&target, others)) = existing.split_first() else {
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO api_duplicate (id, duplicate_type, review_status, created_at, updated_at, \
               reviewed_at, similarity_score, potential_savings, trashed_count, note, kept_photo_id, owner_id) \
             VALUES ($1, $2, 'pending', now(), now(), NULL, $3, 0, 0, NULL, NULL, $4)",
        )
        .bind(id)
        .bind(duplicate_type)
        .bind(similarity_score)
        .bind(owner)
        .execute(&mut *conn)
        .await?;
        add_photos(conn, id, photos).await?;
        calculate_potential_savings(conn, id, duplicate_type).await?;
        return Ok(Some(id));
    };
    for &other in others {
        let moved: Vec<Uuid> = sqlx::query_scalar(
            "SELECT photo_id FROM api_photo_duplicates WHERE duplicate_id = $1 ORDER BY id",
        )
        .bind(other)
        .fetch_all(&mut *conn)
        .await?;
        add_photos(conn, target, &moved).await?;
        calculate_potential_savings(conn, target, duplicate_type).await?;
        delete_groups(conn, &[other]).await?;
    }
    add_photos(conn, target, photos).await?;
    calculate_potential_savings(conn, target, duplicate_type).await?;
    Ok(Some(target))
}

/// `clear_pending`: delete the user's pending groups.
pub async fn clear_pending(conn: &mut PgConnection, owner: i32) -> sqlx::Result<usize> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM api_duplicate WHERE owner_id = $1 AND review_status = 'pending'",
    )
    .bind(owner)
    .fetch_all(&mut *conn)
    .await?;
    delete_groups(conn, &ids).await?;
    Ok(ids.len())
}

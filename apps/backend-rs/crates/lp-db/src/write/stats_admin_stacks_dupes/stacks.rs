//! `PhotoStack` writes (`api/views/stacks.py`, `api/models/photo_stack.py`).
//! Stack membership is the `api_photo_stacks` link table (no unique pair);
//! deleting a stack also deletes its `api_stackreview` (Django CASCADE).

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool, QueryBuilder};
use uuid::Uuid;

use crate::scope;

type Span = Option<DateTime<Utc>>;

pub const MANUAL: &str = "manual";
pub const BURST: &str = "burst";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetPrimary {
    StackNotFound,
    PhotoNotInStack,
    Updated,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoveOutcome {
    StackNotFound,
    Deleted { removed: i64 },
    Updated { removed: i64, remaining: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeOutcome {
    PhotosNotFound,
    NoManualStacks,
    NoMergeNeeded {
        stack_id: Uuid,
        photo_count: i64,
    },
    Merged {
        stack_id: Uuid,
        photo_count: i64,
        merged: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManualOutcome {
    PhotosNotFound,
    Created { stack_id: Uuid, photo_count: i64 },
}

async fn owned_stack_type(
    conn: &mut PgConnection,
    owner: i32,
    id: Uuid,
) -> sqlx::Result<Option<String>> {
    sqlx::query_scalar(
        "SELECT stack_type FROM api_photostack WHERE id = $1 AND owner_id = $2 FOR UPDATE",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(conn)
    .await
}

async fn member_count(conn: &mut PgConnection, id: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT count(*) FROM api_photo_stacks WHERE photostack_id = $1")
        .bind(id)
        .fetch_one(conn)
        .await
}

/// Unlink every photo and delete the stacks (and their reviews).
pub async fn delete_stacks(conn: &mut PgConnection, ids: &[Uuid]) -> sqlx::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    sqlx::query("DELETE FROM api_photo_stacks WHERE photostack_id = ANY($1)")
        .bind(ids)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM api_stackreview WHERE stack_id = ANY($1)")
        .bind(ids)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM api_photostack WHERE id = ANY($1)")
        .bind(ids)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// `DELETE /api/stacks/{id}/`: the number of unlinked photos, None if the
/// user has no such stack.
pub async fn delete(db: &PgPool, owner: i32, id: Uuid) -> sqlx::Result<Option<i64>> {
    let mut tx = db.begin().await?;
    if owned_stack_type(&mut tx, owner, id).await?.is_none() {
        return Ok(None);
    }
    let n = member_count(&mut tx, id).await?;
    delete_stacks(&mut tx, &[id]).await?;
    tx.commit().await?;
    Ok(Some(n))
}

/// `PhotoStack.auto_select_primary`: bursts and brackets take the middle
/// photo by timestamp, everything else the largest resolution
/// (`order_by(w*h).last()`). Ties are left to Postgres, with statements
/// shaped like Django's.
pub async fn auto_select_primary(
    conn: &mut PgConnection,
    id: Uuid,
    stack_type: &str,
) -> sqlx::Result<Option<Uuid>> {
    let pick: Option<Uuid> = if stack_type == BURST || stack_type == "bracket" {
        let n = member_count(conn, id).await?;
        sqlx::query_scalar(
            "SELECT p.id FROM api_photo p INNER JOIN api_photo_stacks x ON (p.id = x.photo_id)              WHERE x.photostack_id = $1 ORDER BY p.exif_timestamp ASC LIMIT 1 OFFSET $2",
        )
        .bind(id)
        .bind(n / 2)
        .fetch_optional(&mut *conn)
        .await?
    } else {
        sqlx::query_scalar(
            "SELECT p.id FROM api_photo p INNER JOIN api_photo_stacks x ON (p.id = x.photo_id)              LEFT OUTER JOIN api_photometadata m ON (p.id = m.photo_id)              WHERE x.photostack_id = $1 ORDER BY (m.width * m.height) DESC LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?
    };
    if let Some(photo) = pick {
        sqlx::query(
            "UPDATE api_photostack SET primary_photo_id = $2, updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(photo)
        .execute(&mut *conn)
        .await?;
    }
    Ok(pick)
}

/// `POST /api/stacks/{id}/primary/`.
pub async fn set_primary(
    db: &PgPool,
    owner: i32,
    id: Uuid,
    hash: &str,
) -> sqlx::Result<SetPrimary> {
    let mut tx = db.begin().await?;
    if owned_stack_type(&mut tx, owner, id).await?.is_none() {
        return Ok(SetPrimary::StackNotFound);
    }
    let photo: Option<Uuid> = sqlx::query_scalar(
        "SELECT p.id FROM api_photo_stacks x JOIN api_photo p ON p.id = x.photo_id \
         WHERE x.photostack_id = $1 AND p.image_hash = $2 ORDER BY x.id LIMIT 1",
    )
    .bind(id)
    .bind(hash)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(photo) = photo else {
        return Ok(SetPrimary::PhotoNotInStack);
    };
    sqlx::query(
        "UPDATE api_photostack SET primary_photo_id = $2, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(photo)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(SetPrimary::Updated)
}

/// Ids of `owner`'s photos with one of `hashes` (`owned_by(...).filter(image_hash__in=...)`).
pub async fn owned_photos_by_hash(
    conn: &mut PgConnection,
    owner: i32,
    hashes: &[String],
) -> sqlx::Result<Vec<Uuid>> {
    let mut qb = QueryBuilder::new("SELECT p.id FROM api_photo p WHERE p.image_hash = ANY(");
    qb.push_bind(hashes.to_vec());
    qb.push(") AND ");
    scope::owned_by(&mut qb, "p", owner);
    qb.push(" ORDER BY p.id");
    let rows: Vec<(Uuid,)> = qb.build_query_as().fetch_all(conn).await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Link `photos` to `stack` unless already linked (M2M `add`). Photos
/// deleted meanwhile are skipped: burst detection reads its candidates
/// before its transaction.
pub async fn add_photos(
    conn: &mut PgConnection,
    stack: Uuid,
    photos: &[Uuid],
) -> sqlx::Result<u64> {
    Ok(sqlx::query(
        "INSERT INTO api_photo_stacks (photo_id, photostack_id) \
         SELECT DISTINCT ON (u.id) u.id, $1 FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, ord) \
         WHERE NOT EXISTS (SELECT 1 FROM api_photo_stacks x WHERE x.photostack_id = $1 AND x.photo_id = u.id) \
         AND EXISTS (SELECT 1 FROM api_photo p WHERE p.id = u.id) \
         ORDER BY u.id",
    )
    .bind(stack)
    .bind(photos)
    .execute(conn)
    .await?
    .rows_affected())
}

/// `POST /api/stacks/{id}/add/`: link the user's photos with `hashes`;
/// `(added, total)`, None if the user has no such stack.
pub async fn add_to_stack(
    db: &PgPool,
    owner: i32,
    id: Uuid,
    hashes: &[String],
) -> sqlx::Result<Option<(i64, i64)>> {
    let mut tx = db.begin().await?;
    if owned_stack_type(&mut tx, owner, id).await?.is_none() {
        return Ok(None);
    }
    let photos = owned_photos_by_hash(&mut tx, owner, hashes).await?;
    let added = add_photos(&mut tx, id, &photos).await? as i64;
    let total = member_count(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Some((added, total)))
}

/// `POST /api/stacks/{id}/remove/`.
pub async fn remove_photos(
    db: &PgPool,
    owner: i32,
    id: Uuid,
    hashes: &[String],
) -> sqlx::Result<RemoveOutcome> {
    let mut tx = db.begin().await?;
    let Some(stack_type) = owned_stack_type(&mut tx, owner, id).await? else {
        return Ok(RemoveOutcome::StackNotFound);
    };
    let photos = owned_photos_by_hash(&mut tx, owner, hashes).await?;
    let removed: i64 = sqlx::query_scalar(
        "WITH gone AS (DELETE FROM api_photo_stacks WHERE photostack_id = $1 AND photo_id = ANY($2) \
           RETURNING photo_id) SELECT count(DISTINCT photo_id) FROM gone",
    )
    .bind(id)
    .bind(&photos)
    .fetch_one(&mut *tx)
    .await?;
    let remaining = member_count(&mut tx, id).await?;
    if remaining < 2 {
        delete_stacks(&mut tx, &[id]).await?;
        tx.commit().await?;
        return Ok(RemoveOutcome::Deleted { removed });
    }
    let primary_removed: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM api_photostack s JOIN api_photo p ON p.id = s.primary_photo_id \
         WHERE s.id = $1 AND p.image_hash = ANY($2))",
    )
    .bind(id)
    .bind(hashes)
    .fetch_one(&mut *tx)
    .await?;
    if primary_removed {
        auto_select_primary(&mut tx, id, &stack_type).await?;
    }
    tx.commit().await?;
    Ok(RemoveOutcome::Updated { removed, remaining })
}

/// Move every photo of `other` into `target` and delete `other`
/// (`PhotoStack.merge_with`).
async fn merge_into(
    conn: &mut PgConnection,
    target: Uuid,
    target_type: &str,
    other: Uuid,
) -> sqlx::Result<()> {
    if target == other {
        return Ok(());
    }
    let photos: Vec<Uuid> = sqlx::query_scalar(
        "SELECT photo_id FROM api_photo_stacks WHERE photostack_id = $1 ORDER BY id",
    )
    .bind(other)
    .fetch_all(&mut *conn)
    .await?;
    add_photos(conn, target, &photos).await?;
    let has_primary: bool =
        sqlx::query_scalar("SELECT primary_photo_id IS NOT NULL FROM api_photostack WHERE id = $1")
            .bind(target)
            .fetch_one(&mut *conn)
            .await?;
    if !has_primary {
        auto_select_primary(conn, target, target_type).await?;
    }
    delete_stacks(conn, &[other]).await
}

/// `POST /api/stacks/merge/`: merge every manual stack holding one of the
/// photos into the newest of them.
pub async fn merge_manual(
    db: &PgPool,
    owner: i32,
    hashes: &[String],
) -> sqlx::Result<MergeOutcome> {
    let mut tx = db.begin().await?;
    let photos = owned_photos_by_hash(&mut tx, owner, hashes).await?;
    if photos.len() != hashes.len() {
        return Ok(MergeOutcome::PhotosNotFound);
    }
    let stacks: Vec<Uuid> = sqlx::query_scalar(
        "SELECT s.id FROM api_photostack s WHERE s.owner_id = $1 AND s.stack_type = 'manual' \
         AND EXISTS (SELECT 1 FROM api_photo_stacks x WHERE x.photostack_id = s.id AND x.photo_id = ANY($2)) \
         ORDER BY s.created_at DESC, s.id FOR UPDATE",
    )
    .bind(owner)
    .bind(&photos)
    .fetch_all(&mut *tx)
    .await?;
    let Some((&target, others)) = stacks.split_first() else {
        return Ok(MergeOutcome::NoManualStacks);
    };
    if others.is_empty() {
        let photo_count = member_count(&mut tx, target).await?;
        tx.commit().await?;
        return Ok(MergeOutcome::NoMergeNeeded {
            stack_id: target,
            photo_count,
        });
    }
    for &other in others {
        merge_into(&mut tx, target, MANUAL, other).await?;
    }
    let has_primary: bool =
        sqlx::query_scalar("SELECT primary_photo_id IS NOT NULL FROM api_photostack WHERE id = $1")
            .bind(target)
            .fetch_one(&mut *tx)
            .await?;
    if !has_primary {
        auto_select_primary(&mut tx, target, MANUAL).await?;
    }
    let photo_count = member_count(&mut tx, target).await?;
    tx.commit().await?;
    Ok(MergeOutcome::Merged {
        stack_id: target,
        photo_count,
        merged: others.len() as i64,
    })
}

async fn insert_stack(
    conn: &mut PgConnection,
    owner: i32,
    stack_type: &str,
    sequence_start: Option<DateTime<Utc>>,
    sequence_end: Option<DateTime<Utc>>,
) -> sqlx::Result<Uuid> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO api_photostack (id, stack_type, created_at, updated_at, sequence_start, \
           sequence_end, owner_id, primary_photo_id) VALUES ($1, $2, now(), now(), $3, $4, $5, NULL)",
    )
    .bind(id)
    .bind(stack_type)
    .bind(sequence_start)
    .bind(sequence_end)
    .bind(owner)
    .execute(conn)
    .await?;
    Ok(id)
}

/// `POST /api/stacks/manual/`: `hashes` are already de-duplicated (2+).
pub async fn create_manual(
    db: &PgPool,
    owner: i32,
    hashes: &[String],
) -> sqlx::Result<ManualOutcome> {
    let mut tx = db.begin().await?;
    let photos = owned_photos_by_hash(&mut tx, owner, hashes).await?;
    if photos.len() != hashes.len() {
        return Ok(ManualOutcome::PhotosNotFound);
    }
    // The first photo (in photo order) already in a manual stack decides; of
    // its manual stacks the newest wins (`PhotoStack.Meta.ordering`).
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT s.id FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, ord) \
         JOIN api_photo_stacks x ON x.photo_id = u.id JOIN api_photostack s ON s.id = x.photostack_id \
         WHERE s.stack_type = 'manual' ORDER BY u.ord, s.created_at DESC, s.id LIMIT 1",
    )
    .bind(owner)
    .bind(&photos)
    .fetch_optional(&mut *tx)
    .await?;
    let stack = match existing {
        Some(s) => s,
        None => insert_stack(&mut tx, owner, MANUAL, None, None).await?,
    };
    add_photos(&mut tx, stack, &photos).await?;
    auto_select_primary(&mut tx, stack, MANUAL).await?;
    tx.commit().await?;
    Ok(ManualOutcome::Created {
        stack_id: stack,
        photo_count: photos.len() as i64,
    })
}

/// `clear_stacks_of_type`: the number of stacks deleted.
pub async fn clear_type(
    conn: &mut PgConnection,
    owner: i32,
    stack_type: &str,
) -> sqlx::Result<usize> {
    let ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM api_photostack WHERE owner_id = $1 AND stack_type = $2")
            .bind(owner)
            .bind(stack_type)
            .fetch_all(&mut *conn)
            .await?;
    delete_stacks(conn, &ids).await?;
    Ok(ids.len())
}

/// `PhotoStack.create_or_merge` for 2+ photos.
pub async fn create_or_merge(
    conn: &mut PgConnection,
    owner: i32,
    stack_type: &str,
    photos: &[Uuid],
    sequence_start: Option<DateTime<Utc>>,
    sequence_end: Option<DateTime<Utc>>,
) -> sqlx::Result<Option<Uuid>> {
    if photos.len() < 2 {
        return Ok(None);
    }
    let existing: Vec<(Uuid, Span, Span)> = sqlx::query_as(
        "SELECT s.id, s.sequence_start, s.sequence_end FROM api_photostack s \
         WHERE s.owner_id = $1 AND s.stack_type = $2 AND EXISTS (SELECT 1 FROM api_photo_stacks x \
           WHERE x.photostack_id = s.id AND x.photo_id = ANY($3)) \
         ORDER BY s.created_at DESC, s.id",
    )
    .bind(owner)
    .bind(stack_type)
    .bind(photos)
    .fetch_all(&mut *conn)
    .await?;
    let Some(&(target, start, end)) = existing.first() else {
        let id = insert_stack(conn, owner, stack_type, sequence_start, sequence_end).await?;
        add_photos(conn, id, photos).await?;
        auto_select_primary(conn, id, stack_type).await?;
        return Ok(Some(id));
    };
    for &(other, _, _) in &existing[1..] {
        merge_into(conn, target, stack_type, other).await?;
    }
    add_photos(conn, target, photos).await?;
    if let (Some(new_start), Some(new_end)) = (sequence_start, sequence_end) {
        let start = Some(start.map_or(new_start, |s| s.min(new_start)));
        let end = Some(end.map_or(new_end, |e| e.max(new_end)));
        sqlx::query(
            "UPDATE api_photostack SET sequence_start = $2, sequence_end = $3, updated_at = now() \
             WHERE id = $1",
        )
        .bind(target)
        .bind(start)
        .bind(end)
        .execute(&mut *conn)
        .await?;
    }
    auto_select_primary(conn, target, stack_type).await?;
    Ok(Some(target))
}

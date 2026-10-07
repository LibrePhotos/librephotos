//! `Duplicate` writes (`api/views/duplicates.py`, `api/models/duplicate.py`).
//! Group membership is the `api_photo_duplicates` link table.

use std::collections::HashSet;

use uuid::Uuid;

use super::refresh_tags_for_photos;
use crate::db::{Conn, Db, DjUuid};
use crate::stats_admin_stacks_dupes::dupes::{EXACT_COPY, best_photo};

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
    conn: &mut Conn,
    owner: i32,
    id: Uuid,
) -> sqlx::Result<Option<(String, i32)>> {
    crate::sql::query_as(
        "SELECT review_status, trashed_count FROM api_duplicate WHERE id = $1 AND owner_id = $2 FOR UPDATE",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(conn)
    .await
}

async fn unlink_all(conn: &mut Conn, ids: &[Uuid]) -> sqlx::Result<u64> {
    Ok(
        crate::sql::query("DELETE FROM api_photo_duplicates WHERE duplicate_id = ANY($1)")
            .bind(ids)
            .execute(conn)
            .await?
            .rows_affected(),
    )
}

async fn delete_groups(conn: &mut Conn, ids: &[Uuid]) -> sqlx::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    unlink_all(conn, ids).await?;
    crate::sql::query("DELETE FROM api_duplicate WHERE id = ANY($1)")
        .bind(ids)
        .execute(conn)
        .await?;
    Ok(())
}

/// `DELETE /api/duplicates/{id}/delete`: the number of distinct photos
/// unlinked, None if the user has no such group.
pub async fn delete(db: &Db, owner: i32, id: Uuid) -> sqlx::Result<Option<i64>> {
    let mut tx = db.begin().await?;
    if owned_status(&mut tx, owner, id).await?.is_none() {
        return Ok(None);
    }
    let n: i64 = crate::sql::query_scalar(
        "SELECT count(*) FROM api_photo_duplicates WHERE duplicate_id = $1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    delete_groups(&mut tx, &[id]).await?;
    tx.commit().await?;
    Ok(Some(n))
}

/// `POST /api/duplicates/{id}/dismiss`: false if the user has no such group.
pub async fn dismiss(db: &Db, owner: i32, id: Uuid) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    if owned_status(&mut tx, owner, id).await?.is_none() {
        return Ok(false);
    }
    unlink_all(&mut tx, &[id]).await?;
    crate::sql::query(
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
pub async fn revert(db: &Db, owner: i32, id: Uuid) -> sqlx::Result<RevertOutcome> {
    let mut tx = db.begin().await?;
    let Some((status, _)) = owned_status(&mut tx, owner, id).await? else {
        return Ok(RevertOutcome::NotFound);
    };
    if status != "resolved" {
        return Ok(RevertOutcome::NotResolved);
    }
    let restored: Vec<Uuid> = crate::sql::query_scalar(
        "UPDATE api_photo p SET in_trashcan = FALSE, last_modified = now() WHERE p.in_trashcan \
         AND p.id IN (SELECT photo_id FROM api_photo_duplicates WHERE duplicate_id = $1) RETURNING p.id",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    refresh_tags_for_photos(&mut tx, &restored).await?;
    crate::sql::query(
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
    db: &Db,
    owner: i32,
    id: Uuid,
    keep_hash: &str,
    trash_others: bool,
) -> sqlx::Result<ResolveOutcome> {
    let mut tx = db.begin().await?;
    let Some((_, mut trashed_count)) = owned_status(&mut tx, owner, id).await? else {
        return Ok(ResolveOutcome::NotFound);
    };
    let keep: Option<Uuid> = crate::sql::query_scalar(
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
        let trashed: Vec<Uuid> = crate::sql::query_scalar(
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
    crate::sql::query(
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
    conn: &mut Conn,
    id: Uuid,
    duplicate_type: &str,
) -> sqlx::Result<i64> {
    let savings: i64 = match best_photo(conn, id, duplicate_type).await? {
        None => 0,
        Some((best, _)) => {
            crate::sql::query_scalar(
                "SELECT COALESCE(sum(p.size), 0)::bigint FROM api_photo_duplicates x \
             JOIN api_photo p ON p.id = x.photo_id WHERE x.duplicate_id = $1 AND p.id <> $2",
            )
            .bind(id)
            .bind(best)
            .fetch_one(&mut *conn)
            .await?
        }
    };
    crate::sql::query(
        "UPDATE api_duplicate SET potential_savings = $2, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(savings)
    .execute(conn)
    .await?;
    Ok(savings)
}

/// Link `photos` to `group` unless already linked (M2M `add`), in the
/// given order: link order breaks ties in [`best_photo`].
async fn add_photos(conn: &mut Conn, group: Uuid, photos: &[Uuid]) -> sqlx::Result<u64> {
    let mut seen = HashSet::new();
    let photos: Vec<Uuid> = photos.iter().copied().filter(|p| seen.insert(*p)).collect();
    Ok(crate::sql::query(
        "INSERT INTO api_photo_duplicates (photo_id, duplicate_id) \
         SELECT u.id, $1::uuid FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, n) \
         WHERE NOT EXISTS (SELECT 1 FROM api_photo_duplicates x WHERE x.duplicate_id = $1 AND x.photo_id = u.id) \
         ORDER BY u.n",
    )
    .bind(group)
    .bind(&photos)
    .execute(conn)
    .await?
    .rows_affected())
}

/// `photos` in the order Django's `Photo.objects.filter(id__in=photos)`
/// yields them, which is the order `create_or_merge` links them in. The
/// planner decides it (primary key order for a few ids, heap order from a
/// bitmap scan for more), so the statement is shaped like Django's and
/// planned with the actual ids (unnamed statement), as Django's inlined
/// `IN (...)` list is.
async fn django_order(conn: &mut Conn, photos: &[Uuid]) -> sqlx::Result<Vec<Uuid>> {
    let rows =
        crate::sql::query("SELECT p.id AS lp_order_id, p.* FROM api_photo p WHERE p.id = ANY($1)")
            .bind(photos)
            .persistent(false)
            .fetch_all(conn)
            .await?;
    let mut ordered: Vec<Uuid> = rows.iter().map(|r| r.get(0)).collect();
    // Photos without a row keep a place at the end (they link and fail the
    // foreign key check at commit, as in Django).
    let known: HashSet<Uuid> = ordered.iter().copied().collect();
    ordered.extend(photos.iter().filter(|p| !known.contains(p)));
    Ok(ordered)
}

/// Whether [`django_order`]'s statement for `photos` is an index scan
/// (primary key order) rather than a bitmap or sequential scan (heap order).
async fn in_list_is_index_scan(conn: &mut Conn, photos: &[Uuid]) -> sqlx::Result<bool> {
    let plan: serde_json::Value = crate::sql::query_scalar(
        "EXPLAIN (FORMAT JSON) SELECT p.id AS lp_order_id, p.* FROM api_photo p WHERE p.id = ANY($1)",
    )
    .bind(photos)
    .persistent(false)
    .fetch_one(conn)
    .await?;
    Ok(plan[0]["Plan"]["Node Type"] == "Index Scan")
}

/// `Duplicate.create_or_merge` for 2+ photos: returns the group.
pub async fn create_or_merge(
    conn: &mut Conn,
    owner: i32,
    duplicate_type: &str,
    photos: &[Uuid],
    similarity_score: Option<f64>,
) -> sqlx::Result<Option<Uuid>> {
    if photos.len() < 2 {
        return Ok(None);
    }
    let photos = &django_order(conn, photos).await?;
    let existing: Vec<Uuid> = crate::sql::query_scalar(
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
        crate::sql::query(
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
        let moved: Vec<Uuid> = crate::sql::query_scalar(
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

/// [`create_or_merge`] over disjoint groups (union-find output) with the
/// same result as calling it once per group in order, in a fixed number of
/// statements: only groups sharing a photo with an existing group of this
/// type take the one-by-one merge path; every other group is new and cannot
/// meet another, so they are inserted and priced together. Returns how many
/// groups were created or merged into.
pub async fn create_or_merge_many(
    conn: &mut Conn,
    owner: i32,
    duplicate_type: &str,
    groups: &[Vec<Uuid>],
) -> sqlx::Result<usize> {
    let groups: Vec<&Vec<Uuid>> = groups.iter().filter(|g| g.len() >= 2).collect();
    if groups.is_empty() {
        return Ok(0);
    }
    let all: Vec<Uuid> = groups.iter().flat_map(|g| g.iter().copied()).collect();
    let grouped: HashSet<Uuid> = crate::sql::query_scalar::<_, Uuid>(
        "SELECT DISTINCT x.photo_id FROM api_photo_duplicates x \
         JOIN api_duplicate d ON d.id = x.duplicate_id \
         WHERE d.owner_id = $1 AND d.duplicate_type = $2 AND x.photo_id = ANY($3)",
    )
    .bind(owner)
    .bind(duplicate_type)
    .bind(&all)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .collect();
    let (merging, fresh): (Vec<&Vec<Uuid>>, Vec<&Vec<Uuid>>) = groups
        .into_iter()
        .partition(|g| g.iter().any(|p| grouped.contains(p)));
    let mut done = 0;
    for g in merging {
        if create_or_merge(conn, owner, duplicate_type, g, None)
            .await?
            .is_some()
        {
            done += 1;
        }
    }
    if fresh.is_empty() {
        return Ok(done);
    }
    let ids: Vec<Uuid> = fresh.iter().map(|_| Uuid::new_v4()).collect();
    // One microsecond apart, so the list (newest first) shows them in
    // reverse creation order like Django's one-by-one creates.
    crate::sql::query(
        "INSERT INTO api_duplicate (id, duplicate_type, review_status, created_at, updated_at, \
           reviewed_at, similarity_score, potential_savings, trashed_count, note, kept_photo_id, owner_id) \
         SELECT g.id, $2, 'pending', now() + g.n * interval '1 microsecond', \
           now() + g.n * interval '1 microsecond', NULL, NULL, 0, 0, NULL, NULL, $3 \
         FROM unnest($1::uuid[]) WITH ORDINALITY AS g(id, n) ORDER BY g.n",
    )
    .bind(&ids)
    .bind(duplicate_type)
    .bind(owner)
    .execute(&mut *conn)
    .await?;
    let mut members: Vec<Vec<Uuid>> = fresh
        .iter()
        .map(|g| {
            let mut m = g.to_vec();
            m.sort_unstable();
            m.dedup();
            m
        })
        .collect();
    // Link order only matters where several photos tie for the suggested
    // one; those groups get Django's order (see `django_order`). Its plan
    // depends on the number of ids alone: primary key order from an index
    // scan, else heap order.
    let tied = tied_groups(conn, duplicate_type, &members).await?;
    let mut heap_order = Vec::new();
    let mut plan_by_size: std::collections::HashMap<usize, bool> = Default::default();
    for n in tied {
        let k = members[n].len();
        let index_order = match plan_by_size.get(&k) {
            Some(&b) => b,
            None => {
                let b = in_list_is_index_scan(conn, &members[n]).await?;
                plan_by_size.insert(k, b);
                b
            }
        };
        if !index_order {
            heap_order.push(n);
        }
    }
    if !heap_order.is_empty() {
        let (pos, photo): (Vec<i32>, Vec<Uuid>) = heap_order
            .iter()
            .flat_map(|&n| members[n].iter().map(move |&p| (n as i32, p)))
            .unzip();
        let rows: Vec<(i32, DjUuid)> = crate::sql::query_as(
            "SELECT l.n, p.id FROM unnest($1::int4[], $2::uuid[]) AS l(n, photo_id) \
             JOIN api_photo p ON p.id = l.photo_id ORDER BY l.n, p.ctid",
        )
        .bind(&pos)
        .bind(&photo)
        .fetch_all(&mut *conn)
        .await?;
        for &n in &heap_order {
            members[n].clear();
        }
        for (n, p) in rows {
            members[n as usize].push(p.0);
        }
    }
    let (link_dup, link_photo): (Vec<Uuid>, Vec<Uuid>) = members
        .into_iter()
        .zip(&ids)
        .flat_map(|(m, &id)| m.into_iter().map(move |p| (id, p)))
        .unzip();
    crate::sql::query(
        "INSERT INTO api_photo_duplicates (photo_id, duplicate_id) \
         SELECT l.photo_id, l.dup FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS l(dup, photo_id, n) \
         ORDER BY l.n",
    )
    .bind(&link_dup)
    .bind(&link_photo)
    .execute(&mut *conn)
    .await?;
    let (best_join, best_key) = best_key(duplicate_type);
    let best_order = format!("{best_key}, x.id");
    crate::sql::query(format!(
        "UPDATE api_duplicate d SET potential_savings = s.savings, updated_at = now() \
         FROM (SELECT b.id, COALESCE((SELECT sum(p.size) FROM api_photo_duplicates x \
                 JOIN api_photo p ON p.id = x.photo_id \
                 WHERE x.duplicate_id = b.id AND p.id <> b.best), 0)::bigint AS savings \
               FROM (SELECT g.id, (SELECT p.id FROM api_photo p \
                       JOIN api_photo_duplicates x ON x.photo_id = p.id {best_join} \
                       WHERE x.duplicate_id = g.id ORDER BY {best_order} LIMIT 1) AS best \
                     FROM unnest($1::uuid[]) AS g(id)) b) s \
         WHERE d.id = s.id"
    ))
    .bind(&ids)
    .execute(&mut *conn)
    .await?;
    Ok(done + ids.len())
}

/// `(join, key)` of `auto_select_best_photo` for a group type, over the
/// photo alias `p`: exact copies keep the shortest main file path, visual
/// duplicates the largest resolution (DESC puts NULLs first, like Django's
/// `.last()` of the ascending order).
fn best_key(duplicate_type: &str) -> (&'static str, &'static str) {
    if duplicate_type == EXACT_COPY {
        (
            "LEFT JOIN api_file mf ON mf.hash = p.main_file_id",
            "length(mf.path) ASC",
        )
    } else {
        (
            "LEFT JOIN api_photometadata m ON m.photo_id = p.id",
            "(m.width * m.height) DESC",
        )
    }
}

/// Positions of the groups where two or more photos share the best key.
async fn tied_groups(
    conn: &mut Conn,
    duplicate_type: &str,
    groups: &[Vec<Uuid>],
) -> sqlx::Result<Vec<usize>> {
    let (join, key) = best_key(duplicate_type);
    let (pos, photo): (Vec<i32>, Vec<Uuid>) = groups
        .iter()
        .enumerate()
        .flat_map(|(n, g)| g.iter().map(move |&p| (n as i32, p)))
        .unzip();
    let tied: Vec<i32> = crate::sql::query_scalar(format!(
        "SELECT r.n FROM (SELECT l.n, rank() OVER (PARTITION BY l.n ORDER BY {key}) AS r \
           FROM unnest($1::int4[], $2::uuid[]) AS l(n, photo_id) \
           JOIN api_photo p ON p.id = l.photo_id {join}) r \
         WHERE r.r = 1 GROUP BY r.n HAVING count(*) > 1 ORDER BY r.n"
    ))
    .bind(&pos)
    .bind(&photo)
    .fetch_all(&mut *conn)
    .await?;
    Ok(tied.into_iter().map(|n| n as usize).collect())
}

/// `clear_pending`: delete the user's pending groups.
pub async fn clear_pending(conn: &mut Conn, owner: i32) -> sqlx::Result<usize> {
    let ids: Vec<Uuid> = crate::sql::query_scalar(
        "SELECT id FROM api_duplicate WHERE owner_id = $1 AND review_status = 'pending'",
    )
    .bind(owner)
    .fetch_all(&mut *conn)
    .await?;
    delete_groups(conn, &ids).await?;
    Ok(ids.len())
}

//! `Tag` writes. Every photo-link change (`tag.photos.add/remove`, forward,
//! with at least one photo) runs Django's `m2m_changed` receivers: the
//! recount (S2) and the mobile-sync bump of the tag's `last_modified`
//! (`api/sync_signals.py`, live since its receivers are connected with
//! strong references). A deleted tag leaves a `DeletionLog` tombstone for
//! its owner.

use super::PhotoSelection;
use crate::albums_tags::tags::TagRow;
use crate::db::{Conn, Db, Qb};
use crate::write::deletion_log;

pub async fn create(db: &Db, owner_id: i32, name: &str) -> sqlx::Result<TagRow> {
    crate::sql::query_as(
        "INSERT INTO api_tag (name, photo_count, owner_id, last_modified) \
         VALUES ($1, 0, $2, now()) RETURNING id, name, photo_count",
    )
    .bind(name)
    .bind(owner_id)
    .fetch_one(db)
    .await
}

pub async fn rename(db: &Db, tag_id: i32, name: Option<&str>) -> sqlx::Result<TagRow> {
    crate::sql::query_as(
        "UPDATE api_tag SET name = COALESCE($2, name), last_modified = now() WHERE id = $1 \
         RETURNING id, name, photo_count",
    )
    .bind(tag_id)
    .bind(name)
    .fetch_one(db)
    .await
}

async fn delete_in(conn: &mut Conn, tag_id: i32) -> sqlx::Result<()> {
    deletion_log::tags_deleted(conn, &[tag_id]).await?;
    crate::sql::query("DELETE FROM api_tag_photos WHERE tag_id = $1")
        .bind(tag_id)
        .execute(&mut *conn)
        .await?;
    crate::sql::query("DELETE FROM api_tag WHERE id = $1")
        .bind(tag_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

pub async fn delete(db: &Db, tag_id: i32) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    delete_in(&mut tx, tag_id).await?;
    tx.commit().await
}

/// The `post_add` / `post_remove` receivers: visible-photo count
/// (`save(update_fields=["photo_count"])`) and the sync bump
/// (`save(update_fields=["last_modified"])`).
async fn after_link_change(conn: &mut Conn, tag_id: i32) -> sqlx::Result<TagRow> {
    crate::sql::query_as(
        "UPDATE api_tag t SET photo_count = (SELECT count(*) FROM api_tag_photos tp \
           JOIN api_photo p ON p.id = tp.photo_id \
           WHERE tp.tag_id = t.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), \
           last_modified = now() \
         WHERE t.id = $1 RETURNING id, name, photo_count",
    )
    .bind(tag_id)
    .fetch_one(conn)
    .await
}

async fn current(conn: &mut Conn, tag_id: i32) -> sqlx::Result<TagRow> {
    crate::sql::query_as("SELECT id, name, photo_count FROM api_tag WHERE id = $1")
        .bind(tag_id)
        .fetch_one(conn)
        .await
}

/// Number of photos in the selection (the receivers' "anything to add or
/// remove" test).
async fn selection_len(conn: &mut Conn, sel: &PhotoSelection) -> sqlx::Result<i64> {
    if let PhotoSelection::Ids(ids) = sel {
        return Ok(ids.len() as i64);
    }
    let mut qb = Qb::new("SELECT count(*) FROM (");
    sel.push_ids_query(&mut qb);
    qb.push(") sel");
    qb.build_query_scalar().fetch_one(conn).await
}

/// `tag.photos.add(...)`. The receivers only run when the selection is not
/// empty (Django never calls `add()` with nothing). Two statements in one
/// transaction: SQLite has no DML inside a CTE.
pub async fn add_photos(db: &Db, tag_id: i32, sel: &PhotoSelection) -> sqlx::Result<TagRow> {
    let mut tx = db.begin().await?;
    let n = selection_len(&mut tx, sel).await?;
    if n > 0 {
        let mut qb = Qb::new("INSERT INTO api_tag_photos (tag_id, photo_id) SELECT ");
        qb.push_bind(tag_id);
        qb.push(", sel.id FROM (");
        sel.push_ids_query(&mut qb);
        // `WHERE true`: SQLite would read `ON` as a join constraint.
        qb.push(") sel WHERE true ON CONFLICT DO NOTHING");
        qb.build().execute(&mut *tx).await?;
    }
    let row = if n > 0 {
        after_link_change(&mut tx, tag_id).await?
    } else {
        current(&mut tx, tag_id).await?
    };
    tx.commit().await?;
    Ok(row)
}

/// `tag.photos.remove(...)`.
pub async fn remove_photos(db: &Db, tag_id: i32, sel: &PhotoSelection) -> sqlx::Result<TagRow> {
    let mut tx = db.begin().await?;
    let n = selection_len(&mut tx, sel).await?;
    if n > 0 {
        let mut qb = Qb::new("DELETE FROM api_tag_photos WHERE tag_id = ");
        qb.push_bind(tag_id);
        qb.push(" AND photo_id IN (");
        sel.push_ids_query(&mut qb);
        qb.push(")");
        qb.build().execute(&mut *tx).await?;
    }
    let row = if n > 0 {
        after_link_change(&mut tx, tag_id).await?
    } else {
        current(&mut tx, tag_id).await?
    };
    tx.commit().await?;
    Ok(row)
}

/// `TagViewSet.merge`: `source`'s photos move to `target`, `source` goes.
pub async fn merge(db: &Db, target_id: i32, source_id: i32) -> sqlx::Result<TagRow> {
    let mut tx = db.begin().await?;
    crate::sql::query(
        "INSERT INTO api_tag_photos (tag_id, photo_id) \
         SELECT $1, photo_id FROM api_tag_photos WHERE tag_id = $2 \
         ON CONFLICT DO NOTHING",
    )
    .bind(target_id)
    .bind(source_id)
    .execute(&mut *tx)
    .await?;
    let had_photos: bool =
        crate::sql::query_scalar("SELECT EXISTS (SELECT 1 FROM api_tag_photos WHERE tag_id = $1)")
            .bind(source_id)
            .fetch_one(&mut *tx)
            .await?;
    let row = if had_photos {
        after_link_change(&mut tx, target_id).await?
    } else {
        current(&mut tx, target_id).await?
    };
    delete_in(&mut tx, source_id).await?;
    tx.commit().await?;
    Ok(row)
}

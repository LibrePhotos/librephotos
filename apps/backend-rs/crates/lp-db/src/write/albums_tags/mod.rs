//! Write services for the `albums_tags` area. Conventions: see `lp_db::write`.
//!
//! Side effects kept from Django's signals (02 §5):
//! * S1 [`refresh_album_things`]: `AlbumThing.photo_count` (non-hidden) and
//!   the cover top-up to 4.
//! * S2 [`refresh_tag_photo_counts`] / the tag services: `Tag.photo_count`
//!   over visible photos.
//! * S14: `last_modified` (and `AlbumUser.created_on`, which is `auto_now`)
//!   bumped wherever Django saves the row, and on every photo-link change
//!   (`api/sync_signals.py` `m2m_changed`): user / auto / thing / place
//!   albums save after their link changes anyway; tags bump in
//!   `tags::after_link_change`.
//! * S17: album share slugs (12 hex, `-N` on a clash).
//! * Mobile sync (`write::deletion_log`): album and tag deletes leave
//!   `DeletionLog` tombstones (owner + recipients), removing a recipient
//!   leaves one for that user, adding one clears its stale tombstone.

use uuid::Uuid;

use crate::db::{Conn, Qb};
use crate::scope::{self, PhotoFilterParams};

pub mod auto_albums;
pub mod tags;
pub mod user_albums;

/// Photos a bulk request names: explicit (already owner-validated) ids, or
/// a select-all query over the requester's own photos.
#[derive(Debug, Clone)]
pub enum PhotoSelection {
    Ids(Vec<Uuid>),
    SelectAll {
        owner_id: i32,
        favorite_min_rating: i32,
        params: PhotoFilterParams,
        excluded_hashes: Vec<String>,
    },
}

impl PhotoSelection {
    /// `SELECT p.id FROM api_photo p WHERE ...` for this selection.
    pub(crate) fn push_ids_query(&self, qb: &mut Qb<'_>) {
        match self {
            PhotoSelection::Ids(ids) => {
                qb.push("SELECT sel.id FROM unnest(");
                qb.push_bind(ids.clone());
                qb.push("::uuid[]) AS sel(id)");
            }
            PhotoSelection::SelectAll {
                owner_id,
                favorite_min_rating,
                params,
                excluded_hashes,
            } => {
                qb.push("SELECT p.id FROM api_photo p WHERE ");
                scope::photo_filters(qb, "p", *owner_id, *favorite_min_rating, params);
                if !excluded_hashes.is_empty() {
                    qb.push(" AND NOT (p.image_hash = ANY(");
                    qb.push_bind(excluded_hashes.clone());
                    qb.push("))");
                }
            }
        }
    }
}

/// The selection's photo ids (for services that need them in memory).
pub async fn selection_ids(conn: &mut Conn, selection: &PhotoSelection) -> sqlx::Result<Vec<Uuid>> {
    if let PhotoSelection::Ids(ids) = selection {
        return Ok(ids.clone());
    }
    let mut qb = Qb::new("");
    selection.push_ids_query(&mut qb);
    qb.build_query_scalar().fetch_all(conn).await
}

/// S2, set-based (`refresh_tag_photo_counts`): recount visible photos of
/// `tag_ids` without touching `last_modified` (Django uses `.update()`).
pub async fn refresh_tag_photo_counts(conn: &mut Conn, tag_ids: &[i32]) -> sqlx::Result<u64> {
    if tag_ids.is_empty() {
        return Ok(0);
    }
    Ok(crate::sql::query(
        "UPDATE api_tag t SET photo_count = (SELECT count(*) FROM api_tag_photos tp \
           JOIN api_photo p ON p.id = tp.photo_id \
           WHERE tp.tag_id = t.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed) \
         WHERE t.id = ANY($1)",
    )
    .bind(tag_ids)
    .execute(conn)
    .await?
    .rows_affected())
}

/// Ids of the tags holding any of `photo_ids` (snapshot before a delete).
pub async fn tag_ids_for_photos(conn: &mut Conn, photo_ids: &[Uuid]) -> sqlx::Result<Vec<i32>> {
    crate::sql::query_scalar("SELECT DISTINCT tag_id FROM api_tag_photos WHERE photo_id = ANY($1)")
        .bind(photo_ids)
        .fetch_all(conn)
        .await
}

/// S1 (`AlbumThing` m2m receiver + `update_default_cover_photo`): recount
/// non-hidden photos and top the covers up to 4 with non-hidden members.
pub async fn refresh_album_things(conn: &mut Conn, album_ids: &[i32]) -> sqlx::Result<()> {
    if album_ids.is_empty() {
        return Ok(());
    }
    crate::sql::query(
        "UPDATE api_albumthing t SET photo_count = (SELECT count(*) FROM api_albumthing_photos l \
           JOIN api_photo p ON p.id = l.photo_id WHERE l.albumthing_id = t.id AND NOT p.hidden) \
         WHERE t.id = ANY($1)",
    )
    .bind(album_ids)
    .execute(&mut *conn)
    .await?;
    crate::sql::query(
        "INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id) \
         SELECT c.albumthing_id, c.photo_id FROM ( \
           SELECT l.albumthing_id, l.photo_id, \
             row_number() OVER (PARTITION BY l.albumthing_id ORDER BY l.id) AS rn, \
             (SELECT count(*) FROM api_albumthing_cover_photos cc \
                WHERE cc.albumthing_id = l.albumthing_id) AS have \
           FROM api_albumthing_photos l JOIN api_photo p ON p.id = l.photo_id \
           WHERE l.albumthing_id = ANY($1) AND NOT p.hidden \
             AND NOT EXISTS (SELECT 1 FROM api_albumthing_cover_photos cc \
               WHERE cc.albumthing_id = l.albumthing_id AND cc.photo_id = l.photo_id)) c \
         WHERE c.rn <= 4 - c.have",
    )
    .bind(album_ids)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

//! `/photosedit/share/` (direct user shares) and `/photo/share` (public
//! photo links, S17).

use base64::Engine;
use rand::RngCore;
use uuid::Uuid;

use super::bulk::{Selection, push_select_all};
use crate::db::{Conn, Qb};
use crate::photo_edits::ShareRow;
use crate::write::deletion_log;

/// `SetPhotosShared`: add or remove `target_user_id` on the requester's
/// photos. Returns the count Django reports (rows created / deleted).
pub async fn set_shared(
    conn: &mut Conn,
    user_id: i32,
    favorite_min_rating: i32,
    selection: &Selection,
    target_user_id: i32,
    shared: bool,
) -> sqlx::Result<u64> {
    let mut qb = Qb::new("SELECT p.id FROM api_photo p WHERE p.owner_id = ");
    qb.push_bind(user_id);
    qb.push(" AND p.image_hash IN (");
    match selection {
        Selection::Hashes(hashes) => {
            qb.push("SELECT unnest(");
            qb.push_bind(hashes.clone());
            qb.push(")");
        }
        Selection::SelectAll {
            params,
            excluded_hashes,
        } => {
            qb.push("SELECT p.image_hash FROM api_photo p WHERE ");
            push_select_all(
                &mut qb,
                user_id,
                favorite_min_rating,
                params,
                excluded_hashes,
            );
        }
    }
    qb.push(")");
    let ids: Vec<Uuid> = qb.build_query_scalar().fetch_all(&mut *conn).await?;

    if shared {
        let created: Vec<Uuid> = crate::sql::query_scalar(
            "INSERT INTO api_photo_shared_to (photo_id, user_id) \
             SELECT x, $2 FROM unnest($1::uuid[]) x \
             WHERE NOT EXISTS (SELECT 1 FROM api_photo_shared_to s WHERE s.photo_id = x AND s.user_id = $2) \
             RETURNING photo_id",
        )
        .bind(&ids)
        .bind(target_user_id)
        .fetch_all(&mut *conn)
        .await?;
        bump(conn, &created).await?;
        // A re-shared photo must not be shadowed by the recipient's stale
        // tombstone on the next pull.
        deletion_log::clear(
            conn,
            deletion_log::entity::PHOTO,
            &deletion_log::uuid_ids(&created),
            &[target_user_id],
        )
        .await?;
        Ok(created.len() as u64)
    } else {
        let n = crate::sql::query(
            "DELETE FROM api_photo_shared_to WHERE user_id = $1 AND photo_id = ANY($2)",
        )
        .bind(target_user_id)
        .bind(&ids)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        bump(conn, &ids).await?;
        // Visibility loss: one tombstone per selected photo for the
        // recipient, shared or not (Django's `bulk_create`).
        deletion_log::photos_unshared_bulk(conn, &ids, target_user_id).await?;
        Ok(n)
    }
}

async fn bump(conn: &mut Conn, ids: &[Uuid]) -> sqlx::Result<()> {
    if !ids.is_empty() {
        crate::sql::query("UPDATE api_photo SET last_modified = now() WHERE id = ANY($1)")
            .bind(ids)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// `secrets.token_urlsafe(9)`: 12 URL-safe characters.
pub fn token_urlsafe_9() -> String {
    let mut bytes = [0u8; 9];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

async fn fresh_slug(conn: &mut Conn) -> sqlx::Result<String> {
    loop {
        let candidate = token_urlsafe_9();
        let taken: bool = crate::sql::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM api_photoshare WHERE slug = $1)",
        )
        .bind(&candidate)
        .fetch_one(&mut *conn)
        .await?;
        if !taken {
            return Ok(candidate);
        }
    }
}

const SHARE_RETURNING: &str = "RETURNING id, enabled, slug, created_at, photo_id, \
    (SELECT image_hash FROM api_photo WHERE id = photo_id) AS image_hash";

/// `SetPhotoShare` `enable` (`rotate = false`) or `rotate`: the share exists,
/// is enabled and has a slug; `rotate` always mints a new one.
pub async fn enable_share(conn: &mut Conn, photo_id: Uuid, rotate: bool) -> sqlx::Result<ShareRow> {
    let existing: Option<(i32, bool, Option<String>)> = crate::sql::query_as(
        "SELECT id, enabled, slug FROM api_photoshare WHERE photo_id = $1 FOR UPDATE",
    )
    .bind(photo_id)
    .fetch_optional(&mut *conn)
    .await?;
    match existing {
        None => {
            let slug = fresh_slug(conn).await?;
            crate::sql::query_as::<_, ShareRow>(&format!(
                "INSERT INTO api_photoshare (enabled, slug, created_at, photo_id) \
                 VALUES (TRUE, $1, now(), $2) {SHARE_RETURNING}"
            ))
            .bind(slug)
            .bind(photo_id)
            .fetch_one(&mut *conn)
            .await
        }
        Some((id, _, slug)) => {
            let slug = match slug {
                Some(s) if !rotate => s,
                _ => fresh_slug(conn).await?,
            };
            crate::sql::query_as::<_, ShareRow>(&format!(
                "UPDATE api_photoshare SET enabled = TRUE, slug = $1 WHERE id = $2 {SHARE_RETURNING}"
            ))
            .bind(slug)
            .bind(id)
            .fetch_one(&mut *conn)
            .await
        }
    }
}

/// `disable`: keep the row, drop the slug, so the next enable mints a new link.
pub async fn disable_share(conn: &mut Conn, photo_id: Uuid) -> sqlx::Result<Option<ShareRow>> {
    crate::sql::query_as::<_, ShareRow>(&format!(
        "UPDATE api_photoshare SET enabled = FALSE, slug = NULL WHERE photo_id = $1 {SHARE_RETURNING}"
    ))
    .bind(photo_id)
    .fetch_optional(&mut *conn)
    .await
}

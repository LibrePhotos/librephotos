//! Write services for the `stats_admin_stacks_dupes` area: photo stacks and
//! duplicate groups. Conventions: see `lp_db::write`.

use sqlx::PgConnection;

pub mod dupes;
pub mod stacks;

/// `refresh_tag_photo_counts` (S2/S20): recount the visible photos of every
/// tag that holds one of `photo_ids` (after changing their visibility).
pub async fn refresh_tags_for_photos(
    conn: &mut PgConnection,
    photo_ids: &[uuid::Uuid],
) -> sqlx::Result<u64> {
    if photo_ids.is_empty() {
        return Ok(0);
    }
    Ok(sqlx::query(
        "UPDATE api_tag t SET photo_count = COALESCE((SELECT count(*) FROM api_tag_photos tp \
           JOIN api_photo p ON p.id = tp.photo_id WHERE tp.tag_id = t.id \
           AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), 0) \
         WHERE t.id IN (SELECT tag_id FROM api_tag_photos WHERE photo_id = ANY($1))",
    )
    .bind(photo_ids)
    .execute(conn)
    .await?
    .rows_affected())
}

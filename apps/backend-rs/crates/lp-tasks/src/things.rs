//! Album memberships the tasks maintain: tagging-model `AlbumThing`s (S1:
//! `photo_count` over non-hidden photos, covers topped up to 4) and
//! `AlbumPlace`s from reverse geocoding.

use sqlx::PgConnection;
use uuid::Uuid;

/// `PhotoCaption._update_tag_album_things`: the photo leaves every
/// `thing_type` album of its owner, then joins one per title (created as
/// needed). Counts and covers of every touched album are recomputed.
pub async fn replace_thing_memberships(
    conn: &mut PgConnection,
    photo_id: Uuid,
    owner_id: i32,
    thing_type: &str,
    titles: &[String],
) -> sqlx::Result<()> {
    let mut titles: Vec<&str> = titles.iter().map(String::as_str).collect();
    titles.sort_unstable();
    titles.dedup();

    sqlx::query(
        "INSERT INTO api_albumthing (title, thing_type, favorited, owner_id, photo_count, last_modified) \
         SELECT t, $2, FALSE, $3, 0, now() FROM unnest($1::text[]) AS t \
         ON CONFLICT (title, thing_type, owner_id) DO NOTHING",
    )
    .bind(&titles)
    .bind(thing_type)
    .bind(owner_id)
    .execute(&mut *conn)
    .await?;

    // Lock every album this change touches, in id order, so concurrent
    // photos recount after each other instead of over stale snapshots.
    let touched: Vec<i32> = sqlx::query_scalar(
        "SELECT a.id FROM api_albumthing a \
         WHERE a.owner_id = $2 AND a.thing_type = $3 \
           AND (a.title = ANY($4) OR EXISTS (SELECT 1 FROM api_albumthing_photos l \
                  WHERE l.albumthing_id = a.id AND l.photo_id = $1)) \
         ORDER BY a.id FOR UPDATE",
    )
    .bind(photo_id)
    .bind(owner_id)
    .bind(thing_type)
    .bind(&titles)
    .fetch_all(&mut *conn)
    .await?;
    if touched.is_empty() {
        return Ok(());
    }

    sqlx::query(
        "DELETE FROM api_albumthing_photos l USING api_albumthing a \
         WHERE l.albumthing_id = a.id AND l.photo_id = $1 AND a.owner_id = $2 AND a.thing_type = $3",
    )
    .bind(photo_id)
    .bind(owner_id)
    .bind(thing_type)
    .execute(&mut *conn)
    .await?;

    sqlx::query(
        "INSERT INTO api_albumthing_photos (albumthing_id, photo_id) \
         SELECT a.id, $1 FROM api_albumthing a \
         WHERE a.owner_id = $2 AND a.thing_type = $3 AND a.title = ANY($4) \
         ORDER BY a.id \
         ON CONFLICT DO NOTHING",
    )
    .bind(photo_id)
    .bind(owner_id)
    .bind(thing_type)
    .bind(&titles)
    .execute(&mut *conn)
    .await?;

    refresh_things(conn, &touched).await
}

/// S1 for `album_ids`: `photo_count` = non-hidden photos, `last_modified`
/// bumped (Django saves the album after each membership change), covers
/// topped up to 4 from its non-hidden photos.
pub async fn refresh_things(conn: &mut PgConnection, album_ids: &[i32]) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE api_albumthing a SET last_modified = now(), photo_count = ( \
           SELECT count(*) FROM api_albumthing_photos l JOIN api_photo p ON p.id = l.photo_id \
           WHERE l.albumthing_id = a.id AND NOT p.hidden) \
         WHERE a.id = ANY($1)",
    )
    .bind(album_ids)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id) \
         SELECT s.albumthing_id, s.photo_id FROM ( \
           SELECT l.albumthing_id, l.photo_id, \
                  row_number() OVER (PARTITION BY l.albumthing_id ORDER BY l.id) AS rn, \
                  (SELECT count(*) FROM api_albumthing_cover_photos c \
                    WHERE c.albumthing_id = l.albumthing_id) AS have \
           FROM api_albumthing_photos l JOIN api_photo p ON p.id = l.photo_id \
           WHERE l.albumthing_id = ANY($1) AND NOT p.hidden \
             AND NOT EXISTS (SELECT 1 FROM api_albumthing_cover_photos c \
                  WHERE c.albumthing_id = l.albumthing_id AND c.photo_id = l.photo_id) \
         ) s WHERE s.rn <= 4 - s.have \
         ON CONFLICT DO NOTHING",
    )
    .bind(album_ids)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Lower-cased `siglip2_tag` album titles per photo (document detection).
pub async fn siglip_labels(
    conn: &mut PgConnection,
    photo_ids: &[Uuid],
) -> sqlx::Result<std::collections::HashMap<Uuid, Vec<String>>> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT l.photo_id, a.title FROM api_albumthing_photos l \
         JOIN api_albumthing a ON a.id = l.albumthing_id \
         WHERE l.photo_id = ANY($1) AND a.thing_type = 'siglip2_tag' AND a.title <> ''",
    )
    .bind(photo_ids)
    .fetch_all(&mut *conn)
    .await?;
    let mut out: std::collections::HashMap<Uuid, Vec<String>> = Default::default();
    for (id, title) in rows {
        out.entry(id).or_default().push(title.to_lowercase());
    }
    Ok(out)
}

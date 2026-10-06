//! `AlbumUser` writes: `AlbumUserEditSerializer` create/update, rename,
//! delete, sharing to users and the public share.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::PhotoSelection;
use super::tombstones as dl;
use crate::db::{Conn, Db, Qb, sql};
use crate::write::deletion_log::{AlbumKind, entity};

/// What an edit request changes (`AlbumUserEditSerializer.update`), in the
/// order Django applies it.
#[derive(Debug, Clone, Default)]
pub struct AlbumEdit {
    pub title: Option<String>,
    /// `removedPhotos`: image hashes to drop from the album.
    pub removed_hashes: Option<Vec<String>>,
    /// `Some(None)` clears the cover.
    pub cover_photo: Option<Option<Uuid>>,
    /// Photos to add (`photos`, or the select-all query).
    pub add: Option<PhotoSelection>,
}

async fn add_photos(conn: &mut Conn, album_id: i32, sel: &PhotoSelection) -> sqlx::Result<()> {
    let mut qb = Qb::new("INSERT INTO api_albumuser_photos (albumuser_id, photo_id) SELECT ");
    qb.push_bind(album_id);
    qb.push(", s.id FROM (");
    sel.push_ids_query(&mut qb);
    // `WHERE true`: SQLite would read `ON` as a join constraint.
    qb.push(") s WHERE true ON CONFLICT DO NOTHING");
    qb.build().execute(conn).await?;
    Ok(())
}

async fn apply(conn: &mut Conn, album_id: i32, edit: &AlbumEdit) -> sqlx::Result<()> {
    if let Some(hashes) = &edit.removed_hashes {
        let d = conn.dialect();
        crate::sql::query(format!(
            "DELETE FROM api_albumuser_photos WHERE albumuser_id = $1 \
               AND photo_id IN (SELECT p.id FROM api_photo p WHERE {})",
            sql::any_sql(d, "p.image_hash", 2)
        ))
        .bind(album_id)
        .bind(hashes)
        .execute(&mut *conn)
        .await?;
    }
    if let Some(sel) = &edit.add {
        add_photos(conn, album_id, sel).await?;
    }
    // instance.save(): auto_now `created_on` and `last_modified`.
    crate::sql::query(
        "UPDATE api_albumuser SET title = COALESCE($2, title), \
           cover_photo_id = CASE WHEN $3 THEN $4 ELSE cover_photo_id END, \
           created_on = now(), last_modified = now() WHERE id = $1",
    )
    .bind(album_id)
    .bind(&edit.title)
    .bind(edit.cover_photo.is_some())
    .bind(edit.cover_photo.flatten())
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// `AlbumUserEditSerializer.create`: `get_or_create(title, owner)`; an
/// existing album goes through the update path. Returns the album id.
pub async fn create(db: &Db, owner_id: i32, title: &str, edit: &AlbumEdit) -> sqlx::Result<i32> {
    let mut tx = db.begin().await?;
    // Look first: an INSERT .. ON CONFLICT would burn an id on every
    // existing title, and ids must stay in step with Django's.
    let existing: Option<i32> =
        crate::sql::query_scalar("SELECT id FROM api_albumuser WHERE title = $1 AND owner_id = $2")
            .bind(title)
            .bind(owner_id)
            .fetch_optional(&mut *tx)
            .await?;
    let id = match existing {
        Some(id) => {
            apply(&mut tx, id, edit).await?;
            id
        }
        None => {
            let id: i32 = crate::sql::query_scalar(
                "INSERT INTO api_albumuser (title, created_on, favorited, owner_id, cover_photo_id, last_modified)                  VALUES ($1, now(), FALSE, $2, NULL, now()) RETURNING id",
            )
            .bind(title)
            .bind(owner_id)
            .fetch_one(&mut *tx)
            .await?;
            // A new album only takes the photos (Django's create ignores the rest).
            if let Some(sel) = &edit.add {
                add_photos(&mut tx, id, sel).await?;
            }
            id
        }
    };
    tx.commit().await?;
    Ok(id)
}

/// `AlbumUserSerializer.create`: a plain `AlbumUser.objects.create` (an
/// existing title is a unique violation, a 500 in Django too).
pub async fn create_empty(db: &Db, owner_id: i32, title: &str) -> sqlx::Result<i32> {
    crate::sql::query_scalar(
        "INSERT INTO api_albumuser (title, created_on, favorited, owner_id, cover_photo_id, last_modified) \
         VALUES ($1, now(), FALSE, $2, NULL, now()) RETURNING id",
    )
    .bind(title)
    .bind(owner_id)
    .fetch_one(db)
    .await
}

/// `AlbumUserEditSerializer.update` on the owner's album.
pub async fn update(db: &Db, album_id: i32, edit: &AlbumEdit) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    apply(&mut tx, album_id, edit).await?;
    tx.commit().await
}

/// `PATCH /albums/user/{id}/` (`AlbumUserSerializer`, only `title` is writable).
pub async fn rename(db: &Db, album_id: i32, title: Option<&str>) -> sqlx::Result<()> {
    crate::sql::query(
        "UPDATE api_albumuser SET title = COALESCE($2, title), created_on = now(), \
           last_modified = now() WHERE id = $1",
    )
    .bind(album_id)
    .bind(title)
    .execute(db)
    .await?;
    Ok(())
}

/// Django's collector for `AlbumUser.delete()`: links, share, the row.
/// Tombstones for the owner and every recipient (`post_delete`) first,
/// while the recipients are still linked.
pub async fn delete(db: &Db, album_id: i32) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    dl::albums_deleted(&mut tx, AlbumKind::User, &[album_id]).await?;
    for sql in [
        "DELETE FROM api_albumuser_photos WHERE albumuser_id = $1",
        "DELETE FROM api_albumuser_shared_to WHERE albumuser_id = $1",
        "DELETE FROM api_albumusershare WHERE album_id = $1",
        "DELETE FROM api_albumuser WHERE id = $1",
    ] {
        crate::sql::query(sql)
            .bind(album_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await
}

/// `SetUserAlbumShared`: add/remove one recipient, then `save()`.
pub async fn set_shared(db: &Db, album_id: i32, user_id: i32, shared: bool) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    let album = [album_id.to_string()];
    if shared {
        // `shared_to.add`: a newly added recipient's stale tombstone goes.
        let added = crate::sql::query(
            "INSERT INTO api_albumuser_shared_to (albumuser_id, user_id) VALUES ($1, $2)              ON CONFLICT DO NOTHING",
        )
        .bind(album_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if added > 0 {
            dl::clear(&mut tx, entity::ALBUM_USER, &album, &[user_id]).await?;
        }
    } else {
        // `shared_to.remove`: a tombstone for the recipient, shared or not.
        crate::sql::query(
            "DELETE FROM api_albumuser_shared_to WHERE albumuser_id = $1 AND user_id = $2",
        )
        .bind(album_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        dl::unshared(&mut tx, entity::ALBUM_USER, &album, &[user_id]).await?;
    }
    crate::sql::query(
        "UPDATE api_albumuser SET created_on = now(), last_modified = now() WHERE id = $1",
    )
    .bind(album_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

pub const SHARING_OPTION_FIELDS: [&str; 5] = [
    "share_location",
    "share_camera_info",
    "share_timestamps",
    "share_captions",
    "share_faces",
];

/// `SetUserAlbumPublic` input, already parsed like Django reads it.
#[derive(Debug, Clone, Default)]
pub struct PublicShareEdit {
    pub enabled: bool,
    /// `Some(x)`: the request carried a slug (`""` means none).
    pub slug: Option<Option<String>>,
    /// `Some(x)`: the request carried a non-null `expires_at` (`parse_datetime`
    /// result, `None` when unparseable).
    pub expires_at: Option<Option<DateTime<Utc>>>,
    /// Overrides present in `sharing_options`, by field index.
    pub options: [Option<Option<bool>>; 5],
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct ShareRow {
    id: i32,
    slug: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    share_location: Option<bool>,
    share_camera_info: Option<bool>,
    share_timestamps: Option<bool>,
    share_captions: Option<bool>,
    share_faces: Option<bool>,
}

/// `AlbumUserShare.get_or_create` + field updates + `save()` (S17 slug).
pub async fn set_public(db: &Db, album_id: i32, edit: &PublicShareEdit) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    let existing: Option<ShareRow> = crate::sql::query_as(format!(
        "SELECT id, slug, expires_at, share_location, share_camera_info, share_timestamps, \
           share_captions, share_faces FROM api_albumusershare WHERE album_id = $1{}",
        sql::for_update(tx.dialect())
    ))
    .bind(album_id)
    .fetch_optional(&mut *tx)
    .await?;
    let mut row = existing.clone().unwrap_or(ShareRow {
        id: 0,
        slug: None,
        expires_at: None,
        share_location: None,
        share_camera_info: None,
        share_timestamps: None,
        share_captions: None,
        share_faces: None,
    });
    if let Some(slug) = &edit.slug {
        row.slug = slug.clone().filter(|s| !s.is_empty());
    }
    if let Some(expires) = edit.expires_at {
        row.expires_at = expires;
    }
    let targets = [
        &mut row.share_location,
        &mut row.share_camera_info,
        &mut row.share_timestamps,
        &mut row.share_captions,
        &mut row.share_faces,
    ];
    for (slot, value) in targets.into_iter().zip(edit.options.iter()) {
        if let Some(v) = value {
            *slot = *v;
        }
    }
    if !edit.enabled {
        row.slug = None;
    }
    if edit.enabled && row.slug.is_none() {
        let base: String = Uuid::new_v4().simple().to_string()[..12].to_string();
        let mut candidate = base.clone();
        let mut idx = 0;
        loop {
            let clash: bool = crate::sql::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM api_albumusershare WHERE slug = $1 AND id <> $2)",
            )
            .bind(&candidate)
            .bind(row.id)
            .fetch_one(&mut *tx)
            .await?;
            if !clash {
                break;
            }
            idx += 1;
            candidate = format!("{base}-{idx}");
        }
        row.slug = Some(candidate);
    }
    let sql = if existing.is_some() {
        "UPDATE api_albumusershare SET enabled = $2, slug = $3, expires_at = $4, share_location = $5, \
           share_camera_info = $6, share_timestamps = $7, share_captions = $8, share_faces = $9 \
         WHERE album_id = $1"
    } else {
        "INSERT INTO api_albumusershare (album_id, enabled, slug, expires_at, share_location, \
           share_camera_info, share_timestamps, share_captions, share_faces) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
    };
    crate::sql::query(sql)
        .bind(album_id)
        .bind(edit.enabled)
        .bind(&row.slug)
        .bind(row.expires_at)
        .bind(row.share_location)
        .bind(row.share_camera_info)
        .bind(row.share_timestamps)
        .bind(row.share_captions)
        .bind(row.share_faces)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

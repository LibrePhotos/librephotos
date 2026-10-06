//! `/photos/shared/tome/` and `/photos/shared/fromme/` (api/views/sharing.py).
//!
//! Both walk `api_photo_shared_to` with a JOIN, like Django: the through
//! table has no unique pair, so a duplicated share is listed twice there too.

use sqlx::FromRow;
use uuid::Uuid;

use crate::db::{Db, DjUuid, Qb};
use crate::pig::{self, PigPhoto};
use crate::scope;
use crate::users::SimpleUser;

pub async fn shared_to_me_count(db: &Db, user_id: i32) -> sqlx::Result<i64> {
    let mut qb = Qb::new(
        "SELECT count(*) FROM api_photo p JOIN api_photo_shared_to st ON st.photo_id = p.id WHERE st.user_id = ",
    );
    qb.push_bind(user_id);
    qb.push(" AND ");
    scope::visible_manager(&mut qb, "p");
    qb.build_query_scalar().fetch_one(db).await
}

/// Visible photos shared directly to `user_id`, oldest first (Django:
/// `order_by("exif_timestamp")`, NULLs last).
pub async fn shared_to_me(
    db: &Db,
    user_id: i32,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<PigPhoto>> {
    let mut qb = pig::query();
    qb.push(" JOIN api_photo_shared_to st ON st.photo_id = p.id WHERE st.user_id = ");
    qb.push_bind(user_id);
    qb.push(" AND ");
    scope::visible_manager(&mut qb, "p");
    qb.push(" ORDER BY p.exif_timestamp ASC, p.id, st.id LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);
    pig::fetch(&mut qb, db).await
}

#[derive(Debug, Clone, FromRow)]
struct FromMeRow {
    user_id: i32,
    username: String,
    first_name: String,
    last_name: String,
    #[sqlx(try_from = "DjUuid")]
    photo_id: Uuid,
}

/// One share of one of the caller's visible photos.
#[derive(Debug, Clone)]
pub struct SharedFromMe {
    pub user: SimpleUser,
    pub photo: PigPhoto,
}

pub async fn shared_from_me_count(db: &Db, user_id: i32) -> sqlx::Result<i64> {
    let mut qb = Qb::new(
        "SELECT count(*) FROM api_photo_shared_to st JOIN api_photo p ON p.id = st.photo_id WHERE ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(" AND ");
    scope::visible_manager(&mut qb, "p");
    qb.build_query_scalar().fetch_one(db).await
}

/// `SharedFromMePhotoThroughSerializer` rows of the caller's visible photos,
/// ordered by the photo's `exif_timestamp`.
pub async fn shared_from_me(
    db: &Db,
    user_id: i32,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<SharedFromMe>> {
    let mut qb = Qb::new(
        "SELECT st.user_id, u.username, u.first_name, u.last_name, st.photo_id \
         FROM api_photo_shared_to st JOIN api_photo p ON p.id = st.photo_id \
         JOIN api_user u ON u.id = st.user_id WHERE ",
    );
    scope::owned_by(&mut qb, "p", user_id);
    qb.push(" AND ");
    scope::visible_manager(&mut qb, "p");
    qb.push(" ORDER BY p.exif_timestamp ASC, p.id, st.id LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);
    let rows: Vec<FromMeRow> = qb.build_query_as().fetch_all(db).await?;

    let mut ids: Vec<Uuid> = rows.iter().map(|r| r.photo_id).collect();
    ids.sort_unstable();
    ids.dedup();
    let photos = pig::by_ids(db, &ids).await?;
    let by_id: std::collections::HashMap<Uuid, PigPhoto> =
        photos.into_iter().map(|p| (p.id, p)).collect();
    let out = rows
        .into_iter()
        .filter_map(|r| {
            by_id.get(&r.photo_id).map(|photo| SharedFromMe {
                user: SimpleUser {
                    id: r.user_id,
                    username: r.username,
                    first_name: r.first_name,
                    last_name: r.last_name,
                },
                photo: photo.clone(),
            })
        })
        .collect();
    Ok(out)
}

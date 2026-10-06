//! `AlbumUser` reads: the list serializer rows (lists, shared from/to me,
//! share responses), the detail header and membership.

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use sqlx::types::Json;
use uuid::Uuid;

use crate::db::{DjList, DjUuid, DjUuidOpt, Exec, Qb};

use super::things_places::{HasTotal, fetch_paged};
use super::{Paged, push_search, simple_user_json};

/// One `AlbumUserListSerializer` row.
#[derive(Debug, Clone, FromRow)]
pub struct UserAlbumListRow {
    pub id: i32,
    pub created_on: DateTime<Utc>,
    pub favorited: bool,
    pub title: String,
    /// `SimpleUser` list (`json`, key order kept).
    pub shared_to: Json<serde_json::Value>,
    pub owner: Json<serde_json::Value>,
    pub photo_count: i64,
    pub cover_image_hash: Option<String>,
    pub cover_rating: Option<i32>,
    pub cover_hidden: Option<bool>,
    pub cover_exif_timestamp: Option<DateTime<Utc>>,
    pub cover_public: Option<bool>,
    pub cover_video: Option<bool>,
    pub share_id: Option<i32>,
    pub share_enabled: Option<bool>,
    pub share_slug: Option<String>,
    pub share_expires_at: Option<DateTime<Utc>>,
    pub share_location: Option<bool>,
    pub share_camera_info: Option<bool>,
    pub share_timestamps: Option<bool>,
    pub share_captions: Option<bool>,
    pub share_faces: Option<bool>,
    #[sqlx(default)]
    pub total_count: Option<i64>,
}

/// Which albums a list shows (and how `photo_count` is computed).
#[derive(Debug, Clone)]
pub enum UserAlbumListKind<'a> {
    /// `/albums/user/list/`: own albums with a non-hidden photo, by title;
    /// `photo_count` counts non-hidden photos.
    Owned { owner_id: i32, search: &'a [String] },
    /// `/albums/user/shared/fromme/`: own albums shared to someone, by id.
    SharedFromMe { owner_id: i32 },
    /// `/albums/user/shared/tome/`: albums shared to the user, by id.
    SharedToMe { user_id: i32 },
    /// A single album (share / make-public responses).
    ById { id: i32 },
}

fn select(qb: &mut Qb<'_>, nonhidden_count: bool, with_total: bool) {
    let hidden = if nonhidden_count {
        " AND NOT cp_p.hidden"
    } else {
        ""
    };
    let total = if with_total {
        ", count(*) OVER () AS total_count"
    } else {
        ""
    };
    qb.push(format!(
        "SELECT a.id, a.created_on, a.favorited, a.title,            (SELECT COALESCE(json_agg({st} ORDER BY st_l.id), '[]'::json)               FROM api_albumuser_shared_to st_l JOIN api_user st ON st.id = st_l.user_id               WHERE st_l.albumuser_id = a.id) AS shared_to,            {ow} AS owner,            (SELECT count(DISTINCT cp_p.id) FROM api_albumuser_photos cp_l               JOIN api_photo cp_p ON cp_p.id = cp_l.photo_id               WHERE cp_l.albumuser_id = a.id{hidden}) AS photo_count,            c.image_hash AS cover_image_hash, c.rating AS cover_rating, c.hidden AS cover_hidden,            c.exif_timestamp AS cover_exif_timestamp, c.public AS cover_public, c.video AS cover_video,            s.id AS share_id, s.enabled AS share_enabled, s.slug AS share_slug,            s.expires_at AS share_expires_at, s.share_location, s.share_camera_info,            s.share_timestamps, s.share_captions, s.share_faces{total}          FROM api_albumuser a          JOIN api_user ow ON ow.id = a.owner_id          LEFT JOIN api_albumusershare s ON s.album_id = a.id          LEFT JOIN api_photo c ON c.id = COALESCE(a.cover_photo_id,            (SELECT fl.photo_id FROM api_albumuser_photos fl              WHERE fl.albumuser_id = a.id AND fl.photo_id IS NOT NULL              ORDER BY fl.photo_id LIMIT 1))",
        st = simple_user_json("st"),
        ow = simple_user_json("ow"),
    ));
}

fn build<'a>(kind: &UserAlbumListKind<'a>, limit: i64, offset: i64) -> Qb<'a> {
    let mut qb = Qb::new("");
    match kind {
        UserAlbumListKind::Owned { owner_id, search } => {
            // The window must count only albums that survive photo_count > 0.
            qb.push("SELECT *, count(*) OVER () AS total_count FROM (");
            select(&mut qb, true, false);
            qb.push(" WHERE a.owner_id = ");
            qb.push_bind(*owner_id);
            push_search(&mut qb, &["a.title"], search);
            qb.push(") x WHERE x.photo_count > 0 ORDER BY x.title, x.id");
        }
        UserAlbumListKind::SharedFromMe { owner_id } => {
            select(&mut qb, false, true);
            qb.push(" WHERE a.owner_id = ");
            qb.push_bind(*owner_id);
            qb.push(
                " AND EXISTS (SELECT 1 FROM api_albumuser_shared_to x WHERE x.albumuser_id = a.id)                  ORDER BY a.id",
            );
        }
        UserAlbumListKind::SharedToMe { user_id } => {
            select(&mut qb, false, true);
            qb.push(
                " WHERE EXISTS (SELECT 1 FROM api_albumuser_shared_to x                    WHERE x.albumuser_id = a.id AND x.user_id = ",
            );
            qb.push_bind(*user_id);
            qb.push(") ORDER BY a.id");
        }
        UserAlbumListKind::ById { id } => {
            select(&mut qb, false, false);
            qb.push(" WHERE a.id = ");
            qb.push_bind(*id);
        }
    }
    qb.push(" LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);
    qb
}

pub async fn list<'e, E>(
    db: E,
    kind: UserAlbumListKind<'_>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<UserAlbumListRow>>
where
    E: Exec<'e> + Copy,
{
    let rows: Vec<UserAlbumListRow> = build(&kind, limit, offset)
        .build_query_as()
        .fetch_all(db)
        .await?;
    let total = match rows.first() {
        Some(r) => r.total_count.unwrap_or(rows.len() as i64),
        // Past the last page: count once more to tell "empty" from "invalid page".
        None if offset > 0 => {
            let first: Vec<UserAlbumListRow> =
                build(&kind, 1, 0).build_query_as().fetch_all(db).await?;
            first.first().and_then(|r| r.total_count).unwrap_or(0)
        }
        None => 0,
    };
    Ok(Paged { rows, total })
}

pub async fn by_id<'e>(db: impl Exec<'e>, id: i32) -> sqlx::Result<Option<UserAlbumListRow>> {
    build(&UserAlbumListKind::ById { id }, 1, 0)
        .build_query_as()
        .fetch_optional(db)
        .await
}

/// Header of `AlbumUserSerializer` / `AlbumUserPublicSerializer`.
#[derive(Debug, Clone, FromRow)]
pub struct UserAlbumDetailRow {
    pub id: i32,
    pub title: String,
    pub owner_id: i32,
    pub owner: Json<serde_json::Value>,
    pub owner_sharing_defaults: serde_json::Value,
    pub shared_to: Json<serde_json::Value>,
    pub share_id: Option<i32>,
    pub share_enabled: Option<bool>,
    pub share_slug: Option<String>,
    pub share_expires_at: Option<DateTime<Utc>>,
    pub share_location: Option<bool>,
    pub share_camera_info: Option<bool>,
    pub share_timestamps: Option<bool>,
    pub share_captions: Option<bool>,
    pub share_faces: Option<bool>,
    /// "The first photo" of the unordered membership with a timestamp / a
    /// search location. Django iterates `obj.photos.all()`, which Postgres
    /// answers in heap order, hence `ctid` order.
    pub first_timestamp: Option<DateTime<Utc>>,
    pub first_location: Option<String>,
    #[sqlx(default)]
    pub total_count: Option<i64>,
}

/// Who may open the album detail.
#[derive(Debug, Clone, Copy)]
pub enum DetailScope<'a> {
    /// Owner, or (read-only) a user it is shared to.
    Visible { user_id: i32, write: bool },
    /// `?public=`: an enabled, unexpired public share (optionally of `username`).
    Public { username: Option<&'a str> },
}

/// `SELECT` of [`UserAlbumDetailRow`] up to `WHERE `.
fn detail_select<'a>() -> Qb<'a> {
    Qb::new(format!(
        "SELECT a.id, a.title, a.owner_id, {ow} AS owner, ow.public_sharing_defaults AS owner_sharing_defaults, \
           (SELECT COALESCE(json_agg({st} ORDER BY st_l.id), '[]'::json) \
              FROM api_albumuser_shared_to st_l JOIN api_user st ON st.id = st_l.user_id \
              WHERE st_l.albumuser_id = a.id) AS shared_to, \
           s.id AS share_id, s.enabled AS share_enabled, s.slug AS share_slug, \
           s.expires_at AS share_expires_at, s.share_location, s.share_camera_info, \
           s.share_timestamps, s.share_captions, s.share_faces, \
           (SELECT p.exif_timestamp FROM api_albumuser_photos l JOIN api_photo p ON p.id = l.photo_id \
              WHERE l.albumuser_id = a.id AND p.exif_timestamp IS NOT NULL ORDER BY p.ctid LIMIT 1) AS first_timestamp, \
           (SELECT ps.search_location FROM api_albumuser_photos l JOIN api_photo p ON p.id = l.photo_id \
              JOIN api_photo_search ps ON ps.photo_id = p.id \
              WHERE l.albumuser_id = a.id AND ps.search_location IS NOT NULL AND ps.search_location <> '' \
              ORDER BY p.ctid LIMIT 1) AS first_location, \
           count(*) OVER () AS total_count \
         FROM api_albumuser a \
         JOIN api_user ow ON ow.id = a.owner_id \
         LEFT JOIN api_albumusershare s ON s.album_id = a.id \
         WHERE ",
        ow = simple_user_json("ow"),
        st = simple_user_json("st"),
    ))
}

/// ` AND <scope>` over album `a`, share `s` and owner `ow`.
fn push_detail_scope(qb: &mut Qb<'_>, scope: DetailScope<'_>) {
    match scope {
        DetailScope::Visible { user_id, write } => {
            qb.push(" AND (a.owner_id = ");
            qb.push_bind(user_id);
            if !write {
                qb.push(
                    " OR EXISTS (SELECT 1 FROM api_albumuser_shared_to x \
                       WHERE x.albumuser_id = a.id AND x.user_id = ",
                );
                qb.push_bind(user_id);
                qb.push(")");
            }
            qb.push(")");
        }
        DetailScope::Public { username } => {
            qb.push(" AND s.enabled AND (s.expires_at IS NULL OR s.expires_at >= now())");
            if let Some(name) = username {
                qb.push(" AND ow.username = ");
                qb.push_bind(name.to_string());
            }
        }
    }
}

pub async fn detail<'e>(
    db: impl Exec<'e>,
    id: i32,
    scope: DetailScope<'_>,
) -> sqlx::Result<Option<UserAlbumDetailRow>> {
    let mut qb = detail_select();
    qb.push("a.id = ");
    qb.push_bind(id);
    push_detail_scope(&mut qb, scope);
    qb.build_query_as().fetch_optional(db).await
}

/// A page of the albums `scope` lets the requester see, newest first
/// (`AlbumUserViewSet.list`).
pub async fn detail_list<'e, E>(
    db: E,
    scope: DetailScope<'_>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<UserAlbumDetailRow>>
where
    E: Exec<'e> + Copy,
{
    let build = |limit: i64, offset: i64| {
        let mut qb = detail_select();
        qb.push("TRUE");
        push_detail_scope(&mut qb, scope);
        qb.push(" ORDER BY a.id DESC LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);
        qb
    };
    fetch_paged(db, build, limit, offset).await
}

impl HasTotal for UserAlbumDetailRow {
    fn total(&self) -> i64 {
        self.total_count.unwrap_or(0)
    }
}

impl HasTotal for UserAlbumEditRow {
    fn total(&self) -> i64 {
        self.total_count.unwrap_or(0)
    }
}

/// `AlbumUserEditViewSet.list`: the owner's albums by title.
pub async fn edit_list<'e, E>(
    db: E,
    owner_id: i32,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<UserAlbumEditRow>>
where
    E: Exec<'e> + Copy,
{
    let build = |limit: i64, offset: i64| {
        let mut qb = Qb::new(format!(
            "{EDIT_SELECT}, count(*) OVER () AS total_count FROM api_albumuser a WHERE a.owner_id = "
        ));
        qb.push_bind(owner_id);
        qb.push(" ORDER BY a.title, a.id LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);
        qb
    };
    fetch_paged(db, build, limit, offset).await
}

/// `(album id, photo id)` memberships of `album_ids`.
pub async fn members<'e>(db: impl Exec<'e>, album_ids: &[i32]) -> sqlx::Result<Vec<(i32, Uuid)>> {
    let rows: Vec<(i32, DjUuid)> = crate::sql::query_as(
        "SELECT albumuser_id, photo_id FROM api_albumuser_photos \
         WHERE albumuser_id = ANY($1) AND photo_id IS NOT NULL",
    )
    .bind(album_ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|(a, p)| (a, p.0)).collect())
}

/// `AlbumUserEditSerializer` output row.
#[derive(Debug, Clone, FromRow)]
pub struct UserAlbumEditRow {
    pub id: i32,
    pub title: String,
    #[sqlx(try_from = "DjList<Uuid>")]
    pub photos: Vec<Uuid>,
    pub created_on: DateTime<Utc>,
    pub favorited: bool,
    #[sqlx(try_from = "DjUuidOpt")]
    pub cover_photo_id: Option<Uuid>,
    #[sqlx(default)]
    pub total_count: Option<i64>,
}

const EDIT_SELECT: &str = "SELECT a.id, a.title, \
    ARRAY(SELECT l.photo_id FROM api_albumuser_photos l \
      WHERE l.albumuser_id = a.id AND l.photo_id IS NOT NULL ORDER BY l.id) AS photos, \
    a.created_on, a.favorited, a.cover_photo_id";

pub async fn edit_row<'e>(db: impl Exec<'e>, id: i32) -> sqlx::Result<UserAlbumEditRow> {
    crate::sql::query_as(format!(
        "{EDIT_SELECT} FROM api_albumuser a WHERE a.id = $1"
    ))
    .bind(id)
    .fetch_one(db)
    .await
}

/// The owner's album id, if `id` exists and belongs to `owner_id`.
pub async fn owned_id<'e>(db: impl Exec<'e>, id: i32, owner_id: i32) -> sqlx::Result<Option<i32>> {
    crate::sql::query_scalar("SELECT id FROM api_albumuser WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(owner_id)
        .fetch_optional(db)
        .await
}

/// `(owner_id)` of album `id`.
pub async fn owner_of<'e>(db: impl Exec<'e>, id: i32) -> sqlx::Result<Option<i32>> {
    crate::sql::query_scalar("SELECT owner_id FROM api_albumuser WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await
}

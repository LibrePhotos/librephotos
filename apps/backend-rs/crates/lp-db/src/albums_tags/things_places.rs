//! Thing and place albums, plus the photo lists every grouped album detail
//! (user, thing, place, tag) renders.

use sqlx::FromRow;
use sqlx::types::Json;

use super::{Paged, photo_hash_json, push_search};
use crate::db::{Exec, FromDbRow, Qb};
use crate::pig::{self, PigPhoto};
use crate::scope;

/// `filter_photos_by_media_type`: `video` wins over `photo`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MediaFilter {
    #[default]
    All,
    Videos,
    Photos,
}

/// Whose photos a grouped album detail shows, with the album's own
/// visibility rule.
#[derive(Debug, Clone, Copy)]
pub enum AlbumPhotos {
    /// Every member (`obj.photos.all()`), or, for the public view, the
    /// members that are neither hidden nor trashed.
    User { album_id: i32, public: bool },
    /// `Photo.visible` members.
    Thing { album_id: i32 },
    /// Non-hidden members (trashed ones included, as in Django).
    Place { album_id: i32 },
    /// `Photo.visible` members.
    Tag { tag_id: i32 },
}

/// Members ordered by `-exif_timestamp` (Postgres puts NULLs first), ready
/// for `pig::group_by_date`.
pub async fn album_photos<'e>(
    db: impl Exec<'e>,
    source: AlbumPhotos,
    media: MediaFilter,
) -> sqlx::Result<Vec<PigPhoto>> {
    let mut qb = pig::query();
    let (link, fk, id) = match source {
        AlbumPhotos::User { album_id, .. } => ("api_albumuser_photos", "albumuser_id", album_id),
        AlbumPhotos::Thing { album_id } => ("api_albumthing_photos", "albumthing_id", album_id),
        AlbumPhotos::Place { album_id } => ("api_albumplace_photos", "albumplace_id", album_id),
        AlbumPhotos::Tag { tag_id } => ("api_tag_photos", "tag_id", tag_id),
    };
    qb.push(format!(
        " WHERE p.id IN (SELECT l.photo_id FROM {link} l WHERE l.{fk} = "
    ));
    qb.push_bind(id);
    qb.push(")");
    match source {
        AlbumPhotos::User { public: true, .. } => {
            qb.push(" AND NOT p.hidden AND NOT p.in_trashcan");
        }
        AlbumPhotos::User { .. } => {}
        AlbumPhotos::Thing { .. } | AlbumPhotos::Tag { .. } => {
            qb.push(" AND ");
            scope::visible_manager(&mut qb, "p");
        }
        AlbumPhotos::Place { .. } => {
            qb.push(" AND NOT p.hidden");
        }
    }
    match media {
        MediaFilter::All => {}
        MediaFilter::Videos => {
            qb.push(" AND p.video");
        }
        MediaFilter::Photos => {
            qb.push(" AND NOT p.video");
        }
    }
    qb.push(" ORDER BY p.exif_timestamp DESC, p.id");
    pig::fetch(&mut qb, db).await
}

/// The members of every user album in `album_ids` (the public view's rule
/// when `public`), ordered like [`album_photos`]; pair them up with
/// `user_albums::members`.
pub async fn user_albums_photos<'e>(
    db: impl Exec<'e>,
    album_ids: &[i32],
    public: bool,
) -> sqlx::Result<Vec<PigPhoto>> {
    if album_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut qb = pig::query();
    qb.push(
        " WHERE p.id IN (SELECT l.photo_id FROM api_albumuser_photos l WHERE l.albumuser_id = ANY(",
    );
    qb.push_bind(album_ids.to_vec());
    qb.push("))");
    if public {
        qb.push(" AND NOT p.hidden AND NOT p.in_trashcan");
    }
    qb.push(" ORDER BY p.exif_timestamp DESC, p.id");
    pig::fetch(&mut qb, db).await
}

/// `AlbumThingListSerializer` / `AlbumPlaceListSerializer` row.
#[derive(Debug, Clone, FromRow)]
pub struct CoverAlbumRow {
    pub id: i32,
    pub title: String,
    pub photo_count: i64,
    /// Thing albums only.
    pub thing_type: Option<String>,
    /// Place albums only.
    pub geolocation_level: Option<i32>,
    /// `[{image_hash, video}]`.
    pub cover_photos: Json<serde_json::Value>,
    pub total_count: i64,
}

/// The thing types `/albums/thing/*` show for the active tagging model.
pub fn active_thing_types(tagging_model: &str) -> Vec<String> {
    vec![
        format!("{tagging_model}_tag"),
        "hashtag_attribute".to_string(),
    ]
}

pub async fn thing_list<'e, E>(
    db: E,
    owner_id: i32,
    thing_types: &[String],
    search: &[String],
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<CoverAlbumRow>>
where
    E: Exec<'e> + Copy,
{
    let build = |limit: i64, offset: i64| {
        let mut qb = Qb::new(format!(
            "SELECT t.id, t.title, t.photo_count::bigint AS photo_count, t.thing_type, \
               NULL::int AS geolocation_level, \
               (SELECT COALESCE(json_agg({ph} ORDER BY cp.ctid), '[]'::json) \
                  FROM api_albumthing_cover_photos cl JOIN api_photo cp ON cp.id = cl.photo_id \
                  WHERE cl.albumthing_id = t.id) AS cover_photos, \
               count(*) OVER () AS total_count \
             FROM api_albumthing t WHERE t.owner_id = ",
            ph = photo_hash_json("cp"),
        ));
        qb.push_bind(owner_id);
        qb.push(" AND t.photo_count > 0 AND t.thing_type = ANY(");
        qb.push_bind(thing_types.to_vec());
        qb.push(")");
        push_search(&mut qb, &["t.title"], search);
        qb.push(" ORDER BY t.title DESC, t.id LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);
        qb
    };
    fetch_paged(db, build, limit, offset).await
}

pub async fn place_list<'e, E>(
    db: E,
    owner_id: i32,
    search: &[String],
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<CoverAlbumRow>>
where
    E: Exec<'e> + Copy,
{
    let build = |limit: i64, offset: i64| {
        // One pass over the owner's place links: per-album correlated subqueries
        // made the planner hash-join all of api_photo once per album.
        let mut qb = Qb::new(format!(
            "SELECT pl.id, pl.title, a.photo_count, NULL::varchar AS thing_type, pl.geolocation_level, \
               COALESCE(array_to_json(a.covers), '[]'::json) AS cover_photos, \
               count(*) OVER () AS total_count \
             FROM api_albumplace pl \
             JOIN (SELECT r.albumplace_id, max(r.n) AS photo_count, \
                     array_agg(r.j ORDER BY r.lid) FILTER (WHERE r.rn <= 4) AS covers \
                   FROM (SELECT cl.albumplace_id, cl.id AS lid, {ph} AS j, \
                           row_number() OVER (PARTITION BY cl.albumplace_id ORDER BY cl.id) AS rn, \
                           count(*) OVER (PARTITION BY cl.albumplace_id) AS n \
                         FROM api_albumplace_photos cl \
                         JOIN api_albumplace p2 ON p2.id = cl.albumplace_id AND p2.owner_id = ",
            ph = photo_hash_json("cp"),
        ));
        qb.push_bind(owner_id);
        qb.push(
            " JOIN api_photo cp ON cp.id = cl.photo_id AND NOT cp.hidden) r \
               GROUP BY r.albumplace_id) a ON a.albumplace_id = pl.id \
             WHERE pl.owner_id = ",
        );
        qb.push_bind(owner_id);
        push_search(&mut qb, &["pl.title"], search);
        qb.push(" ORDER BY pl.title, pl.id LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);
        qb
    };
    fetch_paged(db, build, limit, offset).await
}

pub(crate) async fn fetch_paged<'e, 'q, E, F, T>(
    db: E,
    build: F,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Paged<T>>
where
    E: Exec<'e> + Copy,
    F: Fn(i64, i64) -> Qb<'q>,
    T: FromDbRow + HasTotal,
{
    let rows: Vec<T> = build(limit, offset).build_query_as().fetch_all(db).await?;
    let total = match rows.first() {
        Some(r) => r.total(),
        None if offset > 0 => {
            let first: Vec<T> = build(1, 0).build_query_as().fetch_all(db).await?;
            first.first().map(HasTotal::total).unwrap_or(0)
        }
        None => 0,
    };
    Ok(Paged { rows, total })
}

pub(crate) trait HasTotal {
    fn total(&self) -> i64;
}

impl HasTotal for CoverAlbumRow {
    fn total(&self) -> i64 {
        self.total_count
    }
}

/// Header of a grouped thing / place album: `(id, title)` if the requester
/// may see it under the list's rules.
pub async fn thing_header<'e>(
    db: impl Exec<'e>,
    id: i32,
    owner_id: i32,
    thing_types: &[String],
) -> sqlx::Result<Option<(i32, String)>> {
    crate::sql::query_as(
        "SELECT id, title FROM api_albumthing \
         WHERE id = $1 AND owner_id = $2 AND photo_count > 0 AND thing_type = ANY($3)",
    )
    .bind(id)
    .bind(owner_id)
    .bind(thing_types)
    .fetch_optional(db)
    .await
}

pub async fn place_header<'e>(
    db: impl Exec<'e>,
    id: i32,
    owner_id: i32,
) -> sqlx::Result<Option<(i32, String)>> {
    crate::sql::query_as(
        "SELECT pl.id, pl.title FROM api_albumplace pl \
         WHERE pl.id = $1 AND pl.owner_id = $2 AND EXISTS ( \
           SELECT 1 FROM api_albumplace_photos l JOIN api_photo p ON p.id = l.photo_id \
           WHERE l.albumplace_id = pl.id AND NOT p.hidden)",
    )
    .bind(id)
    .bind(owner_id)
    .fetch_optional(db)
    .await
}

//! `AlbumDateListViewSet` and `AlbumDateViewSet.retrieve`: the timeline.
//!
//! The list is one grouped query over `api_albumdate_photos`; a day page is
//! one query that authorizes the day, counts its matching photos, clamps the
//! page like Django's `Paginator` and returns the summaries of that page.

use chrono::NaiveDate;
use sqlx::{FromRow, PgExecutor, Postgres, QueryBuilder};

use crate::pig::{PIG_COLUMNS, PIG_JOINS, PigPhoto, PigRow};
use crate::scope::{self, PhotoFilterParams};

/// The query parameters both date-album views understand, resolved against
/// the requester.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TimelineFilter {
    /// Authenticated requester (`None` = anonymous, only with `public`).
    pub viewer: Option<i32>,
    /// `rating >= favorite_min_rating` when `favorite` was asked for.
    pub favorite_min_rating: Option<i32>,
    pub public: bool,
    pub username: Option<String>,
    pub hidden: bool,
    pub in_trashcan: bool,
    pub video: bool,
    pub photo: bool,
    pub is_screenshot: bool,
    pub is_document: bool,
    pub person: Option<i64>,
    pub folder: Option<String>,
    pub show_all_stack_photos: bool,
}

impl TimelineFilter {
    /// `viewer` = `(user id, favorite_min_rating)`.
    pub fn new(
        params: &PhotoFilterParams,
        viewer: Option<(i32, i32)>,
        username: Option<&str>,
    ) -> Self {
        TimelineFilter {
            viewer: viewer.map(|v| v.0),
            favorite_min_rating: viewer.filter(|_| params.favorite).map(|v| v.1),
            public: params.public,
            username: username.filter(|u| !u.is_empty()).map(str::to_string),
            hidden: params.hidden,
            in_trashcan: params.in_trashcan,
            video: params.video,
            photo: params.photo,
            is_screenshot: params.is_screenshot,
            is_document: params.is_document,
            person: params.person,
            folder: params.folder.clone(),
            show_all_stack_photos: params.show_all_stack_photos,
        }
    }

    /// The requester's own photos (no `public` view).
    fn owner_scoped(&self) -> Option<i32> {
        self.viewer.filter(|_| !self.public)
    }
}

/// `owner_id IN (SELECT id FROM api_user WHERE username = $x)`.
fn push_username(qb: &mut QueryBuilder<'_, Postgres>, col: &str, username: &str) {
    qb.push(format!(
        "{col} IN (SELECT uu.id FROM api_user uu WHERE uu.username = "
    ));
    qb.push_bind(username.to_string());
    qb.push(")");
}

/// Photo-level conditions shared by the list and the day page (everything
/// but ownership), one parenthesized expression over alias `p`.
fn push_photo_conditions(qb: &mut QueryBuilder<'_, Postgres>, p: &str, f: &TimelineFilter) {
    qb.push(format!(
        "({} AND {p}.hidden = ",
        scope::has_thumbnail_sql(p)
    ));
    qb.push_bind(f.hidden);
    if f.in_trashcan {
        qb.push(format!(" AND {p}.in_trashcan AND NOT {p}.removed"));
    } else {
        qb.push(format!(" AND NOT {p}.in_trashcan"));
    }
    if let Some(min) = f.favorite_min_rating {
        qb.push(format!(" AND {p}.rating >= "));
        qb.push_bind(min);
    }
    if f.public {
        qb.push(format!(" AND {p}.public"));
    }
    if f.video {
        qb.push(format!(" AND {p}.video"));
    }
    if f.photo {
        qb.push(format!(" AND NOT {p}.video"));
    }
    if f.is_screenshot {
        qb.push(format!(" AND {p}.is_screenshot"));
    }
    if f.is_document {
        qb.push(format!(" AND {p}.is_document"));
    }
    if let Some(folder) = &f.folder {
        qb.push(" AND ");
        scope::folder(qb, p, folder);
    }
    if !f.show_all_stack_photos {
        qb.push(format!(" AND {}", scope::stack_visible_sql(p)));
    }
    if let Some(person) = f.person {
        qb.push(" AND ");
        scope::person(qb, p, person);
    }
    qb.push(")");
}

/// The day's place: the stored `location.places[0]`, or in the public view
/// the city of its first geotagged public photo (`_public_place`).
/// `places` is free-form JSON: a scalar must neither reach
/// `jsonb_array_length` (a query error that took down the whole public
/// timeline) nor be skipped, since Python indexes a string like a list.
/// Only `CASE` fixes the evaluation order, so every guard is one.
fn location_sql(a: &str, public: bool) -> String {
    if public {
        let places = "lp.geolocation_json->'places'";
        format!(
            "COALESCE((SELECT CASE jsonb_typeof({places}) \
                 WHEN 'array' THEN {places}->>(jsonb_array_length({places}) - 2) \
                 ELSE substr({places} #>> '{{}}', length({places} #>> '{{}}') - 1, 1) END \
               FROM api_albumdate_photos lap JOIN api_photo lp ON lp.id = lap.photo_id \
               WHERE lap.albumdate_id = {a}.id AND lp.public AND NOT lp.hidden AND NOT lp.in_trashcan \
                 AND NOT lp.removed AND CASE jsonb_typeof({places}) \
                   WHEN 'array' THEN jsonb_array_length({places}) >= 2 \
                   WHEN 'string' THEN length({places} #>> '{{}}') >= 2 ELSE false END \
               ORDER BY lp.exif_timestamp, lp.id LIMIT 1), '')"
        )
    } else {
        let places = format!("{a}.location->'places'");
        format!(
            "COALESCE(CASE jsonb_typeof({places}) WHEN 'string' THEN substr({places} #>> '{{}}', 1, 1) \
             ELSE {places}->>0 END, '')"
        )
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct DateGroupRow {
    pub id: i32,
    pub date: Option<NaiveDate>,
    pub location: String,
    pub photo_count: i64,
}

/// `GET /albums/date/list/`: every day with at least one matching photo,
/// newest first.
pub async fn list<'e>(
    db: impl PgExecutor<'e>,
    f: &TimelineFilter,
) -> sqlx::Result<Vec<DateGroupRow>> {
    let mut qb = QueryBuilder::new(format!(
        "SELECT a.id, a.date, {} AS location, count(*) AS photo_count \
         FROM api_albumdate a \
         JOIN api_albumdate_photos ap ON ap.albumdate_id = a.id \
         JOIN api_photo p ON p.id = ap.photo_id WHERE ",
        location_sql("a", f.public)
    ));
    if let Some(uid) = f.owner_scoped() {
        qb.push("a.owner_id = ");
        qb.push_bind(uid);
        qb.push(" AND ");
        scope::owned_by(&mut qb, "p", uid);
        qb.push(" AND ");
    }
    if f.public
        && let Some(u) = &f.username
    {
        push_username(&mut qb, "a.owner_id", u);
        qb.push(" AND ");
    }
    push_photo_conditions(&mut qb, "p", f);
    qb.push(" GROUP BY a.id ORDER BY a.date DESC NULLS LAST, a.id");
    qb.build_query_as().fetch_all(db).await
}

#[derive(Debug, Clone, FromRow)]
pub struct DateHeaderRow {
    pub id: i32,
    pub date: Option<NaiveDate>,
    pub location: String,
}

#[derive(Debug, Clone, FromRow)]
struct DatePageRow {
    album_id: i32,
    album_date: Option<NaiveDate>,
    album_location: String,
    total: i64,
    #[sqlx(flatten)]
    pig: PigRow,
}

#[derive(Debug, Clone)]
pub struct DatePage {
    pub header: DateHeaderRow,
    /// All matching photos of the day (`numberOfItems`).
    pub total: i64,
    pub items: Vec<PigPhoto>,
}

/// `_album_date`: the requester's own day, or with `public` a day holding a
/// public photo (of `username`, when given).
fn push_album_auth(
    qb: &mut QueryBuilder<'_, Postgres>,
    a: &str,
    album_id: i32,
    f: &TimelineFilter,
) {
    qb.push(format!("{a}.id = "));
    qb.push_bind(album_id);
    if f.public {
        if let Some(u) = &f.username {
            qb.push(" AND ");
            push_username(qb, &format!("{a}.owner_id"), u);
        }
        qb.push(format!(
            " AND EXISTS (SELECT 1 FROM api_albumdate_photos xap JOIN api_photo xp ON xp.id = xap.photo_id \
             WHERE xap.albumdate_id = {a}.id AND xp.public)"
        ));
    } else {
        qb.push(format!(" AND {a}.owner_id = "));
        qb.push_bind(f.viewer.unwrap_or(-1));
    }
}

/// `GET /albums/date/{id}`: `None` when the caller may not see the day.
/// `page`: `None` for a missing or non-integer page (Django: page 1);
/// pages below 1 or past the end resolve to the last page.
pub async fn page(
    db: &sqlx::PgPool,
    album_id: i32,
    f: &TimelineFilter,
    page: Option<i64>,
    size: i64,
) -> sqlx::Result<Option<DatePage>> {
    let mut qb = QueryBuilder::new(format!(
        "WITH alb AS (SELECT a.id, a.date, {} AS location FROM api_albumdate a WHERE ",
        location_sql("a", f.public)
    ));
    push_album_auth(&mut qb, "a", album_id, f);
    qb.push(
        "), m AS (SELECT p.id, p.exif_timestamp AS ts, mf.path AS mpath FROM alb \
         JOIN api_albumdate_photos ap ON ap.albumdate_id = alb.id \
         JOIN api_photo p ON p.id = ap.photo_id \
         LEFT JOIN api_file mf ON mf.hash = p.main_file_id WHERE ",
    );
    if let Some(uid) = f.owner_scoped() {
        scope::owned_by(&mut qb, "p", uid);
        qb.push(" AND ");
    }
    if f.public
        && let Some(u) = &f.username
    {
        push_username(&mut qb, "p.owner_id", u);
        qb.push(" AND ");
    }
    push_photo_conditions(&mut qb, "p", f);
    qb.push("), c AS (SELECT count(*) AS total FROM m), pg AS (SELECT total, CASE WHEN ");
    qb.push_bind(page);
    qb.push("::bigint IS NULL THEN 1 WHEN ");
    qb.push_bind(page);
    qb.push("::bigint < 1 OR ");
    qb.push_bind(page);
    qb.push("::bigint > GREATEST(CEIL(total::numeric / ");
    qb.push_bind(size);
    qb.push(")::bigint, 1) THEN GREATEST(CEIL(total::numeric / ");
    qb.push_bind(size);
    qb.push(")::bigint, 1) ELSE ");
    qb.push_bind(page);
    qb.push("::bigint END AS page FROM c), sel AS (SELECT m.id, m.ts, m.mpath FROM m ORDER BY m.ts DESC, m.mpath, m.id LIMIT ");
    qb.push_bind(size);
    qb.push(" OFFSET (SELECT (pg.page - 1) * ");
    qb.push_bind(size);
    qb.push(format!(
        " FROM pg)) SELECT alb.id AS album_id, alb.date AS album_date, alb.location AS album_location, \
         pg.total, {PIG_COLUMNS} FROM sel JOIN api_photo p ON p.id = sel.id{PIG_JOINS} \
         CROSS JOIN alb CROSS JOIN pg ORDER BY sel.ts DESC, sel.mpath, sel.id"
    ));
    let rows: Vec<DatePageRow> = qb.build_query_as().fetch_all(db).await?;
    if let Some(first) = rows.first() {
        let header = DateHeaderRow {
            id: first.album_id,
            date: first.album_date,
            location: first.album_location.clone(),
        };
        let total = first.total;
        let items = rows.into_iter().map(|r| PigPhoto::from(r.pig)).collect();
        return Ok(Some(DatePage {
            header,
            total,
            items,
        }));
    }
    // No rows: either the day is not visible or no photo matches (total 0).
    let mut qb = QueryBuilder::new(format!(
        "SELECT a.id, a.date, {} AS location FROM api_albumdate a WHERE ",
        location_sql("a", f.public)
    ));
    push_album_auth(&mut qb, "a", album_id, f);
    let header: Option<DateHeaderRow> = qb.build_query_as().fetch_optional(db).await?;
    Ok(header.map(|header| DatePage {
        header,
        total: 0,
        items: Vec::new(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_sql_shape() {
        let f = TimelineFilter {
            viewer: Some(2),
            favorite_min_rating: Some(4),
            video: true,
            photo: true,
            person: Some(1),
            ..Default::default()
        };
        let mut qb = QueryBuilder::<Postgres>::new("SELECT 1 FROM api_photo p WHERE ");
        push_photo_conditions(&mut qb, "p", &f);
        let sql = qb.sql();
        assert!(sql.contains("p.video") && sql.contains("NOT p.video"));
        assert!(sql.contains("p.rating >= "));
        assert!(sql.contains("fx.person_id"));
        assert!(sql.contains("NOT p.in_trashcan"));
    }

    #[test]
    fn filter_from_params() {
        let params = PhotoFilterParams {
            favorite: true,
            public: true,
            ..Default::default()
        };
        let anon = TimelineFilter::new(&params, None, Some("alice"));
        assert_eq!(anon.favorite_min_rating, None);
        assert_eq!(anon.username.as_deref(), Some("alice"));
        assert_eq!(anon.owner_scoped(), None);
        let own = TimelineFilter::new(&PhotoFilterParams::default(), Some((3, 4)), Some(""));
        assert_eq!(own.owner_scoped(), Some(3));
        assert_eq!(own.username, None);
    }
}

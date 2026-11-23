//! `GET /api/albums/date/list/` and `GET /api/albums/date/{id}` (03 §4).

use axum::Json;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use chrono::NaiveDate;
use lp_auth::OptionalUser;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::pig::PigPhoto;
use lp_db::scope::PhotoFilterParams;
use lp_db::timeline_photos::date_albums::{self, TimelineFilter};
use lp_db::users::User;
use serde::{Serialize, Serializer};

use super::py_int;

/// Frontend page size (hard-coded there too).
const PAGE_SIZE: i64 = 100;

fn ser_id<S: Serializer>(id: &i32, s: S) -> Result<S::Ok, S::Error> {
    s.collect_str(id)
}

fn ser_date<S: Serializer>(d: &Option<NaiveDate>, s: S) -> Result<S::Ok, S::Error> {
    match d {
        Some(d) => s.collect_str(&d.format("%Y-%m-%d")),
        None => s.serialize_none(),
    }
}

/// `IncompleteAlbumDateSerializer` (list) / `AlbumDateSerializer` (page).
#[derive(Serialize)]
struct DateGroup<I: Serialize> {
    #[serde(serialize_with = "ser_id")]
    id: i32,
    #[serde(serialize_with = "ser_date")]
    date: Option<NaiveDate>,
    location: String,
    incomplete: bool,
    #[serde(rename = "numberOfItems")]
    number_of_items: i64,
    items: I,
}

#[derive(Serialize)]
struct Results<T: Serialize> {
    results: T,
}

/// Both views: `public` is open to anyone, everything else needs a login.
/// The permission check comes before any parameter parsing, as in DRF.
fn filter_for(user: Option<&User>, q: &QueryMap) -> ApiResult<TimelineFilter> {
    if user.is_none() && !q.flag("public") {
        return Err(ApiError::not_authenticated());
    }
    let params = PhotoFilterParams::from_query(q)?;
    Ok(TimelineFilter::new(
        &params,
        user.map(|u| (u.id, u.favorite_min_rating)),
        q.get("username"),
    ))
}

pub async fn list(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    q: QueryMap,
) -> ApiResult<Response> {
    let f = filter_for(user.as_ref(), &q)?;
    let rows = date_albums::list(&state.db, &f).await?;
    let results: Vec<DateGroup<[(); 0]>> = rows
        .into_iter()
        .map(|r| DateGroup {
            id: r.id,
            date: r.date,
            location: r.location,
            incomplete: true,
            number_of_items: r.photo_count,
            items: [],
        })
        .collect();
    Ok(Json(Results { results }).into_response())
}

pub async fn page(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    Path(id): Path<String>,
    q: QueryMap,
) -> ApiResult<Response> {
    let f = filter_for(user.as_ref(), &q)?;
    let album_id: i32 = id
        .trim()
        .parse()
        .map_err(|_| ApiError::not_found_msg("No AlbumDate matches the given query."))?;
    let page = q.get("page").and_then(py_int);
    let size = q
        .get("size")
        .and_then(py_int)
        .filter(|s| *s > 0)
        .unwrap_or(PAGE_SIZE);
    let day = date_albums::page(&state.db, album_id, &f, page, size)
        .await?
        .ok_or_else(|| ApiError::not_found_msg("No AlbumDate matches the given query."))?;
    let group: DateGroup<Vec<PigPhoto>> = DateGroup {
        id: day.header.id,
        date: day.header.date,
        location: day.header.location,
        incomplete: false,
        number_of_items: day.total,
        items: day.items,
    };
    Ok(Json(Results { results: group }).into_response())
}

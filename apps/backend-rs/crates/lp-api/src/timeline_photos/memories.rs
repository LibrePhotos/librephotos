//! `GET /api/memories` (`MemoriesView`): one entry per earlier year with
//! photos around today's date, nearest year first.

use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use lp_auth::AuthUser;
use lp_core::{ApiResult, AppState, QueryMap};
use lp_db::pig::{self, PigPhoto};
use lp_db::timeline_photos::memories as db;
use lp_db::users::User;
use serde::Serialize;
use uuid::Uuid;

use super::py_int;

const DEFAULT_WINDOW_DAYS: i64 = 3;
const MAX_WINDOW_DAYS: i64 = 30;
const DEFAULT_ITEMS_PER_MEMORY: i64 = 30;
const MAX_ITEMS_PER_MEMORY: i64 = 200;
const TYPE_YEARS_AGO: &str = "years_ago";
const TYPE_MONTH_YEARS_AGO: &str = "month_years_ago";

/// `(years_ago, anchor, start, end)`.
type Window = (i32, NaiveDate, NaiveDate, NaiveDate);

fn clamp_int(v: Option<&str>, default: i64, min: i64, max: i64) -> i64 {
    v.and_then(py_int)
        .map(|n| n.clamp(min, max))
        .unwrap_or(default)
}

fn parse_flag(v: Option<&str>, default: bool) -> bool {
    match v {
        None => default,
        Some(v) => !matches!(
            v.trim().to_lowercase().as_str(),
            "false" | "0" | "f" | "no" | "off"
        ),
    }
}

fn today_for_user(user: &User) -> NaiveDate {
    let tz: chrono_tz::Tz = user.default_timezone.parse().unwrap_or(chrono_tz::Tz::UTC);
    Utc::now().with_timezone(&tz).date_naive()
}

fn anniversary(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day)
        .or_else(|| NaiveDate::from_ymd_opt(year, month, day - 1))
        .unwrap_or(NaiveDate::MIN)
}

fn day_windows(reference: NaiveDate, first_year: i32, window_days: i64) -> Vec<Window> {
    let w = Duration::days(window_days);
    (first_year..reference.year())
        .rev()
        .map(|year| {
            let anchor = anniversary(year, reference.month(), reference.day());
            (reference.year() - year, anchor, anchor - w, anchor + w)
        })
        .collect()
}

fn month_windows(reference: NaiveDate, first_year: i32) -> Vec<Window> {
    (first_year..reference.year())
        .rev()
        .filter_map(|year| {
            let start = NaiveDate::from_ymd_opt(year, reference.month(), 1)?;
            let end = if reference.month() == 12 {
                NaiveDate::from_ymd_opt(year, 12, 31)?
            } else {
                NaiveDate::from_ymd_opt(year, reference.month() + 1, 1)? - Duration::days(1)
            };
            Some((reference.year() - year, start, start, end))
        })
        .collect()
}

fn iso(d: &NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

#[derive(Serialize)]
struct Memory {
    id: String,
    #[serde(rename = "type")]
    kind: &'static str,
    years_ago: i32,
    year: i32,
    date: String,
    start_date: String,
    end_date: String,
    location: String,
    #[serde(rename = "numberOfItems")]
    number_of_items: i64,
    cover: PigPhoto,
    items: Vec<PigPhoto>,
}

#[derive(Serialize)]
struct MemoriesResponse {
    date: String,
    window_days: i64,
    results: Vec<Memory>,
}

async fn build(
    state: &AppState,
    user: &User,
    windows: &[Window],
    size: i64,
    kind: &'static str,
) -> ApiResult<Vec<Memory>> {
    if windows.is_empty() {
        return Ok(Vec::new());
    }
    let ranges: Vec<(NaiveDate, NaiveDate)> = windows.iter().map(|w| (w.2, w.3)).collect();
    let days = db::days(&state.db, user.id, user.favorite_min_rating, &ranges).await?;
    if days.is_empty() {
        return Ok(Vec::new());
    }
    let mut places: HashMap<NaiveDate, String> = HashMap::new();
    for d in &days {
        if !d.place.is_empty() {
            places.entry(d.date).or_insert_with(|| d.place.clone());
        }
    }

    // (window, days with photos, their total)
    let mut planned: Vec<(Window, Vec<NaiveDate>, i64)> = Vec::new();
    for w in windows {
        let in_window: Vec<&db::MemoryDay> = days
            .iter()
            .filter(|d| d.total > 0 && w.2 <= d.date && d.date <= w.3)
            .collect();
        if in_window.is_empty() {
            continue;
        }
        let mut dates: Vec<NaiveDate> = in_window.iter().map(|d| d.date).collect();
        dates.sort();
        let count = in_window.iter().map(|d| d.total).sum();
        planned.push((*w, dates, count));
    }
    if planned.is_empty() {
        return Ok(Vec::new());
    }

    let planned_ranges: Vec<(NaiveDate, NaiveDate)> =
        planned.iter().map(|(w, _, _)| (w.2, w.3)).collect();
    let ids = db::window_photo_ids(
        &state.db,
        user.id,
        user.favorite_min_rating,
        &planned_ranges,
        size,
    )
    .await?;
    let wanted: Vec<Uuid> = ids.iter().flatten().copied().collect();
    let mut photos: HashMap<Uuid, PigPhoto> = pig::by_ids(&state.db, &wanted)
        .await?
        .into_iter()
        .map(|p| (p.id, p))
        .collect();

    let mut results = Vec::new();
    for ((w, dates, count), ids) in planned.into_iter().zip(ids) {
        let items: Vec<PigPhoto> = ids.iter().filter_map(|id| photos.remove(id)).collect();
        if items.is_empty() {
            continue;
        }
        let (years_ago, anchor, _, _) = w;
        let representative = *dates
            .iter()
            .min_by_key(|d| ((**d - anchor).num_days().abs(), **d))
            .expect("non-empty");
        let location = places
            .get(&representative)
            .or_else(|| dates.iter().find_map(|d| places.get(d)))
            .cloned()
            .unwrap_or_default();
        let cover = items
            .iter()
            .min_by_key(|p| (p.video, -p.rating))
            .cloned()
            .expect("non-empty");
        results.push(Memory {
            id: format!("{kind}-{}", anchor.year()),
            kind,
            years_ago,
            year: anchor.year(),
            date: iso(&representative),
            start_date: iso(&dates[0]),
            end_date: iso(&dates[dates.len() - 1]),
            location,
            number_of_items: count,
            cover,
            items,
        });
    }
    Ok(results)
}

pub async fn memories(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    q: QueryMap,
) -> ApiResult<Response> {
    let reference = q
        .get("date")
        .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
        .unwrap_or_else(|| today_for_user(&user));
    let window_days = clamp_int(q.get("window"), DEFAULT_WINDOW_DAYS, 0, MAX_WINDOW_DAYS);
    let fallback = parse_flag(q.get("fallback"), true);
    let size = clamp_int(
        q.get("size"),
        DEFAULT_ITEMS_PER_MEMORY,
        1,
        MAX_ITEMS_PER_MEMORY,
    );

    let mut results = Vec::new();
    if let Some(first) = db::first_date(&state.db, user.id).await? {
        results = build(
            &state,
            &user,
            &day_windows(reference, first.year(), window_days),
            size,
            TYPE_YEARS_AGO,
        )
        .await?;
        if results.is_empty() && fallback {
            results = build(
                &state,
                &user,
                &month_windows(reference, first.year()),
                size,
                TYPE_MONTH_YEARS_AGO,
            )
            .await?;
        }
    }
    Ok(Json(MemoriesResponse {
        date: iso(&reference),
        window_days,
        results,
    })
    .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn windows_nearest_year_first() {
        let w = day_windows(d(2024, 2, 29), 2021, 3);
        assert_eq!(w.len(), 3);
        assert_eq!(w[0], (1, d(2023, 2, 28), d(2023, 2, 25), d(2023, 3, 3)));
        assert_eq!(w[2].0, 3);
        let m = month_windows(d(2024, 12, 5), 2023);
        assert_eq!(
            m,
            vec![(1, d(2023, 12, 1), d(2023, 12, 1), d(2023, 12, 31))]
        );
        let m = month_windows(d(2024, 2, 5), 2023);
        assert_eq!(m[0].3, d(2023, 2, 28));
    }

    #[test]
    fn params() {
        assert_eq!(clamp_int(Some("99"), 3, 0, 30), 30);
        assert_eq!(clamp_int(Some("x"), 3, 0, 30), 3);
        assert_eq!(clamp_int(None, 3, 0, 30), 3);
        assert!(!parse_flag(Some(" Off "), true));
        assert!(parse_flag(Some("yes"), false));
        assert!(parse_flag(None, true));
    }
}

//! `GET /api/geocode/search?q=[&limit=]` → bare array of `{display_name, lat, lon}`
//! (api/views/geocode.py). The provider call is `lp_tasks::geocode::search_location`.

use axum::Json;
use axum::extract::State;
use lp_auth::AuthUser;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_tasks::geocode::Place;

fn py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

/// Python `int(str)`: surrounding whitespace, a sign, `_` between digits.
fn py_int(s: &str) -> Option<i64> {
    let t = s.trim_matches(py_space);
    let (neg, digits) = match t.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
        || !digits.chars().all(|c| c.is_ascii_digit() || c == '_')
    {
        return None;
    }
    let v: i64 = digits.replace('_', "").parse().ok()?;
    Some(if neg { -v } else { v })
}

pub(super) async fn geocode_search(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    q: QueryMap,
) -> ApiResult<Json<Vec<Place>>> {
    let query = q.get("q").unwrap_or("").trim_matches(py_space).to_string();
    if query.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let limit = match q.get("limit") {
        None => 5,
        Some(raw) => py_int(raw).ok_or_else(|| {
            ApiError::internal(format!("invalid literal for int() with base 10: '{raw}'"))
        })?,
    };
    Ok(Json(
        lp_tasks::geocode::search_location(&state, &query, limit).await,
    ))
}

#[cfg(test)]
mod tests {
    use super::py_int;

    #[test]
    fn python_int() {
        assert_eq!(py_int("5"), Some(5));
        assert_eq!(py_int(" +7 "), Some(7));
        assert_eq!(py_int("-2"), Some(-2));
        assert_eq!(py_int("1_0"), Some(10));
        assert_eq!(py_int(""), None);
        assert_eq!(py_int("x"), None);
        assert_eq!(py_int("_1"), None);
        assert_eq!(py_int("1.5"), None);
    }
}

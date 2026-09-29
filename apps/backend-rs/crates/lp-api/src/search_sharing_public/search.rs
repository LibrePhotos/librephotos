//! `GET /api/photos/searchlist/?search=[&photo|video|is_screenshot|is_document=…]`
//! (api/views/search.py `SearchListViewSet.list` + api/filters.py).

use super::auth::ApiUser;
use axum::Json;
use axum::extract::State;
use lp_core::{ApiError, ApiResult, AppState, QueryMap};
use lp_db::pig::{self, DateGroup, PigPhoto};
use lp_db::search_sharing_public::search::{self, MediaFilter, SearchQuery};
use serde::Serialize;

use super::sidecar;

#[derive(Serialize)]
pub(super) struct Results<T: Serialize> {
    pub results: T,
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum SearchResults {
    Grouped(Vec<DateGroup>),
    Flat(Vec<PigPhoto>),
}

pub(super) async fn search_list(
    State(state): State<AppState>,
    ApiUser(user): ApiUser,
    q: QueryMap,
) -> ApiResult<Json<Results<SearchResults>>> {
    let media = MediaFilter {
        video: q.flag("video"),
        photo: q.flag("photo"),
        is_screenshot: q.flag("is_screenshot"),
        is_document: q.flag("is_document"),
    };
    let raw = q.get("search").unwrap_or("");
    if raw.contains('\0') {
        return Err(ApiError::validation("Null characters are not allowed."));
    }
    let terms = smart_split(raw);

    let semantic = if user.semantic_search_topk > 0 && !terms.is_empty() {
        Some(
            sidecar::semantic_search_hashes(&state, user.id, raw, user.semantic_search_topk)
                .await?,
        )
    } else {
        None
    };
    let photos = search::photos(
        &state.db,
        &SearchQuery {
            user_id: user.id,
            media,
            terms: &terms,
            semantic_hashes: semantic.as_deref(),
        },
    )
    .await?;

    let results = if user.semantic_search_topk == 0 {
        SearchResults::Grouped(pig::group_by_date(photos))
    } else {
        SearchResults::Flat(photos)
    };
    Ok(Json(Results { results }))
}

/// Python's `str.isspace` set (Unicode whitespace plus the `\x1c`..`\x1f` separators).
fn is_py_space(c: char) -> bool {
    c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c)
}

fn is_plain(c: char) -> bool {
    !is_py_space(c) && c != '"' && c != '\''
}

/// Index just past the closing quote of the quoted string starting at `start`
/// (`"(?:[^"\\]|\\.)*"`, where `.` does not match a newline).
fn quoted_end(chars: &[char], start: usize) -> Option<usize> {
    let quote = chars[start];
    let mut k = start + 1;
    while k < chars.len() {
        match chars[k] {
            c if c == quote => return Some(k + 1),
            '\\' => {
                if k + 1 < chars.len() && chars[k + 1] != '\n' {
                    k += 2;
                } else {
                    return None;
                }
            }
            _ => k += 1,
        }
    }
    None
}

/// Django `django.utils.text.smart_split`: whitespace-separated tokens,
/// quoted runs kept together (quotes included).
fn django_smart_split(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        if is_py_space(chars[i]) {
            i += 1;
            continue;
        }
        let start = i;
        let mut j = i;
        while j < n && is_plain(chars[j]) {
            j += 1;
        }
        let mut end = None;
        while j < n && (chars[j] == '"' || chars[j] == '\'') {
            let Some(mut k) = quoted_end(&chars, j) else {
                break;
            };
            while k < n && is_plain(chars[k]) {
                k += 1;
            }
            end = Some(k);
            j = k;
        }
        let end = end.unwrap_or_else(|| {
            let mut k = start;
            while k < n && !is_py_space(chars[k]) {
                k += 1;
            }
            k
        });
        out.push(chars[start..end].iter().collect());
        i = end;
    }
    out
}

/// Django `unescape_string_literal` (caller checked the surrounding quotes).
fn unescape_string_literal(s: &str) -> String {
    let quote = s.chars().next().unwrap_or('"');
    let inner: String = {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() >= 2 {
            chars[1..chars.len() - 1].iter().collect()
        } else {
            String::new()
        }
    };
    inner
        .replace(&format!("\\{quote}"), &quote.to_string())
        .replace("\\\\", "\\")
}

/// DRF 3.18 `search_smart_split`: the search terms of `?search=`.
pub fn smart_split(search: &str) -> Vec<String> {
    let mut terms = Vec::new();
    for token in django_smart_split(search) {
        let term = token.trim_matches(',');
        let first = term.chars().next();
        if matches!(first, Some('"') | Some('\'')) && term.chars().last() == first {
            terms.push(unescape_string_literal(term));
        } else {
            for sub in term.split(',') {
                if !sub.is_empty() {
                    terms.push(sub.trim_matches(is_py_space).to_string());
                }
            }
        }
    }
    terms
}

#[cfg(test)]
mod tests {
    use super::smart_split;

    #[test]
    fn splits_like_drf() {
        assert_eq!(smart_split("berlin 2022"), vec!["berlin", "2022"]);
        assert_eq!(smart_split("  a,b ,c,, "), vec!["a", "b", "c"]);
        assert_eq!(smart_split("\"new york\" cat"), vec!["new york", "cat"]);
        assert_eq!(smart_split("'it\\'s' x"), vec!["it's", "x"]);
        assert_eq!(smart_split("\"unclosed word"), vec!["\"unclosed", "word"]);
        assert_eq!(smart_split("x\"a b\",y"), vec!["x\"a b\"", "y"]);
        assert_eq!(smart_split("\""), vec![""]);
        assert_eq!(smart_split("a\\\"b c\"\""), vec!["a\\\"b c\"", ""]);
        assert_eq!(smart_split(",,,"), Vec::<String>::new());
        assert_eq!(smart_split(""), Vec::<String>::new());
    }
}

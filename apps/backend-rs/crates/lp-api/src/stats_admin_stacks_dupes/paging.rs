//! The hand-rolled paging of the stacks and duplicates lists (Django's
//! `Paginator.get_page` over `page` / `page_size` query params) and small
//! helpers for their request bodies.

use lp_core::{ApiError, QueryMap};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

/// Python `int(s)` for a query string value.
fn py_int(s: &str) -> Option<i64> {
    let t = s.trim();
    let digits = t.strip_prefix(['+', '-']).unwrap_or(t);
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
    {
        return None;
    }
    t.replace('_', "").parse().ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Paging {
    /// The page asked for (echoed back as `page`, even past the end).
    pub requested: i64,
    pub page_size: i64,
}

impl Paging {
    /// `max(1, int(page))`, `max(1, min(int(page_size), 100))`; junk -> defaults.
    pub fn from_query(q: &QueryMap) -> Self {
        let requested = q.get("page").and_then(py_int).unwrap_or(1).max(1);
        let page_size = q
            .get("page_size")
            .and_then(py_int)
            .unwrap_or(20)
            .clamp(1, 100);
        Paging {
            requested,
            page_size,
        }
    }

    pub fn num_pages(&self, count: i64) -> i64 {
        (count.max(1) + self.page_size - 1) / self.page_size
    }

    /// `get_page`: past the end means the last page.
    pub fn actual(&self, count: i64) -> i64 {
        self.requested.min(self.num_pages(count))
    }

    pub fn offset(&self, count: i64) -> i64 {
        (self.actual(count) - 1) * self.page_size
    }

    pub fn envelope<T: Serialize>(&self, count: i64, results: Vec<T>) -> Page<T> {
        let actual = self.actual(count);
        let num_pages = self.num_pages(count);
        Page {
            results,
            count,
            num_pages,
            page: self.requested,
            page_size: self.page_size,
            has_next: actual < num_pages,
            has_previous: actual > 1,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Page<T: Serialize> {
    pub results: Vec<T>,
    pub count: i64,
    pub num_pages: i64,
    pub page: i64,
    pub page_size: i64,
    pub has_next: bool,
    pub has_previous: bool,
}

/// A group id from the URL; anything but a UUID is a 404 like a missing group.
pub fn parse_id(raw: &str, not_found: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(raw).map_err(|_| ApiError::not_found_msg(not_found))
}

/// `request.data.get(key)` on a JSON body (None unless the body is an object).
pub fn field<'a>(body: &'a Value, key: &str) -> Option<&'a Value> {
    body.as_object().and_then(|o| o.get(key))
}

/// `list(dict.fromkeys(value))` for `photo_hashes`: unique, in order.
pub fn hash_list(v: Option<&Value>) -> Vec<String> {
    let items: Vec<String> = match v {
        Some(Value::Array(a)) => a.iter().map(super::stats::py_str).collect(),
        Some(Value::String(s)) => s.chars().map(String::from).collect(),
        Some(Value::Object(o)) => o.keys().cloned().collect(),
        _ => Vec::new(),
    };
    let mut out: Vec<String> = Vec::with_capacity(items.len());
    for h in items {
        if !out.contains(&h) {
            out.push(h);
        }
    }
    out
}

/// Python `int(value)` for a JSON body field.
pub fn json_int(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.trunc() as i64)),
        Value::Bool(b) => Some(*b as i64),
        Value::String(s) => py_int(s),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn paging_like_django() {
        let p = Paging::from_query(&QueryMap::parse(Some("page=9&page_size=500")));
        assert_eq!((p.requested, p.page_size), (9, 100));
        let env = p.envelope::<()>(250, vec![]);
        assert_eq!(
            (env.num_pages, env.page, env.has_next, env.has_previous),
            (3, 9, false, true)
        );
        assert_eq!(p.offset(250), 200);
        let p = Paging::from_query(&QueryMap::parse(Some("page=x&page_size=0")));
        assert_eq!((p.requested, p.page_size), (1, 1));
        assert_eq!(p.envelope::<()>(0, vec![]).num_pages, 1);
        assert_eq!(py_int(" 1_0 "), Some(10));
        assert_eq!(py_int("1.5"), None);
    }

    #[test]
    fn hashes_dedup_in_order() {
        assert_eq!(hash_list(Some(&json!(["b", "a", "b"]))), ["b", "a"]);
        assert!(hash_list(None).is_empty());
        assert_eq!(json_int(&json!("12")), Some(12));
        assert_eq!(json_int(&json!(7.9)), Some(7));
    }
}

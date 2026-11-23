//! Read queries and row types for the `albums_tags` area: user / auto /
//! thing / place albums, tags, `/locclust/` and folder photo counts.
//!
//! List endpoints fetch one page with the total in the same statement
//! (`count(*) OVER ()`); relations (covers, `shared_to`, share settings) are
//! correlated subqueries, so every list is one round trip.

use sqlx::{Postgres, QueryBuilder};

pub mod auto_albums;
pub mod misc;
pub mod tags;
pub mod things_places;
pub mod user_albums;

use crate::scope::like_escape;

/// DRF `SearchFilter` terms: commas count as whitespace, quotes group words.
pub fn search_terms(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw else { return Vec::new() };
    let text = raw.replace('\0', "").replace(',', " ");
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for c in text.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => quote = Some(c),
            None if c.is_whitespace() => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            None => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// ` AND (<expr_1> ILIKE %term% OR ...)` per term: every term must match one
/// of the expressions (`icontains`).
pub(crate) fn push_search(qb: &mut QueryBuilder<'_, Postgres>, exprs: &[&str], terms: &[String]) {
    for term in terms {
        let pattern = format!("%{}%", like_escape(term));
        qb.push(" AND (");
        for (i, expr) in exprs.iter().enumerate() {
            if i > 0 {
                qb.push(" OR ");
            }
            qb.push(format!("{expr} ILIKE "));
            qb.push_bind(pattern.clone());
        }
        qb.push(")");
    }
}

/// `SimpleUserSerializer` as a `json` object (key order kept, unlike jsonb).
pub(crate) fn simple_user_json(u: &str) -> String {
    format!(
        "json_build_object('id', {u}.id, 'username', {u}.username, 'first_name', {u}.first_name, 'last_name', {u}.last_name)"
    )
}

/// `PhotoHashListSerializer` (`{image_hash, video}`) as a `json` object.
pub(crate) fn photo_hash_json(p: &str) -> String {
    format!("json_build_object('image_hash', {p}.image_hash, 'video', {p}.video)")
}

/// A page of rows plus the total the DRF envelope reports.
#[derive(Debug, Clone)]
pub struct Paged<T> {
    pub rows: Vec<T>,
    pub total: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terms() {
        assert_eq!(search_terms(Some("a, b  c")), vec!["a", "b", "c"]);
        assert_eq!(search_terms(Some("\"x y\" z")), vec!["x y", "z"]);
        assert!(search_terms(Some("  ")).is_empty());
        assert!(search_terms(None).is_empty());
    }
}

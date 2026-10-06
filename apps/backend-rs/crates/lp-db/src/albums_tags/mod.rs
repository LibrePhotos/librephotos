//! Read queries and row types for the `albums_tags` area: user / auto /
//! thing / place albums, tags, `/locclust/` and folder photo counts.
//!
//! List endpoints fetch one page with the total in the same statement
//! (`count(*) OVER ()`); relations (covers, `shared_to`, share settings) are
//! correlated subqueries, so every list is one round trip.

pub mod auto_albums;
pub mod misc;
pub mod tags;
pub mod things_places;
pub mod user_albums;

use crate::db::{Dialect, IntoArg, Qb, sql};
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
/// of the expressions (`icontains`; on SQLite `LIKE`, which folds ASCII case
/// only, as Django's SQLite backend).
pub(crate) fn push_search(qb: &mut Qb<'_>, exprs: &[&str], terms: &[String]) {
    for term in terms {
        let pattern = format!("%{}%", like_escape(term));
        qb.push(" AND (");
        for (i, expr) in exprs.iter().enumerate() {
            if i > 0 {
                qb.push(" OR ");
            }
            push_ilike(qb, expr, pattern.clone());
        }
        qb.push(")");
    }
}

/// `expr ILIKE $n` / `expr LIKE $n ESCAPE '\'` (Django `icontains` per
/// backend; the pattern is already `like_escape`d).
pub(crate) fn push_ilike(qb: &mut Qb<'_>, expr: &str, pattern: String) {
    let n = qb.bind_arg(pattern.into_arg());
    qb.push_dialect(
        format!("{expr} ILIKE ${n}"),
        sql::like(Dialect::Sqlite, expr, &format!("${n}")),
    );
}

/// The JSON object constructor: `json_build_object` (`json`, key order kept,
/// unlike jsonb) / `json_object`.
pub(crate) fn json_object(d: Dialect) -> &'static str {
    match d {
        Dialect::Pg => "json_build_object",
        Dialect::Sqlite => "json_object",
    }
}

/// A boolean column as a JSON value: SQLite stores 0/1, which `json_object`
/// would emit as a number.
pub(crate) fn json_bool(d: Dialect, expr: &str) -> String {
    match d {
        Dialect::Pg => expr.to_string(),
        Dialect::Sqlite => format!("json(CASE WHEN {expr} THEN 'true' ELSE 'false' END)"),
    }
}

/// `[expr, ..]` over the rows of the enclosing `SELECT .. FROM`, `'[]'` when
/// there are none: `COALESCE(json_agg(expr ORDER BY order), '[]'::json)` /
/// `json_group_array(json(expr) ORDER BY order)` (`json()` keeps a value
/// that came through a subquery an object instead of a string).
pub(crate) fn json_list(d: Dialect, expr: &str, order: &str) -> String {
    match d {
        Dialect::Pg => format!("COALESCE(json_agg({expr} ORDER BY {order}), '[]'::json)"),
        Dialect::Sqlite => format!("json_group_array(json({expr}) ORDER BY {order})"),
    }
}

/// `SimpleUserSerializer` as a JSON object (key order kept).
pub(crate) fn simple_user_json(d: Dialect, u: &str) -> String {
    format!(
        "{}('id', {u}.id, 'username', {u}.username, 'first_name', {u}.first_name, 'last_name', {u}.last_name)",
        json_object(d)
    )
}

/// `PhotoHashListSerializer` (`{image_hash, video}`) as a JSON object.
pub(crate) fn photo_hash_json(d: Dialect, p: &str) -> String {
    format!(
        "{}('image_hash', {p}.image_hash, 'video', {})",
        json_object(d),
        json_bool(d, &format!("{p}.video"))
    )
}

/// The order in which Django walks an album's unordered `photos.all()`:
/// heap order on Postgres; on SQLite the M2M table's `(album, photo_id)`
/// covering index hands out the members by photo id (`EXPLAIN QUERY PLAN`
/// of Django's query).
pub(crate) fn unordered_members(d: Dialect, p: &str) -> String {
    match d {
        Dialect::Pg => format!("{p}.ctid"),
        Dialect::Sqlite => format!("{p}.id"),
    }
}

/// The order of one photo's unordered `photo.faces.all()`: heap order on
/// Postgres, face id on SQLite (the `api_face.photo_id` index).
pub(crate) fn unordered_faces(d: Dialect, f: &str) -> String {
    match d {
        Dialect::Pg => format!("{f}.ctid"),
        Dialect::Sqlite => format!("{f}.id"),
    }
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

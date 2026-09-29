//! Authorization scopes (02 §4): named SQL fragments, each ported from one
//! Django concept. Never inline these conditions in area code.
//!
//! Every pusher appends ONE parenthesized boolean expression over the photo
//! table alias you pass (usually `"p"` for `api_photo p`) to a
//! `QueryBuilder`, binding its own parameters. Combine with `" AND "`:
//!
//! ```ignore
//! let mut qb = QueryBuilder::new("SELECT p.id FROM api_photo p WHERE ");
//! scope::owned_by(&mut qb, "p", user.id);
//! qb.push(" AND ");
//! scope::visible_manager(&mut qb, "p");
//! ```

use lp_core::extract::{QueryMap, py_truthy};
use lp_core::{ApiError, ApiResult};
use serde_json::Value;
use sqlx::{FromRow, PgExecutor, Postgres, QueryBuilder};
use uuid::Uuid;

/// `PhotoQuerySet.owned_by(user)`: `owner_id = user`.
pub fn owned_by(qb: &mut QueryBuilder<'_, Postgres>, p: &str, user_id: i32) {
    qb.push(format!("({p}.owner_id = "));
    qb.push_bind(user_id);
    qb.push(")");
}

/// `PhotoQuerySet.visible_to(user)`: public, or owned, or shared directly.
/// EXISTS, not a join: `api_photo_shared_to` lacks a unique pair and must
/// not duplicate rows. `None` = anonymous (public only).
pub fn visible_to(qb: &mut QueryBuilder<'_, Postgres>, p: &str, user_id: Option<i32>) {
    match user_id {
        None => {
            qb.push(format!("({p}.public)"));
        }
        Some(uid) => {
            qb.push(format!("({p}.public OR {p}.owner_id = "));
            qb.push_bind(uid);
            qb.push(format!(
                " OR EXISTS (SELECT 1 FROM api_photo_shared_to st WHERE st.photo_id = {p}.id AND st.user_id = "
            ));
            qb.push_bind(uid);
            qb.push("))");
        }
    }
}

/// `Photo.visible` manager: not hidden/trashed/removed and a thumbnail with
/// an aspect ratio (i.e. processed).
pub fn visible_manager(qb: &mut QueryBuilder<'_, Postgres>, p: &str) {
    qb.push(format!(
        "(NOT {p}.hidden AND NOT {p}.in_trashcan AND NOT {p}.removed AND {})",
        has_thumbnail_sql(p)
    ));
}

/// `thumbnail__aspect_ratio__isnull=False`.
pub fn has_thumbnail_sql(p: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM api_thumbnail th WHERE th.photo_id = {p}.id AND th.aspect_ratio IS NOT NULL)"
    )
}

/// `Q(stacks__isnull=True) | Q(primary_in_stack__isnull=False)`: not in any
/// stack, or the primary photo of some stack.
pub fn stack_visible_sql(p: &str) -> String {
    format!(
        "(NOT EXISTS (SELECT 1 FROM api_photo_stacks sx WHERE sx.photo_id = {p}.id) \
         OR EXISTS (SELECT 1 FROM api_photostack sp WHERE sp.primary_photo_id = {p}.id))"
    )
}

/// `faces__person__id = person`.
pub fn person(qb: &mut QueryBuilder<'_, Postgres>, p: &str, person_id: i64) {
    qb.push(format!(
        "EXISTS (SELECT 1 FROM api_face fx WHERE fx.photo_id = {p}.id AND fx.person_id = "
    ));
    qb.push_bind(person_id as i32);
    qb.push(")");
}

/// `tags__id = tag`.
pub fn tag(qb: &mut QueryBuilder<'_, Postgres>, p: &str, tag_id: i64) {
    qb.push(format!(
        "EXISTS (SELECT 1 FROM api_tag_photos tx WHERE tx.photo_id = {p}.id AND tx.tag_id = "
    ));
    qb.push_bind(tag_id as i32);
    qb.push(")");
}

/// `folder_path_q("files__path", folder)`: any of the photo's files lies
/// inside `folder` (anchored on a separator, so `/a/b` doesn't match `/a/bc`).
pub fn folder(qb: &mut QueryBuilder<'_, Postgres>, p: &str, folder: &str) {
    qb.push(format!(
        "EXISTS (SELECT 1 FROM api_photo_files pfx JOIN api_file fx ON fx.hash = pfx.file_id \
         WHERE pfx.photo_id = {p}.id AND ("
    ));
    for (i, prefix) in folder_path_prefixes(folder).into_iter().enumerate() {
        if i > 0 {
            qb.push(" OR ");
        }
        qb.push("fx.path LIKE ");
        qb.push_bind(format!("{}%", like_escape(&prefix)));
    }
    qb.push("))");
}

/// Port of `api.util.folder_path_prefixes`.
pub fn folder_path_prefixes(folder_path: &str) -> Vec<String> {
    let stripped = folder_path.trim_end_matches(['/', '\\']);
    let b = folder_path.as_bytes();
    let windows_path = (b.len() >= 2
        && b[0].is_ascii_alphabetic()
        && b[1] == b':'
        && (b.len() == 2 || b[2] == b'\\' || b[2] == b'/'))
        || folder_path.starts_with("\\\\");
    if windows_path || (stripped.contains('\\') && !stripped.starts_with('/')) {
        vec![format!("{stripped}\\"), format!("{stripped}/")]
    } else {
        vec![format!("{stripped}/")]
    }
}

/// Django's `prep_for_like_query`: escape `\`, `%`, `_` for `LIKE` (default escape `\`).
pub fn like_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Parameters of `build_photo_queryset` (`api/views/photo_filters.py`).
/// Booleans follow Django truthiness: any non-empty query value is true.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PhotoFilterParams {
    pub favorite: bool,
    pub public: bool,
    pub hidden: bool,
    pub in_trashcan: bool,
    pub video: bool,
    pub photo: bool,
    pub is_screenshot: bool,
    pub is_document: bool,
    pub person: Option<i64>,
    pub tag: Option<i64>,
    pub folder: Option<String>,
    pub show_all_stack_photos: bool,
}

fn parse_id(field: &str, raw: &str) -> ApiResult<i64> {
    raw.trim().parse().map_err(|_| {
        ApiError::bad_request(
            field,
            format!("Field '{field}' expected a number but got '{raw}'."),
        )
    })
}

impl PhotoFilterParams {
    pub fn from_query(q: &QueryMap) -> ApiResult<Self> {
        Ok(PhotoFilterParams {
            favorite: q.flag("favorite"),
            public: q.flag("public"),
            hidden: q.flag("hidden"),
            in_trashcan: q.flag("in_trashcan"),
            video: q.flag("video"),
            photo: q.flag("photo"),
            is_screenshot: q.flag("is_screenshot"),
            is_document: q.flag("is_document"),
            person: q
                .non_empty("person")
                .map(|v| parse_id("person", v))
                .transpose()?,
            tag: q.non_empty("tag").map(|v| parse_id("tag", v)).transpose()?,
            folder: q.non_empty("folder").map(str::to_string),
            show_all_stack_photos: q.flag("show_all_stack_photos"),
        })
    }

    /// From the `query` object of a select-all bulk request body.
    pub fn from_json(v: &Value) -> ApiResult<Self> {
        let get = |k: &str| v.get(k).filter(|x| py_truthy(x));
        let id = |k: &str| -> ApiResult<Option<i64>> {
            match get(k) {
                None => Ok(None),
                Some(Value::Number(n)) => n
                    .as_i64()
                    .map(Some)
                    .ok_or_else(|| ApiError::bad_request(k, "expected an integer")),
                Some(Value::String(s)) => parse_id(k, s).map(Some),
                Some(_) => Err(ApiError::bad_request(k, "expected an integer")),
            }
        };
        Ok(PhotoFilterParams {
            favorite: get("favorite").is_some(),
            public: get("public").is_some(),
            hidden: get("hidden").is_some(),
            in_trashcan: get("in_trashcan").is_some(),
            video: get("video").is_some(),
            photo: get("photo").is_some(),
            is_screenshot: get("is_screenshot").is_some(),
            is_document: get("is_document").is_some(),
            person: id("person")?,
            tag: id("tag")?,
            folder: get("folder").and_then(|x| x.as_str()).map(str::to_string),
            show_all_stack_photos: get("show_all_stack_photos").is_some(),
        })
    }
}

/// `build_photo_queryset(user, params)`: the user's OWN photos matching a
/// select-all query (always owner-scoped; nothing in params can widen it).
/// Pushes one parenthesized expression over alias `p`.
pub fn photo_filters(
    qb: &mut QueryBuilder<'_, Postgres>,
    p: &str,
    user_id: i32,
    favorite_min_rating: i32,
    params: &PhotoFilterParams,
) {
    qb.push("(");
    owned_by(qb, p, user_id);
    qb.push(format!(" AND {}", has_thumbnail_sql(p)));
    if params.favorite {
        qb.push(format!(" AND {p}.rating >= "));
        qb.push_bind(favorite_min_rating);
    }
    if params.public {
        qb.push(format!(" AND {p}.public"));
    }
    qb.push(format!(" AND {p}.hidden = "));
    qb.push_bind(params.hidden);
    if params.video {
        qb.push(format!(" AND {p}.video"));
    } else if params.photo {
        qb.push(format!(" AND NOT {p}.video"));
    }
    if params.is_screenshot {
        qb.push(format!(" AND {p}.is_screenshot"));
    }
    if params.is_document {
        qb.push(format!(" AND {p}.is_document"));
    }
    if params.in_trashcan {
        qb.push(format!(" AND {p}.in_trashcan AND NOT {p}.removed"));
    } else {
        qb.push(format!(" AND NOT {p}.in_trashcan"));
    }
    if let Some(person_id) = params.person {
        qb.push(" AND ");
        person(qb, p, person_id);
    }
    if let Some(tag_id) = params.tag {
        qb.push(" AND ");
        tag(qb, p, tag_id);
    }
    if let Some(f) = &params.folder {
        qb.push(" AND ");
        folder(qb, p, f);
    }
    if !params.show_all_stack_photos {
        qb.push(format!(" AND {}", stack_visible_sql(p)));
    }
    qb.push(")");
}

/// Everything the media views' grant order needs about one photo and one
/// requester, in one query (port of `api/views/media.py`). An album share
/// vouches ONLY for the album owner's photos (GHSA-phvg-g65q-rhq3).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, FromRow)]
pub struct PhotoGrants {
    /// `photo.owner_id == user.id`
    pub is_owner: bool,
    /// `photo.shared_to` contains the user
    pub shared_directly: bool,
    /// one of the OWNER's albums containing the photo is shared to the user
    pub album_shared_to_user: bool,
    /// one of the OWNER's albums containing the photo has an active public share
    pub in_public_album: bool,
    /// `Photo.visible.visible_to(None)` contains it
    pub is_public_photo: bool,
}

impl PhotoGrants {
    /// `_may_access`: owner, direct share, or via one of the owner's albums.
    pub fn may_access(&self) -> bool {
        self.is_owner || self.shared_directly || self.album_shared_to_user || self.in_public_album
    }
}

pub async fn album_share_grants<'e>(
    db: impl PgExecutor<'e>,
    photo_id: Uuid,
    user_id: Option<i32>,
) -> sqlx::Result<Option<PhotoGrants>> {
    sqlx::query_as::<_, PhotoGrants>(&format!(
        "SELECT \
           COALESCE(p.owner_id = $2, FALSE) AS is_owner, \
           ($2::int IS NOT NULL AND EXISTS (SELECT 1 FROM api_photo_shared_to st \
              WHERE st.photo_id = p.id AND st.user_id = $2)) AS shared_directly, \
           ($2::int IS NOT NULL AND EXISTS (SELECT 1 FROM api_albumuser_photos ap \
              JOIN api_albumuser a ON a.id = ap.albumuser_id \
              JOIN api_albumuser_shared_to ast ON ast.albumuser_id = a.id \
              WHERE ap.photo_id = p.id AND a.owner_id = p.owner_id AND ast.user_id = $2)) AS album_shared_to_user, \
           EXISTS (SELECT 1 FROM api_albumuser_photos ap \
              JOIN api_albumuser a ON a.id = ap.albumuser_id \
              JOIN api_albumusershare s ON s.album_id = a.id \
              WHERE ap.photo_id = p.id AND a.owner_id = p.owner_id AND s.enabled \
                AND (s.expires_at IS NULL OR s.expires_at >= now())) AS in_public_album, \
           (p.public AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed AND {}) AS is_public_photo \
         FROM api_photo p WHERE p.id = $1",
        has_thumbnail_sql("p")
    ))
    .bind(photo_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes() {
        assert_eq!(folder_path_prefixes("/photos/test/"), vec!["/photos/test/"]);
        assert_eq!(
            folder_path_prefixes("C:\\data"),
            vec!["C:\\data\\", "C:\\data/"]
        );
        assert_eq!(
            folder_path_prefixes("C:/data/x"),
            vec!["C:/data/x\\", "C:/data/x/"]
        );
        assert_eq!(
            folder_path_prefixes("\\\\host\\share"),
            vec!["\\\\host\\share\\", "\\\\host\\share/"]
        );
        assert_eq!(
            folder_path_prefixes("rel\\dir"),
            vec!["rel\\dir\\", "rel\\dir/"]
        );
        assert_eq!(like_escape("a_b%c\\"), "a\\_b\\%c\\\\");
    }

    #[test]
    fn filter_sql_shape() {
        let mut qb = QueryBuilder::<Postgres>::new("SELECT p.id FROM api_photo p WHERE ");
        let params = PhotoFilterParams {
            favorite: true,
            person: Some(3),
            folder: Some("/data".into()),
            ..Default::default()
        };
        photo_filters(&mut qb, "p", 7, 4, &params);
        let sql = qb.sql();
        assert!(sql.contains("p.owner_id = $1"));
        assert!(sql.contains("p.rating >= $2"));
        assert!(sql.contains("fx.person_id = $4"));
        assert!(sql.contains("fx.path LIKE $5"));
        assert!(sql.contains("NOT p.in_trashcan"));
    }

    #[test]
    fn params_truthiness() {
        let q = QueryMap::parse(Some("favorite=false&hidden=&person=5"));
        let p = PhotoFilterParams::from_query(&q).unwrap();
        assert!(p.favorite && !p.hidden);
        assert_eq!(p.person, Some(5));
        assert!(PhotoFilterParams::from_query(&QueryMap::parse(Some("person=x"))).is_err());
        let j = serde_json::json!({"video": true, "photo": false, "tag": "2", "folder": ""});
        let p = PhotoFilterParams::from_json(&j).unwrap();
        assert!(p.video && !p.photo);
        assert_eq!(p.tag, Some(2));
        assert_eq!(p.folder, None);
    }
}

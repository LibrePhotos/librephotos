//! `/photos/searchlist/`: port of `SearchListViewSet` + `SemanticSearchFilter`
//! (DRF `SearchFilter` over `search_captions`, `search_location`, `tags__name`,
//! `exif_timestamp`, plus the OCR full-text match and semantic hits).

use sqlx::{PgExecutor, Postgres, QueryBuilder};

use crate::pig::{self, PigPhoto};
use crate::scope::{self, like_escape};

/// Media narrowing applied before the search terms (`video` wins over `photo`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MediaFilter {
    pub video: bool,
    pub photo: bool,
    pub is_screenshot: bool,
    pub is_document: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct SearchQuery<'a> {
    pub user_id: i32,
    pub media: MediaFilter,
    /// Already split like DRF `search_smart_split`; empty = no text filter.
    pub terms: &'a [String],
    /// Image hashes from the similarity sidecar, OR-ed into every term.
    pub semantic_hashes: Option<&'a [String]>,
}

/// Photos matching the search, newest first (`-exif_timestamp`, NULLs first
/// as on Postgres; `id` breaks ties so the order is stable).
pub async fn photos<'e>(
    db: impl PgExecutor<'e>,
    q: &SearchQuery<'_>,
) -> sqlx::Result<Vec<PigPhoto>> {
    let mut qb = pig::query();
    qb.push(" WHERE ");
    scope::owned_by(&mut qb, "p", q.user_id);
    qb.push(" AND ");
    scope::visible_manager(&mut qb, "p");
    if q.media.video {
        qb.push(" AND p.video");
    } else if q.media.photo {
        qb.push(" AND NOT p.video");
    }
    if q.media.is_screenshot {
        qb.push(" AND p.is_screenshot");
    }
    if q.media.is_document {
        qb.push(" AND p.is_document");
    }
    if !q.terms.is_empty() {
        push_terms(&mut qb, q.terms, q.semantic_hashes);
    }
    qb.push(" ORDER BY p.exif_timestamp DESC, p.id");
    pig::fetch(&mut qb, db).await
}

/// Django filters all terms in ONE `filter()` call, so the `tags` join is
/// shared: a photo matches when a single tag row (or, without tags, the
/// NULL row of the LEFT JOIN) satisfies every term. Equivalent form:
/// every term matches without tags, OR some tag makes every term match.
fn push_terms(qb: &mut QueryBuilder<'_, Postgres>, terms: &[String], semantic: Option<&[String]>) {
    qb.push(" AND ((");
    for (i, term) in terms.iter().enumerate() {
        if i > 0 {
            qb.push(" AND ");
        }
        push_term_without_tags(qb, term, semantic);
    }
    qb.push(
        ") OR EXISTS (SELECT 1 FROM api_tag_photos stp JOIN api_tag stg ON stg.id = stp.tag_id \
             WHERE stp.photo_id = p.id",
    );
    for term in terms {
        qb.push(" AND (");
        push_term_without_tags(qb, term, semantic);
        qb.push(" OR UPPER(stg.name::text) LIKE UPPER(");
        qb.push_bind(pattern(term));
        qb.push("))");
    }
    qb.push("))");
}

fn pattern(term: &str) -> String {
    format!("%{}%", like_escape(term))
}

/// `icontains` on the PhotoSearch fields and the timestamp text (Django's
/// `exif_timestamp::text` on a UTC session), the OCR full-text match (the
/// expression of the GIN index `api_photo_ocr_text_fts`), and semantic hits.
fn push_term_without_tags(
    qb: &mut QueryBuilder<'_, Postgres>,
    term: &str,
    semantic: Option<&[String]>,
) {
    let pat = pattern(term);
    qb.push("(UPPER(pig_s.search_captions::text) LIKE UPPER(");
    qb.push_bind(pat.clone());
    qb.push(") OR UPPER(pig_s.search_location::text) LIKE UPPER(");
    qb.push_bind(pat.clone());
    qb.push(") OR UPPER((p.exif_timestamp AT TIME ZONE 'UTC')::text || '+00') LIKE UPPER(");
    qb.push_bind(pat);
    qb.push(
        ") OR p.id IN (SELECT so.photo_id FROM api_photo_ocr so \
         WHERE to_tsvector('simple'::regconfig, COALESCE(so.text, '')) @@ plainto_tsquery('simple'::regconfig, ",
    );
    qb.push_bind(term.to_string());
    qb.push("))");
    if let Some(hashes) = semantic {
        qb.push(" OR p.image_hash = ANY(");
        qb.push_bind(hashes.to_vec());
        qb.push(")");
    }
    qb.push(")");
}

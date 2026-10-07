//! `/photos/searchlist/`: port of `SearchListViewSet` + `SemanticSearchFilter`
//! (DRF `SearchFilter` over `search_captions`, `search_location`, `tags__name`,
//! `exif_timestamp`, plus the OCR full-text match and semantic hits).

use crate::db::{Dialect, Exec, IntoArg, Qb, sql};
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
pub async fn photos<'e>(db: impl Exec<'e>, q: &SearchQuery<'_>) -> sqlx::Result<Vec<PigPhoto>> {
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
/// Django filters all terms in ONE `filter()` call, so the `tags` join is
/// shared: a photo matches when a single tag row (or, without tags, the
/// NULL row of the LEFT JOIN) satisfies every term. Equivalent form:
/// every term matches without tags, OR some tag makes every term match.
fn push_terms(qb: &mut Qb<'_>, terms: &[String], semantic: Option<&[String]>) {
    qb.push(" AND ((");
    for (i, term) in terms.iter().enumerate() {
        if i > 0 {
            qb.push(" AND ");
        }
        push_term_without_tags(qb, term, semantic, "p", "pig_s");
    }
    // Uncorrelated, so Postgres hashes it once: as a correlated EXISTS it ran
    // a tag scan for every photo the text branch rejected.
    qb.push(
        ") OR p.id IN (SELECT stp.photo_id FROM api_tag_photos stp \
             JOIN api_tag stg ON stg.id = stp.tag_id \
             JOIN api_photo sp ON sp.id = stp.photo_id \
             LEFT JOIN api_photo_search sps ON sps.photo_id = sp.id WHERE TRUE",
    );
    for term in terms {
        qb.push(" AND (");
        push_term_without_tags(qb, term, semantic, "sp", "sps");
        qb.push(" OR ");
        push_icontains(qb, "stg.name", term);
        qb.push(")");
    }
    qb.push("))");
}

fn pattern(term: &str) -> String {
    format!("%{}%", like_escape(term))
}

/// Django `icontains` of `term` on `col` (`sql::ilike`): `UPPER(col::text)
/// LIKE UPPER(pat)` on Postgres, `col LIKE pat ESCAPE '\'` on SQLite (ASCII
/// case folding only, as Django on SQLite).
fn push_icontains(qb: &mut Qb<'_>, col: &str, term: &str) {
    let n = qb.bind_arg(pattern(term).into_arg());
    let pat = format!("${n}");
    qb.push_with(|d| sql::ilike(d, col, &pat));
}

/// `icontains` on the PhotoSearch fields and the timestamp text, the OCR
/// match, and semantic hits.
///
/// - `exif_timestamp`: Django's `exif_timestamp::text` on a UTC session on
///   Postgres (`YYYY-MM-DD HH:MM:SS[.ffffff]+00`); the stored text on SQLite
///   (`YYYY-MM-DD HH:MM:SS[.ffffff]`, no offset).
/// - OCR: the full-text match on Postgres (the expression of the GIN index
///   `api_photo_ocr_text_fts`); `ocr__text__icontains` on SQLite
///   (`build_ocr_search_q`'s non-Postgres branch).
fn push_term_without_tags(
    qb: &mut Qb<'_>,
    term: &str,
    semantic: Option<&[String]>,
    p: &str,
    s: &str,
) {
    qb.push("(");
    push_icontains(qb, &format!("{s}.search_captions"), term);
    qb.push(" OR ");
    push_icontains(qb, &format!("{s}.search_location"), term);
    qb.push(" OR ");
    let n = qb.bind_arg(pattern(term).into_arg());
    qb.push_dialect(
        format!("UPPER(({p}.exif_timestamp AT TIME ZONE 'UTC')::text || '+00') LIKE UPPER(${n})"),
        sql::like(
            Dialect::Sqlite,
            &format!("{p}.exif_timestamp"),
            &format!("${n}"),
        ),
    );
    qb.push(format!(
        " OR {p}.id IN (SELECT so.photo_id FROM api_photo_ocr so WHERE "
    ));
    let n = qb.bind_arg(term.to_string().into_arg());
    let m = qb.bind_arg(pattern(term).into_arg());
    qb.push_dialect(
        format!(
            "to_tsvector('simple'::regconfig, COALESCE(so.text, '')) \
             @@ plainto_tsquery('simple'::regconfig, ${n})"
        ),
        sql::like(Dialect::Sqlite, "so.text", &format!("${m}")),
    );
    qb.push(")");
    if let Some(hashes) = semantic {
        qb.push(" OR ");
        sql::any(qb, &format!("{p}.image_hash"), hashes.to_vec());
    }
    qb.push(")");
}

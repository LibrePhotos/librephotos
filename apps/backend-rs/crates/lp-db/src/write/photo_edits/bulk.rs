//! `BulkPhotoMutationView` and its four subclasses (`/photosedit/favorite`,
//! `hide`, `setdeleted`, `makepublic`): one flag on many of the requester's
//! photos, in one UPDATE.

use std::collections::HashSet;

use sqlx::{FromRow, PgConnection, Postgres, QueryBuilder};
use uuid::Uuid;

use super::{refresh_tag_photo_counts, tag_ids_for_photos};
use crate::scope::{self, PhotoFilterParams};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flag {
    /// `SetPhotosDeleted` (`in_trashcan`); S20 tag counts, stack reviews on restore.
    Deleted,
    /// `SetPhotosFavorite` (`rating`); S16 rating write-back.
    Favorite,
    /// `SetPhotosHidden`; S20 tag counts.
    Hidden,
    /// `SetPhotosPublic`.
    Public,
}

impl Flag {
    fn refreshes_tag_counts(self) -> bool {
        matches!(self, Flag::Deleted | Flag::Hidden)
    }

    fn select_all_only_changed(self) -> bool {
        matches!(self, Flag::Favorite)
    }

    /// `differs(user, value)` over alias `p`.
    fn push_differs(
        self,
        qb: &mut QueryBuilder<'_, Postgres>,
        value: bool,
        favorite_min_rating: i32,
    ) {
        match self {
            Flag::Deleted => {
                qb.push("(p.in_trashcan <> ");
                qb.push_bind(value);
            }
            Flag::Hidden => {
                qb.push("(p.hidden <> ");
                qb.push_bind(value);
            }
            Flag::Public => {
                qb.push("(p.public <> ");
                qb.push_bind(value);
            }
            Flag::Favorite => {
                qb.push(if value {
                    "(p.rating < "
                } else {
                    "(p.rating >= "
                });
                qb.push_bind(favorite_min_rating);
            }
        }
        qb.push(")");
    }

    /// `new_values(user, value)` as a SET clause.
    fn push_set(self, qb: &mut QueryBuilder<'_, Postgres>, value: bool, favorite_min_rating: i32) {
        match self {
            Flag::Deleted => {
                qb.push("in_trashcan = ");
                qb.push_bind(value);
            }
            Flag::Hidden => {
                qb.push("hidden = ");
                qb.push_bind(value);
            }
            Flag::Public => {
                qb.push("public = ");
                qb.push_bind(value);
            }
            Flag::Favorite => {
                qb.push("rating = ");
                qb.push_bind(if value { favorite_min_rating } else { 0 });
            }
        }
    }
}

/// Which photos a bulk request names.
#[derive(Debug, Clone)]
pub enum Selection {
    Hashes(Vec<String>),
    SelectAll {
        params: PhotoFilterParams,
        excluded_hashes: Vec<String>,
    },
}

#[derive(Debug, Clone, Default)]
pub struct BulkOutcome {
    pub count: u64,
    /// Only for [`Selection::Hashes`].
    pub hashes: Option<(Vec<String>, Vec<String>)>,
    /// Every photo the UPDATE touched (for the S16 rating write).
    pub touched: Vec<Uuid>,
}

#[derive(FromRow)]
struct HashRow {
    id: Uuid,
    image_hash: String,
    changing: bool,
}

/// `build_photo_queryset(user, query)` minus `excluded_hashes`, pushed as a
/// WHERE body over alias `p`.
pub fn push_select_all(
    qb: &mut QueryBuilder<'_, Postgres>,
    user_id: i32,
    favorite_min_rating: i32,
    params: &PhotoFilterParams,
    excluded_hashes: &[String],
) {
    scope::photo_filters(qb, "p", user_id, favorite_min_rating, params);
    if !excluded_hashes.is_empty() {
        qb.push(" AND NOT (p.image_hash = ANY(");
        qb.push_bind(excluded_hashes.to_vec());
        qb.push("))");
    }
}

pub async fn apply(
    conn: &mut PgConnection,
    user_id: i32,
    favorite_min_rating: i32,
    flag: Flag,
    value: bool,
    selection: &Selection,
) -> sqlx::Result<BulkOutcome> {
    match selection {
        Selection::SelectAll {
            params,
            excluded_hashes,
        } => {
            let mut qb = QueryBuilder::new("SELECT p.id FROM api_photo p WHERE ");
            push_select_all(
                &mut qb,
                user_id,
                favorite_min_rating,
                params,
                excluded_hashes,
            );
            if flag.select_all_only_changed() {
                qb.push(" AND ");
                flag.push_differs(&mut qb, value, favorite_min_rating);
            }
            let ids: Vec<Uuid> = qb.build_query_scalar().fetch_all(&mut *conn).await?;
            let count = update(conn, flag, value, favorite_min_rating, &ids).await?;
            Ok(BulkOutcome {
                count,
                hashes: None,
                touched: ids,
            })
        }
        Selection::Hashes(requested) => {
            let mut qb = QueryBuilder::new("SELECT p.id, p.image_hash, ");
            flag.push_differs(&mut qb, value, favorite_min_rating);
            qb.push(" AS changing FROM api_photo p WHERE ");
            scope::owned_by(&mut qb, "p", user_id);
            qb.push(" AND p.image_hash = ANY(");
            qb.push_bind(requested.clone());
            qb.push(")");
            let rows: Vec<HashRow> = qb.build_query_as().fetch_all(&mut *conn).await?;

            let found: HashSet<&str> = rows.iter().map(|r| r.image_hash.as_str()).collect();
            let changing: HashSet<&str> = rows
                .iter()
                .filter(|r| r.changing)
                .map(|r| r.image_hash.as_str())
                .collect();
            let mut seen = HashSet::new();
            let unique: Vec<&String> = requested
                .iter()
                .filter(|h| seen.insert(h.as_str()))
                .collect();
            let updated: Vec<String> = unique
                .iter()
                .filter(|h| changing.contains(h.as_str()))
                .map(|h| h.to_string())
                .collect();
            let not_updated: Vec<String> = unique
                .iter()
                .filter(|h| found.contains(h.as_str()) && !changing.contains(h.as_str()))
                .map(|h| h.to_string())
                .collect();
            // Every owned row carrying an updated hash, as Django re-filters by hash.
            let ids: Vec<Uuid> = rows
                .iter()
                .filter(|r| changing.contains(r.image_hash.as_str()))
                .map(|r| r.id)
                .collect();
            if !ids.is_empty() {
                update(conn, flag, value, favorite_min_rating, &ids).await?;
            }
            Ok(BulkOutcome {
                count: updated.len() as u64,
                hashes: Some((updated, not_updated)),
                touched: ids,
            })
        }
    }
}

async fn update(
    conn: &mut PgConnection,
    flag: Flag,
    value: bool,
    favorite_min_rating: i32,
    ids: &[Uuid],
) -> sqlx::Result<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tag_ids = if flag.refreshes_tag_counts() {
        tag_ids_for_photos(conn, ids).await?
    } else {
        Vec::new()
    };
    if flag == Flag::Deleted && !value {
        // A restored photo re-enters its stacks: their reviews go back to pending.
        sqlx::query(
            "UPDATE api_stackreview SET decision = 'pending' WHERE decision = 'resolved' \
             AND stack_id IN (SELECT photostack_id FROM api_photo_stacks WHERE photo_id = ANY($1))",
        )
        .bind(ids)
        .execute(&mut *conn)
        .await?;
    }
    let mut qb = QueryBuilder::new("UPDATE api_photo SET ");
    flag.push_set(&mut qb, value, favorite_min_rating);
    qb.push(", last_modified = now() WHERE id = ANY(");
    qb.push_bind(ids.to_vec());
    qb.push(")");
    let n = qb.build().execute(&mut *conn).await?.rows_affected();
    refresh_tag_photo_counts(conn, &tag_ids).await?;
    Ok(n)
}

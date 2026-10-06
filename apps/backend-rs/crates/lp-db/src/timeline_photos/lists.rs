//! `RecentlyAddedPhotoListViewSet` and `NoTimestampPhotoViewSet`.

use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::{Exec, Qb};
use crate::pig::{PIG_COLUMNS, PIG_JOINS, PigPhoto, PigRow};
use crate::scope;

#[derive(Debug, FromRow)]
struct RecentRow {
    latest_at: DateTime<Utc>,
    #[sqlx(flatten)]
    pig: PigRow,
}

fn push_visible_own(qb: &mut Qb<'_>, user_id: i32) {
    scope::owned_by(qb, "p", user_id);
    qb.push(" AND ");
    scope::visible_manager(qb, "p");
}

/// `GET /photos/recentlyadded/`: the owner's visible photos added on the
/// (UTC) day of the most recent upload, newest first, plus that upload's
/// `added_on`. `(None, [])` for an empty library.
pub async fn recently_added<'e>(
    db: impl Exec<'e>,
    user_id: i32,
) -> sqlx::Result<(Option<DateTime<Utc>>, Vec<PigPhoto>)> {
    let mut qb = Qb::new("WITH latest AS (SELECT max(p.added_on) AS at FROM api_photo p WHERE ");
    push_visible_own(&mut qb, user_id);
    qb.push(format!(
        ") SELECT latest.at AS latest_at, {PIG_COLUMNS} FROM api_photo p{PIG_JOINS} CROSS JOIN latest WHERE "
    ));
    push_visible_own(&mut qb, user_id);
    qb.push(
        " AND (p.added_on AT TIME ZONE 'UTC')::date = (latest.at AT TIME ZONE 'UTC')::date \
         ORDER BY p.added_on DESC, p.id",
    );
    let rows: Vec<RecentRow> = qb.build_query_as().fetch_all(db).await?;
    let latest = rows.first().map(|r| r.latest_at);
    Ok((latest, rows.into_iter().map(|r| r.pig.into()).collect()))
}

#[derive(Debug, FromRow)]
struct CountedRow {
    total: i64,
    #[sqlx(flatten)]
    pig: PigRow,
}

fn push_no_timestamp(qb: &mut Qb<'_>, user_id: i32) {
    qb.push("SELECT p.id, p.added_on, count(*) OVER () AS total FROM api_photo p WHERE ");
    push_visible_own(qb, user_id);
    qb.push(" AND p.exif_timestamp IS NULL");
}

/// Number of the owner's visible photos without a timestamp.
pub async fn no_timestamp_count<'e>(db: impl Exec<'e>, user_id: i32) -> sqlx::Result<i64> {
    let mut qb = Qb::new("SELECT count(*) FROM api_photo p WHERE ");
    push_visible_own(&mut qb, user_id);
    qb.push(" AND p.exif_timestamp IS NULL");
    qb.build_query_scalar().fetch_one(db).await
}

/// `GET /photos/notimestamp/`: one page (oldest upload first) and the total.
/// An empty page reports a total of 0; the caller decides whether that
/// means an empty library or a page past the end.
pub async fn no_timestamp_page<'e>(
    db: impl Exec<'e>,
    user_id: i32,
    offset: i64,
    limit: i64,
) -> sqlx::Result<(i64, Vec<PigPhoto>)> {
    let mut qb = Qb::new("WITH sel AS (");
    push_no_timestamp(&mut qb, user_id);
    qb.push(" ORDER BY p.added_on, p.id LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);
    qb.push(format!(
        ") SELECT sel.total, {PIG_COLUMNS} FROM sel JOIN api_photo p ON p.id = sel.id{PIG_JOINS} \
         ORDER BY sel.added_on, sel.id"
    ));
    let rows: Vec<CountedRow> = qb.build_query_as().fetch_all(db).await?;
    let total = rows.first().map(|r| r.total).unwrap_or(0);
    Ok((total, rows.into_iter().map(|r| r.pig.into()).collect()))
}

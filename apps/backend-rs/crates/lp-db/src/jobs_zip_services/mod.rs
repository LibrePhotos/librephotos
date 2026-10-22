//! Read queries and row types for the `jobs_zip_services` area (owned by that area).

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgExecutor, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::scope::{self, PhotoFilterParams};

/// `api_longrunningjob` + its `started_by` user (`LongRunningJobSerializer`).
#[derive(Debug, Clone, FromRow)]
pub struct JobRow {
    pub id: i32,
    pub job_type: i32,
    pub finished: bool,
    pub failed: bool,
    pub cancelled: bool,
    pub job_id: String,
    pub queued_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub progress_current: i32,
    pub progress_target: i32,
    pub progress_step: Option<String>,
    pub result: Option<Value>,
    pub user_id: i32,
    pub username: String,
    pub first_name: String,
    pub last_name: String,
}

const JOB_SELECT: &str = "SELECT j.id, j.job_type, j.finished, j.failed, j.cancelled, j.job_id, \
    j.queued_at, j.started_at, j.finished_at, j.progress_current, j.progress_target, \
    j.progress_step, j.result, u.id AS user_id, u.username, u.first_name, u.last_name \
    FROM api_longrunningjob j JOIN api_user u ON u.id = j.started_by_id";

/// `/api/jobs/` page, newest `started_at` first (NULLs first, as Postgres
/// sorts `-started_at`); ties in insertion order, like Django's plain scan.
/// `owner` = None is the staff-wide view.
pub async fn list_jobs(
    db: &PgPool,
    owner: Option<i32>,
    limit: i64,
    offset: i64,
) -> sqlx::Result<Vec<JobRow>> {
    sqlx::query_as::<_, JobRow>(&format!(
        "{JOB_SELECT} WHERE ($1::int IS NULL OR j.started_by_id = $1) \
         ORDER BY j.started_at DESC NULLS FIRST, j.id LIMIT $2 OFFSET $3"
    ))
    .bind(owner)
    .bind(limit)
    .bind(offset)
    .fetch_all(db)
    .await
}

pub async fn count_jobs(db: &PgPool, owner: Option<i32>) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM api_longrunningjob WHERE ($1::int IS NULL OR started_by_id = $1)",
    )
    .bind(owner)
    .fetch_one(db)
    .await
}

/// One job by primary key within the caller's scope.
pub async fn job_by_pk<'e>(
    db: impl PgExecutor<'e>,
    id: i32,
    owner: Option<i32>,
) -> sqlx::Result<Option<JobRow>> {
    sqlx::query_as::<_, JobRow>(&format!(
        "{JOB_SELECT} WHERE j.id = $1 AND ($2::int IS NULL OR j.started_by_id = $2)"
    ))
    .bind(id)
    .bind(owner)
    .fetch_optional(db)
    .await
}

/// `QueueAvailabilityView`: the unfinished job that blocks the queue,
/// ignoring rows older than `stuck_hours` (Django: `.order_by("-started_at").last()`).
pub async fn blocking_job(db: &PgPool, stuck_hours: i32) -> sqlx::Result<Option<JobRow>> {
    sqlx::query_as::<_, JobRow>(&format!(
        "{JOB_SELECT} WHERE NOT j.finished AND ( \
           j.started_at >= now() - make_interval(hours => $1) \
           OR (j.started_at IS NULL AND j.queued_at >= now() - make_interval(hours => $1))) \
         ORDER BY j.started_at ASC NULLS LAST, j.id ASC LIMIT 1"
    ))
    .bind(stuck_hours)
    .fetch_optional(db)
    .await
}

/// State of a download job the user started (`GET /api/photos/download?job_id=`).
#[derive(Debug, Clone, FromRow)]
pub struct DownloadJobState {
    pub finished: bool,
    pub failed: bool,
    pub result: Option<Value>,
}

pub async fn download_job_state(
    db: &PgPool,
    job_id: &str,
    user_id: i32,
) -> sqlx::Result<Option<DownloadJobState>> {
    sqlx::query_as::<_, DownloadJobState>(
        "SELECT finished, failed, result FROM api_longrunningjob \
         WHERE job_id = $1 AND started_by_id = $2 LIMIT 1",
    )
    .bind(job_id)
    .bind(user_id)
    .fetch_optional(db)
    .await
}

/// What `POST /api/photos/download` archives.
pub enum DownloadSelection<'a> {
    /// `image_hashes`: the user's own photos with these hashes (any state).
    Hashes(&'a [String]),
    /// `select_all` + `query` (`build_photo_queryset`) minus `excluded`.
    Query {
        params: &'a PhotoFilterParams,
        favorite_min_rating: i32,
        excluded: &'a [String],
    },
}

#[derive(Debug, Clone, FromRow)]
pub struct DownloadPhoto {
    pub id: Uuid,
    pub size: i64,
}

/// The photos to archive, owner-scoped, optionally widened to every owned
/// photo sharing a stack with one of them. One query.
pub async fn download_photos(
    db: &PgPool,
    user_id: i32,
    selection: &DownloadSelection<'_>,
    include_stacked: bool,
) -> sqlx::Result<Vec<DownloadPhoto>> {
    let mut qb: QueryBuilder<'_, Postgres> =
        QueryBuilder::new("WITH sel AS (SELECT p.id FROM api_photo p WHERE ");
    match selection {
        DownloadSelection::Hashes(hashes) => {
            scope::owned_by(&mut qb, "p", user_id);
            qb.push(" AND p.image_hash = ANY(");
            qb.push_bind(hashes.to_vec());
            qb.push(")");
        }
        DownloadSelection::Query {
            params,
            favorite_min_rating,
            excluded,
        } => {
            scope::photo_filters(&mut qb, "p", user_id, *favorite_min_rating, params);
            if !excluded.is_empty() {
                qb.push(" AND NOT (p.image_hash = ANY(");
                qb.push_bind(excluded.to_vec());
                qb.push("))");
            }
        }
    }
    qb.push(")");
    if include_stacked {
        qb.push(
            ", stk AS (SELECT DISTINCT ps.photostack_id FROM api_photo_stacks ps \
               JOIN sel ON sel.id = ps.photo_id), \
             allp AS (SELECT id FROM sel UNION \
               SELECT ps.photo_id FROM api_photo_stacks ps JOIN stk USING (photostack_id)) \
             SELECT p.id, p.size FROM api_photo p JOIN allp ON allp.id = p.id WHERE ",
        );
        scope::owned_by(&mut qb, "p", user_id);
    } else {
        qb.push(" SELECT p.id, p.size FROM api_photo p JOIN sel ON sel.id = p.id");
    }
    qb.build_query_as::<DownloadPhoto>().fetch_all(db).await
}

/// One file to put in a zip: its photo's position in the job and the path.
#[derive(Debug, Clone, FromRow)]
pub struct ZipFileRow {
    pub ord: i64,
    pub path: String,
}

/// Every file of the given photos in `_add_photo_files_to_zip` order: main
/// file, the photo's files, files of legacy RAW+JPEG / live-photo stack
/// mates, then the embedded media of all of those. Owner-scoped.
pub async fn zip_files(
    db: &PgPool,
    user_id: i32,
    photo_ids: &[Uuid],
) -> sqlx::Result<Vec<ZipFileRow>> {
    sqlx::query_as::<_, ZipFileRow>(
        "WITH ph AS ( \
           SELECT p.id, t.ord FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord) \
           JOIN api_photo p ON p.id = t.id AND p.owner_id = $2), \
         mates AS ( \
           SELECT DISTINCT ph.ord, ps2.photo_id AS id FROM ph \
           JOIN api_photo_stacks ps ON ps.photo_id = ph.id \
           JOIN api_photostack st ON st.id = ps.photostack_id \
             AND st.stack_type IN ('raw_jpeg', 'live_photo') \
           JOIN api_photo_stacks ps2 ON ps2.photostack_id = st.id), \
         own AS ( \
           SELECT ph.ord, 0 AS g, 0::bigint AS s, f.hash, f.path FROM ph \
             JOIN api_photo p ON p.id = ph.id JOIN api_file f ON f.hash = p.main_file_id \
           UNION ALL \
           SELECT ph.ord, 1, pf.id, f.hash, f.path FROM ph \
             JOIN api_photo_files pf ON pf.photo_id = ph.id JOIN api_file f ON f.hash = pf.file_id \
           UNION ALL \
           SELECT m.ord, 2, 0, f.hash, f.path FROM mates m \
             JOIN api_photo p ON p.id = m.id JOIN api_file f ON f.hash = p.main_file_id \
           UNION ALL \
           SELECT m.ord, 3, pf.id, f.hash, f.path FROM mates m \
             JOIN api_photo_files pf ON pf.photo_id = m.id JOIN api_file f ON f.hash = pf.file_id), \
         emb AS ( \
           SELECT own.ord, 4 AS g, em.id::bigint AS s, f.hash, f.path FROM own \
             JOIN api_file_embedded_media em ON em.from_file_id = own.hash \
             JOIN api_file f ON f.hash = em.to_file_id) \
         SELECT ord, path FROM (SELECT * FROM own UNION ALL SELECT * FROM emb) x \
         ORDER BY ord, g, s",
    )
    .bind(photo_ids)
    .bind(user_id)
    .fetch_all(db)
    .await
}

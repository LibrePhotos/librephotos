-- SQLite twin of pg/202609291200_jobs_zip_services_lrj_unfinished_idx.sql.
-- A Django rebuild of api_longrunningjob drops it; lp_db::migrate::
-- ensure_sqlite_objects() recreates it at every serve/worker start.
CREATE INDEX IF NOT EXISTS lp_longrunningjob_unfinished_idx
    ON api_longrunningjob (started_at) WHERE NOT finished;

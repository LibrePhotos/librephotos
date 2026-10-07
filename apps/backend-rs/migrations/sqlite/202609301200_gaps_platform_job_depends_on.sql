-- SQLite twin of pg/202609301200_gaps_platform_job_depends_on.sql: the
-- dependency ids are a JSON array (read with json_each), no GIN index.
ALTER TABLE job_queue ADD COLUMN depends_on text NOT NULL DEFAULT '[]';

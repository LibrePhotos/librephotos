-- Job dependencies (Django's Chain): a queued row is claimable only once
-- every job it depends on has left queued/running (done, failed, cancelled
-- or deleted), like django-q running the next task of a chain.
ALTER TABLE job_queue ADD COLUMN IF NOT EXISTS depends_on bigint[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS job_queue_depends_on_idx ON job_queue USING gin (depends_on) WHERE status = 'queued';

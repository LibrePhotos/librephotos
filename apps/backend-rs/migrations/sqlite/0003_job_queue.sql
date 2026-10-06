-- SQLite twin of pg/0003_job_queue.sql. The claim needs no row locks: the
-- single writer (BEGIN IMMEDIATE) makes it atomic across processes.
CREATE TABLE job_queue (
    id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    kind text NOT NULL,
    payload text NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    lrj_id varchar(36) NULL,
    group_id text NULL,
    run_after datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 1,
    locked_by text NULL,
    heartbeat_at datetime NULL,
    last_error text NULL,
    created_at datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    started_at datetime NULL,
    finished_at datetime NULL
);
CREATE INDEX job_queue_claim_idx ON job_queue (run_after, id) WHERE status = 'queued';
CREATE INDEX job_queue_running_idx ON job_queue (heartbeat_at) WHERE status = 'running';
CREATE INDEX job_queue_lrj_id_idx ON job_queue (lrj_id) WHERE lrj_id IS NOT NULL;
CREATE INDEX job_queue_group_id_idx ON job_queue (group_id) WHERE group_id IS NOT NULL;

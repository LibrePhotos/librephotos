-- Background job queue (plans/rust-backend/04 §1). payload holds ids and
-- options only. lrj_id links to api_longrunningjob.job_id for the UI.
CREATE TABLE job_queue (
    id bigserial PRIMARY KEY,
    kind text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    lrj_id varchar(36),
    group_id text,
    run_after timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 1,
    locked_by text,
    heartbeat_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
);
CREATE INDEX job_queue_claim_idx ON job_queue (run_after, id) WHERE status = 'queued';
CREATE INDEX job_queue_running_idx ON job_queue (heartbeat_at) WHERE status = 'running';
CREATE INDEX job_queue_lrj_id_idx ON job_queue (lrj_id) WHERE lrj_id IS NOT NULL;
CREATE INDEX job_queue_group_id_idx ON job_queue (group_id) WHERE group_id IS NOT NULL;

-- Code-defined recurring schedules; persisted so restarts don't double-run.
CREATE TABLE schedule_state (
    name text PRIMARY KEY,
    last_run_at timestamptz,
    next_run_at timestamptz
);

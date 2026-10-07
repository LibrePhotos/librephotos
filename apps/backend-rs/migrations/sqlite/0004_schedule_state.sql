-- SQLite twin of pg/0004_schedule_state.sql.
CREATE TABLE schedule_state (
    name text NOT NULL PRIMARY KEY,
    last_run_at datetime NULL,
    next_run_at datetime NULL
);

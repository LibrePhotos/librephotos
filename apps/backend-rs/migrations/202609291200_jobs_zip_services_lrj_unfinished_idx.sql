-- /api/rqavailable/ is polled every 2 s by every open tab: find the
-- unfinished job without scanning the whole LongRunningJob table.
CREATE INDEX IF NOT EXISTS lp_longrunningjob_unfinished_idx
    ON api_longrunningjob (started_at) WHERE NOT finished;

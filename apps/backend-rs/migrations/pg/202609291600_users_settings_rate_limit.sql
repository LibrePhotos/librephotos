-- Sliding-window rate limits shared by every process on this database
-- (DRF's ScopedRateThrottle kept them in a per-process cache).
CREATE TABLE IF NOT EXISTS rate_limit_hit (
    id bigserial PRIMARY KEY,
    scope varchar(64) NOT NULL,
    ident varchar(255) NOT NULL,
    hit_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_hit_scope_ident_idx ON rate_limit_hit (scope, ident, hit_at);

-- SQLite twin of pg/202609291600_users_settings_rate_limit.sql.
CREATE TABLE IF NOT EXISTS rate_limit_hit (
    id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
    scope varchar(64) NOT NULL,
    ident varchar(255) NOT NULL,
    hit_at datetime NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_hit_scope_ident_idx ON rate_limit_hit (scope, ident, hit_at);

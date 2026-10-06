-- SQLite twin of pg/0002_refresh_token.sql.
CREATE TABLE refresh_token (
    jti varchar(64) NOT NULL PRIMARY KEY,
    user_id integer NOT NULL REFERENCES api_user (id) ON DELETE CASCADE,
    issued_at datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    expires_at datetime NOT NULL,
    revoked_at datetime NULL
);
CREATE INDEX refresh_token_user_id_idx ON refresh_token (user_id);
CREATE INDEX refresh_token_expires_at_idx ON refresh_token (expires_at);

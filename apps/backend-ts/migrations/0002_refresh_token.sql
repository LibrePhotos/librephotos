-- Refresh tokens Rust issued or revoked. A token signed with SECRET_KEY but
-- absent here (Django-issued) is still accepted; revoked_at blacklists it.
CREATE TABLE IF NOT EXISTS refresh_token (
    jti varchar(64) PRIMARY KEY,
    user_id integer NOT NULL REFERENCES api_user (id) ON DELETE CASCADE,
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS refresh_token_user_id_idx ON refresh_token (user_id);
CREATE INDEX IF NOT EXISTS refresh_token_expires_at_idx ON refresh_token (expires_at);

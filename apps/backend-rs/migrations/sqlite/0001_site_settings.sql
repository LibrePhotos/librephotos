-- SQLite twin of pg/0001_site_settings.sql. Values are json.dumps text.
CREATE TABLE site_settings (
    key text NOT NULL PRIMARY KEY,
    value text NOT NULL CHECK (json_valid(value)),
    updated_at datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

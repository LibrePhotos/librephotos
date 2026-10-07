-- SQLite twin of pg/202610051200_scan_inline_faces_scanned.sql.
CREATE TABLE IF NOT EXISTS lp_photo_faces_scanned (
    photo_id char(32) NOT NULL PRIMARY KEY REFERENCES api_photo (id) ON DELETE CASCADE,
    model varchar(64) NOT NULL,
    scanned_at datetime NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

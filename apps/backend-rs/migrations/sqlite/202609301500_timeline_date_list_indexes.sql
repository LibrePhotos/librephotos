-- SQLite twin of pg/202609301500_timeline_date_list_indexes.sql. SQLite has
-- no INCLUDE: the flags are trailing key columns (still a covering index).
-- Recreated by lp_db::migrate::ensure_sqlite_objects() after a Django rebuild.
CREATE INDEX IF NOT EXISTS lp_photo_owner_visible_idx
    ON api_photo (owner_id, id, hidden, in_trashcan);
CREATE INDEX IF NOT EXISTS lp_thumbnail_ready_idx
    ON api_thumbnail (photo_id) WHERE aspect_ratio IS NOT NULL;

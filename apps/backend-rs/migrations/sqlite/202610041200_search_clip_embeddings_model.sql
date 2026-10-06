-- SQLite twin of pg/202610041200_search_clip_embeddings_model.sql.
--
-- api_photo gets no column here: Django rebuilds a table on AlterField and
-- would silently drop a column its models do not know. The model name lives
-- in a side table instead (no row = Django wrote the embedding = ViT-B/32;
-- lp_db::sql::stored_clip_model reads it).
CREATE TABLE IF NOT EXISTS lp_photo_clip_model (
    photo_id char(32) NOT NULL PRIMARY KEY REFERENCES api_photo (id) ON DELETE CASCADE,
    model varchar(64) NOT NULL
);

-- Any writer (Django included) that changes the embedding drops the row;
-- Rust re-inserts it after its own UPDATE in the same transaction. Rust
-- writes embeddings in json.dumps format, so a Django save that keeps the
-- embedding compares equal and does not fire. Dropped by a Django rebuild of
-- api_photo, recreated by lp_db::migrate::ensure_sqlite_objects().
CREATE TRIGGER IF NOT EXISTS lp_clip_embeddings_model_reset
AFTER UPDATE OF clip_embeddings ON api_photo
WHEN json(OLD.clip_embeddings) IS NOT json(NEW.clip_embeddings)
BEGIN
    DELETE FROM lp_photo_clip_model WHERE photo_id = NEW.id;
END;

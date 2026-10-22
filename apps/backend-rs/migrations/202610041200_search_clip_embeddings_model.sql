-- The model that produced api_photo.clip_embeddings ('clip_vit_b32',
-- 'mobileclip_s2'; lp_ml::clip::SemanticModel::name). NULL means Django
-- wrote it (or Rust before this column existed): Django only has CLIP
-- ViT-B/32. The similarity index takes only the selected model's
-- embeddings; clip.embed replaces the others in place (never NULLs them).
ALTER TABLE api_photo ADD COLUMN IF NOT EXISTS clip_embeddings_model varchar(64);

-- Django does not know the column but saves whole rows: a Django write that
-- changes the embedding (a fill, or a stale instance saved over a Rust
-- re-embedding) must not keep a Rust model name, so any writer other than
-- librephotos-rs (lp_db::pool::APPLICATION_NAME) that changes the embedding
-- resets the column to NULL (= ViT-B/32). Rust writes set it themselves.
CREATE OR REPLACE FUNCTION lp_clip_embeddings_model_reset() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.clip_embeddings_model := NULL;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS lp_clip_embeddings_model_reset ON api_photo;
CREATE TRIGGER lp_clip_embeddings_model_reset
    BEFORE UPDATE OF clip_embeddings ON api_photo
    FOR EACH ROW
    WHEN (OLD.clip_embeddings IS DISTINCT FROM NEW.clip_embeddings
          AND current_setting('application_name') IS DISTINCT FROM 'librephotos-rs')
    EXECUTE FUNCTION lp_clip_embeddings_model_reset();

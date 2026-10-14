-- run_suite.sh mut:sidecars: alice's photos get CLIP embeddings (similar_photos
-- asks the similarity index only for a photo that has one) and alice searches
-- semantically.
UPDATE api_photo
SET clip_embeddings = (SELECT jsonb_agg(round(((i * 37) % 200) / 100.0 - 1, 2)) FROM generate_series(1, 512) i),
    clip_embeddings_magnitude = 1
WHERE owner_id = (SELECT id FROM api_user WHERE username = 'alice');
UPDATE api_user SET semantic_search_topk = 4 WHERE username = 'alice';

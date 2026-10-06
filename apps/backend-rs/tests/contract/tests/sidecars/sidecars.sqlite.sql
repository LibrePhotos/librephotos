-- SQLite twin of sidecars.sql (run_suite.sh mut:sidecars, LP_DB_BACKEND=sqlite):
-- the same 512 values, a recursive CTE for generate_series, and py_json()
-- (lp_sql) so the text is what Django's JSONField writes (json.dumps).
WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < 512)
UPDATE api_photo
SET clip_embeddings = (SELECT py_json(json_group_array(round(((i * 37) % 200) / 100.0 - 1, 2))) FROM (SELECT i FROM s ORDER BY i)),
    clip_embeddings_magnitude = 1
WHERE owner_id = (SELECT id FROM api_user WHERE username = 'alice');
UPDATE api_user SET semantic_search_topk = 4 WHERE username = 'alice';

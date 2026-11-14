-- /api/albums/date/list/ counts every visible photo of the user per day.
-- Index-only scans over the photo flags and the "thumbnail ready" rows
-- replace sequential scans of the wide api_photo and api_thumbnail heaps
-- (Django's date list reads the same rows and benefits equally).
CREATE INDEX IF NOT EXISTS lp_photo_owner_visible_idx
    ON api_photo (owner_id, id) INCLUDE (hidden, in_trashcan);
CREATE INDEX IF NOT EXISTS lp_thumbnail_ready_idx
    ON api_thumbnail (photo_id) WHERE aspect_ratio IS NOT NULL;

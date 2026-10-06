-- Photos whose faces a scan found inline (LP_SCAN_INLINE_ML, OPTIMIZATIONS.md
-- #19), with the face pack it used: the faces.scan follow-up of that scan
-- skips them. Rust-only; Django never reads it, and deleting a photo drops its
-- row.
CREATE TABLE IF NOT EXISTS lp_photo_faces_scanned (
    photo_id uuid PRIMARY KEY REFERENCES api_photo (id) ON DELETE CASCADE,
    model varchar(64) NOT NULL,
    scanned_at timestamptz NOT NULL DEFAULT now()
);

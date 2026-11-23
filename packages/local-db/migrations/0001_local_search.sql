-- Hand-written: local full-text search over local_asset (drizzle-kit does not model FTS5).
--
-- Every file is indexed under its name (its extension included: the tokenizer
-- splits "IMG_1234.CR3" into img, 1234, cr3), its kind ("raw photo", "video
-- movie", "photo picture image"), its folder words, its date as words (year,
-- month name long and short, yyyy-mm, yyyy-mm-dd), "undated" when the metadata
-- pass found no date, and its format, camera and lens. A query is a list of
-- prefix words that must all match (see ftsQuery in src/queries/local-search.ts).
--
-- The FTS rowid is local_asset's rowid. The terms are defined ONCE, in the
-- view; the triggers and rebuildLocalSearch() read it, so every runtime that
-- applies these migrations gets the same index for free. local_asset has no
-- INTEGER PRIMARY KEY, so a VACUUM may renumber its rowids: run
-- rebuildLocalSearch() after one.
CREATE VIRTUAL TABLE `local_asset_fts` USING fts5(terms, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE VIEW `local_asset_search_terms` AS
SELECT la.rowid AS asset_rowid,
       COALESCE(la.name, '')
       || ' ' || CASE la.type WHEN 'raw' THEN 'raw photo' WHEN 'video' THEN 'video movie' ELSE 'photo picture image' END
       || ' ' || COALESCE(la.folder, '')
       || ' ' || COALESCE(
            (SELECT substr(d.day, 1, 4)
                    || ' ' || CASE substr(d.day, 6, 2)
                         WHEN '01' THEN 'january jan' WHEN '02' THEN 'february feb' WHEN '03' THEN 'march mar'
                         WHEN '04' THEN 'april apr' WHEN '05' THEN 'may may' WHEN '06' THEN 'june jun'
                         WHEN '07' THEN 'july jul' WHEN '08' THEN 'august aug' WHEN '09' THEN 'september sep'
                         WHEN '10' THEN 'october oct' WHEN '11' THEN 'november nov' WHEN '12' THEN 'december dec'
                         ELSE '' END
                    || ' ' || substr(d.day, 1, 7) || ' ' || d.day
             FROM (SELECT COALESCE(la.bucket_day,
                                   strftime('%Y-%m-%d', la.created_at / 1000, 'unixepoch', 'localtime')) AS day) d
             WHERE d.day IS NOT NULL),
            '')
       || CASE WHEN la.meta_state = 'done' AND la.taken_at IS NULL THEN ' undated' ELSE '' END
       || ' ' || COALESCE(la.format, '')
       || ' ' || COALESCE(la.camera, '')
       || ' ' || COALESCE(la.lens, '') AS terms
FROM local_asset la;
--> statement-breakpoint
CREATE TRIGGER `local_asset_fts_insert` AFTER INSERT ON `local_asset` BEGIN
  INSERT INTO local_asset_fts(rowid, terms)
  SELECT asset_rowid, terms FROM local_asset_search_terms WHERE asset_rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `local_asset_fts_update`
AFTER UPDATE OF name, type, folder, bucket_day, created_at, meta_state, taken_at, format, camera, lens ON `local_asset` BEGIN
  DELETE FROM local_asset_fts WHERE rowid = OLD.rowid;
  INSERT INTO local_asset_fts(rowid, terms)
  SELECT asset_rowid, terms FROM local_asset_search_terms WHERE asset_rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `local_asset_fts_delete` AFTER DELETE ON `local_asset` BEGIN
  DELETE FROM local_asset_fts WHERE rowid = OLD.rowid;
END;

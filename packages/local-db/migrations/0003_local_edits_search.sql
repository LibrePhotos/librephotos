DROP TRIGGER IF EXISTS `local_asset_fts_update`;
--> statement-breakpoint
DROP VIEW IF EXISTS `local_asset_search_terms`;
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
       || ' ' || COALESCE(la.lens, '')
       || ' ' || COALESCE(la.caption, '')
       || ' ' || COALESCE(la.keywords, '') AS terms
FROM local_asset la;
--> statement-breakpoint
CREATE TRIGGER `local_asset_fts_update`
AFTER UPDATE OF name, type, folder, bucket_day, created_at, meta_state, taken_at, format, camera, lens, caption, keywords ON `local_asset` BEGIN
  DELETE FROM local_asset_fts WHERE rowid = OLD.rowid;
  INSERT INTO local_asset_fts(rowid, terms)
  SELECT asset_rowid, terms FROM local_asset_search_terms WHERE asset_rowid = NEW.rowid;
END;
--> statement-breakpoint
DELETE FROM local_asset_fts;
--> statement-breakpoint
INSERT INTO local_asset_fts(rowid, terms) SELECT asset_rowid, terms FROM local_asset_search_terms;

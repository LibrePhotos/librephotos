/**
 * The merged timeline (doc 02 §4): remote photos UNION camera-roll assets whose
 * hash has no remote counterpart and that belong to a backup-selected (and no
 * backup-excluded) local album. Written as raw SQL — the UNION + correlated
 * EXISTS shape is clearer and faster hand-written than through the query builder,
 * and it runs byte-identically under expo-sqlite and better-sqlite3.
 *
 * Until Phase 3 populates the local_* tables the local arm returns nothing, so
 * this collapses to the remote mirror — exactly the current (online-seeded)
 * behavior, with the union shape already proven by the local-arm fixture test.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase, MergedTimelineRow, TimelineBucket } from "../types";

/**
 * The merged view as a single SELECT, aliased to a stable column set. `sort_id`
 * is the keyset tie-break (remote UUID or local asset id). Kept as a string
 * constant so the timeline page and the bucket query share one definition.
 */
export const MERGED_SELECT = `
  SELECT rp.id AS remote_id, la.id AS local_id, rp.timestamp AS timestamp, rp.type AS type,
         rp.aspect_ratio AS aspect_ratio, rp.is_favorite AS is_favorite, rp.bucket_day AS bucket_day,
         rp.image_hash AS image_hash, la.uri AS local_uri, rp.dominant_color AS dominant_color,
         rp.id AS sort_id
  FROM remote_photo rp
  LEFT JOIN local_asset la ON la.hash = rp.image_hash
  WHERE rp.hidden = 0 AND rp.in_trashcan = 0 AND rp.removed = 0 AND rp.timestamp IS NOT NULL
  UNION ALL
  SELECT NULL AS remote_id, la.id AS local_id, la.created_at AS timestamp, la.type AS type,
         CAST(la.width AS REAL) / la.height AS aspect_ratio, 0 AS is_favorite,
         strftime('%Y-%m-%d', la.created_at / 1000, 'unixepoch', 'localtime') AS bucket_day,
         la.hash AS image_hash, la.uri AS local_uri, NULL AS dominant_color,
         la.id AS sort_id
  FROM local_asset la
  WHERE (la.hash IS NULL
         OR NOT EXISTS (SELECT 1 FROM remote_photo rp WHERE rp.image_hash = la.hash))
    AND EXISTS (SELECT 1 FROM local_album_asset laa
                JOIN local_album l ON l.id = laa.album_id
                WHERE laa.asset_id = la.id AND l.backup_selection = 1)
    AND NOT EXISTS (SELECT 1 FROM local_album_asset laa
                JOIN local_album l ON l.id = laa.album_id
                WHERE laa.asset_id = la.id AND l.backup_selection = 2)
`;

export type TimelineCursor = { timestamp: number; sortId: string };

export type TimelinePage = {
  rows: MergedTimelineRow[];
  nextCursor: TimelineCursor | null;
};

/**
 * One keyset-paginated page of the merged timeline, newest first. Keyset (not
 * OFFSET) so page N is O(log n) at 100k rows regardless of depth.
 */
export function timelinePage(
  db: AppDatabase,
  opts: { limit: number; cursor?: TimelineCursor | null }
): TimelinePage {
  const limit = opts.limit;
  const cur = opts.cursor ?? null;
  const rows = db.all(
    sql`
      SELECT remote_id, local_id, timestamp, type, aspect_ratio, is_favorite,
             bucket_day, image_hash, local_uri, dominant_color, sort_id
      FROM (${sql.raw(MERGED_SELECT)})
      WHERE ${cur == null ? sql`1 = 1` : sql`(timestamp < ${cur.timestamp} OR (timestamp = ${cur.timestamp} AND sort_id < ${cur.sortId}))`}
      ORDER BY timestamp DESC, sort_id DESC
      LIMIT ${limit}
    `
  ) as (MergedTimelineRow & { sort_id: string })[];

  const last = rows.length === limit ? rows[rows.length - 1] : null;
  const nextCursor =
    last && last.timestamp != null ? { timestamp: last.timestamp, sortId: last.sort_id } : null;
  return { rows: rows.map(stripSortId), nextCursor };
}

/** Section headers / scrubber buckets over the merged timeline (doc 02 §4). */
export function timelineBuckets(db: AppDatabase): TimelineBucket[] {
  return db.all(
    sql`
      SELECT bucket_day, COUNT(*) AS count
      FROM (${sql.raw(MERGED_SELECT)})
      GROUP BY bucket_day
      ORDER BY bucket_day DESC
    `
  ) as TimelineBucket[];
}

/** EXPLAIN QUERY PLAN rows for the timeline page (test-only budget assertions). */
export function explainTimelinePage(db: AppDatabase): { detail: string }[] {
  return db.all(
    sql`
      EXPLAIN QUERY PLAN
      SELECT remote_id, local_id, timestamp, sort_id
      FROM (${sql.raw(MERGED_SELECT)})
      ORDER BY timestamp DESC, sort_id DESC
      LIMIT 200
    `
  ) as { detail: string }[];
}

function stripSortId(r: MergedTimelineRow & { sort_id: string }): MergedTimelineRow {
  const { sort_id: _sortId, ...rest } = r;
  return rest;
}

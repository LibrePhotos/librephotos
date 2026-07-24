/**
 * The timeline (doc 02 §4). Two shapes behind one entry point:
 *
 *  - the REMOTE fast path: a pure keyset scan of remote_photo, fully covered by
 *    the partial index idx_remote_photo_visible on (timestamp, id) — no temp
 *    sort, no full table scan (the performance budget, doc 02 §5).
 *  - the MERGED path: remote photos UNION camera-roll assets whose hash has no
 *    remote counterpart and that belong to a backup-selected (not excluded)
 *    local album. The UNION defeats index-ordered reads, so it is used only when
 *    local timeline assets actually exist (Phase 3).
 *
 * `timelinePage`/`timelineBuckets` dispatch automatically: until Phase 3
 * populates the local tables they take the fast path, matching today's
 * remote-only reality; the union-shape is already proven by fixture tests.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase, MergedTimelineRow, TimelineBucket } from "../types";

export type TimelineCursor = { timestamp: number; sortId: string };
export type TimelinePage = { rows: MergedTimelineRow[]; nextCursor: TimelineCursor | null };

/** The visible-timeline predicate, shared by every timeline read. */
const VISIBLE = sql`hidden = 0 AND in_trashcan = 0 AND removed = 0 AND timestamp IS NOT NULL`;

/** True once any backup-selected, not-yet-uploaded local asset exists (Phase 3). */
export function hasLocalTimelineAssets(db: AppDatabase): boolean {
  const row = db.get(
    sql`SELECT 1 AS x FROM local_asset la
        WHERE EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                      WHERE laa.asset_id = la.id AND l.backup_selection = 1)
          AND NOT EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                      WHERE laa.asset_id = la.id AND l.backup_selection = 2)
        LIMIT 1`
  ) as { x: number } | undefined;
  return row != null;
}

/* ---- remote fast path (index-covered) --------------------------------- */

export function remoteTimelinePage(db: AppDatabase, opts: { limit: number; cursor?: TimelineCursor | null }): TimelinePage {
  const cur = opts.cursor ?? null;
  const rows = db.all(
    sql`SELECT id AS remote_id, NULL AS local_id, timestamp, type, aspect_ratio, is_favorite,
               bucket_day, image_hash, NULL AS local_uri, dominant_color, id AS sort_id
        FROM remote_photo
        WHERE ${VISIBLE}
          ${cur == null ? sql`` : sql`AND (timestamp < ${cur.timestamp} OR (timestamp = ${cur.timestamp} AND id < ${cur.sortId}))`}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${opts.limit}`
  ) as (MergedTimelineRow & { sort_id: string })[];
  return page(rows, opts.limit);
}

export function remoteTimelineBuckets(db: AppDatabase): TimelineBucket[] {
  return db.all(
    sql`SELECT bucket_day, COUNT(*) AS count FROM remote_photo
        WHERE ${VISIBLE} GROUP BY bucket_day ORDER BY bucket_day DESC`
  ) as TimelineBucket[];
}

/* ---- merged path (remote UNION local-only) ---------------------------- */

/** The merged view as one SELECT with a stable column set + keyset `sort_id`. */
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

export function mergedTimelinePage(db: AppDatabase, opts: { limit: number; cursor?: TimelineCursor | null }): TimelinePage {
  const cur = opts.cursor ?? null;
  const rows = db.all(
    sql`SELECT remote_id, local_id, timestamp, type, aspect_ratio, is_favorite,
               bucket_day, image_hash, local_uri, dominant_color, sort_id
        FROM (${sql.raw(MERGED_SELECT)})
        WHERE ${cur == null ? sql`1 = 1` : sql`(timestamp < ${cur.timestamp} OR (timestamp = ${cur.timestamp} AND sort_id < ${cur.sortId}))`}
        ORDER BY timestamp DESC, sort_id DESC
        LIMIT ${opts.limit}`
  ) as (MergedTimelineRow & { sort_id: string })[];
  return page(rows, opts.limit);
}

export function mergedTimelineBuckets(db: AppDatabase): TimelineBucket[] {
  return db.all(
    sql`SELECT bucket_day, COUNT(*) AS count FROM (${sql.raw(MERGED_SELECT)})
        GROUP BY bucket_day ORDER BY bucket_day DESC`
  ) as TimelineBucket[];
}

/* ---- dispatch --------------------------------------------------------- */

/** One keyset page of the timeline, newest-first. Fast remote path unless local assets exist. */
export function timelinePage(db: AppDatabase, opts: { limit: number; cursor?: TimelineCursor | null }): TimelinePage {
  return hasLocalTimelineAssets(db) ? mergedTimelinePage(db, opts) : remoteTimelinePage(db, opts);
}

/** Section headers / scrubber buckets over the timeline. */
export function timelineBuckets(db: AppDatabase): TimelineBucket[] {
  return hasLocalTimelineAssets(db) ? mergedTimelineBuckets(db) : remoteTimelineBuckets(db);
}

/* ---- EXPLAIN helpers (test-only budget assertions) -------------------- */

export function explainTimelinePage(db: AppDatabase): { detail: string }[] {
  return db.all(
    sql`EXPLAIN QUERY PLAN
        SELECT id, timestamp, image_hash FROM remote_photo
        WHERE ${VISIBLE} ORDER BY timestamp DESC, id DESC LIMIT 200`
  ) as { detail: string }[];
}

export function explainTimelineBuckets(db: AppDatabase): { detail: string }[] {
  return db.all(
    sql`EXPLAIN QUERY PLAN
        SELECT bucket_day, COUNT(*) AS count FROM remote_photo
        WHERE ${VISIBLE} GROUP BY bucket_day ORDER BY bucket_day DESC`
  ) as { detail: string }[];
}

/* ---- internals -------------------------------------------------------- */

function page(rows: (MergedTimelineRow & { sort_id: string })[], limit: number): TimelinePage {
  const last = rows.length === limit ? rows[rows.length - 1] : null;
  const nextCursor = last && last.timestamp != null ? { timestamp: last.timestamp, sortId: last.sort_id } : null;
  return { rows: rows.map(stripSortId), nextCursor };
}

function stripSortId(r: MergedTimelineRow & { sort_id: string }): MergedTimelineRow {
  const { sort_id: _sortId, ...rest } = r;
  return rest;
}

/**
 * The timeline (doc 02 §4). Two shapes behind one entry point:
 *
 *  - the REMOTE fast path: a pure keyset scan of remote_photo, fully covered by
 *    the partial index idx_remote_photo_visible on (timestamp, id) — no temp
 *    sort, no full table scan (the performance budget, doc 02 §5).
 *  - the MERGED path: remote photos UNION camera-roll assets whose hash has no
 *    remote counterpart and that belong to a backup-selected (not excluded)
 *    local album. Used only when local timeline assets actually exist (Phase 3).
 *
 * `timelinePage`/`timelineBuckets` dispatch automatically: until Phase 3
 * populates the local tables they take the fast path, matching today's
 * remote-only reality; the union-shape is already proven by fixture tests.
 *
 * ## Why the merged page limits each UNION arm
 *
 * The merged page used to be `SELECT ... FROM (<arm> UNION ALL <arm>) ORDER BY
 * ... LIMIT n`, with no limit inside either arm. SQLite has no way to push the
 * outer LIMIT through a compound select, so it materialised *every* remote photo
 * and *every* eligible camera-roll asset, sorted the lot in a temp B-tree, and
 * then threw all but `n` rows away — synchronously, on the JS thread, growing
 * with the library. On a real 2.8k-asset phone that was the single most
 * expensive read in the app and it was on the critical path of opening the
 * viewer.
 *
 * Each arm now carries its own `ORDER BY … LIMIT n`, so SQLite walks
 * `idx_remote_photo_visible` / `idx_local_asset_timeline` in key order and stops
 * after `n` rows. The only sort left is the outer merge of the two already-sorted
 * arms, which is bounded by `2n` rows regardless of library size. See
 * `explainMergedTimelinePage` and the assertions in `__tests__/explain.test.ts`.
 */
import { sql, type SQL } from "drizzle-orm";
import type { AppDatabase, MergedTimelineRow, TimelineBucket } from "../types";

export type TimelineCursor = { timestamp: number; sortId: string };
export type TimelinePage = { rows: MergedTimelineRow[]; nextCursor: TimelineCursor | null };

/**
 * Which way a page walks from its cursor. "older" is the timeline's natural
 * newest-first direction; "newer" walks back up towards the top and is what lets
 * the viewer window a slice *around* a photo instead of loading from the top.
 */
export type TimelineDirection = "older" | "newer";

export type TimelinePageOptions = {
  limit: number;
  cursor?: TimelineCursor | null;
  direction?: TimelineDirection;
  /** Include the cursor row itself. Used to anchor a window on a tapped photo. */
  inclusive?: boolean;
};

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

/* ---- keyset plumbing --------------------------------------------------- */

/**
 * The keyset predicate for one arm, as an SQLite *row value* comparison.
 * `(ts, id) < (?, ?)` is the form SQLite turns into a plain index range scan;
 * the equivalent `ts < ? OR (ts = ? AND id < ?)` costs an extra OR-decomposition.
 */
function keyset(
  ts: string,
  id: string,
  cursor: TimelineCursor | null,
  direction: TimelineDirection,
  inclusive: boolean
): SQL {
  if (!cursor) return sql`1 = 1`;
  const op = sql.raw(direction === "older" ? (inclusive ? "<=" : "<") : inclusive ? ">=" : ">");
  return sql`(${sql.raw(ts)}, ${sql.raw(id)}) ${op} (${cursor.timestamp}, ${cursor.sortId})`;
}

/** `DESC` walks into the past, `ASC` back towards the newest photo. */
function order(direction: TimelineDirection): SQL {
  return sql.raw(direction === "older" ? "DESC" : "ASC");
}

/* ---- remote fast path (index-covered) --------------------------------- */

export function remoteTimelinePage(db: AppDatabase, opts: TimelinePageOptions): TimelinePage {
  const { limit, cursor = null, direction = "older", inclusive = false } = opts;
  const dir = order(direction);
  const rows = db.all(
    sql`SELECT id AS remote_id, NULL AS local_id, timestamp, type, aspect_ratio, is_favorite,
               bucket_day, image_hash, NULL AS local_uri, dominant_color, id AS sort_id
        FROM remote_photo
        WHERE ${VISIBLE} AND ${keyset("timestamp", "id", cursor, direction, inclusive)}
        ORDER BY timestamp ${dir}, id ${dir}
        LIMIT ${limit}`
  ) as (MergedTimelineRow & { sort_id: string })[];
  return page(rows, limit, direction);
}

export function remoteTimelineBuckets(db: AppDatabase): TimelineBucket[] {
  return db.all(
    sql`SELECT bucket_day, COUNT(*) AS count FROM remote_photo
        WHERE ${VISIBLE} GROUP BY bucket_day ORDER BY bucket_day DESC`
  ) as TimelineBucket[];
}

/* ---- merged path (remote UNION local-only) ---------------------------- */

/**
 * The merged view as one SELECT with a stable column set + keyset `sort_id`.
 * Unbounded — only for whole-timeline aggregates (buckets). Paged reads go
 * through `mergedTimelinePage`, which limits each arm.
 *
 * The remote arm reads its camera-roll counterpart through two correlated
 * scalar subqueries rather than a LEFT JOIN: a join multiplies a remote photo by
 * however many camera-roll copies share its hash, which duplicates the photo in
 * the timeline (real phones do hold the same image twice) and, once the arm is
 * limited, would let those duplicates eat the page. Both subqueries walk
 * `idx_local_asset_hash` the same way, so they agree on which copy they describe
 * without paying for an ORDER BY per row.
 */
const REMOTE_ARM = `
  SELECT rp.id AS remote_id,
         (SELECT la.id FROM local_asset la WHERE la.hash = rp.image_hash LIMIT 1) AS local_id,
         rp.timestamp AS timestamp, rp.type AS type, rp.aspect_ratio AS aspect_ratio,
         rp.is_favorite AS is_favorite, rp.bucket_day AS bucket_day, rp.image_hash AS image_hash,
         (SELECT la.uri FROM local_asset la WHERE la.hash = rp.image_hash LIMIT 1) AS local_uri,
         rp.dominant_color AS dominant_color, rp.id AS sort_id
  FROM remote_photo rp`;

const REMOTE_ARM_WHERE = `rp.hidden = 0 AND rp.in_trashcan = 0 AND rp.removed = 0 AND rp.timestamp IS NOT NULL`;

const LOCAL_ARM = `
  SELECT NULL AS remote_id, la.id AS local_id, la.created_at AS timestamp, la.type AS type,
         CAST(la.width AS REAL) / la.height AS aspect_ratio, 0 AS is_favorite,
         strftime('%Y-%m-%d', la.created_at / 1000, 'unixepoch', 'localtime') AS bucket_day,
         la.hash AS image_hash, la.uri AS local_uri, NULL AS dominant_color,
         la.id AS sort_id
  FROM local_asset la`;

/**
 * The camera-roll arm suppresses an asset exactly when the remote arm is
 * already showing it — the *same* visibility predicate, not bare existence.
 *
 * Device report: "backed up images disappear from the timeline." The two arms
 * disagreed. The local arm dropped an asset the moment *any* remote_photo row
 * shared its hash, while the remote arm only surfaced rows that were visible
 * (`hidden = 0 AND in_trashcan = 0 AND removed = 0 AND timestamp IS NOT NULL`).
 * A photo whose server row existed but failed that predicate therefore fell
 * through both arms and vanished — on the device, on the server, invisible in
 * the app. The common way in is a freshly uploaded photo whose row syncs back
 * before the server has extracted a timestamp from EXIF: back it up, watch it
 * disappear.
 *
 * The trade-off is deliberate and is the only self-consistent rule: a photo the
 * user hid or trashed *on the server* comes back to the timeline as a plain
 * camera-roll photo for as long as the file is still on the phone. It is on the
 * device; the app must not pretend otherwise.
 */
const LOCAL_ARM_WHERE = `
  (la.hash IS NULL
   OR NOT EXISTS (SELECT 1 FROM remote_photo rp
                  WHERE rp.image_hash = la.hash AND ${REMOTE_ARM_WHERE}))
  AND EXISTS (SELECT 1 FROM local_album_asset laa
              JOIN local_album l ON l.id = laa.album_id
              WHERE laa.asset_id = la.id AND l.backup_selection = 1)
  AND NOT EXISTS (SELECT 1 FROM local_album_asset laa
              JOIN local_album l ON l.id = laa.album_id
              WHERE laa.asset_id = la.id AND l.backup_selection = 2)`;

/** Unbounded merged view — aggregates only. */
export const MERGED_SELECT = `
  ${REMOTE_ARM}
  WHERE ${REMOTE_ARM_WHERE}
  UNION ALL
  ${LOCAL_ARM}
  WHERE ${LOCAL_ARM_WHERE}
`;

/** The arm-limited merged page, as SQL (shared by the reader and EXPLAIN). */
function mergedPageSql(opts: TimelinePageOptions): SQL {
  const { limit, cursor = null, direction = "older", inclusive = false } = opts;
  const dir = order(direction);
  return sql`
    SELECT remote_id, local_id, timestamp, type, aspect_ratio, is_favorite,
           bucket_day, image_hash, local_uri, dominant_color, sort_id
    FROM (
      SELECT * FROM (
        ${sql.raw(REMOTE_ARM)}
        WHERE ${sql.raw(REMOTE_ARM_WHERE)}
          AND ${keyset("rp.timestamp", "rp.id", cursor, direction, inclusive)}
        ORDER BY rp.timestamp ${dir}, rp.id ${dir}
        LIMIT ${limit}
      )
      UNION ALL
      SELECT * FROM (
        ${sql.raw(LOCAL_ARM)}
        WHERE ${sql.raw(LOCAL_ARM_WHERE)}
          AND ${keyset("la.created_at", "la.id", cursor, direction, inclusive)}
        ORDER BY la.created_at ${dir}, la.id ${dir}
        LIMIT ${limit}
      )
    )
    ORDER BY timestamp ${dir}, sort_id ${dir}
    LIMIT ${limit}`;
}

export function mergedTimelinePage(db: AppDatabase, opts: TimelinePageOptions): TimelinePage {
  const rows = db.all(mergedPageSql(opts)) as (MergedTimelineRow & { sort_id: string })[];
  return page(rows, opts.limit, opts.direction ?? "older");
}

export function mergedTimelineBuckets(db: AppDatabase): TimelineBucket[] {
  return db.all(
    sql`SELECT bucket_day, COUNT(*) AS count FROM (${sql.raw(MERGED_SELECT)})
        GROUP BY bucket_day ORDER BY bucket_day DESC`
  ) as TimelineBucket[];
}

/* ---- dispatch --------------------------------------------------------- */

/** One keyset page of the timeline. Fast remote path unless local assets exist. */
export function timelinePage(db: AppDatabase, opts: TimelinePageOptions): TimelinePage {
  return hasLocalTimelineAssets(db) ? mergedTimelinePage(db, opts) : remoteTimelinePage(db, opts);
}

/** Section headers / scrubber buckets over the timeline. */
export function timelineBuckets(db: AppDatabase): TimelineBucket[] {
  return hasLocalTimelineAssets(db) ? mergedTimelineBuckets(db) : remoteTimelineBuckets(db);
}

/**
 * Where a photo sits in the timeline's sort order, from any identity the app
 * routes with: a remote photo id, an image hash, or a local asset id. This is
 * the anchor a windowed pager needs — with it the viewer can read a slice
 * *around* the tapped photo instead of paging down from the top of the library.
 *
 * A camera-roll asset whose hash is already on the server is represented in the
 * timeline by its *remote* row (the local arm excludes it), so a local id
 * resolves through the hash first and only then falls back to the local arm.
 */
export function timelineCursorFor(db: AppDatabase, id: string): TimelineCursor | null {
  const remote = db.get(
    sql`SELECT rp.timestamp AS timestamp, rp.id AS sort_id
        FROM remote_photo rp
        WHERE (rp.id = ${id} OR rp.image_hash = ${id}
               OR rp.image_hash = (SELECT la.hash FROM local_asset la WHERE la.id = ${id}))
          AND rp.hidden = 0 AND rp.in_trashcan = 0 AND rp.removed = 0 AND rp.timestamp IS NOT NULL
        LIMIT 1`
  ) as { timestamp: number; sort_id: string } | undefined;
  if (remote) return { timestamp: remote.timestamp, sortId: remote.sort_id };

  const local = db.get(
    sql`SELECT la.created_at AS timestamp, la.id AS sort_id
        FROM local_asset la
        WHERE (la.id = ${id} OR la.hash = ${id}) AND la.created_at IS NOT NULL
        ORDER BY la.id LIMIT 1`
  ) as { timestamp: number; sort_id: string } | undefined;
  return local ? { timestamp: local.timestamp, sortId: local.sort_id } : null;
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

/** The plan of the arm-limited merged page — the viewer's hot read. */
export function explainMergedTimelinePage(
  db: AppDatabase,
  opts: TimelinePageOptions
): { detail: string }[] {
  return db.all(sql`EXPLAIN QUERY PLAN ${mergedPageSql(opts)}`) as { detail: string }[];
}

/** The plan of the unbounded merged view, kept to document what it costs. */
export function explainMergedTimelineUnbounded(db: AppDatabase): { detail: string }[] {
  return db.all(
    sql`EXPLAIN QUERY PLAN
        SELECT * FROM (${sql.raw(MERGED_SELECT)}) ORDER BY timestamp DESC, sort_id DESC LIMIT 500`
  ) as { detail: string }[];
}

/* ---- internals -------------------------------------------------------- */

function page(
  rows: (MergedTimelineRow & { sort_id: string })[],
  limit: number,
  direction: TimelineDirection
): TimelinePage {
  // A "newer" page is read ascending so the index can stop early; the timeline
  // is always handed back newest-first.
  const ordered = direction === "newer" ? [...rows].reverse() : rows;
  const edge = direction === "newer" ? ordered[0] : ordered[ordered.length - 1];
  const nextCursor =
    rows.length === limit && edge && edge.timestamp != null
      ? { timestamp: edge.timestamp, sortId: edge.sort_id }
      : null;
  return { rows: ordered.map(stripSortId), nextCursor };
}

function stripSortId(r: MergedTimelineRow & { sort_id: string }): MergedTimelineRow {
  const { sort_id: _sortId, ...rest } = r;
  return rest;
}

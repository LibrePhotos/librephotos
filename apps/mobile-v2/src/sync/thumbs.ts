/**
 * Thumb-cache bookkeeping + LRU eviction (doc 01 / doc 02 thumb_cache table).
 *
 * This module is pure DB + arithmetic — no expo-file-system — so the eviction
 * policy is unit-tested under Node. The actual byte download/delete against
 * expo-file-system lives in ./thumb-prefetch (app-only), which drives these.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db/types";

/** Default LRU cap: 2 GB (configurable in the settings store). */
export const DEFAULT_THUMB_CAP_BYTES = 2 * 1024 * 1024 * 1024;

export type ThumbRow = {
  photo_id: string;
  file_path: string;
  size_bytes: number;
  last_used: number;
};

export function thumbCacheTotalBytes(db: AppDatabase): number {
  const row = db.get(sql`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM thumb_cache`) as {
    total: number;
  };
  return row.total;
}

export function getThumb(db: AppDatabase, photoId: string): ThumbRow | null {
  const row = db.get(
    sql`SELECT photo_id, file_path, size_bytes, last_used FROM thumb_cache WHERE photo_id = ${photoId}`
  ) as ThumbRow | undefined;
  return row ?? null;
}

/** Record (or update) a cached thumbnail and mark it freshly used. */
export function recordThumb(
  db: AppDatabase,
  args: { photoId: string; filePath: string; sizeBytes: number; now: number }
): void {
  db.run(
    sql`INSERT INTO thumb_cache (photo_id, file_path, size_bytes, last_used)
        VALUES (${args.photoId}, ${args.filePath}, ${args.sizeBytes}, ${args.now})
        ON CONFLICT(photo_id) DO UPDATE SET
          file_path = excluded.file_path, size_bytes = excluded.size_bytes, last_used = excluded.last_used`
  );
}

/** Bump last_used on cache hit (keeps the LRU ordering meaningful). */
export function touchThumb(db: AppDatabase, photoId: string, now: number): void {
  db.run(sql`UPDATE thumb_cache SET last_used = ${now} WHERE photo_id = ${photoId}`);
}

export function removeThumb(db: AppDatabase, photoId: string): void {
  db.run(sql`DELETE FROM thumb_cache WHERE photo_id = ${photoId}`);
}

/** Least-recently-used cache rows first (eviction order). */
export function lruCandidates(db: AppDatabase): ThumbRow[] {
  return db.all(
    sql`SELECT photo_id, file_path, size_bytes, last_used FROM thumb_cache ORDER BY last_used ASC, photo_id ASC`
  ) as ThumbRow[];
}

/**
 * Pure LRU policy: given the current cache rows (any order), the cap, and the
 * size about to be added, return the rows to evict (oldest first) so that
 * currentTotal - evicted + incoming <= cap. Never evicts a row whose id is in
 * `keep` (e.g. the item being fetched). Returns [] if it already fits.
 */
export function selectEvictions(
  rows: ThumbRow[],
  capBytes: number,
  incomingBytes: number,
  keep: ReadonlySet<string> = new Set()
): ThumbRow[] {
  const currentTotal = rows.reduce((acc, r) => acc + r.size_bytes, 0);
  let projected = currentTotal + incomingBytes;
  if (projected <= capBytes) return [];

  const ordered = [...rows].sort(
    (a, b) => a.last_used - b.last_used || (a.photo_id < b.photo_id ? -1 : 1)
  );
  const victims: ThumbRow[] = [];
  for (const r of ordered) {
    if (projected <= capBytes) break;
    if (keep.has(r.photo_id)) continue;
    victims.push(r);
    projected -= r.size_bytes;
  }
  return victims;
}

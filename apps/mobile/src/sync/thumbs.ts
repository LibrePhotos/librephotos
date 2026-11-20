/**
 * Thumb-cache bookkeeping + LRU eviction (doc 01 / doc 02 thumb_cache table).
 *
 * This module is pure DB + arithmetic — no expo-file-system — so the eviction
 * policy is unit-tested under Node. The actual byte download/delete against
 * expo-file-system lives in ./thumb-prefetch (app-only), which drives these.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "@librephotos/local-db";

/** Default LRU cap: 2 GB (configurable in the settings store). */
export const DEFAULT_THUMB_CAP_BYTES = 2 * 1024 * 1024 * 1024;

export type ThumbRow = {
  photo_id: string;
  file_path: string;
  size_bytes: number;
  last_used: number;
};

export async function thumbCacheTotalBytes(db: AppDatabase): Promise<number> {
  const row = await db.get<{ total: number; }>(sql`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM thumb_cache`);
  return row.total;
}

/**
 * Wipe the whole thumb cache (the settings "Clear cache" action). Returns the
 * file paths that were tracked so the caller (app-only) can delete the files
 * from expo-file-system; the DB rows are removed here in one statement.
 */
export async function clearThumbCache(db: AppDatabase): Promise<string[]> {
  const paths = (await db.all<{ file_path: string }>(sql`SELECT file_path FROM thumb_cache`)).map(
    (r) => r.file_path
  );
  await db.run(sql`DELETE FROM thumb_cache`);
  return paths;
}

export async function getThumb(db: AppDatabase, photoId: string): Promise<ThumbRow | null> {
  const row = await db.get<ThumbRow | undefined>(
    sql`SELECT photo_id, file_path, size_bytes, last_used FROM thumb_cache WHERE photo_id = ${photoId}`
  );
  return row ?? null;
}

/** Record (or update) a cached thumbnail and mark it freshly used. */
export async function recordThumb(
  db: AppDatabase,
  args: { photoId: string; filePath: string; sizeBytes: number; now: number }
): Promise<void> {
  await db.run(
    sql`INSERT INTO thumb_cache (photo_id, file_path, size_bytes, last_used)
        VALUES (${args.photoId}, ${args.filePath}, ${args.sizeBytes}, ${args.now})
        ON CONFLICT(photo_id) DO UPDATE SET
          file_path = excluded.file_path, size_bytes = excluded.size_bytes, last_used = excluded.last_used`
  );
}

/** Bump last_used on cache hit (keeps the LRU ordering meaningful). */
export async function touchThumb(db: AppDatabase, photoId: string, now: number): Promise<void> {
  await db.run(sql`UPDATE thumb_cache SET last_used = ${now} WHERE photo_id = ${photoId}`);
}

export async function removeThumb(db: AppDatabase, photoId: string): Promise<void> {
  await db.run(sql`DELETE FROM thumb_cache WHERE photo_id = ${photoId}`);
}

/** Least-recently-used cache rows first (eviction order). */
export async function lruCandidates(db: AppDatabase): Promise<ThumbRow[]> {
  return await db.all<ThumbRow>(
    sql`SELECT photo_id, file_path, size_bytes, last_used FROM thumb_cache ORDER BY last_used ASC, photo_id ASC`
  );
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

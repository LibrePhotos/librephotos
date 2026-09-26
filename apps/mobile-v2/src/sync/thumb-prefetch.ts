/**
 * Explicit thumbnail prefetch to on-device storage (doc 01). Grid-size
 * thumbnails are downloaded to a cache directory, recorded in thumb_cache, and
 * kept under an LRU byte cap (default 2 GB, configurable in the settings store).
 * Grid cells read the local file when present and fall back to network
 * expo-image otherwise. App-only (expo-file-system); the LRU policy itself is
 * unit-tested in ./thumbs.
 */
import * as FileSystem from "expo-file-system/legacy";
import { sql } from "drizzle-orm";
import { mediaHeaders, squareThumbnailUrl } from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import {
  DEFAULT_THUMB_CAP_BYTES,
  getThumb,
  lruCandidates,
  recordThumb,
  removeThumb,
  selectEvictions,
  thumbCacheTotalBytes,
  touchThumb,
} from "./thumbs";

const THUMB_DIR = `${FileSystem.cacheDirectory ?? ""}thumbs/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(THUMB_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(THUMB_DIR, { intermediates: true });
}

function pathFor(photoId: string): string {
  return `${THUMB_DIR}${photoId}.jpg`;
}

/** Local file uri for a prefetched thumb, or null if not cached. Touches LRU. */
export function cachedThumbUri(db: AppDatabase, photoId: string, now = Date.now()): string | null {
  const row = getThumb(db, photoId);
  if (!row) return null;
  touchThumb(db, photoId, now);
  return row.file_path;
}

/**
 * Prefetch one grid thumbnail. No-op if already cached. Enforces the LRU cap
 * (evicting oldest entries + their files) before recording the new entry.
 */
export async function prefetchThumb(
  db: AppDatabase,
  args: {
    photoId: string;
    imageHash: string;
    serverAddress: string;
    accessToken: string | null;
    capBytes?: number;
  }
): Promise<string | null> {
  const now = Date.now();
  const existing = cachedThumbUri(db, args.photoId, now);
  if (existing) return existing;

  await ensureDir();
  const dest = pathFor(args.photoId);
  const url = squareThumbnailUrl(args.serverAddress, args.imageHash);
  const result = await FileSystem.downloadAsync(url, dest, { headers: mediaHeaders(args.accessToken) });
  if (result.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    return null;
  }
  const info = await FileSystem.getInfoAsync(dest);
  const size = info.exists && !info.isDirectory ? info.size : 0;

  await enforceCap(db, size, args.capBytes ?? DEFAULT_THUMB_CAP_BYTES, args.photoId);
  recordThumb(db, { photoId: args.photoId, filePath: dest, sizeBytes: size, now });
  return dest;
}

/**
 * Sync step 6 (doc 03 §1): best-effort prefetch of grid thumbnails for the most
 * recent visible remote photos that aren't cached yet, so a freshly-synced
 * timeline scrolls without network. Bounded and cancellable; per-item failures
 * are swallowed (a missing thumb just falls back to network expo-image).
 */
export async function prefetchNewThumbs(
  db: AppDatabase,
  args: {
    serverAddress: string;
    accessToken: string | null;
    capBytes?: number;
    limit?: number;
    signal?: AbortSignal;
  }
): Promise<number> {
  if (!args.serverAddress) return 0;
  const limit = args.limit ?? 60;
  const rows = db.all(
    sql`SELECT rp.id AS id, rp.image_hash AS image_hash
        FROM remote_photo rp
        LEFT JOIN thumb_cache tc ON tc.photo_id = rp.id
        WHERE tc.photo_id IS NULL
          AND rp.hidden = 0 AND rp.in_trashcan = 0 AND rp.removed = 0
          AND rp.timestamp IS NOT NULL
        ORDER BY rp.timestamp DESC
        LIMIT ${limit}`
  ) as { id: string; image_hash: string }[];

  let fetched = 0;
  for (const row of rows) {
    if (args.signal?.aborted) break;
    try {
      const uri = await prefetchThumb(db, {
        photoId: row.id,
        imageHash: row.image_hash,
        serverAddress: args.serverAddress,
        accessToken: args.accessToken,
        capBytes: args.capBytes,
      });
      if (uri) fetched += 1;
    } catch {
      // Best-effort — ignore and continue.
    }
  }
  return fetched;
}

/** Evict least-recently-used thumbs (rows + files) to fit `incomingBytes`. */
export async function enforceCap(
  db: AppDatabase,
  incomingBytes: number,
  capBytes: number,
  keepPhotoId?: string
): Promise<void> {
  const total = thumbCacheTotalBytes(db);
  if (total + incomingBytes <= capBytes) return;
  const victims = selectEvictions(
    lruCandidates(db),
    capBytes,
    incomingBytes,
    keepPhotoId ? new Set([keepPhotoId]) : new Set()
  );
  for (const v of victims) {
    await FileSystem.deleteAsync(v.file_path, { idempotent: true });
    removeThumb(db, v.photo_id);
  }
}

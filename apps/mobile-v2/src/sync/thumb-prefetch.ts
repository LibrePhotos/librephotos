/**
 * Explicit thumbnail prefetch to on-device storage (doc 01). Grid-size
 * thumbnails are downloaded to a cache directory, recorded in thumb_cache, and
 * kept under an LRU byte cap (default 2 GB, configurable in the settings store).
 * Grid cells read the local file when present and fall back to network
 * expo-image otherwise. App-only (expo-file-system); the LRU policy itself is
 * unit-tested in ./thumbs.
 */
import * as FileSystem from "expo-file-system/legacy";
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

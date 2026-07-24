/**
 * Lazy photo-detail cache (remote_photo_detail). The full photo endpoint payload
 * (EXIF/geo/captions) is expensive, so the viewer detail sheet reads cache-first
 * then refreshes from the network via api-client, writing the fresh payload back.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

export type CachedDetail = { payload: string; fetched_at: number };

/** Read a cached detail payload (raw JSON string) for a photo, or null. */
export function getPhotoDetail(db: AppDatabase, photoId: string): CachedDetail | null {
  const row = db.get(
    sql`SELECT payload, fetched_at FROM remote_photo_detail WHERE photo_id = ${photoId}`
  ) as CachedDetail | undefined;
  return row ?? null;
}

/** Upsert a photo-detail payload into the cache. */
export function putPhotoDetail(
  db: AppDatabase,
  photoId: string,
  payload: string,
  fetchedAt: number
): void {
  db.run(
    sql`INSERT INTO remote_photo_detail (photo_id, payload, fetched_at)
        VALUES (${photoId}, ${payload}, ${fetchedAt})
        ON CONFLICT(photo_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
  );
}

/** Look up a single mirror row by image hash (viewer opens by hash from a tile). */
export function remotePhotoIdByHash(db: AppDatabase, imageHash: string): string | null {
  const row = db.get(
    sql`SELECT id FROM remote_photo WHERE image_hash = ${imageHash} LIMIT 1`
  ) as { id: string } | undefined;
  return row?.id ?? null;
}

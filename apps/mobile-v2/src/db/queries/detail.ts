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

/**
 * One viewer slide: everything needed to render a photo full-screen, whether it
 * lives on the server, on the camera roll, or both.
 *
 * `image_hash` is null for a camera-roll asset that has not been hashed yet —
 * which is why the viewer must not be keyed on the hash. Tapping such a photo
 * used to be swallowed by an `if (item.imageHash)` guard, so nothing opened and
 * the lightbox looked unimplemented.
 */
export type ViewerSlide = {
  key: string;
  remote_id: string | null;
  local_id: string | null;
  image_hash: string | null;
  local_uri: string | null;
  type: string | null;
};

/**
 * Resolve a single slide from any identifier the app routes with: a remote
 * photo id, an image hash, or a local asset id. Used when the tapped photo is
 * outside the loaded timeline window (a hidden photo, a memories deep link, a
 * notification), so the viewer always has something to show.
 */
export function viewerSlideById(db: AppDatabase, id: string): ViewerSlide | null {
  const remote = db.get(
    sql`SELECT rp.id AS remote_id, rp.image_hash AS image_hash, rp.type AS type,
               (SELECT la.uri FROM local_asset la WHERE la.hash = rp.image_hash LIMIT 1) AS local_uri,
               (SELECT la.id FROM local_asset la WHERE la.hash = rp.image_hash LIMIT 1) AS local_id
        FROM remote_photo rp
        WHERE rp.id = ${id} OR rp.image_hash = ${id}
        LIMIT 1`
  ) as Omit<ViewerSlide, "key"> | undefined;
  if (remote) return { ...remote, key: remote.remote_id ?? id };

  const local = db.get(
    sql`SELECT NULL AS remote_id, la.id AS local_id, la.hash AS image_hash,
               la.uri AS local_uri, la.type AS type
        FROM local_asset la WHERE la.id = ${id} LIMIT 1`
  ) as Omit<ViewerSlide, "key"> | undefined;
  if (local) return { ...local, key: local.local_id ?? id };

  return null;
}

export type PhotoFlags = {
  id: string;
  image_hash: string;
  is_favorite: number;
  hidden: number;
  in_trashcan: number;
  rating: number;
};

/** The mutable flags of one mirror photo (drives the viewer action bar state). */
export function photoFlagsByHash(db: AppDatabase, imageHash: string): PhotoFlags | null {
  const row = db.get(
    sql`SELECT id, image_hash, is_favorite, hidden, in_trashcan, rating
        FROM remote_photo WHERE image_hash = ${imageHash} LIMIT 1`
  ) as PhotoFlags | undefined;
  return row ?? null;
}

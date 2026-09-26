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
  is_public: number;
};

/** The mutable flags of one mirror photo (drives the viewer action bar state). */
export function photoFlagsByHash(db: AppDatabase, imageHash: string): PhotoFlags | null {
  const row = db.get(
    sql`SELECT id, image_hash, is_favorite, hidden, in_trashcan, rating, is_public
        FROM remote_photo WHERE image_hash = ${imageHash} LIMIT 1`
  ) as PhotoFlags | undefined;
  return row ?? null;
}

/**
 * The mirror's own summary of a photo — always available offline, even for a
 * photo whose detail payload was never fetched. Tier A in doc 07 §1.3: it is
 * what the info sheet's header falls back to when the network has never been
 * reachable for this photo.
 */
export type PhotoSummary = {
  id: string;
  image_hash: string;
  timestamp: number | null;
  added_on: number;
  type: string;
  search_location: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function photoSummaryByHash(db: AppDatabase, imageHash: string): PhotoSummary | null {
  const row = db.get(
    sql`SELECT id, image_hash, timestamp, added_on, type, search_location, latitude, longitude
        FROM remote_photo WHERE image_hash = ${imageHash} LIMIT 1`
  ) as PhotoSummary | undefined;
  return row ?? null;
}

/** A camera-roll asset's own metadata — the only source a local-only slide has. */
export type LocalAssetSummary = {
  id: string;
  name: string | null;
  type: string | null;
  created_at: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  uri: string | null;
};

export function localAssetById(db: AppDatabase, assetId: string): LocalAssetSummary | null {
  const row = db.get(
    sql`SELECT id, name, type, created_at, width, height, duration_ms, uri
        FROM local_asset WHERE id = ${assetId} LIMIT 1`
  ) as LocalAssetSummary | undefined;
  return row ?? null;
}

/**
 * Which albums contain this photo, straight from the mirrored membership
 * tables. The web lightbox spends a request on `/photos/{hash}/albums/`; mobile
 * already has the answer offline, which is why doc 07 rates this section higher
 * on mobile than on web.
 *
 * `kind` distinguishes the two membership tables so the UI can route a tap and
 * so "remove from album" is offered only where it is legal (user albums —
 * auto/event albums are server-generated).
 */
export type PhotoAlbumRow = {
  id: number;
  title: string;
  kind: "user" | "auto";
  photo_count: number;
  cover_hash: string | null;
};

export function albumsContainingPhoto(db: AppDatabase, photoId: string): PhotoAlbumRow[] {
  return db.all(
    sql`SELECT ua.id AS id, ua.title AS title, 'user' AS kind,
               ua.photo_count AS photo_count, ua.cover_hash AS cover_hash
        FROM user_album_photo uap JOIN user_album ua ON ua.id = uap.album_id
        WHERE uap.photo_id = ${photoId}
        UNION ALL
        SELECT aa.id AS id, aa.title AS title, 'auto' AS kind,
               aa.photo_count AS photo_count, aa.cover_hash AS cover_hash
        FROM auto_album_photo aap JOIN auto_album aa ON aa.id = aap.album_id
        WHERE aap.photo_id = ${photoId}
        ORDER BY kind ASC, title ASC`
  ) as PhotoAlbumRow[];
}

/** Person ids by name, so a face chip can route to its mirrored person album. */
export function personIdByName(db: AppDatabase, name: string): number | null {
  const row = db.get(sql`SELECT id FROM person WHERE name = ${name} LIMIT 1`) as
    | { id: number }
    | undefined;
  return row?.id ?? null;
}

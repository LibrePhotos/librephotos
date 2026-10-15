/**
 * Zod schemas for the mobile app's delta-sync feeds (backend `api/views/sync.py`).
 *
 * Every feed shares one envelope:
 *   { v, items, tombstones, next_cursor, total?, server_time }
 *
 * `v` is validated (a version bump is a breaking wire change the client must
 * notice), but every object uses `z.looseObject` so unknown/extra fields the
 * server may add later are tolerated — forward-compat by construction.
 *
 * Item shapes mirror the flat `serialize_*_row` outputs and the client's
 * `remote_*` tables (doc 02 §1), and the OpenAPI components of
 * `api/serializers/sync_responses.py`. Timestamps are integer ms epoch;
 * `last_modified` is the keyset-cursor ordering key. A field is nullable only
 * where the server can send null (every server since the feeds were added).
 */
import { z } from "zod";

/** Envelope wrapper: parametrised over the per-entity item schema. */
export function syncEnvelope<T extends z.ZodType>(item: T) {
  return z.looseObject({
    v: z.literal(1),
    items: z.array(item),
    // Backend emits `str(entity_id)`; accept numbers too and coerce to string.
    tombstones: z.array(z.coerce.string()).default([]),
    next_cursor: z.string().nullable(),
    total: z.number().optional(),
    server_time: z.string(),
  });
}

/* ---- photo -------------------------------------------------------------- */

export const SyncPhotoItem = z.looseObject({
  id: z.string(),
  image_hash: z.string(),
  owner_id: z.number(),
  timestamp: z.number().nullable(),
  added_on: z.number(),
  last_modified: z.number(),
  type: z.string(),
  video_length_ms: z.number().nullable(),
  rating: z.number(),
  is_favorite: z.boolean(),
  hidden: z.boolean(),
  // Off the timeline and Memories (#545). Older servers do not send it.
  archived: z.boolean().optional(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  is_public: z.boolean(),
  aspect_ratio: z.number().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  /** "" without a place name. */
  search_location: z.string(),
  dominant_color: z.string().nullable(),
});
export type SyncPhotoItem = z.infer<typeof SyncPhotoItem>;

/* ---- person ------------------------------------------------------------- */

export const SyncPersonItem = z.looseObject({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  face_count: z.number(),
  /** The cover the user chose, else null. */
  cover_photo_hash: z.string().nullable(),
  /**
   * The cover the People list shows (`face_photo_url`): the chosen one, else
   * the first face's photo, else null. Absent from servers up to 1.3.0.
   */
  effective_cover_hash: z.string().nullable().optional(),
  last_modified: z.number(),
});
export type SyncPersonItem = z.infer<typeof SyncPersonItem>;

/* ---- albums ------------------------------------------------------------- */

export const SyncUserAlbumItem = z.looseObject({
  id: z.number(),
  title: z.string(),
  owner_id: z.number(),
  favorited: z.boolean(),
  shared: z.number(), // 0 | 1
  cover_hash: z.string().nullable(),
  photo_count: z.number(),
  created_on: z.number(),
  last_modified: z.number(),
  photo_ids: z.array(z.string()).default([]),
});
export type SyncUserAlbumItem = z.infer<typeof SyncUserAlbumItem>;

export const SyncAutoAlbumItem = z.looseObject({
  id: z.number(),
  title: z.string(),
  timestamp: z.number(),
  favorited: z.boolean(),
  photo_count: z.number(),
  cover_hash: z.string().nullable(),
  last_modified: z.number(),
  photo_ids: z.array(z.string()).default([]),
});
export type SyncAutoAlbumItem = z.infer<typeof SyncAutoAlbumItem>;

/** Thing / tag list mirror (photo_count + cover hashes, no membership). */
export const SyncNamedAlbumItem = z.looseObject({
  id: z.number(),
  title: z.string(),
  photo_count: z.number(),
  cover_hashes: z.array(z.string()).default([]),
  last_modified: z.number(),
});
export type SyncNamedAlbumItem = z.infer<typeof SyncNamedAlbumItem>;

/** Place list mirror — as named, plus the geolocation zoom level. */
export const SyncPlaceAlbumItem = z.looseObject({
  id: z.number(),
  title: z.string(),
  photo_count: z.number(),
  cover_hashes: z.array(z.string()).default([]),
  geolocation_level: z.number().nullable(),
  last_modified: z.number(),
});
export type SyncPlaceAlbumItem = z.infer<typeof SyncPlaceAlbumItem>;

/* ---- sharing surface ---------------------------------------------------- */

export const SyncSharedUserItem = z.looseObject({
  id: z.number(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  avatar_url: z.string().nullable(),
  last_modified: z.number(),
});
export type SyncSharedUserItem = z.infer<typeof SyncSharedUserItem>;

/* ---- per-entity envelopes ---------------------------------------------- */

export const SyncPhotosResponse = syncEnvelope(SyncPhotoItem);
export const SyncPersonsResponse = syncEnvelope(SyncPersonItem);
export const SyncUserAlbumsResponse = syncEnvelope(SyncUserAlbumItem);
export const SyncAutoAlbumsResponse = syncEnvelope(SyncAutoAlbumItem);
export const SyncThingAlbumsResponse = syncEnvelope(SyncNamedAlbumItem);
export const SyncPlaceAlbumsResponse = syncEnvelope(SyncPlaceAlbumItem);
export const SyncTagAlbumsResponse = syncEnvelope(SyncNamedAlbumItem);
export const SyncSharingResponse = syncEnvelope(SyncSharedUserItem);

export type SyncPhotosResponse = z.infer<typeof SyncPhotosResponse>;
export type SyncPersonsResponse = z.infer<typeof SyncPersonsResponse>;
export type SyncUserAlbumsResponse = z.infer<typeof SyncUserAlbumsResponse>;
export type SyncAutoAlbumsResponse = z.infer<typeof SyncAutoAlbumsResponse>;
export type SyncThingAlbumsResponse = z.infer<typeof SyncThingAlbumsResponse>;
export type SyncPlaceAlbumsResponse = z.infer<typeof SyncPlaceAlbumsResponse>;
export type SyncTagAlbumsResponse = z.infer<typeof SyncTagAlbumsResponse>;
export type SyncSharingResponse = z.infer<typeof SyncSharingResponse>;

/** Generic envelope shape (for code that is polymorphic over entity). */
export type SyncEnvelope<T> = {
  v: 1;
  items: T[];
  tombstones: string[];
  next_cursor: string | null;
  total?: number;
  server_time: string;
};

/* ---- counts (integrity check, doc 03 §8) ------------------------------- */

export const SyncCounts = z.looseObject({
  photos: z.number(),
  persons: z.number(),
  user_albums: z.number(),
  auto_albums: z.number(),
  thing_albums: z.number(),
  place_albums: z.number(),
  tags: z.number(),
  server_time: z.string(),
});
export type SyncCounts = z.infer<typeof SyncCounts>;

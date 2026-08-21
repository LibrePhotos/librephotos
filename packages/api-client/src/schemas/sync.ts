/**
 * Zod schemas for the mobile-v2 delta-sync feeds (backend `api/views/sync.py`).
 *
 * Every feed shares one envelope:
 *   { v, items, tombstones, next_cursor, total?, server_time }
 *
 * `v` is validated (a version bump is a breaking wire change the client must
 * notice), but every object uses `.passthrough()` so unknown/extra fields the
 * server may add later are tolerated — forward-compat by construction.
 *
 * Item shapes mirror the flat `serialize_*_row` outputs and the client's
 * `remote_*` tables (doc 02 §1). Timestamps are integer ms epoch (or null);
 * `last_modified` is the keyset-cursor ordering key.
 */
import { z } from "zod";

/** Envelope wrapper: parametrised over the per-entity item schema. */
export function syncEnvelope<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      v: z.literal(1),
      items: z.array(item),
      // Backend emits `str(entity_id)`; accept numbers too and coerce to string.
      tombstones: z.array(z.coerce.string()).default([]),
      next_cursor: z.string().nullable(),
      total: z.number().optional(),
      server_time: z.string(),
    })
    .passthrough();
}

/* ---- photo -------------------------------------------------------------- */

export const SyncPhotoItem = z
  .object({
    id: z.string(),
    image_hash: z.string(),
    owner_id: z.number(),
    timestamp: z.number().nullable(),
    added_on: z.number().nullable(),
    last_modified: z.number().nullable(),
    type: z.string(),
    video_length_ms: z.number().nullable(),
    rating: z.number(),
    is_favorite: z.boolean(),
    hidden: z.boolean(),
    in_trashcan: z.boolean(),
    removed: z.boolean(),
    is_public: z.boolean(),
    aspect_ratio: z.number().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    search_location: z.string().nullable(),
    dominant_color: z.string().nullable(),
  })
  .passthrough();
export type SyncPhotoItem = z.infer<typeof SyncPhotoItem>;

/* ---- person ------------------------------------------------------------- */

export const SyncPersonItem = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    kind: z.string().nullable(),
    face_count: z.number().nullable(),
    cover_photo_hash: z.string().nullable(),
    last_modified: z.number().nullable(),
  })
  .passthrough();
export type SyncPersonItem = z.infer<typeof SyncPersonItem>;

/* ---- albums ------------------------------------------------------------- */

export const SyncUserAlbumItem = z
  .object({
    id: z.number(),
    title: z.string(),
    owner_id: z.number().nullable(),
    favorited: z.boolean(),
    shared: z.number(), // 0 | 1
    cover_hash: z.string().nullable(),
    photo_count: z.number(),
    created_on: z.number().nullable(),
    last_modified: z.number().nullable(),
    photo_ids: z.array(z.string()).default([]),
  })
  .passthrough();
export type SyncUserAlbumItem = z.infer<typeof SyncUserAlbumItem>;

export const SyncAutoAlbumItem = z
  .object({
    id: z.number(),
    title: z.string(),
    timestamp: z.number().nullable(),
    favorited: z.boolean(),
    photo_count: z.number(),
    cover_hash: z.string().nullable(),
    last_modified: z.number().nullable(),
    photo_ids: z.array(z.string()).default([]),
  })
  .passthrough();
export type SyncAutoAlbumItem = z.infer<typeof SyncAutoAlbumItem>;

/** Thing / tag list mirror (photo_count + cover hashes, no membership). */
export const SyncNamedAlbumItem = z
  .object({
    id: z.number(),
    title: z.string(),
    photo_count: z.number(),
    cover_hashes: z.array(z.string()).default([]),
    last_modified: z.number().nullable(),
  })
  .passthrough();
export type SyncNamedAlbumItem = z.infer<typeof SyncNamedAlbumItem>;

/** Place list mirror — as named, plus the geolocation zoom level. */
export const SyncPlaceAlbumItem = z
  .object({
    id: z.number(),
    title: z.string(),
    photo_count: z.number(),
    cover_hashes: z.array(z.string()).default([]),
    geolocation_level: z.number().nullable(),
    last_modified: z.number().nullable(),
  })
  .passthrough();
export type SyncPlaceAlbumItem = z.infer<typeof SyncPlaceAlbumItem>;

/* ---- sharing surface ---------------------------------------------------- */

export const SyncSharedUserItem = z
  .object({
    id: z.number(),
    username: z.string().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    last_modified: z.number().nullable(),
  })
  .passthrough();
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

export const SyncCounts = z
  .object({
    photos: z.number(),
    persons: z.number(),
    user_albums: z.number(),
    auto_albums: z.number(),
    thing_albums: z.number(),
    place_albums: z.number(),
    tags: z.number(),
    server_time: z.string(),
  })
  .passthrough();
export type SyncCounts = z.infer<typeof SyncCounts>;

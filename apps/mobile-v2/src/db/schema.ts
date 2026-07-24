/**
 * Drizzle schema for the on-device SQLite mirror (doc 02).
 *
 * Three groups of tables:
 *   - remote mirror : flat summaries of server state (own + shared photos,
 *                     albums, people). Disposable — re-seedable from the API.
 *   - local media   : camera-roll assets (populated in Phase 3; created empty).
 *   - app state     : sync cursors, offline outbox, upload/thumb queues, logs.
 *
 * Timestamps are stored as integer ms-epoch (mode: "number"), NOT Date, so the
 * same numbers round-trip identically under both the expo-sqlite driver (app)
 * and the better-sqlite3 driver (Node tests). Flags are integers with mode
 * "boolean" for ergonomic query-builder filters; raw SQL sees plain 0/1.
 *
 * This module is the single source of truth drizzle-kit reads to generate the
 * committed SQL migrations in ./migrations.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/* ---------------------------------------------------------------------- *
 * Remote mirror
 * ---------------------------------------------------------------------- */

/** One row per server Photo the user can see (own + shared). */
export const remotePhoto = sqliteTable(
  "remote_photo",
  {
    id: text("id").primaryKey(),
    imageHash: text("image_hash").notNull(),
    ownerId: integer("owner_id").notNull(),
    /** ms epoch; null => "no timestamp" (renders in the notimestamp bucket). */
    timestamp: integer("timestamp"),
    addedOn: integer("added_on").notNull(),
    /** sync ordering half 1 (keyset cursor). */
    lastModified: integer("last_modified").notNull(),
    type: text("type").notNull(), // 'image' | 'video' | 'motion_photo'
    videoLengthMs: integer("video_length_ms"),
    rating: integer("rating").notNull().default(0),
    isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    inTrashcan: integer("in_trashcan", { mode: "boolean" }).notNull().default(false),
    removed: integer("removed", { mode: "boolean" }).notNull().default(false),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
    aspectRatio: real("aspect_ratio"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    searchLocation: text("search_location"),
    dominantColor: text("dominant_color"),
    /** 'YYYY-MM-DD' precomputed at insert (local tz) — trivial timeline GROUP BY. */
    bucketDay: text("bucket_day").notNull(),
    bucketMonth: text("bucket_month").notNull(),
  },
  (t) => [
    index("idx_remote_photo_bucket_day").on(t.bucketDay),
    index("idx_remote_photo_timestamp").on(t.timestamp),
    index("idx_remote_photo_image_hash").on(t.imageHash),
    index("idx_remote_photo_last_modified").on(t.lastModified),
    // Partial indexes keep the flag-filter screens (favorites/hidden/trash)
    // off the base table and small — they only cover the matching rows.
    index("idx_remote_photo_favorite")
      .on(t.timestamp)
      .where(sql`is_favorite = 1 AND hidden = 0 AND in_trashcan = 0 AND removed = 0`),
    index("idx_remote_photo_hidden").on(t.timestamp).where(sql`hidden = 1 AND removed = 0`),
    index("idx_remote_photo_trash").on(t.timestamp).where(sql`in_trashcan = 1 AND removed = 0`),
    // Covers the hot "visible timeline" predicate for the merged view + buckets.
    index("idx_remote_photo_visible")
      .on(t.timestamp, t.id)
      .where(sql`hidden = 0 AND in_trashcan = 0 AND removed = 0 AND timestamp IS NOT NULL`),
  ]
);

/** Lazy cache of the full photo-detail endpoint (EXIF/geo/captions JSON). */
export const remotePhotoDetail = sqliteTable("remote_photo_detail", {
  photoId: text("photo_id").primaryKey(),
  payload: text("payload").notNull(), // zod-validated JSON from api-client
  fetchedAt: integer("fetched_at").notNull(),
});

/** Mirror of persons for the People album grid (faces are NOT mirrored, doc 02). */
export const person = sqliteTable("person", {
  id: integer("id").primaryKey(),
  name: text("name"),
  kind: text("kind"),
  faceCount: integer("face_count"),
  coverPhotoHash: text("cover_photo_hash"),
  lastModified: integer("last_modified"),
});

export const userAlbum = sqliteTable("user_album", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  ownerId: integer("owner_id"),
  shared: integer("shared", { mode: "boolean" }).notNull().default(false),
  favorited: integer("favorited", { mode: "boolean" }).notNull().default(false),
  coverHash: text("cover_hash"),
  photoCount: integer("photo_count").notNull().default(0),
  createdOn: integer("created_on"),
  lastModified: integer("last_modified"),
});

export const userAlbumPhoto = sqliteTable(
  "user_album_photo",
  {
    albumId: integer("album_id").notNull(),
    photoId: text("photo_id").notNull(),
    ordering: integer("ordering").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.photoId] }),
    index("idx_user_album_photo_album").on(t.albumId, t.ordering),
  ]
);

export const autoAlbum = sqliteTable("auto_album", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  timestamp: integer("timestamp"),
  favorited: integer("favorited", { mode: "boolean" }).notNull().default(false),
  photoCount: integer("photo_count").notNull().default(0),
  coverHash: text("cover_hash"),
  lastModified: integer("last_modified"),
});

export const autoAlbumPhoto = sqliteTable(
  "auto_album_photo",
  {
    albumId: integer("album_id").notNull(),
    photoId: text("photo_id").notNull(),
    ordering: integer("ordering").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.photoId] }),
    index("idx_auto_album_photo_album").on(t.albumId, t.ordering),
  ]
);

/** Thing / place / tag albums — mirror the *lists* only (membership is fetched on tap). */
export const thingAlbum = sqliteTable("thing_album", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  photoCount: integer("photo_count").notNull().default(0),
  coverHashes: text("cover_hashes"), // json array
  lastModified: integer("last_modified"),
});

export const placeAlbum = sqliteTable("place_album", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  photoCount: integer("photo_count").notNull().default(0),
  geolocationLevel: integer("geolocation_level"),
  coverHashes: text("cover_hashes"),
  lastModified: integer("last_modified"),
});

export const tagAlbum = sqliteTable("tag_album", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  photoCount: integer("photo_count").notNull().default(0),
  coverHashes: text("cover_hashes"),
  lastModified: integer("last_modified"),
});

export const sharedFromMe = sqliteTable(
  "shared_from_me",
  {
    photoId: text("photo_id").notNull(),
    sharedToUserId: integer("shared_to_user_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.sharedToUserId] })]
);

export const sharedUser = sqliteTable("shared_user", {
  id: integer("id").primaryKey(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarUrl: text("avatar_url"),
});

/* ---------------------------------------------------------------------- *
 * Local media (camera roll) — created empty; populated in Phase 3.
 * ---------------------------------------------------------------------- */

export const localAsset = sqliteTable(
  "local_asset",
  {
    id: text("id").primaryKey(), // MediaLibrary asset id
    name: text("name"),
    type: text("type"), // 'image' | 'video'
    createdAt: integer("created_at"),
    modifiedAt: integer("modified_at"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    uri: text("uri"), // ph:// | content://
    hash: text("hash"), // md5(bytes)+userId — null until hashed
    hashedAt: integer("hashed_at"),
  },
  (t) => [
    index("idx_local_asset_hash").on(t.hash),
    index("idx_local_asset_modified").on(t.modifiedAt),
  ]
);

export const localAlbum = sqliteTable("local_album", {
  id: text("id").primaryKey(),
  title: text("title"),
  assetCount: integer("asset_count"),
  modifiedAt: integer("modified_at"),
  backupSelection: integer("backup_selection").notNull().default(0), // 0 none | 1 selected | 2 excluded
});

export const localAlbumAsset = sqliteTable(
  "local_album_asset",
  {
    albumId: text("album_id").notNull(),
    assetId: text("asset_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.assetId] }),
    index("idx_local_album_asset_asset").on(t.assetId),
  ]
);

/* ---------------------------------------------------------------------- *
 * App state
 * ---------------------------------------------------------------------- */

/** One row per synced entity type; drives resumable/determinate sync. */
export const syncState = sqliteTable("sync_state", {
  entity: text("entity").primaryKey(), // 'photo' | 'person' | 'user_album' | ...
  cursorModified: integer("cursor_modified"), // keyset cursor half 1
  cursorId: text("cursor_id"), // keyset cursor half 2 (tie-break)
  lastFullSync: integer("last_full_sync"),
  status: text("status"), // 'idle' | 'running' | 'done' | 'error'
  progressCurrent: integer("progress_current").notNull().default(0),
  progressTotal: integer("progress_total").notNull().default(0),
});

/** Offline mutations (doc 03 §6). Survives a wipe-and-reseed. */
export const outbox = sqliteTable(
  "outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: integer("created_at").notNull(),
    kind: text("kind").notNull(), // 'favorite' | 'hide' | 'trash' | 'album_add' | ...
    payload: text("payload"), // zod-validated json
    state: text("state").notNull().default("pending"), // pending | inflight | failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** ms-epoch an `inflight` row was claimed (stale-claim recovery on crash). */
    inflightAt: integer("inflight_at"),
    /** Earliest ms-epoch a failed row may be retried (exponential backoff). */
    nextAttemptAt: integer("next_attempt_at"),
  },
  (t) => [index("idx_outbox_state").on(t.state)]
);

/** Upload queue (doc 03 §5). Survives a wipe-and-reseed. */
export const uploadQueue = sqliteTable(
  "upload_queue",
  {
    assetId: text("asset_id").primaryKey(),
    // pending | checking | uploading | done | failed | skipped_exists
    state: text("state").notNull().default("pending"),
    progress: real("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    enqueuedAt: integer("enqueued_at"),
    /** Earliest ms-epoch a failed item may be retried (exponential backoff). */
    nextAttemptAt: integer("next_attempt_at"),
  },
  (t) => [index("idx_upload_queue_state").on(t.state)]
);

/** Explicit offline thumbnail store with LRU eviction (doc 01). */
export const thumbCache = sqliteTable(
  "thumb_cache",
  {
    photoId: text("photo_id").primaryKey(),
    filePath: text("file_path").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    lastUsed: integer("last_used").notNull().default(0),
  },
  (t) => [index("idx_thumb_cache_last_used").on(t.lastUsed)]
);

/**
 * Diagnostics ring buffer for sync runs (doc 03 §8). One row per meaningful
 * step (a pull page, a reseed, an integrity check). Capped in code
 * (see queries/sync-log). `cursor` records the durable resume token at the time
 * of the entry so a bug report can be reconstructed.
 */
export const syncLog = sqliteTable(
  "sync_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    op: text("op"), // 'pull' | 'seed' | 'reseed' | 'integrity' | 'run' | ...
    entity: text("entity"),
    level: text("level").notNull().default("info"), // info | warn | error
    applied: integer("applied"), // rows upserted
    deleted: integer("deleted"), // tombstones applied
    durationMs: integer("duration_ms"),
    cursor: text("cursor"),
    message: text("message"),
  },
  (t) => [index("idx_sync_log_ts").on(t.ts)]
);

/**
 * Small key/value store for app-level sync metadata that isn't per-entity —
 * e.g. the last-seen `favorite_min_rating` (a change forces a reseed, doc 03
 * §3) and the last integrity snapshot. Survives a mirror wipe; cleared only on
 * logout.
 */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at"),
});

export const schema = {
  remotePhoto,
  remotePhotoDetail,
  person,
  userAlbum,
  userAlbumPhoto,
  autoAlbum,
  autoAlbumPhoto,
  thingAlbum,
  placeAlbum,
  tagAlbum,
  sharedFromMe,
  sharedUser,
  localAsset,
  localAlbum,
  localAlbumAsset,
  syncState,
  outbox,
  uploadQueue,
  thumbCache,
  syncLog,
  appMeta,
};

export type Schema = typeof schema;

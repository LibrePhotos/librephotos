# 02 — Local Database (SQLite mirror)

Drizzle ORM over `expo-sqlite`. One database file, three groups of tables:
**remote mirror** (server state), **local media** (camera roll), **app state**
(sync cursors, outbox, queues, caches). Timeline and album screens are pure
SQL over these tables — no network on the read path.

Modeled on Immich's Drift schema (`mobile/lib/infrastructure/entities/`) but
mapped to LibrePhotos' data model.

## 1. Remote mirror tables

Mirrors are **flat summaries**, not full server rows. The full photo detail
(EXIF json, geolocation json, captions) is fetched on demand via
`api-client` and cached in a detail table.

```ts
// remote_photo — one row per server Photo the user can see (own + shared)
remote_photo {
  id: text primary key,            // Photo.id (UUID)
  image_hash: text not null,       // md5+userid — join key to local_asset
  owner_id: integer not null,
  timestamp: integer,              // Photo.timestamp (ms epoch, null => "no timestamp")
  added_on: integer not null,
  last_modified: integer not null, // sync ordering
  type: text not null,             // 'image' | 'video' | 'motion' ...
  video_length_ms: integer,
  rating: integer not null default 0,
  is_favorite: integer not null,   // derived server-side: rating >= user.favorite_min_rating
  hidden: integer not null,
  in_trashcan: integer not null,
  removed: integer not null,
  is_public: integer not null,
  aspect_ratio: real,              // for grid layout without fetching bytes
  latitude: real, longitude: real,
  search_location: text,           // short place string for tiles
  dominant_color: text,
  bucket_day: text not null,       // 'YYYY-MM-DD' precomputed at insert (local tz)
  bucket_month: text not null      // 'YYYY-MM'
}
-- indexes: (bucket_day), (timestamp), (image_hash), (last_modified),
--          partial indexes for hidden/in_trashcan/removed flags

remote_photo_detail {              // lazy cache of the full photo endpoint
  photo_id: text pk references remote_photo,
  payload: text not null,          // zod-validated JSON from api-client
  fetched_at: integer not null
}

person {
  id: integer pk, name: text, kind: text,        // person kind incl. cluster state
  face_count: integer, cover_photo_hash: text, last_modified: integer
}

user_album        { id, title, owner_id, shared: int, favorited: int,
                    cover_hash: text, photo_count: int, created_on, last_modified }
user_album_photo  { album_id, photo_id, ordering, pk(album_id, photo_id) }

auto_album        { id, title, timestamp, favorited, photo_count, cover_hash, last_modified }
auto_album_photo  { album_id, photo_id, pk(album_id, photo_id) }

-- Things / places / tags are lists of named groupings; membership is resolved
-- server-side. Mirror only the *lists* (cheap); the photos of one thing/place
-- are fetched via api-client on tap and rendered through the query layer,
-- NOT mirrored (P1: mirror membership too if offline album browsing demands it).
thing_album  { id, title, photo_count, cover_hashes: text /*json*/, last_modified }
place_album  { id, title, photo_count, geolocation_level: int, cover_hashes, last_modified }
tag_album    { id, title, photo_count, cover_hashes, last_modified }

shared_from_me  { photo_id, shared_to_user_id, pk(photo_id, shared_to_user_id) }
shared_user     { id pk, username, first_name, last_name, avatar_url }
```

Design notes:

- `is_favorite` is materialized at sync time (server sends the resolved
  boolean) so the favorites screen is a flag filter, immune to
  `favorite_min_rating` drift — a full re-seed is triggered if the user changes
  that setting.
- `bucket_day`/`bucket_month` are precomputed at row-write time to keep the
  timeline GROUP BY trivial and index-friendly (Immich computes buckets with
  STRFTIME per query; precomputing is cheaper and our rows are immutable
  between syncs).
- Faces are **not** mirrored in v1. The face-tagging workflow (frontend
  `/faces`) is online-only through api-client (doc 05). Only `person` rows are
  mirrored for the People album grid.

## 2. Local media tables (camera roll)

```ts
local_asset {
  id: text pk,                 // MediaLibrary asset id
  name: text, type: text,      // image | video
  created_at: integer, modified_at: integer,
  width: int, height: int, duration_ms: int,
  uri: text,                   // ph:// | content://
  hash: text,                  // md5(bytes)+userId — null until hashed
  hashed_at: integer
}
-- index on (hash), (modified_at)

local_album        { id: text pk, title: text, asset_count: int, modified_at: integer,
                     backup_selection: int }   // 0 none | 1 selected | 2 excluded
local_album_asset  { album_id, asset_id, pk(album_id, asset_id) }
```

## 3. App-state tables

```ts
sync_state {           // one row per synced entity type
  entity: text pk,     // 'photo' | 'person' | 'user_album' | ...
  cursor_modified: integer,  // keyset cursor half 1 (last_modified)
  cursor_id: text,           // keyset cursor half 2 (tie-break id)
  last_full_sync: integer, status: text
}

outbox {               // offline mutations, doc 03 §6
  id: integer pk autoincrement,
  created_at: integer, kind: text,   // 'favorite' | 'hide' | 'trash' | 'album_add' | ...
  payload: text,                     // zod-validated json
  state: text,                       // pending | inflight | failed
  attempts: integer, last_error: text
}

upload_queue {         // doc 03 §5
  asset_id: text pk references local_asset,
  state: text,         // pending | hashing | checking | uploading | done | failed | skipped_exists
  progress: real, attempts: int, last_error: text, enqueued_at: integer
}

thumb_cache {          // explicit offline thumbnail store, doc 01
  photo_id: text pk, file_path: text, size_bytes: int, last_used: integer
}
```

## 4. The merged timeline (the "track only local images" core)

Direct adaptation of Immich's `mergedAsset` view — remote photos UNION
camera-roll assets whose hash has no remote counterpart:

```sql
-- Main timeline page (keyset-paginated by (timestamp, id))
SELECT rp.id AS remote_id, la.id AS local_id, rp.timestamp, rp.type,
       rp.aspect_ratio, rp.is_favorite, rp.bucket_day
FROM remote_photo rp
LEFT JOIN local_asset la ON la.hash = rp.image_hash    -- "also on this device"
WHERE rp.hidden = 0 AND rp.in_trashcan = 0 AND rp.removed = 0
      AND rp.timestamp IS NOT NULL

UNION ALL

SELECT NULL, la.id, la.created_at, la.type, CAST(la.width AS REAL)/la.height, 0,
       strftime('%Y-%m-%d', la.created_at/1000, 'unixepoch', 'localtime')
FROM local_asset la
WHERE (la.hash IS NULL
       OR NOT EXISTS (SELECT 1 FROM remote_photo rp WHERE rp.image_hash = la.hash))
  AND EXISTS (SELECT 1 FROM local_album_asset laa
              JOIN local_album l ON l.id = laa.album_id
              WHERE laa.asset_id = la.id AND l.backup_selection = 1)
  AND NOT EXISTS (SELECT 1 FROM local_album_asset laa
              JOIN local_album l ON l.id = laa.album_id
              WHERE laa.asset_id = la.id AND l.backup_selection = 2)

ORDER BY 3 DESC LIMIT :page OFFSET :offset;
```

Semantics (matching Immich):

- A local asset appears in the merged timeline only if it belongs to a
  backup-**selected** album and no **excluded** album — i.e. "will be backed
  up but isn't on the server yet". Local-only assets render with an
  upload-pending badge.
- Once uploaded (or found via `/api/exists`), the server row arrives on next
  delta sync and the local row is absorbed by the join.
- Un-hashed assets (`hash IS NULL`) count as local-only until hashed —
  they may briefly duplicate a remote photo; acceptable and self-healing
  within one hash pass.
- A bucket query (`GROUP BY bucket_day`) drives the scrubber/section headers,
  same shape as Immich's `mergedBucket`.

## 5. Sizing & performance budget

- 100k photos ≈ 100k `remote_photo` rows × ~200 B ≈ **20 MB** — trivial for
  SQLite. Immich runs the same design at this scale.
- All hot queries must be covered by indexes; CI runs `EXPLAIN QUERY PLAN`
  assertions on the timeline, bucket, and favorites queries against a seeded
  100k-row fixture.
- Writes happen in transactions of ≤1k rows during sync to keep the UI thread
  responsive (expo-sqlite runs on a background thread; live queries re-fire
  per transaction commit, not per row).

## 6. Migrations

- drizzle-kit generates SQL migrations, committed to the repo; applied on app
  start before any query.
- Schema version tracked by drizzle's migration table. A failed/impossible
  migration falls back to **wipe-and-reseed** (the mirror is disposable by
  design; only `outbox`, `upload_queue`, and auth must survive, so they are
  migrated first and separately).

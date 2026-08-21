# 03 — Client Sync Engine

A pure-TypeScript module (`src/sync/`) with no UI dependencies. Everything is
unit-testable against an in-memory SQLite DB and a mocked api-client.

```
src/sync/
  orchestrator.ts        # entry points: syncAll(), syncEntity(), cancellation
  remote/
    seed.ts delta.ts     # server → mirror
    applier.ts           # batched upserts/deletes per entity
  device/
    mediaSync.ts         # camera roll → local_asset tables
    hasher.ts            # md5 pipeline
  upload/
    queue.ts worker.ts   # backup engine
  outbox/
    outbox.ts replay.ts  # offline mutations
  background/
    tasks.ts             # expo-background-task registration
```

## 1. Orchestration

`syncAll()` runs as a single-flight async sequence (mutex, cancellable — same
shape as Immich's `background_sync.dart`):

1. Replay outbox (push local mutations first so pulls don't clobber them)
2. Remote delta pull, per entity in dependency order:
   `users → photos → persons → user_albums → auto_albums → things/places/tags → sharing`
3. Device media sync (camera roll diff)
4. Hash pass (new/changed local assets)
5. Upload queue top-up (if backup enabled)
6. Thumb prefetch (fill `thumb_cache` for new remote photos)

Triggers: app foreground (throttled ≥1 min), pull-to-refresh (forced), after
any outbox write (steps 1–2 only), background task (§7), connectivity regained.

## 2. Remote seed (first login)

Seed = delta from cursor zero. No separate code path: the delta endpoint
(doc 04) with `updated_after=0` streams the whole table in keyset pages
(1 000 rows/page for photos). UI shows determinate progress
(`total` comes in the first page envelope).

- Order matters for perceived speed: photos first (timeline usable
  immediately), then the rest.
- Seed runs foreground-only with a "keep app open" hint; resumable at page
  granularity (cursor persisted after each applied page — an interrupted seed
  continues, never restarts).
- Budget: 100k photos / 1k per page = 100 requests ≈ 20 MB JSON. Minutes, not
  hours, on a LAN.

## 3. Remote delta

Per entity: request pages of `{ items, tombstones, next_cursor }` with the
stored cursor; apply in one transaction per page (upsert items, delete
tombstoned ids, advance `sync_state` cursor). Idempotent by construction —
re-applying a page is harmless, so a crash mid-entity is safe.

Full reseed triggers (mirror is disposable): schema migration failure,
`favorite_min_rating` change, server responds `410 cursor_expired`
(tombstone log pruned past our cursor, doc 04 §3), or user-initiated
"Repair sync" in settings.

## 4. Device media sync + hashing

Camera roll → `local_asset` / `local_album` tables via `expo-media-library`:

- **Fast path**: `getAssetsAsync({ createdAfter, sortBy: creationTime })` per
  album since the last sync watermark; upsert results.
- **Deletion/edit detection**: expo-media-library has no change tokens, so run
  a periodic **full id-diff** per album: fetch all asset ids + modification
  times (metadata only, paged), sorted-merge against DB (Immich full-diffs
  Android albums for the same reason — this is proven adequate). Run the full
  diff when album asset-count/updated-time mismatches the DB, mirroring
  Immich's `checkAddition` fast path → `fullDiff` fallback.
- `MediaLibrary.addListener` nudges a device sync while the app is open.
- Permissions: request full library access; degrade gracefully under iOS
  "limited" selection (sync what we're shown).

**Hashing** (`hasher.ts`): for every `local_asset` with `hash IS NULL` and for
hash-invalidation on `modified_at` change:

- `FileSystem.getInfoAsync(uri, { md5: true })` (copy `ph://` assets to cache
  via `MediaLibrary.getAssetInfoAsync().localUri` first when needed), then
  store `md5 + userId` to match `File.hash` server-side.
- Batches of ~50, backup-selected albums first, yielding between batches;
  cancellable. Videos: hash lazily (only when needed for upload/dedup check)
  since hashing GB-scale files eagerly wastes battery.
- If profiling shows native MD5 via getInfoAsync is too slow at scale, the
  escape hatch is a ~100-line Expo Module (Kotlin/Swift batch hasher, like
  Immich's `hashAssets` pigeon API) — config-plugin packaged, still no eject.

## 5. Upload / backup queue

- Enqueue rule: asset in backup-selected album, not excluded, hashed, hash not
  present in `remote_photo` → `upload_queue`.
- Worker (serial, wifi-aware, charging-aware — all user settings):
  1. `GET /api/exists/{hash}` — if exists, mark `skipped_exists` (server row
     will arrive via delta; join absorbs the local asset)
  2. Chunked upload via existing endpoints (`/api/upload/`,
     `/api/upload/complete/`) using `expo-file-system` upload tasks
     (background session on iOS); resumable at chunk level.
     The completion payload includes **device metadata**: filesystem
     created/modified timestamps and (when available) media-library creation
     date, so the server can date EXIF-less photos correctly instead of
     falling back to upload time (issue librephotos#614; server side in
     doc 04 §5)
  3. On complete: mark `done`; trigger a photos delta pull so the merged
     timeline flips the badge from "pending" to "synced"
- Retry with exponential backoff, capped attempts, per-item error surface in
  the Backup screen. Queue survives restarts (it's a table).

## 6. Offline mutations — outbox

Parity requires mutating while offline (favorite, hide, trash/restore, rating,
album add/remove, person rename, photo caption). Pattern:

1. Apply the change **optimistically to the mirror** (e.g. flip
   `remote_photo.is_favorite`) inside a transaction that also inserts an
   `outbox` row.
2. Live queries update the UI instantly.
3. `replay.ts` drains the outbox FIFO when online, calling the normal
   api-client mutation for each row. Success → delete row. 4xx → drop row,
   surface toast, next delta restores server truth. Network error → keep, back
   off.
4. Delta pulls never run while outbox rows are `pending` for that entity
   (replay-first ordering in §1) — last-write-wins with server authority,
   no merge logic.

Out of scope for outbox (online-only, greyed out offline): album sharing,
user management, face tagging, search — see doc 05 flags.

## 7. Background execution

Honest constraints: both OSes throttle; ~15-min minimum intervals, no
guarantees. Foreground-first design; background is a top-up.

- `expo-background-task` registers one task: runs §1 steps 1–2 and 4–5 within
  the OS time budget (chunked so any prefix is useful).
- iOS uploads use background `URLSession` via expo-file-system upload tasks —
  transfers continue after suspend; completion handled on next launch.
- Android: if the 15-min WorkManager cadence proves insufficient for backup
  UX, a foreground-service upload module (or `expo-foreground-actions`-style
  config plugin) is the P2 escape hatch. Not in v1.
- Nice-to-have (P2): silent push from server on library changes to trigger
  sync — requires push infra, conflicts with F-Droid flavor; deferred.

## 8. Observability

- Structured ring-buffer logger (op, entity, counts, durations, cursor
  values) persisted to a `sync_log` table; surfaced in Settings → Sync status
  (mirrors Immich's sync-status page) with "export logs" for bug reports.
- Every sync run ends with an integrity snapshot: row counts per table vs
  server counts endpoint (doc 04 §5) — drift beyond tolerance schedules a
  reseed and logs loudly.

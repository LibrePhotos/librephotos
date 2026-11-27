# Viewer contract: Rust core <-> UI

The prototype of the local Photos-style viewer (see `plans/desktop/README.md`, section 4.2).
Rust lives in `src-tauri/`, the UI in `src/`. This file is the only thing both sides rely on;
`src/ipc.ts` mirrors it in TypeScript. Change both together.

## Commands (`invoke`)

All paths are absolute OS paths (`C:\Users\...` on Windows). Errors reject with a string.

| Command | Args | Returns |
|---|---|---|
| `initial_path` | none | `string \| null`: on macOS the last file Finder opened with the app (an Apple Event) before the UI asked, otherwise the file or folder given on the command line (first non-flag argument), or null. Without one the UI starts in the library. The UI listens for `viewer://open` before it asks, so a file opened in between is never lost. |
| `list_folder` | `{ path }` (a file or a folder) | `FolderListing` |
| `image_info` | `{ path }` | `ImageInfo` |
| `write_metadata` | `{ path, edits: MetadataEdits, target: "sidecar" \| "file" }` | `WriteOutcome`; saves rating, caption, keywords and date taken (see "Edits") |
| `open_external` | `{ url }` | `null`; opens an `https://` link in the default browser (anything else rejects) |
| `trash_file` | `{ path }` | `null`; moves the file to the Recycle Bin / Trash |
| `rotate_file` | `{ path, clockwise }` | `number`: the file's new modified time (ms). Rotates the file on disk losslessly where possible (EXIF orientation for JPEG/HEIC/TIFF, otherwise decode, rotate, re-encode). The UI busts its cache with the new mtime. |
| `reveal_in_folder` | `{ path }` | `null`; opens Explorer/Finder/file manager with the file selected |
| `copy_image` | `{ path }` | `null`; puts the decoded image (orientation applied) on the clipboard |
| `prewarm_thumbs` | `{ paths }` | `number` queued. Replaces the pre-warm list: Rust makes the `thumb` of each file (in the given order, nearest first) into the disk cache when no other request is waiting, skipping files already cached. `[]` cancels. |
| `remember_folder` | `{ path }` | `boolean`: in the macOS App Store build (sandboxed) keeps a security-scoped bookmark of a folder the user picked, so the app can read it again after a restart; `false` and nothing stored elsewhere |
| `clear_cache` | none | `number`: bytes deleted from the disk cache (also cancels pre-warming) |
| `open_default_apps_settings` | none | `null`; opens Settings > Apps > Default apps at this app's page (`ms-settings:defaultapps?registeredAppUser=LibrePhotos%20Viewer`, or `registeredAppMachine=`, or plain `ms-settings:defaultapps` when the app is not registered). Windows only; rejects with "not supported yet" elsewhere. |
| `tile_info` | `{ path }` | `TileInfo \| null`: the deep-zoom pyramid of a big picture, or null when it is not tiled (see "Tiles"). Cheap (header only) except for RAW, where it develops the file once. Makes the picture the one whose pyramid is filled in the background. |
| `tile_release` | `{ path }` | `null`; the UI no longer shows tiles of `path` (it moved on to another picture): stop the background fill. |

```ts
type FileKind = "image" | "raw" | "video";
type FileEntry = { path: string; name: string; size: number; modifiedMs: number; kind: FileKind };
type FolderListing = { folder: string; files: FileEntry[]; index: number; limited: boolean }; // index of `path` when it is a file, else 0; limited: the sandbox let the app read only this file, so `files` holds just it
type TileInfo = { width: number; height: number; tileSize: number; levels: number }; // displayed full size
type ImageInfo = {
  path: string; name: string; size: number; modifiedMs: number;
  format: string;                 // "JPEG", "HEIC", "Canon CR3", ...
  width: number | null; height: number | null;   // after orientation
  takenAt: string | null;         // ISO 8601 local time from EXIF DateTimeOriginal
  cameraMake: string | null; cameraModel: string | null; lens: string | null;
  exposure: string | null;        // "1/250 s"
  fNumber: string | null;         // "f/2.8"
  iso: number | null;
  focalLength: string | null;     // "35 mm"
  gps: { lat: number; lon: number } | null;
  extra: [string, string][];      // any other interesting tags, label + value
  rating: number | null;          // 0-5: sidecar xmp:Rating > embedded XMP > EXIF Rating
  caption: string | null;         // sidecar dc:description > embedded XMP > EXIF ImageDescription (camera placeholders dropped)
  keywords: string[];             // dc:subject + leaves of lr:hierarchicalSubject, each from the sidecar when it has them
  sidecar: string | null;         // the XMP sidecar read (and written to), if any
  writableInFile: boolean;        // write_metadata can target "file" (JPEG)
};
type MetadataEdits = { rating?: number; caption?: string; keywords?: string[]; takenAt?: string };  // "" clears a text
type WriteOutcome = { modifiedMs: number; sidecar: string | null; wroteFile: boolean };
```

`takenAt` follows the server's date rules: XMP `photoshop:DateCreated` (sidecar, else embedded) wins,
then the sidecar's `exif:DateTimeOriginal`, then EXIF `DateTimeOriginal` / `DateTime` (RAW: its own
capture time). A sidecar's `exif:GPSLatitude`/`GPSLongitude` win over the EXIF position.

Supported extensions (case-insensitive), used by `list_folder` filtering and file associations:
`jpg jpeg jpe jfif png gif webp bmp tif tiff heic heif hif avif jxl` (image),
`dng cr2 cr3 nef nrw arw srf sr2 orf rw2 raf pef srw raw rwl 3fr erf kdc mrw x3f` (raw),
`mp4 mov m4v webm mkv avi` (video: listed so the filmstrip shows them; the UI plays them with `<video>` via `full`).

Sort order: natural, case-insensitive by file name (`IMG_2.jpg` before `IMG_10.jpg`), like Explorer.

## Events (Rust -> UI)

| Event | Payload | When |
|---|---|---|
| `viewer://open` | `{ path: string }` | A file to show now: on Windows and Linux a second launch (double-click in Explorer while running) forwarded it; on macOS Finder or `open` sent it as an Apple Event to the running app. The UI switches to it and focuses. |

Drag and drop of files onto the window is handled in the UI with `getCurrentWebview().onDragDropEvent`.

## The `lpview` URI scheme (pixels)

URL shape (built by `src/ipc.ts` `imageUrl()`):

- Windows (WebView2): `http://lpview.localhost/<kind>?path=<encodeURIComponent(path)>&w=<px>&h=<px>&v=<modifiedMs>[&p=low]`
- macOS/Linux: `lpview://localhost/<kind>?path=...&w=...&h=...&v=...[&p=low]`

`p` is a scheduling hint, not part of the picture's identity: no `p` (the stage, its neighbours) is
served before `p=low` (the filmstrip), which is served before pre-warming. The filmstrip also hands
out its loads a few at a time, visible items centre-out first (`src/lib/thumbQueue.ts`), since the
webview sends all `<img>` requests at once and in DOM order.

| kind | Meaning |
|---|---|
| `thumb` | Fast small image, long edge <= 320 px. Prefer the embedded EXIF/RAW thumbnail; may be lower quality. Must answer in a few ms when an embedded thumbnail exists. |
| `screen` | Fits inside `w` x `h` device pixels (never upscaled), orientation applied. |
| `tile` | One tile of the deep-zoom pyramid (see "Tiles"); takes `level`, `x`, `y` instead of `w`/`h`. |
| `full` | Original resolution, orientation applied. For RAW: a full develop with [FlashRaw](https://github.com/ybouane/flashraw) (`thumb`/`screen` use its embedded preview when it is big enough, else a half-size develop). For video: the file itself (supports `Range`). |

Response: image bytes with the right `Content-Type`. Pass-through (the file's own bytes) is allowed
when the webview can decode the format itself and no resize is needed (JPEG, PNG, GIF, WebP, BMP):
the webview applies EXIF orientation by itself (`image-orientation: from-image`). Anything decoded in
Rust is re-encoded (JPEG q90 for photos, PNG when the source has alpha) with orientation applied.

Headers: `Cache-Control: max-age=31536000, immutable` (the URL carries `v=mtime`),
`Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers: x-lp-width, x-lp-height`,
`x-lp-width` / `x-lp-height` (size of the returned image).

Errors: 404 file missing, 415 unsupported format, 500 decode failure with a plain-text body.

Rust keeps an LRU cache of encoded `screen`/`thumb` responses keyed by (path, mtime, kind, w, h) and
decodes off the main thread. The UI prefetches the neighbours (+/-2) through the same URLs.

## Disk cache

Encoded `thumb` and `screen` responses that took at least 12 ms to make (so not pass-through files
or embedded EXIF thumbnails) are also written to `%LOCALAPPDATA%\com.librephotos.viewer\cache\v1\`
(macOS `~/Library/Caches/com.librephotos.viewer`, elsewhere `$XDG_CACHE_HOME/com.librephotos.viewer`), one
file per response, keyed by kind, box, path, mtime and size. The size cap is 1 GB, least recently
used first. Writes happen on a background thread (temp file + rename), lookups on two I/O threads,
so a hit never waits behind a decode; two app instances can share the directory.
`LPVIEW_CACHE_DIR` moves it, `LPVIEW_DISK_CACHE=0` turns it off, `LPVIEW_TRACE=1` logs every
request (queued, memory/disk hit, decode start/end) to stderr.

At start-up Rust begins the `thumb` of the file given on the command line before the page exists,
and its `screen` for the predicted stage box (window size minus the top bar and the filmstrip) as
soon as the window exists, so the page's first requests join work already under way. It also
lists that folder while the webview boots; the page's first `list_folder` for that path gets it.

## Tiles (deep zoom)

Pictures with more than 24 MP (displayed size, any format: JPEG, HEIC, TIFF, PNG, RAW develop, ...)
are not zoomed through `full`; the UI asks `tile_info` once it zooms past the `screen` image, and
when that answers a `TileInfo` it draws tiles instead (null: small, has alpha, GIF or video; use `full`).

- Level 0 is the full resolution (orientation applied); level `L` is `ceil(width / 2^L)` x
  `ceil(height / 2^L)`, up to `levels - 1`, which fits in one tile. Tiles are `tileSize` (512) square
  in displayed pixels, edge tiles smaller; tile (`x`, `y`) of level `L` covers displayed pixels
  `[x*512, x*512+512) x [y*512, y*512+512)` of that level, plus a 1 px overlap with each neighbour
  (Deep Zoom style): the returned image starts 1 px earlier when `x > 0` (`y > 0`) and ends 1 px
  later unless it is the last column (row). Renderers draw the inner part; the border keeps
  interpolation across tile edges seamless.
- URL: `<base>/tile?path=<path>&v=<modifiedMs>&level=<L>&x=<X>&y=<Y>`, a JPEG (q90, 4:4:4) with the usual
  headers (`x-lp-width`/`x-lp-height` give its size, `Cache-Control: immutable`).
  400 for a malformed URL, 404 for a level or tile outside the pyramid, 415 when the file is not tiled.
- Rust produces tiles a band (one row of tiles, a column when the orientation swaps the axes) at a
  time, decoding full-width runs of stored rows that WIC streams forward (JPEG coarse levels at
  1/2-1/8 DCT scale, the rest box-reduced), so it never holds a full-size buffer (RAW: the develop).
  Bands someone waits for go first; then, while the picture is the one being viewed (from
  `tile_info` or a tile request until `tile_release`), the rest of each requested level is filled
  in the background. Tile work runs on its own threads, never on the `thumb`/`screen` workers;
  background fill at below-normal priority.
- Caches: a 96 MB memory LRU of encoded tiles, and a disk cache in
  `%LOCALAPPDATA%\com.librephotos.viewer\tiles\<id>\<L>-<x>-<y>.jpg` (`<id>` hashes the canonical path,
  mtime and size;
  `<L>.done` marks a complete level) capped at 2 GB, whole image folders evicted least recently
  viewed first. `LPVIEW_TILE_CACHE=<dir>` moves it, `=off` disables it; `LPVIEW_TILES=off` turns tiling
  off; `LPVIEW_TILE_TRACE=1` logs the cost of every band.
- The UI draws visible tiles of the level with at least one tile pixel per device pixel on one
  canvas over the stage (plus level+1 first as a fallback), corners snapped to device pixels, at most
  6 requests in flight and ~128 decoded tiles kept.

## Edits

A picture's own metadata (favourite = rating at or above `favorite_min_rating`, rating, caption,
keywords, date taken) travels with the file, using the tags the LibrePhotos server reads and writes
(`apps/backend/api/metadata/`). Rust: `src-tauri/src/xmp/` (a small XML scanner that splices the
changed properties into the original text, so everything else in a packet stays byte for byte);
UI: `src/edits/`.

| Field | XMP |
|---|---|
| rating | `xmp:Rating` (0 is written, so it overrides an embedded rating) |
| caption | `dc:description` `x-default` (other languages kept; empty removes it) |
| keywords | `dc:subject` bag (the whole list); `lr:hierarchicalSubject` entries whose leaf was removed go too |
| date taken | `photoshop:DateCreated` (`YYYY-MM-DDTHH:MM:SS`, local time) |

- `target: "sidecar"`: the first existing of `IMG.xmp`, `IMG.XMP`, `IMG.jpg.xmp`, `IMG.jpg.XMP`
  (the server's order), else a new `IMG.jpg.xmp`. A sidecar that does not parse, or has no
  `rdf:RDF`, is refused, never overwritten. Written to a temp file and renamed.
- `target: "file"`: JPEG only (others reject with a message naming the format): the APP1 XMP
  segment is updated or inserted after APP0/EXIF, the rest of the file copied unchanged (at most
  64 KB of XMP). An existing sidecar is updated as well, since readers prefer it.
- The UI's setting (`app_meta` `desktop_metadata_target`: `sidecar` default, `file`, `app`) picks
  the target; `app` writes the local database only (`local_asset.app_only_fields`). Every edit also
  goes to `local_asset` (`setLocalAssetEdits`; a loose file gets a row first) so search and the
  library follow it, and the info cache is dropped (`forgetInfo`).
- Server: when signed in, each edited field is queued in `outbox` (kind `desktop_photo_edit`,
  payload `{ md5, userId, field, value }`, keyed by md5 + field so the newest edit replaces a
  waiting one). The replay (`src/edits/serverSync.ts`; at start, after a sign-in, every 30 s and
  after each edit) asks `uploadExists` first (not on the server: done), then `setPhotoRating`,
  `savePhotoCaption`, `setPhotoTimestamp`, or `fetchPhotoTags` + `createTag` / `addPhotosToTag` /
  `removePhotosFromTag`. Network errors, 5xx, 408, 429 and 401 back off (15 s x 2^attempts, 8
  attempts); other 4xx and contract errors are kept as `rejected` (Settings: "Try again").
- Server-only sections (people, albums, Add to album) use `fetchPhotoDetails`, `fetchPhotoAlbums`,
  `fetchUserAlbumsList`, `addPhotosToUserAlbum`, `createUserAlbum`; `favorite_min_rating` comes
  from `fetchUserSelfDetails` at sign-in (`app_meta`, then `refreshFavorites`).
- The metadata pass (`fs_read_metadata`) returns the same merged `rating`, `caption`, `keywords`;
  at the first start with this reader every read file is read again once (`requestMetadataReread`).

## Library

Folders the user added ("roots"), kept in the shared local database (below) and up to date through
file-system watchers. Files are referenced where they are (nothing is copied or moved). The schema,
queries and writers are `packages/local-db` (`src/queries/library.ts`, `local-search.ts`; its
README, "The desktop folder library"); the UI drives them from Rust's file seams (below) in
`src/library/indexer.ts`, and reads through them in `src/library/api.ts` and `hooks.ts`. Rust has
no library SQL.

| Table | Holds |
|---|---|
| `local_album` (`source = 'folder'`) | a root: `path`, `added_at`, `backup_selection` (1: backed up) |
| `local_asset` | a file: `uri` = absolute path (also its id), `folder` words, size, mtime, metadata, `meta_state`, `hash` (MD5 + user id), `bucket_day` |
| `local_album_asset` | which root a file is in (a "loose" file, opened from elsewhere, has none) |
| `upload_queue` | backup state, the resumable upload's id and offset |
| `local_asset_fts` | the search index (FTS5, kept by triggers) |

```ts
type Root = { id: string; path: string; fileCount: number };
type RemoteState = "unknown" | "checking" | "present" | "absent" | "uploading" | "failed";
type LibraryFile = FileEntry & {
  id: string;           // the local_asset id (the path)
  width: number | null; height: number | null;  // oriented, from the header (no decode)
  takenMs: number;      // date taken (EXIF/RAW), else modified, as LOCAL wall-clock ms: read with UTC getters
  dated: boolean;       // takenMs comes from the picture's metadata
  inLibrary: boolean;   // in a root (not a loose file)
  remote: RemoteState;  // on the server (mirror or upload_queue done/skipped) > uploading/checking/failed > queued ("absent") > unknown
  md5: string | null;   // hex, once hashed (only while signed in)
};
```

- Adding a root: `addFolderRoot` (a folder inside a root is already in the library: that root is
  used; roots inside the new folder are merged into it with `mergeFolderRoot`), `fs_watch`, then a
  walk: `fs_walk` batches go to `upsertWalkedFiles` as they arrive, so the grid fills while the
  walk runs. Removing one: `fs_unwatch`, `removeFolderRoot` (files with a live upload stay as loose
  files).
- At start every root is watched and walked again; each batch is diffed against `knownFolderFiles`
  by size and mtime, so only new and changed files are written and vanished ones removed
  (`removeLocalPaths`). A root that cannot be read (unplugged drive) keeps its rows.
- `fs://changed`: `removed` -> `removeLocalPaths` (a path and everything below it), `renamed` ->
  `renameLocalPaths` (the row, its MD5 and upload state survive; a folder moves its files),
  `created`/`modified` -> `upsertWalkedFiles` (a changed file loses its hash and metadata).
- Metadata pass: `pendingMetadata` (256, newest mtime first) -> `fs_read_metadata` (4 Rust
  threads) -> `applyFileMetadata` (unreadable files are `failed` until they change).
- Hash pass (only while signed in: a server hash is MD5 + user id): `pendingHashes` (32) ->
  `fs_md5`, 4 at a time -> `setFileHashes`; unreadable files are skipped until they change
  (`markHashUnreadable`); then `enqueueBackups`. The account the hashes belong to is kept in
  `app_meta` (`folder_account` = `url|userId`); signing in to another one runs
  `switchFolderAccount` (hashes rebuilt for the new user id, upload queue starts over).
- Views: the timeline is `localTimelinePage` (keyset pages of 5,000, newest first) and
  `localTimelineDays`; search is `searchLocalAssets` (every word prefix-matches the file's name and
  extension, kind, folder words, date words, format, camera and lens; see the package's
  "Local search"); the viewer's badge is `localAssetByUri`. They are live queries
  (`src/db/live.ts`): cached per key, re-read when the change hub flushes a write to their tables,
  held while the grid scrolls.
- Pre-warming: the UI hands the visible list to `prewarm_thumbs` when idle, so library thumbs come
  from the disk cache.

## Local database

The on-device SQLite database that mobile and desktop share (`packages/local-db`): its schema,
migrations, queries and writers are TypeScript on Drizzle's `sqlite-proxy`; Rust only executes SQL,
applies the migrations and reports changes. UI: `src/db/` (`executor.ts`, `database.ts`: the
package's `createDatabase(executor)` and its change hub fed by `db://changed`, `live.ts`); Rust:
`src-tauri/src/localdb/`. The UI imports the package like the api-client (Vite alias and tsconfig
`paths` to `../../packages/local-db/src/index.ts`, `drizzle-orm` and `zod` deduped to this app's
install).

| Command | Args | Returns |
|---|---|---|
| `db_exec` | `{ sql, params, method: "run" \| "all" \| "values" \| "get" }` | `{ rows, columns?, changes?, lastInsertRowId?, tagged? }`: one statement, autocommit |
| `db_batch` | `{ statements: { sql, params, method }[] }` | the same per statement: one `BEGIN IMMEDIATE` transaction, all or nothing; rejects with `statement <i>: <error>` and writes nothing |
| `db_info` | none | `{ path, applied: string[], wiped, migrationError }` |

- Answers are JSON that Rust writes while SQLite steps, sent as raw bytes (an `ArrayBuffer` that
  the executor parses), so no row is copied out of SQLite first. `LPVIEW_DB_TRACE=1` logs each
  call's time and answer size.
- Rows (sqlite-proxy's shapes): `all` and `values` an array of row arrays (columns in SELECT order),
  `get` one row array or `null` (the executor makes it `undefined`), `run` `[]`. A `get` still
  steps the statement to the end, so `INSERT ... RETURNING` writes every row. `all` and `get`
  carry `columns` (the statement's column names in order: the package reads raw SQL rows by
  name), `run` carries `changes` and `lastInsertRowId`.
- Values: `null`, strings, finite reals and integers within +/-(2^53 - 1) are plain JSON. Anything
  else is a one-key object, and `tagged: true` says the result holds one: `{ "$bigint": "<decimal>" }`
  (integers beyond 2^53), `{ "$blob": "<base64>" }`, `{ "$real": "Infinity" | "-Infinity" }`. The
  executor turns them into `bigint`, `Uint8Array` and numbers. Parameters take the same tags, plus
  `true`/`false` (bound as 1/0); the executor encodes `bigint`, `Uint8Array` and the infinities.
- Transactions: one connection behind a mutex (WAL, `synchronous=NORMAL`, foreign keys off like
  mobile), and no transaction outlives a call. A `db_exec` that leaves one open (`BEGIN`) is rolled
  back and rejected; a batch statement that begins or ends a transaction is rejected (savepoints are
  fine). So the package writes several statements with `db.batch([...])`, never
  `db.transaction(...)`, whose `begin`/`commit` would be separate calls.
- Storage: `<data dir>/local.db` (WAL). `<data dir>` is `%LOCALAPPDATA%\com.librephotos.viewer` (macOS
  `~/Library/Application Support/com.librephotos.viewer`, else `$XDG_DATA_HOME/com.librephotos.viewer`);
  `LPVIEW_DATA_DIR` moves it, and with it the thumbnail cache (`cache/`), the tile cache (`tiles/`)
  and the server media cache, so test runs never touch the user's state. The old Rust library's
  `library.db` is no longer read (its folders are added again). Migrations: `packages/local-db/migrations/migrations.json`
  (`[{ tag, statements: string[] }]`, ordered) is compiled in (`include_str!`) and applied at
  start-up before the window exists, the package's algorithm: each missing migration in its own
  transaction with its row in `__local_db_migrations(tag TEXT PRIMARY KEY, applied_at INTEGER NOT
  NULL)`; if one fails, wipe and rebuild (the rows of `outbox` and `upload_queue` are kept, every
  view and table is dropped, every migration applied from scratch). `db_info()` reports `wiped` and
  the `migrationError`.

| Event | Payload | When |
|---|---|---|
| `db://changed` | `{ tables: string[] }` | Tables written by committed calls (`sqlite3_update_hook`), sorted, coalesced: the first change opens a 40 ms window and every table touched in it goes out in one event. A rolled-back batch or a read sends nothing. `DELETE` without `WHERE` is seen (the truncate optimisation is turned off); tables `WITHOUT ROWID` and `DROP TABLE` are not (the update hook does not see them). Writes to a virtual table's shadow tables (the FTS index, written by triggers) are left out. The package's change hub (`createChangeHub`) coalesces further for the views (90 ms quiet, 450 ms at most). |

## File seams

What the desktop knows about files, handed to the package's writers as data (like mobile's native
modules hand over the camera roll). None of these write a database. UI: `src/db/seams.ts`; Rust:
`src-tauri/src/platform/`.

| Command | Args | Returns |
|---|---|---|
| `fs_walk` | `{ root, onBatch: Channel<WalkBatch> }` | `number` of files. Streams `{ files: FsEntry[], done }` batches of up to 500 as they are found (hidden folders, `$RECYCLE.BIN`, `@eaDir` skipped); the last batch has `done: true`. Rejects when `root` cannot be read. |
| `fs_watch` | `{ root }` | `string`: the normalised root that `fs://changed` names. Starts a recursive watcher (replacing one for the same root). |
| `fs_unwatch` | `{ root }` | `boolean`: whether a watcher was stopped |
| `fs_read_metadata` | `{ paths }` (at most 4096) | `(FileMeta \| null)[]` in the order given: headers only, 4 threads; null when unreadable |
| `fs_stat` | `{ paths }` (at most 4096) | `(FsEntry \| null)[]`: null for missing files, folders and unsupported kinds |
| `fs_md5` | `{ path }` | `string`: MD5, lower-case hex (streamed) |

```ts
type FsEntry = { path: string; folder: string; name: string; size: number; mtimeMs: number; kind: FileKind };
type FileMeta = {
  path: string; format: string; width: number | null; height: number | null;  // oriented
  takenAt: string | null;        // ISO 8601 local time, as in ImageInfo
  takenMs: number | null;        // takenAt as local wall-clock ms (read with UTC getters)
  cameraMake: string | null; cameraModel: string | null;
  camera: string | null;         // "Canon EOS R5": make + model without the make twice
  lens: string | null; lat: number | null; lon: number | null;
  rating: number | null; caption: string | null; keywords: string[];  // as in ImageInfo (sidecar merged)
};
type FsChanges = { root: string; created: FsEntry[]; modified: FsEntry[]; removed: string[];
                   renamed: { from: string; to: string; dir: boolean }[] };
```

| Event | Payload | When |
|---|---|---|
| `fs://changed` | `FsChanges` | A watched root's events, debounced per root (350 ms quiet, 2 s at most) and checked against the disk: `created`/`modified` are supported files that exist now (a folder that appears is walked, its files `created`); `removed` are paths that are gone, files or folders (delete the path and everything below it); `renamed` are the OS's renames inside the root (a folder rename is one pair; the files below it move along), so the writer keeps the row (MD5, server state). Renames out of the root are removals, into it creations. Hidden folders are ignored. |

Uploads keep `http_fetch`'s `nativeFilePart`: its `ref` is `{ path, offset, len }` (a supported
picture or video, at most 64 MB).

## Server

A LibrePhotos server connection. **Every request goes through `packages/api-client`**: the UI calls
its endpoint functions (`endpoints.login`, `uploadExists`, `uploadChunk`, ...), which parse each
answer with the shared zod schemas that the web and mobile apps use, so the desktop tests the same
contracts. Rust only carries the bytes (`http_fetch`, the api-client's native transport) and keeps the
refresh token in the OS keychain; the backup queue is the local database's `upload_queue`.
UI: `src/server/` (session, transport, backup engine, errors) and `src/library/{api,serverApi,hooks}.ts`.
Rust: `src-tauri/src/server/`.

The UI imports the package's React-free entry `@librephotos/api-client/core` (Vite alias and
tsconfig `paths` to `../../packages/api-client/src/core.ts`, like the web app; its own `zod` 4, checked
by `scripts/check-shared-deps.mjs`).

| Endpoint (api-client) | Used for |
|---|---|
| `login` (`POST /api/auth/token/obtain/`) | sign-in |
| `refreshAccessToken` (`POST /api/auth/token/refresh/`) | a minute before the access token expires, and at start; the transport also refreshes before/after a request on its own |
| `logout` (`POST /api/auth/token/blacklist/`) | sign-out (best effort) |
| `uploadExists` (`GET /api/exists/<md5><user id>`) | checker, dedupe before an upload, the info panel |
| `uploadChunk` (`POST /api/upload/`) | 8 MB chunks, multipart (`file`, `offset`, `md5`, `upload_id` after the first; `Content-Range`) |
| `completeUpload` (`POST /api/upload/complete/`) | `upload_id`, `md5`, `filename`, `device_modified_at` (ISO 8601 with offset) -> `photo_id`, `job_id` |
| `sealUploadImports` (`POST /api/upload/seal/`) | when the upload queue runs dry |
| `searchPhotos` (`GET /api/photos/searchlist/`) | server search merged into local search; the shape (flat or date groups) follows the user's `semantic_search_topk`, read once per sign-in with `fetchUserSelfDetails` |
| `fetchPhotoDetails` (`GET /api/photos/<id>/`) | info panel: caption, people, tags, place, rating |
| media helpers `squareThumbnailUrl`, `bigThumbnailUrl` | the URLs the media proxy fetches (below) |

Contract errors: a `ResponseParseError` (an answer that breaks its schema) is logged as
`[api-client] the answer of "<endpoint>" breaks its schema: <issues>` and shown as a toast, at most
once per endpoint every 30 s (`src/server/errors.ts`, `onContractError`). It is never read as an
empty answer.

| Command | Args | Returns |
|---|---|---|
| `server_status` | none | `ServerState` |
| `server_session` | none | `{ url, username, userId, refresh }`: the saved sign-in the UI's token supplier starts from (`refresh` from the keychain, null when signed out) |
| `server_prepare_sign_in` | `{ url }` | `string`: the normalised address (`https://` assumed, `http://` for localhost and private addresses, a trailing `/api` dropped; rejects for a bad one). `http_fetch` may reach it from now on. |
| `server_signed_in` | `{ signIn: { url, username, userId, refresh, access } }` | `ServerState`; after `endpoints.login` succeeded: the refresh token goes to the keychain (service `LibrePhotos Viewer`, `LPVIEW_KEYRING_SERVICE` for tests; account `<url>\|<username>`), url/username/userId to `<data dir>/settings.json`. (The library follows the account itself: see "Library", hash pass.) Rejects for a URL that was not prepared. |
| `server_set_access` | `{ token }` | `null`; the access token the client holds now (for the media proxy only) |
| `server_signed_out` | `{ reason }` | `null`; forgets the tokens (keychain too); url and username stay. `reason` (an expired session) shows as `error` until the next sign-in. |
| `server_set_backup` | `{ on }` | `null`; the switch is saved here; the UI sets every root's `backup_selection` to it (new roots follow it) and, when off, drops the queued uploads of library files (`cancelFolderBackups`) |
| `server_set_paused` | `{ paused }` | `null`; pause uploads (checks go on) |
| `http_fetch` | raw bytes (below) | raw bytes (below); rejects with a string when there is no answer |
| `http_fetch_abort` | `{ id }` | `null`; cancels that request |

`http_fetch` (the api-client's `createNativeFetch`, `src/server/transport.ts`, `src-tauri/src/server/http.rs`):
one binary IPC message each way, `u32 LE n | n bytes of JSON head | body`. Request head
`{ id, url, method, headers: [name, value][] }`, with the body as the webview encoded it (JSON, or
multipart with its boundary in `content-type`); response head `{ status, statusText, headers }`.
Any HTTP status is an answer. Only URLs under the connected server, or the one being signed in to,
are sent; anything else rejects. The head may carry `fileParts: { marker, ref: { path, offset, len } }[]`
(the api-client's `nativeFilePart`): Rust replaces each marker in the body with `len` bytes (at most
64 MB) of the file at `path` (a supported picture or video) from `offset` before sending.

```ts
type ServerState = {
  connected: boolean; url: string | null; username: string | null; userId: number | null;
  backup: boolean; paused: boolean;
  error: string | null;   // why the last sign-in ended ("Your sign-in expired. Sign in again.")
};
// What the library's `useServerStatus` shows: ServerState, the library's backup counts
// (`localBackupCounts(db, "folder")`), and the backup engine's progress.
type ServerStatus = ServerState & {
  counts: { total: number; unknown: number; present: number; absent: number; uploading: number;
            failed: number; wanted: number; pendingBytes: number };  // library files by state
  uploads: { name: string; sent: number; total: number }[];  // in flight
  rate: number;           // bytes/s over the last ~8 s
  uploadedFiles: number; uploadedBytes: number;  // since the app started
};
type RemoteOf = { state: RemoteState; photoId: string | null; md5: string | null;
                  imageHash: string | null; inLibrary: boolean };
```

- Tokens: the UI's `TokenSupplier` (`src/server/session.ts`) holds both tokens in memory only
  (never web storage), loaded from `server_session` at start. Each new access token goes to Rust
  (`server_set_access`) and is refreshed a minute before it expires, so server thumbnails keep
  loading while no API request is due. A refused refresh signs out (`server_signed_out` with the
  "expired" reason).
- Identity: a server photo's `image_hash` is the file's MD5 (hex) followed by the user id, so a
  local MD5 maps to the server without a lookup and back (`localAssetsByHash`).

| Event | Payload | When |
|---|---|---|
| `server://status` | `null` | The connection, the backup switch or the pause changed: call `server_status` (the backup engine also looks for work). |

### Backup

The engine is TypeScript (`src/server/backup.ts`) and starts with the app; its queue is the local
database's `upload_queue`, written through `packages/local-db` (`queries/upload-queue.ts`), so
nothing is lost on a restart or a reloaded UI. Rust only hashes (`fs_md5`) and reads chunks.

- Queue: the hash pass queues hashed files of backed-up roots that are not on the server yet
  (`enqueueBackups`); "Upload to LibrePhotos" on one file is `requestUpload` (a loose file gets a
  row first: `upsertLooseFile`).
- Checker: `claimExistenceChecks` (32 at a time, atomic), `uploadExists` 4 at a time ->
  `markSkipped` (on the server) or `markAbsent` (an uploader takes it; it is not checked again).
- Uploaders (2 at a time; never while paused): `claimNextUpload` (atomic; a file whose hash is
  being uploaded by a copy waits), re-stat (`fs_stat`; a changed file is hashed again and starts
  over), re-check `uploadExists` (dedupe -> `markSkipped`), then `uploadChunk` per 8 MB chunk,
  whose file part is a `nativeFilePart({ path, offset, len })` that `http_fetch` fills from the file
  (no chunk crosses IPC), with `setUploadProgress` after every chunk (an upload resumes after a
  restart; a 400 naming another offset continues there, an expired upload, 404/410, starts over),
  then `completeUpload` -> `markDone` (with the photo id). When the queue is empty the collected
  `job_id`s are sealed with `sealUploadImports`. Failures: `markFailed` (the package's backoff,
  30 s x 2^attempts, at most 5 attempts; "Retry" is `retryFailed`); network errors, 5xx, 429 and
  401 do not count (the row goes back to pending).
- `resetInFlightUploads` (at engine start): checks in flight are asked again, uploads resume.
- The info panel asks about one file directly (`uploadExists`); a "yes" is kept with
  `recordServerHas`.
- Runs only while the window is open (the app has no tray yet).

### Server media

`<lpview base>/remote?src=<url>`: a server thumbnail, where `src` is the URL the api-client's media
helpers build (`squareThumbnailUrl` / `bigThumbnailUrl` of the connected server; only
`<server>/media/square_thumbnails/<hash>[.webp]` and `.../thumbnails_big/<hash>` are served),
fetched with the access token the UI last handed over and cached in
`<data dir>/server-media/<folder>-<userId>/<file>` (`Cache-Control: immutable`). 400 for any other
`src`, the server's status otherwise (502 when it cannot be reached).

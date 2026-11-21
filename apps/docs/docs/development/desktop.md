---
title: "Desktop app"
description: "How the desktop app (apps/desktop, Tauri 2) is built: the Rust platform layer and the shared TypeScript packages, the lpview scheme and its decode pipeline, deep-zoom tiles, the caches, the local database executor, the file seams, the server connection and backup engine, and XMP edits."
sidebar_position: 6
---

:::note Preview
The [desktop app](../user-guide/desktop/index.md) is not released yet. This page describes `apps/desktop` on `dev`.
:::

The desktop app is a [Tauri 2](https://tauri.app/) app: a Rust core in `apps/desktop/src-tauri` and a React UI in `apps/desktop/src`, shown in the system webview (WebView2 on Windows). Every command, event and URL the two sides exchange is listed in [`apps/desktop/CONTRACT.md`](https://github.com/LibrePhotos/librephotos/blob/dev/apps/desktop/CONTRACT.md), which `src/ipc.ts`, `src/db/` and `src/server/` mirror in TypeScript; change both sides and the contract together. This page explains how the parts work and why they are built the way they are.

## Rust platform layer, shared TypeScript packages

The rule that shapes the app: **Rust does what needs the platform, TypeScript does what the other apps share.**

| Concern | Lives in | Rust's part |
| --- | --- | --- |
| Pixels: decoding, scaling, caching, deep zoom | Rust (`decode/`, `pipeline.rs`, `diskcache.rs`, `tiles/`) | all of it |
| File operations: trash, rotate, reveal, clipboard, default-app settings | Rust (`ops.rs`, `jpegmeta.rs`, `orient.rs`) | all of it |
| Metadata reads and XMP writes | Rust (`info.rs`, `xmp/`) | all of it; the UI decides the target |
| The library, search, upload queue, outbox | [`packages/local-db`](./local-database.md) (schema, migrations, queries, writers) | only executes SQL, applies the migrations and reports changed tables (`localdb/`); no library SQL in Rust |
| What the disk knows about files | Rust (`platform/`), the "file seams" | walks, watches, reads headers and hashes, and hands the facts over as data; writes no database |
| Every server request | `packages/api-client` (endpoint functions and zod schemas, the `core` entry) | carries the bytes (`server/http.rs`) and keeps the refresh token in the OS keychain |

So the desktop runs the same schemas, queries and API contracts as the web and mobile apps, and a server answer that breaks a shared schema fails here the way it fails there.

The UI imports both packages from source, like the web app does: a Vite alias in `vite.config.ts` and the same mapping under `paths` in `tsconfig.json` point `@librephotos/api-client/core` at `packages/api-client/src/core.ts` and `@librephotos/local-db` at `packages/local-db/src/index.ts`. `resolve.dedupe` makes the packages' bare `zod` and `drizzle-orm` imports resolve to the desktop's own install, so the bundle holds one copy of each. `apps/desktop` is not an npm workspace: it keeps its own `package.json` and `package-lock.json` (the `api-client` workflow's nested-lockfile guard allows exactly that one), and `node scripts/check-shared-deps.mjs` checks that its zod, and React or React Query when it declares them, satisfy `packages/api-client`'s peer ranges, and that its `drizzle-orm` matches the one `packages/local-db` is tested with.

The Vite dev server uses a fixed port and keeps the terminal (Tauri expects the port and has to show Rust's compile errors).

### Where things are

| Rust (`src-tauri/src`) | |
| --- | --- |
| `lib.rs` | start-up, the `lpview` scheme registration, the command list |
| `protocol.rs`, `request.rs` | the `lpview` handler and URL parsing |
| `pipeline.rs`, `cache.rs`, `diskcache.rs` | decode scheduling, the byte-budgeted memory LRU, the disk cache |
| `decode/` (`mod.rs`, `wic.rs`, `raw.rs`, `generic.rs`), `heif.rs`, `pixels.rs`, `orient.rs`, `jpegmeta.rs` | decoders, resizing and encoding, EXIF orientation and JPEG header surgery |
| `tiles/` (`geom.rs`, `source.rs`, `disk.rs`, `mod.rs`) | deep zoom |
| `listing.rs`, `info.rs`, `formats.rs`, `ops.rs` | `list_folder`, `image_info`, file kinds, file operations |
| `localdb/` (`mod.rs`, `value.rs`, `migrate.rs`, `changes.rs`) | the SQL engine behind `packages/local-db` |
| `platform/` (`mod.rs`, `files.rs`, `watch.rs`) | the file seams |
| `server/` (`mod.rs`, `auth.rs`, `http.rs`, `backup.rs`) | settings, keychain, the native transport, the media proxy, MD5 and chunk reads |
| `commands.rs`, `appdirs.rs` | the Tauri commands and events of the above, where the app keeps its state |

| UI (`src`) | |
| --- | --- |
| `App.tsx`, `ipc.ts`, `platform.ts` | the app shell, the contract's commands and URLs (with a browser mock), window helpers |
| `stage/`, `chrome/`, `lib/` | the viewer: stage, tiles, slideshow, top bar, filmstrip, info panel, caches and queues |
| `edits/` | metadata edits and their server replay |
| `library/` | the library window: indexer, timeline layout and grid, search, folders, server pages |
| `db/` | the local database's executor, live queries, file seams, benchmark |
| `server/` | session, native transport, backup engine, contract errors |
| `ui/`, `styles.css` | the design tokens and the shared primitives |

## The `lpview` scheme

Every picture the webview shows comes from a custom URI scheme, `lpview`, so images load through `<img>` and `<video>` like any URL, are cached by the webview (`Cache-Control: immutable`, the URL carries the file's mtime) and never cross the JSON IPC. On Windows WebView2 reaches it as `http://lpview.localhost/...`, elsewhere as `lpview://localhost/...`; `imageUrl()` in `src/ipc.ts` builds both. The kinds (`thumb`, `screen`, `full`, `tile`, `remote`) and the headers are in the contract.

- `request.rs` parses the URL. `URLSearchParams` encodes spaces as `+`, so `+` is read as a space. A `thumb` is at most 320 px on its long edge (`THUMB_EDGE`); a `screen` request without a size gets 1920 x 1080 (`DEFAULT_SCREEN`), and no box edge goes beyond 16384 px.
- `p=` is a scheduling class, not part of the picture's identity: no `p` is `High` (the stage and its neighbours), `p=low` the filmstrip, `p=idle` folder pre-warming.
- Videos are served from the file with `Range` support so `<video>` can seek; an open-ended range is answered with at most 8 MB (`MAX_RANGE_CHUNK`).
- Every handler calls its responder exactly once, possibly from another thread.

### Decode pipeline

`pipeline.rs` decides when a request runs, `decode/` how it is made.

- A request first looks in the memory LRU of encoded `thumb` and `screen` responses (256 MB, keyed by path, mtime, kind and box; an entry bigger than a quarter of the budget is not kept), then in the [disk cache](#caches) on one of two I/O threads (so a disk hit never waits behind a decode), then goes to a pool of six decode workers. Identical requests in flight share one decode.
- Three lanes: `High` before `Low` before `Idle`. `High` and `Low` are LIFO, because the newest request is the picture the user is looking at; `Idle` runs in the order the UI gave. `Low` and `Idle` never take the last free worker, so a `screen` request always finds one; `Idle` uses at most two workers (`IDLE_WORKERS`), runs only when nothing else is queued, and lowers its thread's CPU and I/O priority. A request asked for again moves to the top of its lane, or to a better lane (a filmstrip thumb the stage asks for becomes `High`).
- Pre-warmed thumbs nobody asked for go to the disk cache only, so they never push the pictures being looked at out of memory.

`decode/mod.rs` picks the cheapest way to make what was asked:

1. **Pass-through**: the file's own bytes, when the webview decodes the format (JPEG, PNG, GIF, WebP, BMP) and no resize is needed. GIFs always pass through, so they keep their animation. `LPVIEW_SCREEN_PASSTHROUGH=<n>` lets a JPEG `screen` pass through up to `n` times the box's pixel count (default 1: only when it fits), which moves the decode into the webview.
2. **Embedded thumbnails**: a JPEG's EXIF thumbnail for `thumb` when its long edge is at least 120 px; a HEIC's `thmb` item (iPhones up to iOS 16, many cameras), which `heif.rs` rebuilds into a minimal HEIF holding only that item, so the decoder spends one 320 x 240 HEVC frame instead of the whole 12 MP grid. Embedded thumbnails and RAW previews are served with an EXIF orientation injected (`jpegmeta.rs`), so the webview turns them itself.
3. **Explorer's thumbnail cache** (Windows): about 15 ms on a hit, already oriented. Formats that are slow to decode (HEVC, AV1) and very big JPEGs (a 1/8 decode of a 300 MP JPEG still entropy-decodes all of it, about 0.6 s) let the shell make the thumbnail once and serve it from its cache afterwards; the rest only take a hit. Formats with alpha are left out, since shell bitmaps lose it. Videos get their thumbnail from the shell too.
4. **WIC** (Windows Imaging Component; JPEG, PNG, GIF, BMP, TIFF, WebP, HEIC/HEIF, AVIF, JXL and RAW with the Store codecs). JPEGs decode at 1/2, 1/4 or 1/8 through `IWICBitmapSourceTransform` (DCT scaling), so a 298 MP JPEG never exists at full size for a `screen`. A scaled decode down to 85 % of the box (`DCT_TOLERANCE`) is served as it is: a 1/2 decode of a 3840 x 2560 JPEG for a 2160 x 1440 box saves about 40 % of the time. COM is initialised multithreaded once per thread that touches WIC.
5. **Pure-Rust decoders** (`decode/generic.rs`: `image` with zune-jpeg, png, gif, webp, tiff and bmp, plus `jxl-oxide`), on every platform and as the fallback when WIC fails.
6. **Camera RAW** through [FlashRaw](https://github.com/ybouane/flashraw) (`decode/raw.rs`): the embedded JPEG previews (smallest first) for `thumb` and `screen`; a preview up to 480 px passes through with the RAW's orientation injected; the largest preview is used when it reaches about 90 % of the box; otherwise, and for `full`, a develop.

Decoded pixels are resized with `fast_image_resize` and encoded as JPEG q90 4:2:0, or as PNG when the image uses its alpha channel (`pixels.rs`). On Windows the WIC encoder does the JPEG (two to three times faster than `jpeg-encoder`, which is the encoder elsewhere); its output buffer is sized for the worst case and shrunk afterwards, so cached JPEGs do not keep megabytes committed that the caches' budgets never see. A `full` image is capped at 120 MP (`FULL_MAX_PIXELS`), which also keeps it within JPEG's 65535 px limit.

Orientation (`orient.rs`) is modelled as "rotate the stored pixels by `r` quarter turns clockwise, then mirror if `m`", which covers all eight EXIF values; orientations 5 to 8 swap width and height. `rotate_file` composes a quarter turn onto that: a JPEG's EXIF orientation is patched in place (two bytes) when the tag exists, otherwise its EXIF header is rebuilt with the tag (IFD0 copied to the end of the TIFF data, so no other offset moves) and the file replaced atomically, and an XMP `tiff:Orientation` is kept in step. TIFF files are patched when the tag exists, PNG and BMP re-encoded losslessly; other formats turn in the view only.

Windows 11 does not let an app make itself the default photo viewer, so `open_default_apps_settings` opens the Settings page where the user can. That page exists only when the installer registered the app under `Software\RegisteredApplications` with its product name (`src-tauri/windows/installer-hooks.nsh`); a dev build, or an install without the hook, gets the generic Default apps page.

### Start-up

Rust starts the `thumb` of the file given on the command line before the page exists, and its `screen` as soon as the window exists. The stage box it predicts is the window minus the top bar (48 px) and the filmstrip (76 px): `TOPBAR_HEIGHT_CSS_PX` and `FILMSTRIP_HEIGHT_CSS_PX` in `lib.rs` mirror `--lp-topbar-height` and `--lp-filmstrip-height` in `src/styles.css` and `useStageSize` in `src/stage/Stage.tsx`; change them together (a wrong guess costs one extra decode). The folder is listed while the webview boots (about 50 ms for 2,000 files; on Windows `DirEntry::metadata` comes from the directory enumeration, no extra system call per file), and the page's first `list_folder` for that path gets that listing. `src/lib/startupMarks.ts` logs when the first stage pixel and the first sharp one appeared (ms since navigation start; add `performance.timeOrigin` to compare with the process start). The local database's migrations also run before the window exists, so the UI's first query never waits for them.

Release builds on Windows use the `windows` subsystem, so no console window opens next to the viewer.

### The viewer in the UI

- `src/lib/viewport.ts` applies zoom and pan straight to a DOM element as a CSS transform, with no React state per wheel event. `scale` is CSS px per original image px, so 100 % (one image pixel per device pixel) is `1 / devicePixelRatio`. The layer is sized to the original pixel size and the loaded image stretches to fill it, so the geometry does not change when a sharper image arrives. Rotation counts quarter turns without wrapping, so a CSS transition always turns the short way. Only the top bar's zoom readout subscribes to the zoom (`zoomStore.ts`).
- `src/stage/useProgressiveImage.ts` shows the `thumb` at once, the `screen` (fitted to the stage's device-pixel box) over it once decoded, and `full` when zoomed past `screen`. While the user flips fast only thumbnails load and `screen` waits 140 ms for them to settle; the previous picture stays up for 160 ms while the next one has nothing decoded, and a file rotated on disk (same path, new mtime) keeps its old pixels until the new ones are ready. Results of a file the user already left are dropped.
- `src/lib/imageCache.ts` fetches and fully decodes a picture off-screen (`img.decode()`), so swapping it into the DOM paints in one frame; when every caller of a URL aborts, the request is cancelled. The stage prefetches the `screen` of the neighbours in the order +1, -1, +2, -2 once the current picture is up, and aborts a prefetch on the next tick so a request the stage picks up when the user steps onto that neighbour is not restarted.
- `src/lib/thumbQueue.ts`: the webview sends every `<img>` request at once and in DOM order, which the LIFO lanes would serve last-item-first. The filmstrip and the library grid therefore hand out their loads six at a time (one more than the thumb workers), visible items centre-out first, ranks read when a slot frees up, so scrolling re-orders what still waits.
- `src/lib/infoCache.ts` shares `image_info` per path and mtime between the stage (for 100 %) and the info panel, and delays it while the user flips fast.

## Deep zoom tiles

Pictures with more than 24 MP (`MIN_TILED_PIXELS`, displayed size, opaque) are zoomed through a tile pyramid instead of `full`. The geometry (512 px tiles with a 1 px overlap, level `L` at `1/2^L`) and the URLs are in the contract; `tiles/geom.rs` holds it as pure functions.

**Producing tiles** (`tiles/`):

- Tiles are made a *band* at a time: one row of tiles, or one column when the orientation swaps the axes, which is a run of full-width rows of the stored image. Decoders stream rows forward cheaply, so a band is the natural unit. Each level is produced by at most one job at a time, which owns its own row source and streams forward: bands someone waits for first (the nearest one at or below the decoder's position, so it rarely rewinds), then, while the picture is the one being viewed, the rest of the level ("fill"), so panning soon hits the cache only. Bands an earlier session already put on disk are skipped.
- Row sources (`tiles/source.rs`): on Windows WIC's `CopyPixels` with a row rectangle. Decoders keep their position, so consecutive runs stream (a 512-row strip of a 23040 px wide JPEG costs about 47 ms however deep it is) and rows above a rectangle are skipped with entropy decoding only (the middle band of a 298 MP JPEG comes out in about 0.35 s cold); JPEG coarse levels decode at 1/2 to 1/8 scale with a rectangle, so they never touch full resolution. A RAW develop, or a pure-Rust decode off Windows, is decoded once and sliced. Coarser levels are box-reduced from the closest native scale, at most 256 source rows at a time.
- Tiles are cut in stored orientation and turned one by one on six encode threads (orienting a whole band first would be a serial transpose of up to 35 MB). They are JPEG q90 **4:4:4**: with 4:2:0 every tile edge shows a faint seam, because a decoder reconstructs chroma at an image edge differently than between two blocks.
- Tile work has its own threads (four job threads, two I/O threads), never the `thumb`/`screen` workers; background fill runs at below-normal priority. Measured: an uncached `screen` decode of an 81 MP JPEG takes about 1.3 times as long while a 298 MP pyramid is built from scratch.
- Caches: a 96 MB memory LRU of encoded tiles, and `tiles/<id>/<L>-<x>-<y>.jpg` on disk (`tiles/disk.rs`), one folder per image version (`<id>` is an FNV-1a hash of the canonical path, mtime, size and `TILE_FORMAT`, which is bumped when the tile format changes so old tiles are never served). A `used` file's mtime records when the picture was last viewed; past the 2 GB cap whole folders go, least recently viewed first, down to 90 %. `<L>.done` marks a complete level. Tiles are written as temp file plus rename, off the request path (creating a file costs about 2 ms on Windows with real-time scanning).

**Drawing tiles** (`src/stage/tileLayer.ts`): one canvas over the stage, drawn in device pixels from refs in `requestAnimationFrame`, with no React state per frame.

- The geometry comes from the stage layer's computed transform, so the tiles follow the image exactly, also during CSS zoom and rotate transitions (redrawn every frame while one runs). Tiles appear once the picture shows 1.1 times more detail than the `screen` image has.
- The level is the coarsest with at least one tile pixel per device pixel. Every tile corner is rounded to a device pixel and neighbours share corners, so there are no gaps at fractional zoom; each tile's 1 px overlap feeds the interpolation at its edge, so magnified edges show no seam.
- Missing tiles are drawn from the nearest loaded coarser tile, and the next coarser level is fetched first, so panning never falls back to the blurry `screen`. Then the tiles of this level nearest the centre, then a ring around the view while it holds at most 40 tiles. Levels passed mid-animation are not fetched.
- At most six requests in flight and 128 decoded tiles (about 1 MB each), closing the least recently drawn bitmaps (never one drawn in this frame). `window.__lpTiles.stats()` in DevTools shows the live layer.

## Caches

| Cache | Where | Size | Notes |
| --- | --- | --- | --- |
| Encoded `thumb`/`screen` responses | memory | 256 MB | `cache.rs`, byte-budgeted LRU |
| The same, on disk | `<data dir>/cache` (or `LPVIEW_CACHE_DIR`) | 1 GB | only responses that took 12 ms or more |
| Tiles | memory and `<data dir>/tiles` | 96 MB and 2 GB | see above |
| Server thumbnails | `<data dir>/server-media/<server>-<user id>/` | | the `remote` route |
| Decoded images in the webview | `src/lib/imageCache.ts` | 48 pictures | |

The disk cache (`diskcache.rs`) keeps one file per response under `<root>/v1/<hh>/<hash>.lpc`. The file starts with the full cache id (kind, box, mtime, size and path of the source), so a hash collision or a torn file is a miss, never a wrong picture. Writes go through one background thread (temp file plus rename, so readers and a second app instance never see half a file); when 512 writes wait, more are dropped, since the cache is best effort. "Used" is the file's mtime, refreshed by a hit at most once an hour; a sweep deletes the least recently used files down to 90 % of the cap, plus temp files older than an hour left by a crash. The first sweep waits 20 s after start-up so it does not compete with the first pictures. Several processes can share the directory: every operation tolerates files appearing or vanishing underneath it.

`appdirs.rs` puts everything under one data directory (`%LOCALAPPDATA%\com.librephotos.viewer`, macOS `~/Library/Application Support/com.librephotos.viewer`, else `$XDG_DATA_HOME/com.librephotos.viewer`); `LPVIEW_DATA_DIR` moves all of it, so test runs never touch the user's state.

## Local database

The desktop's executor for [`packages/local-db`](./local-database.md) is `src/db/executor.ts` over the Rust commands `db_exec` and `db_batch` (`localdb/`). The wire format (row shapes, value tags, transaction rules) is in the contract; the reasons behind it:

- **Answers are JSON that Rust writes while SQLite steps**, sent as raw bytes (an `ArrayBuffer` the executor parses), so no row is copied out of SQLite first. Handing the answer over as a script instead (`webview.eval`) measured about 45 % slower for a 900 KB page on WebView2.
- **Exact values**: plain JSON for `null`, strings, finite reals and integers within 2^53 - 1; anything else is a one-key tag object (`$bigint`, `$blob`, `$real`). A result says whether it holds a tag at all (`tagged`), so the executor only walks the rows that need it. SQLite stores NaN as NULL, so the only non-finite reals are the infinities. Parameters are deserialised by hand (`localdb/value.rs`): serde's `untagged` buffers every value first, which made a 2,000-statement batch spend about 60 ms in parsing alone.
- **One connection** behind a mutex (WAL, `synchronous=NORMAL`, foreign keys off like mobile's expo-sqlite connection), with a cache of 256 prepared statements, since Drizzle sends the same SQL again and again. A transaction never outlives one call, so the package writes several statements with `db.batch([...])`, never `db.transaction()`.
- **Changed tables**: `sqlite3_update_hook` collects the tables a call writes; once it committed they go to the change hub (`localdb/changes.rs`), which opens a 40 ms window at the first change and sends one `db://changed` with every table touched in it, so a walk inserting thousands of rows is a handful of events and the first is never more than a window late. Writes to a virtual table's shadow tables (the FTS index, written by triggers) are left out: a listener of the indexed table hears about the change already. A `DELETE FROM t` without `WHERE` would empty the table without visiting rows (the truncate optimisation), which the update hook does not see, so the authoriser answers `SQLITE_IGNORE` to that delete, which keeps the delete and turns the optimisation off; `DROP TABLE` and `DROP VIEW` ask for the same authorisation right after their own, where `SQLITE_IGNORE` would skip the drop, so those (and the schema table's) are allowed.
- **Migrations** (`localdb/migrate.rs`) apply the package's `migrations/migrations.json`, compiled in with `include_str!`, the way the package's `runMigrations` does: each missing tag in its own transaction with its row in `__local_db_migrations`. If one fails the database is wiped and rebuilt: the rows of `outbox` and `upload_queue` (`PRESERVED_TABLES`) are read out, every view and table is dropped, every migration applied from scratch, and the saved rows go back with the columns that still exist (`INSERT OR IGNORE`). The server mirror is disposable and the library is walked again. `db_info` reports it. The file is `local.db`; the Rust library before the shared package used `library.db`, which is no longer read.
- **Live queries** (`src/db/live.ts`) follow mobile's, without React Query: a query runs when a view shows it and again when the change hub flushes a write to one of its tables, answers are cached per key (a view shown again paints at once while it re-reads), and the newest read wins. While the grid scrolls the hub holds its re-reads (`defer`).

`window.__lpDbBench()` (`src/db/bench.ts`) measures the IPC round trip in the real app on its own `__bench_photo` table shaped like mobile's `remote_photo`; targets are a 5,000-row timeline page under 30 ms and a 2,000-row batch insert under 100 ms. `cargo run --example localdb` measures the Rust half alone on a 50,000-row table.

## File seams

`platform/` is what the desktop knows about files on disk, handed to the TypeScript writers of `packages/local-db` as data, the way mobile's native modules hand over the camera roll. Nothing in it writes a database.

- **Walk**: supported files in batches of 500 as they are found. Hidden folders, `$RECYCLE.BIN` and Synology's `@eaDir` are never entered; a subfolder that cannot be read is skipped, but a root that cannot be read fails.
- **Watch** (`platform/watch.rs`): one recursive `notify` watcher per root, events debounced per root (350 ms quiet, 2 s at most) and resolved against the disk, so the final state wins (a file created and deleted within one batch is only `removed`). A folder that appears is walked. Removed paths may be folders, so the writer deletes the path and everything below it. Renames keep the row (its MD5 and server state): Windows reports a rename in two events and Linux in one (plus the halves), a chain `a -> b -> c` is one move, a rename to a kind the library does not keep (`a.jpg -> a.txt`) is a removal, and renames out of or into the root are removals and creations.
- **Metadata**: headers only, no pixels, on four threads, at most 4,096 paths a call. Dates taken are local wall-clock milliseconds (an EXIF date has no time zone), which the UI reads with the UTC getters of `Date`.
- **Normalised roots**: `C:\Pics\` becomes `C:\Pics` and, on Windows, `/` becomes `\` (`normalize_dir` in `platform/files.rs`, mirrored by the indexer in `src/library/indexer.ts`); a drive root keeps its separator.

The indexer (`src/library/indexer.ts`) drives the writers from these seams: it walks and watches every root at start and diffs each batch against the known rows by size and mtime, runs the metadata pass (256 files a batch, newest first) and, while signed in, the hash pass (32 files a batch, four at a time), then wakes the backup engine. The steps and the writers are listed in the contract's "Library" section.

The timeline's layout (`src/library/layout.ts`) follows the web app's react-pig: day groups of justified rows, a day short enough for one line sharing it with the next days, as in Immich and Google Photos. It is plain arithmetic over aspect ratios the library rows already carry (3:2 until a file's header is read), so it never reads the DOM; the result is a flat list of blocks sorted by `top`, which `Grid.tsx` binary-searches to render only what is in view (plus 800 px).

## Server connection and backup

Every request is an endpoint function of `packages/api-client` (`src/server/session.ts` holds the one client). Rust only:

- **carries the bytes** (`server/http.rs`): the api-client's native transport (see [Native transports](./contribution/frontend/index.md#native-transports)) hands over a framed request, `reqwest` sends it, and the framed answer comes back, so CORS and the webview's cookie jar and limits never apply. Only URLs of the connected server, or the one being signed in to (`server_prepare_sign_in`), are sent. A request's `nativeFilePart` markers are replaced by up to 64 MB of a library file, read in Rust, so an upload chunk never crosses IPC.
- **keeps the session**: the server address, user and backup switch in `settings.json`, the refresh token in the OS keychain (Windows Credential Manager, macOS Keychain, the Linux kernel keyring, via `keyring`), never in web storage. `auth.rs` normalises the address typed into the sign-in form (`https://` assumed, `http://` only for this machine and the local network, a pasted `/api` dropped) and reads the access token's `user_id` and `exp` claims without verifying them (the server does that; the client only needs to know who it is and when to refresh).
- **proxies server thumbnails** for the `remote` route (`square_thumbnails` and `thumbnails_big` of the connected server only), with the access token the UI last handed over (`server_set_access`) and a disk cache. The UI refreshes the access token a minute before it expires (`endpoints.refreshAccessToken`), so server thumbnails keep loading while no API request is due.

Contract errors (`src/server/errors.ts`): an answer that breaks its schema is logged with its endpoint and shown as a toast, at most once per endpoint every 30 s, and is never read as an empty answer.

The **backup engine** (`src/server/backup.ts`) is TypeScript and its queue is the shared database's `upload_queue`, so nothing is lost on a restart or a reloaded UI. One checker (32 rows a claim, four `uploadExists` at a time) and two uploaders (8 MB chunks, a re-stat and a dedupe check before each upload) run while the window is open; the steps, the backoff and the resume rules are in the contract's "Backup" section. A network error, a 5xx, 429 or 401 is not the file's fault: the row goes back in line and the attempt does not count, and the loop waits 15 s. Idle loops look for work every 5 s even without a wake-up. When the queue runs dry the collected `job_id`s are sealed (`sealUploadImports`), so the server's import jobs finish at once instead of after a few idle minutes. `device_modified_at` is the file's mtime in ISO 8601 local time with its UTC offset.

## Edits

Ratings, captions, keywords and the date taken are written where other photo apps read them: an XMP sidecar by default, the JPEG's own XMP segment, or the local database only. `src-tauri/src/xmp/` is a small XML scanner that splices the changed properties into the original packet, so everything else in it stays byte for byte; a sidecar that does not parse is refused, never overwritten. When signed in, each edit is also queued in `outbox` and replayed against the server by `src/edits/serverSync.ts`. The tags, the sidecar names and the replay are in the contract's "Edits" section; what users see is in [Editing a picture's details](../user-guide/desktop/editing.md).

## Design tokens and UI primitives

The desktop has no Mantine; it draws the web app's Mantine 9 theme with plain CSS so it reads as the same product. `src/styles.css` holds the tokens (`--lp-color-*`, `--lp-radius-*`, `--lp-space-*`, `--lp-font-*`, `--lp-shadow-*`, `--lp-z-*`, sizes such as `--lp-topbar-height`), taken from `apps/frontend/src/theme`; new CSS uses them, never raw colours (the short legacy names at the end of the file, `--bg`, `--surface`, `--text`, are only for older code). `:root` follows `prefers-color-scheme`; `.lp-dark` forces the dark values on the viewer (top bar, stage, filmstrip, info panel), which is dark in both schemes like the web lightbox; `.lp-app-scheme` brings the app's scheme back for menus and dialogs opened from the viewer, as Mantine's portalled dropdowns do on the web. Photo-side colours (`--lp-stage`, the scrims) are the same in both schemes.

`src/ui/` re-creates the Mantine components the desktop needs as small React components over plain classes: `ui.css` (buttons, icon buttons, CSS-only tooltips through `data-tip`, menus, panels, detail rows, checkboxes) and `controls.css` (Button variants, inputs, Switch, SegmentedControl, Badge, Progress, Card, NavLink, Alert, Loader, Modal, EmptyState, Avatar, PageHeader). Each class names the web component it follows; the web sources are the reference when one of them changes.

## Running, testing and measuring

| | |
| --- | --- |
| `npm ci`, `npx tauri dev` / `npx tauri build` (in `apps/desktop`) | run or build the app |
| `npm run dev` | the UI alone in a browser, answering from a mock in `src/ipc.ts`; `?empty` starts with nothing open, `?big` with 2,000 files |
| `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build` | the UI's checks |
| `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (in `src-tauri`) | the Rust checks |
| `cargo test --test corpus -- --ignored --nocapture --test-threads=1` | tests against the real files of `desktop-test-corpus` |
| `cargo run --example bench -- [--full] [--quick] [paths...]` | decode times per file (thumb, a 2560 x 1440 `screen`, full), cold and cached, as Markdown tables with per-format medians |
| `cargo run --example tiles -- [image] [--all] [--fill]` | cold tile latency per level, the whole pyramid with `--all`, background fill on with `--fill`; uses a fresh disk cache in `%TEMP%`. It also measures the colour step across tile edges against the step across the source JPEG's own 8 px block edges (1.0: tiling adds nothing) |
| `cargo run --example localdb` | the Rust half of the local database's IPC cost |

The dev profile builds every dependency at `opt-level = 3` (decoders are unusably slow unoptimised) and the app's own crate at 2, so its pixel loops are fast while it still rebuilds quickly.

For test runs over the Chrome DevTools Protocol the page exposes `window.__lpDev()` (library and server calls a native dialog or a click would make, such as `addLibraryRoot(path)`), `window.__lpDbBench()` and `window.__lpTiles`, each loaded on first use.

| Variable | Does |
| --- | --- |
| `LPVIEW_DATA_DIR` | moves the database, settings and every cache |
| `LPVIEW_CACHE_DIR`, `LPVIEW_DISK_CACHE=0` | move or turn off the thumbnail disk cache |
| `LPVIEW_TILE_CACHE=<dir>` or `=off`, `LPVIEW_TILES=off` | move or turn off the tile disk cache; no tiling at all (big pictures load `full`, for comparisons) |
| `LPVIEW_SCREEN_PASSTHROUGH=<n>` | see [Decode pipeline](#decode-pipeline) |
| `LPVIEW_TRACE=1`, `LPVIEW_TILE_TRACE=1`, `LPVIEW_DB_TRACE=1` | log every `lpview` request (queued, memory or disk hit, decode), the cost of every tile band, every database call's statements, time and answer size to stderr |
| `LPVIEW_KEYRING_SERVICE` | the keychain service the refresh token is stored under (tests) |
| `LPVIEW_MULTI_INSTANCE=1` | lets several copies run side by side (test harnesses) |

## CI and releases

<Since version="1.7.0" />

`.github/workflows/desktop.yml` runs on Windows for every pull request and push to `dev` that changes `apps/desktop`, `packages/api-client` or `packages/local-db`, and for every release:

| Job | Does |
| --- | --- |
| `check` | `npm ci`, the UI's typecheck and build, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` |
| `installer` | builds the NSIS installer with `npx tauri build --bundles nsis`, stamped with the release tag (`0.0.0` outside a release), and smoke-tests it with `apps/desktop/scripts/smoke-installer.mjs` |

The smoke test is what a user does: it installs silently (`/S`), checks the registry entries the installer hooks write for **Set as default photo viewer** (`RegisteredApplications`, `Capabilities\FileAssociations`, the `LibrePhotosViewer.Image` ProgID), starts the installed app on a picture and waits until its window title is `<picture> - LibrePhotos Viewer` (the viewer sets it once it has listed the folder and opened the picture; GitHub's Windows runners don't answer on WebView2's remote-debugging port, so the test reads the title through Windows instead), then uninstalls silently and checks that the program and its registration are gone. Run it locally with `node apps/desktop/scripts/smoke-installer.mjs <setup.exe> <picture>`; it installs into your own user profile.

Every build uploads the installer as the workflow artifact `librephotos-desktop-windows-x64`. For a release (`release: created`, not drafts or pre-releases) it is also attached to the release as `librephotos-desktop-<tag>-windows-x64-setup.exe`, as `librephotos-desktop-windows-x64-setup.exe` (the name the user guide's `releases/latest/download` link uses) and with `SHA256SUMS-desktop`. A tag must be `X.Y.Z`. A failed release build opens an issue. To build a release's installer again, dispatch the workflow from the tag: `gh workflow run desktop.yml --ref <tag> -f tag=<tag>` (`-f replace_asset=true` to overwrite assets it already has).

The installer is per user (`%LOCALAPPDATA%\LibrePhotos Viewer`, no administrator rights) and not signed yet, so Windows SmartScreen warns about it. The app keeps its data in a different folder named after the bundle identifier (`com.librephotos.viewer`, `appdirs::DIR_NAME`, held equal to `tauri.conf.json` by a test), which is the folder the uninstaller's **Delete the application data** option removes.

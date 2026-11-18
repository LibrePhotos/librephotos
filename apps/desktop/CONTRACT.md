# Viewer contract: Rust core <-> UI

The prototype of the local Photos-style viewer (see `plans/desktop/README.md`, section 4.2).
Rust lives in `src-tauri/`, the UI in `src/`. This file is the only thing both sides rely on;
`src/ipc.ts` mirrors it in TypeScript. Change both together.

## Commands (`invoke`)

All paths are absolute OS paths (`C:\Users\...` on Windows). Errors reject with a string.

| Command | Args | Returns |
|---|---|---|
| `initial_path` | none | `string \| null`: the file or folder given on the command line (first non-flag argument), or null |
| `list_folder` | `{ path }` (a file or a folder) | `FolderListing` |
| `image_info` | `{ path }` | `ImageInfo` |
| `trash_file` | `{ path }` | `null`; moves the file to the Recycle Bin / Trash |
| `rotate_file` | `{ path, clockwise }` | `number`: the file's new modified time (ms). Rotates the file on disk losslessly where possible (EXIF orientation for JPEG/HEIC/TIFF, otherwise decode, rotate, re-encode). The UI busts its cache with the new mtime. |
| `reveal_in_folder` | `{ path }` | `null`; opens Explorer/Finder/file manager with the file selected |
| `copy_image` | `{ path }` | `null`; puts the decoded image (orientation applied) on the clipboard |
| `prewarm_thumbs` | `{ paths }` | `number` queued. Replaces the pre-warm list: Rust makes the `thumb` of each file (in the given order, nearest first) into the disk cache when no other request is waiting, skipping files already cached. `[]` cancels. |
| `clear_cache` | none | `number`: bytes deleted from the disk cache (also cancels pre-warming) |
| `open_default_apps_settings` | none | `null`; opens Settings > Apps > Default apps at this app's page (`ms-settings:defaultapps?registeredAppUser=LibrePhotos%20Viewer`, or `registeredAppMachine=`, or plain `ms-settings:defaultapps` when the app is not registered). Windows only; rejects with "not supported yet" elsewhere. |
| `tile_info` | `{ path }` | `TileInfo \| null`: the deep-zoom pyramid of a big picture, or null when it is not tiled (see "Tiles"). Cheap (header only) except for RAW, where it develops the file once. Makes the picture the one whose pyramid is filled in the background. |
| `tile_release` | `{ path }` | `null`; the UI no longer shows tiles of `path` (it moved on to another picture): stop the background fill. |

```ts
type FileKind = "image" | "raw" | "video";
type FileEntry = { path: string; name: string; size: number; modifiedMs: number; kind: FileKind };
type FolderListing = { folder: string; files: FileEntry[]; index: number }; // index of `path` when it is a file, else 0
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
};
```

Supported extensions (case-insensitive), used by `list_folder` filtering and file associations:
`jpg jpeg jpe jfif png gif webp bmp tif tiff heic heif hif avif jxl` (image),
`dng cr2 cr3 nef nrw arw srf sr2 orf rw2 raf pef srw raw rwl 3fr erf kdc mrw x3f` (raw),
`mp4 mov m4v webm mkv avi` (video: listed so the filmstrip shows them; the UI plays them with `<video>` via `full`).

Sort order: natural, case-insensitive by file name (`IMG_2.jpg` before `IMG_10.jpg`), like Explorer.

## Events (Rust -> UI)

| Event | Payload | When |
|---|---|---|
| `viewer://open` | `{ path: string }` | A second launch (double-click in Explorer while running) forwarded its file. The UI switches to it and focuses. |

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
or embedded EXIF thumbnails) are also written to `%LOCALAPPDATA%\LibrePhotos Viewer\cache1\`
(macOS `~/Library/Caches/LibrePhotos Viewer`, elsewhere `$XDG_CACHE_HOME/librephotos-viewer`), one
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
  `%LOCALAPPDATA%\LibrePhotos Viewer\tiles\<id>\<L>-<x>-<y>.jpg` (`<id>` hashes the canonical path,
  mtime and size;
  `<L>.done` marks a complete level) capped at 2 GB, whole image folders evicted least recently
  viewed first. `LPVIEW_TILE_CACHE=<dir>` moves it, `=off` disables it; `LPVIEW_TILES=off` turns tiling
  off; `LPVIEW_TILE_TRACE=1` logs the cost of every band.
- The UI draws visible tiles of the level with at least one tile pixel per device pixel on one
  canvas over the stage (plus level+1 first as a fallback), corners snapped to device pixels, at most
  6 requests in flight and ~128 decoded tiles kept.

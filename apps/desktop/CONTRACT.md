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

```ts
type FileKind = "image" | "raw" | "video";
type FileEntry = { path: string; name: string; size: number; modifiedMs: number; kind: FileKind };
type FolderListing = { folder: string; files: FileEntry[]; index: number }; // index of `path` when it is a file, else 0
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

- Windows (WebView2): `http://lpview.localhost/<kind>?path=<encodeURIComponent(path)>&w=<px>&h=<px>&v=<modifiedMs>`
- macOS/Linux: `lpview://localhost/<kind>?path=...&w=...&h=...&v=...`

| kind | Meaning |
|---|---|
| `thumb` | Fast small image, long edge <= 320 px. Prefer the embedded EXIF/RAW thumbnail; may be lower quality. Must answer in a few ms when an embedded thumbnail exists. |
| `screen` | Fits inside `w` x `h` device pixels (never upscaled), orientation applied. |
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

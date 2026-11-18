# LibrePhotos Desktop: research and plan

Status: research + plan only (2026-11-18, revised the same day). Nothing is built yet.

Goal: one desktop app for Windows, macOS and Linux that

1. **is a LibrePhotos client built from the mobile app's code**: same offline-first SQLite mirror, delta
   sync, outbox, backup engine and screens as `apps/mobile`, so most mobile functionality can be built,
   debugged and tested on a desktop before it meets the long tail of phones; and
2. **is a fast local image viewer** in the spirit of the Windows 11 Photos app: double-click a
   JPG/HEIC/RAW in Explorer, Finder or Nautilus, it opens at once, arrow keys walk the folder, zoom,
   rotate, delete, slideshow, info panel.

The bridge between the two is what no other viewer has: a local file you open can show whether it is
already in your library, who is in it, its caption, and offers "Upload to LibrePhotos".

## 1. Recommendation

Build `apps/desktop` as a **Tauri 2** shell around **the Expo web build of `apps/mobile`**, plus a Rust
core that implements the mobile app's platform interfaces for the desktop.

- **Same code as mobile, not a copy.** `apps/mobile` already isolates the platform behind interfaces
  (`MediaProvider`, `AssetHasher`, `UploadTransport`, `DeviceProbe`) and keeps its SQLite access on
  Drizzle. The desktop provides a second implementation of each interface; the sync engine, queries,
  outbox, job queue and screens run unchanged. A bug fixed on desktop is fixed on mobile.
- **Roll out incrementally.** Step 1 is "the mobile app runs in a desktop window against a real server"
  with zero desktop-specific features. Each later step swaps one more seam (folders as the camera roll,
  native hashing, keychain, tray backup) and each step is shippable on its own.
- **The viewer** is a small, separate entry in the same Tauri app, with Rust decoders behind a custom
  URI scheme so it starts fast and opens HEIC/RAW on every OS.
- **The server's web app** stays one click away ("Open full web app") for the admin area, the editor and
  everything mobile does not have; the desktop does not try to replace it.
- **Not Expo native desktop**: Expo has no Windows or Linux target (section 3.1). Expo **web** inside
  Tauri reaches all three OSes with the same JS.
- Electron (or Tauri's CEF runtime once stable) remains the fallback if WebKitGTK on Linux fails the
  phase 0 spike; the JS and the seams carry over unchanged.

## 2. What the codebase gives us today

### 2.1 Mobile's platform seams (origin/dev 0d29919da)

Native imports in `apps/mobile/src` are concentrated in about 20 files. Everything else is Drizzle,
React, expo-router, expo-image, zod and the shared api-client.

| Seam | Mobile implementation | Desktop implementation |
|---|---|---|
| SQLite (`AppDatabase = BaseSQLiteDatabase<"sync">`, sync `db.all()/db.get()`) | `db/client.ts`: expo-sqlite + `drizzle-orm/expo-sqlite`; tests already use `better-sqlite3` | **expo-sqlite's web backend** (sync API + change listener supported on web; wasm worker needs `SharedArrayBuffer`, so COOP/COEP headers, which Tauri 2.1+ sets via `app.security.headers`). Possibly no code change at all. |
| Migrations | `db/migrate.ts`, `migrations-sql.ts`, drizzle migrator | same files |
| Live queries | `db/live-query.ts` (coalesces `addDatabaseChangeListener` storms) | same; verify the web listener fires per row like native |
| Camera roll: `MediaProvider` | `sync/device/expo-media-provider.ts` (expo-media-library) | `tauri-media-provider`: chosen folders = "albums", Rust walks them, `notify` crate drives `addChangeListener` |
| `AssetHasher` (md5, never touches network) | `sync/device/expo-asset-hasher.ts` | Rust command, streaming MD5 off the UI thread |
| `UploadTransport` | `sync/upload/expo-transport.ts` | Rust upload (reads the file itself, so no bytes cross IPC) |
| `DeviceProbe` (battery, network) | `sync/upload/expo-probe.ts` | Rust: AC power, metered connection |
| Tokens | `lib/tokenStorage.ts` (expo-secure-store, no web support) | OS keychain via `keyring` crate |
| Preferences | `lib/preferencesStorage.ts` (`expo-sqlite/kv-store`) | same (kv-store sits on the same SQLite) |
| Background work | `sync/background/tasks.ts` (expo-background-task) | not needed: the app lives in the tray; `sync/triggers.ts` runs on a timer + folder events |
| Online status | `hooks/use-online-status.ts` (expo-network) | `navigator.onLine` + Rust probe |
| Share, save to device, clipboard, notifications | `features/viewer/shareMedia.ts`, `features/selection/saveToDevice.ts`, expo-clipboard, expo-notifications | Tauri dialog (save as), clipboard and notification plugins; "share" becomes "Show in folder" / drag out |
| API requests | `packages/api-client` | same client; it already accepts an injected `fetch` (`transport/types.ts`), so pass Tauri's HTTP plugin `fetch` and CORS never applies |
| Authenticated images (`mediaHeaders()` = Bearer) | expo-image with `headers` | a Rust `lpmedia://` protocol that adds the token and keeps an on-disk thumbnail cache (offline thumbnails for free); avoids relying on header support in expo-image's web `<img>` and on COEP rules for cross-origin images |

How the swap is wired: Metro already resolves `*.web.ts` before `*.ts` (there is a
`hooks/use-color-scheme.web.ts`). Each seam gets a `.web.ts` file that picks the Tauri implementation
when `window.__TAURI_INTERNALS__` exists and a browser fallback otherwise, so a plain
`expo start --web` keeps working for quick UI work.

### 2.2 Other facts

| Fact | Where | Consequence |
|---|---|---|
| Media endpoints accept `Authorization: Bearer` as well as the `jwt` cookie | `api/views/media.py`, `packages/api-client/src/media.ts` | the Rust media proxy works without cookies |
| Server CORS allows only `http://localhost:3000` | `settings/production.py` | another reason to send requests from Rust (HTTP plugin) rather than the webview |
| `File.hash = md5(bytes) + str(user.id)`, `/api/exists/{hash}` | backend | the viewer's "In your library" badge is one MD5 + one request |
| Windows standalone server: Nuitka, ~450 MB zip / 1.1 GB, pystray tray, own update check | `librephotos/standalone.py` | do not bundle; detect and start it, later take over its tray |
| Web app has the editor (PR #2999), admin, full lightbox | `apps/frontend` | "Open full web app" opens it in a second window or the browser |

## 3. Options considered

| Option | Shares mobile code | Size | Linux | HEIC/RAW | Verdict |
|---|---|---|---|---|---|
| **A. Tauri 2 + Expo web build of `apps/mobile`** | **yes, almost all** | ~15-25 MB | WebKitGTK (weakest) | via Rust | **Chosen.** |
| B. Tauri 2 + the server's own web app in a window | no (web app) | ~10-20 MB | WebKitGTK | via Rust | The first draft of this plan. Cheapest, but tests nothing of mobile and has no offline mirror. Kept as the "Open full web app" button. |
| C. Electron + Expo web build | yes | ~100-250 MB | good (Chromium) | via napi-rs | Fallback if WebKitGTK fails; same JS, seams move from Rust commands to Node. |
| D. Expo native desktop (react-native-macos / -windows) | yes, natively | medium | **none** | native module per OS | Rejected, section 3.1. |
| E. Flutter / Avalonia / Qt | no | medium | good | native | Full rewrite; rejected. |
| F. PWA (+ `file_handlers`) | web app only | 0 | Chromium | no | Small extra, not the answer. |

### 3.1 Why Expo web and not Expo native desktop (checked 2026-11-18)

- The Expo Modules API supports only Android, iOS, macOS and tvOS
  ([docs](https://docs.expo.dev/modules/additional-platform-support/)). macOS goes through
  `react-native-macos` without `expo prebuild --platform macos` or EAS builds; Windows exists only as the
  community "Expo Desktop" project (0.0.1, SDK 54, Windows in progress, no Linux).
- `apps/mobile` is on SDK 57 / RN 0.86; `react-native-macos`/`-windows` trail upstream by months and
  would hold mobile upgrades back.
- Most of the native modules the app uses (media library, background task, notifications, secure store,
  glass effect, symbols) have no Windows implementation.
- Expo **web** needs none of that: `react-native-web` is already a dependency, `app.json` already has a
  `web` block, and expo-router, expo-image, flash-list, reanimated, gesture-handler and NativeWind all
  target web. What web lacks is exactly what the seams in 2.1 replace.

What desktop does **not** test for mobile: the native modules themselves, iOS/Android lifecycle and
background limits, real touch gestures, low-memory devices and the iCloud "remote" asset state. Those stay
on device testing (and the emulator harness). Everything above the seams is shared and testable here.

### 3.2 Prior art

Ente desktop is its web app in Electron (their newer app uses Tauri). Immich has no official desktop app;
community clients use Tauri (Lymic), GTK4/Rust (Mimick) and Qt (immich-desktop). Every viewer that feels
instant (Photos, Preview, Loupe, Oculante, ImageGlass) decodes natively and draws on the GPU.

## 4. Architecture

```
apps/desktop/
  src-tauri/          Rust: windows, single instance, file associations, tray, decoders + lpview://,
                      lpmedia:// proxy + cache, folder index/watcher, md5, upload, keychain, updater,
                      standalone launcher
  viewer/             small React entry for the local viewer (no router, no DB)
apps/mobile/          unchanged structure; gains *.web.ts seam files and desktop-aware layouts
packages/api-client   unchanged
```

`apps/desktop` builds `apps/mobile` with `expo export -p web` and ships the output as Tauri's
`frontendDist`. One codebase, two build targets.

### 4.1 Windows of the app

- **Library window**: the mobile app (Expo web). Phase 1 shows it as is (phone layout in a narrow
  window is fine for testing); later phases add wide layouts (sidebar instead of tab bar, multi-column
  grid, keyboard shortcuts, hover states) behind `useWindowDimensions`, which also benefits tablets.
- **Viewer window**: opened from argv (Windows/Linux) or `RunEvent::Opened` (macOS).
  `tauri-plugin-single-instance` forwards later double-clicks to the running process. Stays resident
  in the tray after the first open so later opens skip the webview cold start.
- **Web app window** (optional): the server's own URL for admin/editor.

### 4.2 Local viewer decode pipeline

Custom protocol `lpview://` (`register_asynchronous_uri_scheme_protocol`):

| Request | Answer |
|---|---|
| `lpview://folder/<id>` | sibling files in natural sort order, filtered to supported types |
| `lpview://thumb/<file>` | embedded EXIF thumbnail / RAW embedded JPEG, else 256 px decode |
| `lpview://screen/<file>?w=&h=` | screen-sized decode, orientation applied |
| `lpview://full/<file>` | full resolution, only when zoomed past fit |
| `lpview://meta/<file>` | EXIF/XMP/GPS; MD5 computed lazily for the library badge |

- Pass through what the engine decodes itself (JPEG, PNG, GIF, WebP; AVIF/JXL where available, not on
  Ubuntu's WebKitGTK). Decode the rest in Rust: HEIC (libheif-rs + libde265, dynamically linked), JXL
  (jxl-oxide), TIFF, RAW embedded preview (rawler or LibRaw). macOS can use ImageIO; Windows WIC only
  decodes HEIC with the paid HEVC extension, so libheif is the default there.
- Thumb first, screen decode next, full res on zoom. Prefetch +/-2, LRU cache by (path, mtime, size),
  cancel on navigation.
- v1 features: folder navigation, filmstrip, zoom/pan, rotate, delete to Recycle Bin/Trash with undo,
  fullscreen, slideshow, info panel with map, copy, show in folder, open with, drag out, OS theme.
- Library bridge: "In your library" badge (MD5 + `/api/exists/`), people/caption/favourite from the
  server, "Upload to LibrePhotos" (enqueues into the **same upload queue** the mobile code runs).

### 4.3 Backup from desktop folders

This is mobile's backup engine with `MediaProvider` = folders. The user picks folders the way a phone
user picks albums; the existing hash pass, exists check, upload queue, gate and status UI run as on
mobile. Desktop-only additions: the tray shows progress and the engine runs with the window closed.

### 4.4 Standalone server integration

Detect a local server, start/stop it as a managed child, later move the tray role from pystray into the
desktop app. The standalone stays a separate download.

## 5. Platform specifics

### File associations and default app

- `bundle.fileAssociations` for jpg, jpeg, png, gif, webp, heic, heif, avif, jxl, tiff, bmp and RAW
  (cr2, cr3, nef, arw, dng, orf, rw2, raf), `role: Viewer`, `rank: Alternate`.
- **Windows 11**: register ProgIDs + `Capabilities\FileAssociations` + `RegisteredApplications` so the
  app is listed under "Open with" and Default apps. The app cannot make itself the default (UserChoice
  hash + UCPD), so first run offers a button to `ms-settings:defaultapps?registeredAppUser=LibrePhotos`.
- **macOS**: `CFBundleDocumentTypes`/UTIs; files arrive as `RunEvent::Opened`. Prototype single-instance
  plus Opened early.
- **Linux**: `.desktop` `MimeType=`; first run can run `xdg-mime default` on request.

### Packaging, signing, updates

| | Windows | macOS | Linux |
|---|---|---|---|
| Package | NSIS (per-user) + MSI; winget | `.dmg` | AppImage, `.deb`/`.rpm`, Flathub later |
| Signing | SignPath Foundation (free for OSI projects) or OV cert; Azure Artifact Signing is US/CA only for individuals | Developer ID ($99/yr) + notarization (`tauri-action`) | none; Flathub builds from source |
| Updates | Tauri updater, minisign `latest.json` on GitHub Releases | same | AppImage via updater |

Release line `desktop-v0.x`, own workflow. Because the library window is the mobile JS, desktop and
mobile must stay compatible with the same server versions; the existing `/api/sync/*` contract tests
(`live.contract.test.ts`) cover both.

### Licensing

libheif and libde265 (LGPL, dynamically linked; HEVC patents are the usual grey area), rawler LGPL-2.1,
LibRaw LGPL/CDDL. Check against the repo license before the viewer ships.

## 6. Risks

1. **expo-sqlite on web inside a webview.** It needs cross-origin isolation (COOP/COEP) and a wasm
   worker; storage lives in the webview profile (OPFS/IndexedDB), not a file we control, and WebKit's
   OPFS support differs from Chromium's. Tests: open, migrate, 50k-row seed, live query storm, quota,
   survive app update. Fallback if it fails: keep the sync `AppDatabase` contract and back it with
   `@sqlite.org/sqlite-wasm` (OPFS) ourselves, or move the sync engine into a Node/Bun sidecar on
   `better-sqlite3` (which the tests already use), at a much higher cost.
2. **COEP vs images.** Cross-origin isolation blocks cross-origin images without CORP. Serving all
   server media through `lpmedia://` (same origin to the app) avoids it; verify early.
3. **WebKitGTK on Linux**: NVIDIA/Wayland blank windows, silent software WebGL, distro-dependent codecs.
   Spike on Ubuntu + Fedora with NVIDIA. Fallback: Electron with the same JS.
4. **Phone UX on a desktop.** Phase 1 accepts it; desktop layouts are their own phase, and must not
   regress phones (the mobile CI and emulator screenshot harness cover that).
5. **Cold start** for the viewer: target < 400 ms warm (resident in tray), < 1 s cold.
6. **Signing** for a maintainer outside the US/Canada; **codec licensing**; Apple fee.
7. **Bridge security**: Tauri capabilities only for the app's own bundle; the optional web app window
   gets no IPC at all.

## 7. Incremental rollout

| Step | Scope | Exit criteria |
|---|---|---|
| **0. Does it run** (2-3 days) | `expo export -p web` of `apps/mobile` builds and runs in a browser against a dev server: list what breaks per screen. Then the same build inside a bare Tauri window with COOP/COEP headers, api-client on Tauri's `fetch`. | Login, initial seed, timeline, album and person screens work in Tauri on Windows; expo-sqlite web passes the risk-1 checks. Same run on macOS and Linux (NVIDIA). |
| **1. Mobile app on desktop** | `apps/desktop` scaffold, `lpmedia://` proxy + thumb cache, keychain tokens, `*.web.ts` seams that are enough for read-only use. CI builds unsigned artifacts. | A developer can test sync, offline browsing, outbox mutations (favourite, album edits, trash) on desktop against a real server. Mobile tests unchanged and green. |
| **2. Backup from folders** | `tauri-media-provider`, Rust MD5 hasher, Rust upload transport, probe; tray progress. | A 50k-file folder backs up through mobile's engine, resumes after restart, no duplicates. The same engine change is visible in mobile tests. |
| **3. Local viewer** | `viewer/` entry, `lpview://` decoders, file associations, single instance, default-app helper, library badge. | Opens every format in the test corpus, < 400 ms warm, 10k-file folders fine. |
| **4. Desktop layouts** | Wide layouts for the library (sidebar, multi-column, shortcuts, hover). Also improves tablets. | Phone screenshots unchanged in the emulator harness. |
| **5. Ship** | Signing, updater, NSIS/dmg/AppImage, docs page `installation/desktop.md`, standalone detection, winget/Flathub. | First public `desktop-v0.1`. |

Steps 1 and 2 are useful to the project even if 3-5 never happen: they turn the desktop into a test bed
for the mobile app's whole data layer.

## 8. Open questions for the maintainer

1. Name: "LibrePhotos" for the desktop app and the standalone, or "LibrePhotos Desktop" so the two
   downloads are not confused?
2. Should the desktop build live inside `apps/mobile` (one more build target, closest coupling) or as
   `apps/desktop` consuming `apps/mobile` (cleaner ownership, the plan's default)?
3. Is a viewer without any server a first-class mode, or should first run push towards a server?
4. Signing budget: SignPath Foundation application vs an OV certificate; Apple Developer ID for v1?
5. Should the desktop app eventually replace the Windows standalone's tray/launcher?
6. Linux priority if the WebKitGTK spike is poor: Electron for Linux, viewer-only, or hold Linux?

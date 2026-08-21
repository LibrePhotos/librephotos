# LibrePhotos Mobile v2

The official LibrePhotos mobile app, rebuilt on **Expo (SDK 54, New
Architecture)** with an **offline-first, device-mirrored** data model. It
replaces the legacy `apps/mobile` (bare React Native 0.72 + NativeBase), which
is frozen and removed in a follow-up once v2 ships on all channels.

The design goal: feature parity with the web frontend for everything that makes
sense on a phone, plus mobile-only superpowers — camera-roll backup and fully
offline browsing.

## Architecture

The full design lives in [`plans/mobile-v2/`](../../plans/mobile-v2/). Start
with the [plan README](../../plans/mobile-v2/README.md); the docs below map each
subsystem to its plan chapter.

### Mirror-first reads

Synced content (photos, albums, people, sharing) renders from a **local SQLite
mirror** of the server database, via `expo-sqlite` + Drizzle ORM with
`useLiveQuery` for reactive screens. The network is used only to *converge* the
mirror and to fetch image bytes — never on the read path. The rule (enforced
per screen): **synced entities render from SQLite; everything else renders
through TanStack Query. A screen never mixes both for the same entity.** See
[01-architecture.md](../../plans/mobile-v2/01-architecture.md) and the schema in
[02-local-database.md](../../plans/mobile-v2/02-local-database.md).

### Sync engine

Keyset-paginated pull endpoints (`updated_after` cursors) plus a server-side
tombstone table (`DeletionLog`) converge the mirror. The client seeds from the
existing paginated endpoints, then applies deltas; an integrity snapshot
compares per-table row counts against a server counts endpoint and schedules a
reseed on drift. The mirror is disposable — a reseed is always a safe recovery.
See [03-sync-engine.md](../../plans/mobile-v2/03-sync-engine.md) and the backend
contract in [04-backend-sync-api.md](../../plans/mobile-v2/04-backend-sync-api.md).

### The job queue (`src/sync/jobs/`)

Sync is **driven by a durable, SQLite-backed job queue**, not by a sequence of
awaits. This is load-bearing, and the reasons are worth knowing before changing
it — the previous design was a strict chain (outbox → remote delta → device
scan → hashing → uploads → thumbs), and on a real 2867-photo library it failed
three ways at once: hashing stalled behind a full camera-roll enumeration,
uploads never began because they sat last behind the slowest steps, and the only
record of progress was the JS call stack, so a reload restarted everything.

- **`job_queue` table** — `kind`, `payload`, `state`
  (`pending|running|done|failed`), `priority`, `attempts`, `next_attempt_at`,
  `last_error`. Shaped like the `outbox` and `upload_queue` tables that already
  worked this way. A **partial unique index** on `dedupe_key` over
  `(pending|running)` makes re-enqueuing the same work a no-op, so the triggers
  can fire as often as they like.
- **Job kinds**, each sized to finish *well under a second*: `outbox_replay`,
  `reseed_check`, `remote_delta` (one page), `device_scan` (one chunk of ~400
  assets), `hash_batch` (~50 md5s), `upload_asset` (one photo),
  `thumb_prefetch`, `integrity_check`. If a unit can exceed a second, split it —
  that budget is what keeps the UI responsive and makes an interrupted run cheap.
- **Worker** (`jobs/worker.ts`) — claims the next eligible job inside a
  transaction (so a claim is exclusive), runs it, records the outcome, applies
  whatever the job chained, yields a macrotask, repeats. Concurrency is a
  constant, currently 1.
- **Boot reclaim** — a `running` row can only be residue from a killed process,
  so the first worker start of a process reverts them all to `pending`, with the
  attempt refunded.
- **Priorities**: `outbox_replay` (10) < `reseed_check` (15) < `remote_delta`
  (20) < the background band (60) < `thumb_prefetch` (90) < `integrity_check`
  (95). **`device_scan`, `hash_batch` and `upload_asset` deliberately share
  priority 60.** Each enqueues its own continuation, so distinct priorities
  would let the best-ranked one monopolise the worker — the strict chain
  re-implemented in data. Sharing one priority makes the tie-break insertion
  order, so the three round-robin and uploads begin *while* hashing runs.
- **Chaining**: a `device_scan` chunk enqueues the next chunk plus a
  `hash_batch`; a `hash_batch` opens an `upload_asset` window over whatever it
  just made uploadable plus its own continuation. Nothing waits for a
  predecessor to *finish*, only for it to *produce something*.

`syncAll()` enqueues and drains; `runSync`, `runBackupNow`, `repairSync`,
`cancelSync` and the triggers are unchanged for callers. The regression tests
live in `src/sync/jobs/__tests__/chaining.test.ts` and
`src/sync/__tests__/pipeline.test.ts` — they pin resume-after-reload and
uploads-during-hashing, so read them before touching the chaining rules.

### Outbox (offline mutations)

Mutations (favorite, hide, trash/restore, rating, album add/remove, caption,
person rename) apply **optimistically to the mirror** inside a transaction that
also inserts an `outbox` row, so live queries update the UI instantly. A FIFO
replay drains the outbox when online. Success deletes the row; a 4xx drops it
and lets the next delta restore server truth; a network error keeps it and
backs off. Delta pulls never run while an entity has pending outbox rows —
replay-first, last-write-wins with server authority, no merge logic.

### The photo viewer (`src/features/viewer/`)

The mobile answer to the web lightbox. The full capability-by-capability
comparison — 27 shipped, 12 adapted, 18 deferred with reasons — is
[07-lightbox-parity.md](../../plans/mobile-v2/07-lightbox-parity.md). Three
things are worth knowing before changing it:

- **The info surface is a draggable bottom sheet, not a sidebar.** A phone has
  no room for the web's 400px column. `src/components/BottomSheet.tsx` is
  ~120 lines of gesture-handler + reanimated rather than a sheet library,
  because the hoisting rules below make every new package a real risk. Only the
  grabber pans, so the ScrollView inside never fights it.
- **Three data tiers, three offline states, no blanks.** The mirror
  (`remote_photo`, album membership) is always available; the cached
  `remote_photo_detail` payload carries EXIF, people with face boxes, similar
  photos and the AI caption, so those work offline *once the photo has been
  opened online*; anything else is an online-only control that renders disabled
  with a reason. A section that has nothing to show says so — it never
  disappears, because a missing section reads as "this photo has no camera".
- **The map is OpenStreetMap raster tiles fetched as images**, not a map
  module. `react-native-maps` / `expo-maps` need a dev build, and an iOS dev
  build needs the Apple Developer Program this project declined — adding one
  would make the app unopenable in Expo Go. Tapping hands off to the platform
  maps app.

Mutations follow the outbox rule: caption, rating, favorite, hide, trash,
album add/remove and person rename go through `useMutations()`; timestamp edit
and make-public are direct api-client calls, disabled offline.

### Backup

Camera-roll assets are enumerated with `expo-media-library`, hashed with native
MD5 (`expo-file-system` `getInfoAsync(uri, { md5: true })`) to match
LibrePhotos' `md5(bytes) + user.id` file-hash scheme with zero custom native
code, and joined against the server mirror by content hash. The timeline is a
SQL `UNION` of remote assets and not-yet-uploaded local assets. A serial,
wifi/charging-aware upload queue (a table, so it survives restarts) checks
`/api/exists/{hash}` then uploads via the chunked upload endpoints, sending
device timestamps so the server can date EXIF-less photos correctly.

**Hashing never downloads.** `getAssetInfoAsync` defaults to
`shouldDownloadFromNetwork: true`, and on an iPhone with iCloud Photos +
"Optimise iPhone Storage" that made every md5 pull a multi-megabyte original
down the wire first — measured at ~1.8 s per photo, against ~10 ms of actual
hashing. The hash pass now asks with `shouldDownloadFromNetwork: false` (the
only mode in which iOS populates `isNetworkAsset`) and parks anything not on
the device as `local_asset.hash_state = 'icloud'`. Those assets are queued for
upload *unhashed* and sorted last; the upload worker fetches each one once via
the `materialize` seam, which returns the bytes' md5 so a single download feeds
the hash, the `/api/exists` dedupe check and the upload. Every iCloud download
is therefore behind the backup toggle and the Wi-Fi/charging gate, and the
Backup screen names the state rather than showing a stalled bar.

### Local database

Drizzle schema, checked-in SQL migrations, and query layer in `src/db/`.
Migrations are generated with `drizzle-kit` and inlined into a TS module so the
runtime has no filesystem dependency (see "Regenerating migrations" below).

## Dev setup

### Prerequisites

- **Node 22** via [`fnm`](https://github.com/Schniz/fnm). All commands below
  assume `fnm exec --using=22 -- <cmd>`.
- On **Windows**, invoke the `.cmd` shims: `npm.cmd` / `npx.cmd` (bare `npm` /
  `npx` may not resolve under some shells).
- **Android**: Android Studio + an emulator or a device. **iOS**: a Mac with
  Xcode (iOS dev builds go through EAS).
- **Android emulator requires hardware virtualization.** x86/x86_64 system
  images cannot boot without an acceleration backend (WHPX, AEHD/GVM, or
  HAXM), and every backend needs virtualization enabled in firmware — `SVM
  Mode` on AMD, `VT-x` on Intel. Check with `emulator -accel-check`; on
  Windows, `systeminfo` must report *Virtualization Enabled In Firmware: Yes*.
  If it says No, enable it in the BIOS/UEFI — no emulator flag works around
  it. A USB device with debugging enabled needs none of this.
  **Compiling** the app (`gradlew assembleDebug`) does not require
  virtualization; only *running* an emulator does.

### Install

This app is an npm **workspace**. Install from the **repo root** so the root
`package-lock.json` stays authoritative:

```bash
cd <repo-root>
fnm exec --using=22 -- npm.cmd ci        # or: npm install
```

### Run it

Every native module the app uses is one **Expo Go** bundles, and the project
is held at SDK 54 precisely so the App Store build of Expo Go can open it
(see "Dependency constraints"). `expo-dev-client` is installed, so
`expo start` defaults to dev-build mode — pass `--go` (or press `s` in the
interactive prompt) for Expo Go:

```bash
cd apps/mobile-v2
fnm exec --using=22 -- npx.cmd expo start --go   # scan the QR with Expo Go
```

A [dev build](https://docs.expo.dev/develop/development-builds/introduction/)
is still the better target for native work (custom native modules, the iOS
share extension, background tasks under load) — on Android it needs nothing
but a device or emulator; on iOS it needs a paid Apple Developer account:

```bash
fnm exec --using=22 -- npx.cmd expo run:android   # builds + installs a dev build
fnm exec --using=22 -- npx.cmd expo start --dev-client
```

> **Note:** no `expo start` / Metro run happens in CI — CI only typechecks,
> lints, and tests. Native project folders (`android/`, `ios/`) are **not** in
> git; they are generated on demand by `expo prebuild` (Continuous Native
> Generation). All native config lives in `app.json`.

## Tests

Jest runs **two projects** (configured in `jest.config.js`):

- **`rn`** — component/hook tests under `jest-expo` + React Native Testing
  Library.
- **`node`** — DB and sync-engine tests against **real SQLite**
  (`better-sqlite3` under Node), so merged-timeline SQL and outbox replay are
  tested for real, not mocked.

```bash
cd apps/mobile-v2
fnm exec --using=22 -- npm.cmd run test        # both projects
fnm exec --using=22 -- npm.cmd run typecheck   # tsc --noEmit
fnm exec --using=22 -- npm.cmd run lint         # eslint (flat config)
fnm exec --using=22 -- npm.cmd run check        # typecheck + lint + test
```

The shared API package has its own suite:

```bash
cd packages/api-client
fnm exec --using=22 -- npx.cmd vitest run       # zod schema + endpoint contract tests
```

## Regenerating migrations

After changing the Drizzle schema in `src/db/`, regenerate the checked-in SQL
migrations and the inlined runtime module:

```bash
cd apps/mobile-v2
fnm exec --using=22 -- npm.cmd run db:generate
```

This runs `drizzle-kit generate` (writes `src/db/migrations/`) and then
`scripts/inline-migrations.mjs`, which bundles the SQL into
`src/db/migrations-sql.ts`. Commit both. The command is idempotent — if the
schema already matches the migrations it is a no-op. A CI-style "schema matches
migrations" check is just running this and confirming a clean `git status`.

## Dependency constraints

These are load-bearing — changing them breaks the build or tests:

- **Expo SDK 54 is a ceiling, not a starting point.** The App Store build of
  **Expo Go for iOS is capped at client 54.0.2**, and an Expo Go client can
  only open projects on its own SDK. Moving to SDK 55+ therefore means the app
  can no longer be opened on an iPhone with Expo Go at all — the only
  alternative is an iOS [dev build](https://docs.expo.dev/develop/development-builds/introduction/),
  which requires the **$99/yr Apple Developer Program** (declined). So: bump
  the SDK only together with a decision about how iOS gets tested. Android has
  no such constraint (Expo Go is sideloadable and dev builds are free), but the
  SDK must stay a single number for both platforms. Take versions from Expo's
  own bundled-module list (`npx expo install --fix`), never by hand, and keep
  `npx expo install --check` clean.
- **`expo-media-library` has no `/legacy` subpath on SDK 54** — its classic
  `getAssetsAsync`/`getAlbumsAsync` API *is* the main entry, and the rewrite
  sits behind `expo-media-library/next`. `expo-file-system` is the opposite:
  the new API is the main entry and the app imports
  `expo-file-system/legacy`. Both flip in later SDKs, so these two imports are
  the first thing to re-check on any SDK bump.
- **zod v3**, not v4. `packages/api-client` pins `zod@^3` and its peer range is
  `^3.23.0`. The schemas rely on v3 semantics; do not bump to v4.
- **Single `@types/react`**. React types must resolve to **one** copy across the
  workspace (mobile-v2 and api-client both pin `~19.2.x`). A duplicate
  `@types/react` produces spurious JSX type errors — dedupe if `tsc` starts
  complaining about incompatible `ReactNode`s.
- **Jest module mappers use `require.resolve`**. `jest.config.js` maps some
  packages by absolute resolved path (via `require.resolve`) rather than by
  name so both jest projects load the same physical copy. Keep new mappings in
  that style.
- **React is pinned to `19.1.0`** in `apps/mobile-v2` *and* at the workspace
  root — the version Expo SDK 54 / react-native 0.81.5 ship with. `jest-expo@54`
  depends on `react-test-renderer@19.1.0`, and jest-expo refuses to run unless
  `react-test-renderer` matches `react` exactly — bumping React alone fails
  every `rn` suite with *"Incorrect version of react-test-renderer detected"*.
  Move `react`, `react-dom`, and `react-test-renderer` together, in both
  manifests, and keep `packages/api-client`'s `react`/`@types/react` dev ranges
  wide enough to resolve to the same copies.
- **`expo` and `expo-router` are declared at the workspace root** purely so npm
  hoists them. The Expo CLI hoists to the root, but npm nests this app's
  `expo-*` packages, and the root CLI's typed-route generator then cannot
  resolve `expo-router/_ctx-shared` — `expo start` crashes before Metro serves
  anything. `expo` needs the same treatment because `expo-router` peer-depends
  on `expo: "*"`: without a pin npm satisfies that peer with the *latest* expo
  (a newer SDK) at the root and nests the app's copy, leaving the root CLI a
  different SDK from the app. Do not delete the root
  `expo`/`expo-router`/`react`/`react-dom` entries; they are load-bearing and
  documented inline in the root `package.json`.
- **The root `overrides` block keeps native modules single-copy.** npm
  auto-installs the root `expo-router`'s open-ended peers
  (`react-native-screens: *`, `react-native-safe-area-context: >= 5.4.0`) at
  their newest versions, which put a second copy of both next to the versions
  SDK 54 bundles — expo-router would then resolve different screens/safe-area
  modules than the app. The overrides pin one copy of each.
- **`babel-preset-expo` is a direct devDependency** even though `expo` already
  depends on it. It peer-depends back on `expo`, so npm resolves that cycle by
  nesting it inside `node_modules/expo`, where Babel — resolving presets
  relative to `apps/mobile-v2/babel.config.js` — cannot find it, and every jest
  suite dies with *"Cannot find module 'babel-preset-expo'"*. Keep its range in
  step with the SDK.
- **`.sql` migrations need two pieces of config.** `metro.config.js` adds `sql`
  to `resolver.sourceExts` (so Metro resolves the imports in drizzle's
  generated `migrations.js`) **and** `babel.config.js` applies
  `babel-plugin-inline-import` for `.sql` (so Babel inlines them as strings
  instead of parsing SQL as JavaScript). With only the first, every bundle
  fails with a `TransformError`. Note the jest DB tests import the inlined
  `migrations-sql.ts` instead, so they stay green either way — only a real
  bundle catches this.

## App identity

Set in `app.json` and consumed by `expo prebuild` (there is no checked-in
manifest to edit):

| Field | Value |
| --- | --- |
| Display name | `LibrePhotos` |
| Android `package` | `com.librephotosmobile` |
| iOS `bundleIdentifier` | `com.librephotosmobile` |
| Deep-link `scheme` | `librephotos://` |

The Android package **deliberately matches the legacy `apps/mobile` app**
(`com.librephotosmobile`) so v2 ships as an **in-place Play Store update**
rather than a separate listing — existing users upgrade without reinstalling.
This requires signing with the **same upload key** as the legacy app. If the
project instead wants a clean-slate listing, change `android.package` *before*
the first store upload; afterwards it is immovable. The legacy iOS project
never moved off the React Native template identifier
(`org.reactjs.native.example.*`), so iOS carries no such constraint.

## F-Droid / FOSS

The app must stay publishable on F-Droid:

- **No OTA updates.** `expo-updates` is disabled for the FOSS flavor — F-Droid
  forbids remote code loading. OTA is Play/App Store only.
- **No push required.** Nothing in the app depends on Firebase/FCM or any push
  service. Server-change notifications are a deferred P2 and would only ship on
  the Google-services flavor.
- **Local notifications only** (`expo-notifications` scheduled locally) power
  the memories reminder — no server or push involvement.
- `expo prebuild` output is a plain Gradle project, so a Google-services-free
  foss flavor builds cleanly.

## Known deferred items

- **iOS share-extension** — the share *target* lands, but the native iOS share
  extension is wired at prebuild time and is not yet configured.
- **Multi-chunk resumable uploads** — uploads are chunked and the queue
  survives restarts, but resume currently restarts the in-flight chunk rather
  than resuming mid-chunk.
- **Per-thing/place/tag membership mirroring** — thing/place/tag *albums* are
  mirrored, but full per-photo membership for these auto-album types is not yet
  mirrored offline.

See [06-roadmap.md](../../plans/mobile-v2/06-roadmap.md) for the full phase and
risk breakdown.

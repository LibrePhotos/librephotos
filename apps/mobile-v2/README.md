# LibrePhotos Mobile v2

The official LibrePhotos mobile app, rebuilt on **Expo (SDK 57, New
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

### Outbox (offline mutations)

Mutations (favorite, hide, trash/restore, rating, album add/remove, caption,
person rename) apply **optimistically to the mirror** inside a transaction that
also inserts an `outbox` row, so live queries update the UI instantly. A FIFO
replay drains the outbox when online. Success deletes the row; a 4xx drops it
and lets the next delta restore server truth; a network error keeps it and
backs off. Delta pulls never run while an entity has pending outbox rows —
replay-first, last-write-wins with server authority, no merge logic.

### Backup

Camera-roll assets are enumerated with `expo-media-library`, hashed with native
MD5 (`expo-file-system` `getInfoAsync(uri, { md5: true })`) to match
LibrePhotos' `md5(bytes) + user.id` file-hash scheme with zero custom native
code, and joined against the server mirror by content hash. The timeline is a
SQL `UNION` of remote assets and not-yet-uploaded local assets. A serial,
wifi/charging-aware upload queue (a table, so it survives restarts) checks
`/api/exists/{hash}` then uploads via the chunked upload endpoints, sending
device timestamps so the server can date EXIF-less photos correctly.

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

### Run a dev build

The app uses native modules, so **Expo Go will not work** — you need a
[dev build](https://docs.expo.dev/develop/development-builds/introduction/)
(`expo-dev-client`):

```bash
cd apps/mobile-v2
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

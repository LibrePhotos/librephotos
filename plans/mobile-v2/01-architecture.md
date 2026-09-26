# 01 — App Architecture

## Stack

| Concern | Choice | Rationale |
| --- | --- | --- |
| Framework | **Expo, latest SDK at kickoff (SDK 53+), New Architecture on** | Officially recommended RN path; CNG keeps `android/`/`ios/` out of git; `expo-doctor` gives agents a checkable feedback loop |
| Language | TypeScript, strict | Same as frontend |
| Routing | **Expo Router** (file-based, typed routes) | Mirrors the frontend's TanStack Router file conventions; very legible for agents |
| Server state (mutations, non-mirrored reads) | **TanStack Query v5** | Already used by frontend and old mobile; hooks live in shared `packages/api-client` |
| Synced reads | **SQLite via `expo-sqlite` + Drizzle ORM** | Source of truth for timeline/albums/people; `useLiveQuery` for reactive screens; drizzle-kit migrations checked into the repo |
| Client state | **zustand** | Already used in old mobile; small |
| UI | **NativeWind** (Tailwind for RN) + small in-house component set | No dependency on a component-kit vendor (NativeBase burned us); agents are exceptionally fluent in Tailwind. Fallback option: react-native-paper |
| Lists | `@shopify/flash-list` v2 | Already proven in old app for 100k-item timelines |
| Images | **`expo-image`** | Built-in disk cache, blurhash/thumbhash placeholders, priority control |
| Video | `expo-video` | Replaces dead react-native-video 5.x |
| Auth storage | `expo-secure-store` | JWT access/refresh tokens (LibrePhotos JWT auth), never AsyncStorage |
| Media library | `expo-media-library` | Camera-roll enumeration for backup/local tracking (doc 03) |
| Hashing | `expo-file-system` (`getInfoAsync(uri, { md5: true })`) | Native MD5 → matches LibrePhotos `File.hash` scheme with zero custom native code |
| Background | `expo-background-task` + `expo-task-manager` | WorkManager / BGTaskScheduler; see doc 03 §7 |
| i18n | i18next + react-i18next | Same stack as today; locales come from Weblate |

Explicitly avoided: WatermelonDB (its sync protocol doesn't fit our
server-authoritative model and adds a native dependency; Drizzle + expo-sqlite
covers live queries and migrations), Realm (heavy, vendor-coupled), moment
(use `dayjs`), NativeBase/gluestack (discontinued / churn risk).

## Monorepo layout

```
monorepo/
  apps/
    frontend/            # unchanged, later adopts packages/api-client
    mobile/              # legacy app, frozen; deleted after v2 ships
    mobile-v2/
      app/               # Expo Router routes (see below)
      src/
        components/      # UI primitives + shared composites
        db/              # drizzle schema, migrations, queries (doc 02)
        sync/            # sync engine (doc 03)
        stores/          # zustand stores (ui state, settings)
        theme/
        i18n/
      assets/
      app.json           # Expo config — the only "native" config surface
      eas.json
      package.json
  packages/
    api-client/          # NEW — shared between frontend + mobile-v2
      src/
        schemas/         # zod schemas per entity (single source of truth for API types)
        endpoints/       # thin fetch wrappers (platform-agnostic, injectable fetch/baseURL/token)
        hooks/           # TanStack Query hooks
```

Rules:

- **No `android/` or `ios/` directories in git.** Native projects are generated
  by `expo prebuild` (CNG). All native configuration goes through `app.json`
  and config plugins. This is the core agent-friendliness win.
- `packages/api-client` must be React-DOM-free and RN-free: zod + TanStack
  Query only, with `fetch`, base URL, and token supplier injected at app init.
  The web app and mobile app each provide their own transport config (cookies
  vs Authorization header).
- Migration path for `api-client`: extract from the two existing
  `src/api_client` trees (they are near-identical), mobile-v2 consumes it from
  day one, frontend switches over in a separate PR once stable.

## Routing map (Expo Router)

```
app/
  _layout.tsx                 # providers: QueryClient, SQLite/Drizzle, theme, i18n
  (auth)/
    login.tsx                 # server URL + credentials (self-hosted: URL field first)
  (tabs)/
    _layout.tsx               # bottom tabs: Photos, Albums, Search, Upload/Backup, Profile
    photos/
      index.tsx               # merged timeline (remote + local-only)
      favorites.tsx  hidden.tsx  deleted.tsx  videos.tsx  recent.tsx  notimestamp.tsx
    albums/
      index.tsx               # hub: People / Places / Things / My Albums / Events / Tags / Folders
      user/[id].tsx  events/[id].tsx  people/[id].tsx  places/[id].tsx  things/[id].tsx  tags/[id].tsx  folders/[id].tsx
    search/index.tsx
    backup/index.tsx          # backup status, queue, album selection
    profile/index.tsx         # profile, settings, sharing hub, admin-lite
  photo/[id].tsx              # full-screen viewer (modal presentation)
  sharing/...                 # by-me / with-me / links
```

Screen data rule: **synced entities render from SQLite (Drizzle live
queries); everything else renders through TanStack Query.** A screen never
mixes both for the same entity. Doc 05 tags every screen with its data source.

## Images & offline media

- All thumbnails go through `expo-image` with `cachePolicy: 'disk'`; auth
  header injected globally.
- Offline guarantee needs more than opportunistic caching: a `thumb_cache`
  table (doc 02) tracks explicitly prefetched small thumbnails
  (target: every photo in the mirror gets its grid thumb prefetched, LRU-capped,
  configurable e.g. 2 GB). Full-res originals are fetch-on-demand, with an
  explicit "keep offline" flag per album as a later feature.
- Local-only assets render straight from the camera roll via `ph://` /
  `content://` URIs — no network involved.

## Testing

- **Unit/component**: jest-expo + React Native Testing Library. The sync
  engine and DB layer get the densest coverage (pure TS, no UI): diffing,
  cursor handling, outbox replay, hash matching.
- **DB tests** run against real SQLite (better-sqlite3 driver under Node) so
  merged-timeline SQL is tested for real, not mocked.
- **E2E**: Maestro flows for the golden paths (login → timeline → viewer →
  favorite; backup happy path) on EAS or local emulator.
- **Contract**: `packages/api-client` zod schemas double as runtime validators;
  a CI job replays recorded server fixtures against them so server drift breaks
  loudly. Backend counterpart in doc 04 §6.

## Build & distribution

- **Dev**: `npx expo start` with a dev build (expo-dev-client). Works on
  Windows for Android; iOS dev builds via EAS.
- **CI**: GitHub Actions — typecheck, lint (eslint flat config), jest, drizzle
  migration check ("schema matches migrations"), expo-doctor.
- **Release**: EAS Build for Play Store + TestFlight/App Store.
- **F-Droid**: `expo prebuild` output is a plain Gradle project; publish a
  foss flavor with no Google services, no expo-updates OTA (F-Droid forbids
  remote code), keeping the FOSS story intact. Firebase/push not required by
  anything in this plan.
- OTA updates (expo-updates) only for Play/App Store builds, never F-Droid.

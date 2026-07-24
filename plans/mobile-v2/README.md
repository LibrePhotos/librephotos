# LibrePhotos Mobile v2 — Expo + Offline-First Sync

Plan for rebuilding the LibrePhotos mobile app on Expo with an offline-first,
device-mirrored database and Immich-style sync. Target: feature parity with the
web frontend for everything that makes sense on a phone, plus mobile-only
superpowers (camera-roll backup, offline browsing).

## Documents

| Doc | Contents |
| --- | --- |
| [01-architecture.md](01-architecture.md) | Expo app architecture: stack, project structure, shared packages, UI kit, i18n, testing, builds/distribution |
| [02-local-database.md](02-local-database.md) | On-device SQLite schema: server mirror tables, local (camera roll) tables, merged timeline queries |
| [03-sync-engine.md](03-sync-engine.md) | Client sync engine: seed, delta, device media tracking, hashing, upload queue, offline mutations (outbox), background tasks |
| [04-backend-sync-api.md](04-backend-sync-api.md) | Django changes: tombstones, delta endpoints, serializers, tests |
| [05-feature-parity.md](05-feature-parity.md) | Route-by-route parity matrix against the web frontend, with priorities and mobile-specific UX notes |
| [06-roadmap.md](06-roadmap.md) | Phases, milestones, risks, open questions |

## Executive summary

- **Framework**: Expo (latest SDK, New Architecture), TypeScript, Expo Router,
  built as `apps/mobile-v2` in the monorepo. The old `apps/mobile` (bare RN
  0.72 + NativeBase) is retired, not migrated in place.
- **Offline model**: the app renders synced content from a local SQLite mirror
  of the server DB (photos, albums, people, sharing). The network is only used
  to *converge* the mirror and to fetch image bytes. This is the architecture
  Immich converged on after several rewrites, adapted to LibrePhotos.
- **Local images**: camera-roll assets are tracked in their own tables and
  joined against the server mirror **by content hash**. LibrePhotos' file hash
  is `md5(bytes) + user.id` (`api/models/file.py:193`), and Expo computes MD5
  natively (`expo-file-system getInfoAsync(uri, { md5: true })`) — so
  local↔remote matching needs **no custom native code**. The timeline is a SQL
  `UNION` of remote assets and not-yet-uploaded local assets (Immich's
  `mergedAsset` pattern).
- **Sync protocol**: keyset-paginated pull endpoints
  (`updated_after` cursors) + a tombstone table on the server. Deliberately
  simpler than Immich's streaming/ack protocol; upgradeable later. `Photo`
  already has an indexed `last_modified` (auto_now), so the biggest table is
  nearly sync-ready today.
- **API sharing**: a new `packages/api-client` package (zod schemas +
  TanStack Query v5 hooks) shared between `apps/frontend` and `apps/mobile-v2`
  — both already use react-query v5 + zod, and their `src/api_client` trees are
  ~90% duplicated today.
- **Biggest cost center**: the backend sync API (doc 04). The mobile client is
  mostly assembly of well-supported Expo primitives; the server needs new
  endpoints, tombstones, and `last_modified` columns on a few models.

## Non-goals

- No live collaboration/CRDTs — last-write-wins with server authority is fine
  for a photo manager.
- No offline ML (face detection etc. stays server-side).
- Web-only frontend features (admin console, dataviz statistics pages) are
  P2/out of scope; see doc 05.
- No changes to the web frontend beyond adopting `packages/api-client`.

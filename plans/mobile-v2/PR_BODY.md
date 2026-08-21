# feat: mobile v2 — Expo rewrite with offline-first sync

## Summary

Rebuilds the official LibrePhotos mobile app from scratch as `apps/mobile-v2`:
an **Expo (SDK 57, New Architecture)** app with an **offline-first,
device-mirrored** data model. Synced content renders from a local SQLite mirror
of the server; the network is used only to converge that mirror and to fetch
image bytes. Adds a shared `packages/api-client` (zod schemas + injectable
transport + TanStack Query hooks) and the backend delta-sync API the mirror
converges against.

The legacy `apps/mobile` (bare RN 0.72 + NativeBase) is untouched here and is
removed in a follow-up once v2 ships on all channels.

Full design docs: [`plans/mobile-v2/`](https://github.com/LibrePhotos/librephotos/blob/feat/mobile-v2/plans/mobile-v2/README.md).

## Architecture

- **Mirror-first reads** — photos, albums, people, and sharing live in on-device
  SQLite (`expo-sqlite` + Drizzle, `useLiveQuery`). Synced entities render from
  SQLite; everything else through TanStack Query; a screen never mixes both for
  one entity. ([01-architecture.md](https://github.com/LibrePhotos/librephotos/blob/feat/mobile-v2/plans/mobile-v2/01-architecture.md),
  [02-local-database.md](https://github.com/LibrePhotos/librephotos/blob/feat/mobile-v2/plans/mobile-v2/02-local-database.md))
- **Sync engine** — keyset-paginated `updated_after` pull endpoints + a
  server-side `DeletionLog` tombstone table. Seed → delta → integrity snapshot
  (per-table counts vs server); drift schedules a reseed. The mirror is
  disposable, so reseed is always a safe recovery.
  ([03-sync-engine.md](https://github.com/LibrePhotos/librephotos/blob/feat/mobile-v2/plans/mobile-v2/03-sync-engine.md))
- **Outbox** — offline mutations apply optimistically to the mirror inside a
  transaction that also queues an outbox row; a FIFO replay drains it when
  online. Delta pulls hold off while an entity has pending rows —
  replay-first, last-write-wins with server authority, no merge logic.
- **Backup** — camera-roll assets (`expo-media-library`) hashed with native MD5
  to match LibrePhotos' `md5(bytes)+user.id` scheme, joined to the mirror by
  content hash; merged timeline is a SQL `UNION` of remote + local-only assets.
  A restart-surviving, wifi/charging-aware upload queue checks
  `/api/exists/{hash}` then chunk-uploads with device timestamps.
- **Shared API client** — `packages/api-client` is RN- and React-DOM-free (zod
  + TanStack Query, injectable fetch/baseURL/token), consumed by mobile-v2 now
  and by the frontend in a later PR.
  ([04-backend-sync-api.md](https://github.com/LibrePhotos/librephotos/blob/feat/mobile-v2/plans/mobile-v2/04-backend-sync-api.md),
  [05-feature-parity.md](https://github.com/LibrePhotos/librephotos/blob/feat/mobile-v2/plans/mobile-v2/05-feature-parity.md))

## Features by phase

- **Phase 0 — Foundations**: Expo Router + NativeWind + Drizzle scaffold;
  `packages/api-client` extracted; server-URL + JWT login with secure-store and
  token refresh; online query-backed timeline.
- **Phase 1 — Offline reads**: Drizzle schema + migrations; seeder + thumb
  prefetch cache; timeline, viewer, favorites/hidden/trash/videos/recent, user
  + auto albums, people — all from SQLite. Airplane-mode browse.
- **Phase 2 — Delta sync**: backend `last_modified` audit, `DeletionLog`,
  `/api/sync/*` feeds + counts; client cursors, delta applier, integrity check,
  sync-status screen.
- **Phase 3 — Local assets & backup**: device media sync + MD5 pipeline; merged
  timeline with upload badges; upload queue + backup settings (album selection,
  wifi/charging); device-timestamp upload fallback.
- **Phase 4 — Offline mutations & background**: outbox + replay with optimistic
  mirror writes (favorite, hide, trash/restore, rating, album add/remove,
  caption, person rename); `expo-background-task` registration.
- **Phase 5 — Parity & release scaffolding**: sharing hub (by-me / with-me /
  public links + revoke), face list/tagging, places/things/tags album grids,
  search (server + offline fallback), memories card + local-notification
  reminder, share target, profile/settings/admin-lite, stats, i18n string base
  + legacy-translation import script.

## Backend API additions

- **Models / tombstones**: new `DeletionLog` tombstone model; `last_modified`
  added to `AlbumAuto`, `AlbumPlace`, `AlbumThing`, `AlbumUser`, `Person`,
  `Tag`, `Photo`, `User`. Signals bump `last_modified` on mutation and record
  tombstones; a cleaning-service prune step ages tombstones out. Migration
  `0138_deletionlog_albumauto_last_modified_and_more`.
- **Delta-sync feeds** (`api/views/sync.py`, `api/serializers/sync.py`):
  `GET /api/sync/photos`, `/api/sync/persons`, `/api/sync/albums/{user,auto,thing,place,tag}`,
  `/api/sync/sharing`, and `/api/sync/counts` — all keyset-paginated by
  `updated_after`, returning tombstones alongside upserts.
- **Upload**: device filesystem/media timestamps in the upload completion
  payload so EXIF-less photos are dated correctly instead of by upload time
  (issue #614).
- **Tests**: `api/tests/test_sync_api.py` (convergence + visibility +
  tombstone coverage).

## Test totals

- **mobile-v2 jest**: 188/188 passing, 40 suites, 2 projects (`rn` +
  `node`-real-SQLite).
- **api-client vitest**: 25/25 passing (3 files).
- **backend**: 1938 passing (full `api.tests` suite; 21 skipped, 2 expected
  failures).

## Verification matrix

| Component | Gate | Result |
| --- | --- | --- |
| packages/api-client | tsc `--noEmit` | pass |
| packages/api-client | eslint | pass |
| packages/api-client | vitest | 25/25 |
| apps/mobile-v2 | tsc `--noEmit` | pass |
| apps/mobile-v2 | eslint | pass |
| apps/mobile-v2 | jest (rn + node) | 188/188 |
| apps/mobile-v2 | `db:generate` idempotent | pass (no diff) |
| apps/backend | full `api.tests` suite | 1938 OK |
| apps/docs | `yarn build` (onBrokenLinks: throw) | pass |

## CI

New `.github/workflows/mobile-v2.yml` (path-filtered to `apps/mobile-v2/**`,
`packages/**`, and root manifests): Node 22, single `npm ci` at the workspace
root, then typecheck + lint + jest for `apps/mobile-v2` and typecheck + lint +
vitest for `packages/api-client`. No existing jobs modified.

## Issues

Closes #784, Closes #761, Closes #614, Closes #783, Closes #760

- **#762** and **#782** close in the follow-up that removes `apps/mobile`
  (migrate-to-TS and MANAGE_EXTERNAL_STORAGE are moot once the legacy RN app is
  gone — v2 is strict TS on the Expo permission model).
- **Partially addressed** (kept open, scope shrunk): **#591** — in-app face-ID
  tagging UI lands; **#843** — memories now surface via a local-notification
  reminder (server-side memories backend remains a prerequisite for the rest);
  **#924** — the native app resolves the driver-remembering case; web
  "remember me" is unaffected.

## Deferred

- **iOS share-extension** — share *target* lands; the native iOS share
  extension is wired at prebuild and not yet configured.
- **Multi-chunk resume** — uploads are chunked and the queue survives restarts,
  but resume restarts the in-flight chunk rather than resuming mid-chunk.
- **Per-thing/place/tag membership mirroring** — those albums are mirrored, but
  full per-photo membership for these auto-album types is not yet offline.

See [06-roadmap.md](https://github.com/LibrePhotos/librephotos/blob/feat/mobile-v2/plans/mobile-v2/06-roadmap.md) for the full phasing,
risks, and issue-closure rationale.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

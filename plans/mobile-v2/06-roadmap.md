# 06 — Roadmap, Risks, Open Questions

## Phasing

Each phase ships something usable; sync sophistication grows underneath a
working app. Backend and mobile tracks can proceed in parallel from Phase 2.

### Phase 0 — Foundations
- Scaffold `apps/mobile-v2` (Expo, Router, NativeWind, Drizzle, CI, EAS dev builds).
- Extract `packages/api-client` from the two existing `api_client` trees
  (zod schemas + query hooks; frontend keeps its copy until Phase 5).
- Auth flow: server URL + JWT login, secure-store, token refresh interceptor.
- **Exit**: log in against a real server, see a query-backed (online) timeline
  page. This proves the whole toolchain end-to-end.

### Phase 1 — Offline read path (no server changes)
- Drizzle schema (doc 02), migrations, seed from **existing** paginated
  endpoints into the mirror; thumb prefetch cache.
- Timeline, viewer, favorites/hidden/trash/videos/recent filters, user +
  auto albums, people list — all rendering from SQLite.
- Refresh = re-seed (crude but correct; delta arrives in Phase 2).
- **Exit**: airplane-mode demo — browse full library, thumbnails included.

### Phase 2 — Delta sync (backend + client)
- Backend: doc 04 complete — `last_modified` audit, `DeletionLog`,
  `/api/sync/*` endpoints, counts endpoint, convergence tests.
- Client: cursors, delta applier, integrity check, sync status screen.
- **Exit**: mutations made on web appear on mobile in one sync cycle;
  convergence property test green in CI.

### Phase 3 — Local assets & backup
- Device media sync + MD5 hash pipeline + merged timeline with upload badges.
- Upload queue against existing `/api/exists` + chunked upload; backup
  settings UI (album selection, wifi/charging).
- **Exit**: fresh photo appears in timeline instantly, uploads, badge flips
  to synced after next delta.

### Phase 4 — Offline mutations & background
- Outbox + replay; optimistic mirror writes for the doc 05 "offline ✅" set.
- `expo-background-task` registration; iOS background upload sessions.
- **Exit**: favorite/trash/album-edit in airplane mode, reconnect, converge.

### Phase 5 — Parity fill & release
- P1 matrix items: sharing screens, face tagging (online), places/things/tags,
  share-sheet target, password reset.
- Frontend switches to `packages/api-client` (separate PR).
- Store releases (EAS), F-Droid foss flavor, migration notice in old app.
- Delete `apps/mobile` once v2 is on all three channels.

## Risks & mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Backend delta protocol subtly wrong (visibility, tombstones, M2M bumps) | **High** — this is where Immich bled | Convergence property test (doc 04 §6) from day one; versioned envelope; mirror is disposable → reseed is always a safe recovery |
| MD5-at-scale too slow via `getInfoAsync` | Medium | Measure early in Phase 3 spike; escape hatch = small Expo Module batch hasher (doc 03 §4); lazy-hash videos |
| Background limits disappoint users (backup "doesn't run") | High (OS reality) | Foreground-first UX, honest status screen, iOS background upload sessions; Android foreground-service plugin as P2 |
| iOS "limited photo access" breaks backup assumptions | Medium | Detect + prompt; sync only granted subset; explicit UI state |
| expo-media-library full-diff cost on 50k+ camera rolls | Medium | Metadata-only paged fetch + sorted merge (Immich-proven); fast-path count/updated checks skip unchanged albums |
| `packages/api-client` extraction destabilizes frontend | Low | Frontend adoption is last (Phase 5), behind its own PR + test suite |
| Old-app users' expectations during transition | Low | Keep old app functional until v2 P0+P1 ships; publish migration note |
| Weblate/i18n drift across three apps | Low | Single locale source in monorepo consumed by frontend + mobile-v2 |

## Open questions (decide before the phase that needs them)

1. **Phase 0**: NativeWind vs react-native-paper — spike both on the timeline
   grid + a settings screen; pick by DX and agent ergonomics.
2. **Phase 1**: thumbnail prefetch default cap (2 GB proposed) and which size
   variant LibrePhotos serves best for grid cells.
3. **Phase 2**: does `Person`/album models' mutation surface bump
   `last_modified` everywhere, or do we add explicit bumps per view? (Audit
   task in doc 04 §1.)
4. **Phase 3**: hash of *edited* iOS photos — PhotoKit returns adjusted or
   original bytes depending on request options; define which one matches what
   users upload via web (probably adjusted/current). Needs a device spike.
5. **Phase 5**: minimum supported server version handshake — add a
   `/api/sync` capability flag to `/api/site-settings` or version endpoint so
   the app can gate features per server.

## GitHub issue closures

Open issues in `LibrePhotos/librephotos` resolved by this plan (the archived
`librephotos-mobile`/`librephotos-frontend` trackers are disabled; everything
lives in the main repo). Close each when its phase ships, not before.

**Closable as fixed:**

| Issue | Closes after | Resolved by |
| --- | --- | --- |
| #784 — Back up only certain locations | Phase 3 | `backup_selection` per album (doc 02 §2, 03 §5) |
| #761 — Directory permission checker | Phase 3 | Permission request + limited-access degrade (doc 03 §4) |
| #783 — Background uploading | Phase 4 | Background task + iOS background upload sessions (doc 03 §7) |
| #614 — Client-side filesystem dates | Phase 3 | Device timestamps in upload metadata (doc 03 §5, 04 §5) |
| #760 — Single-source state/translations across apps | Phase 5 | `packages/api-client` + shared locales (doc 01); repo merge already done |

**Closable as obsolete once `apps/mobile` is deleted (Phase 5), wontfix-via-rewrite:**

| Issue | Reason |
| --- | --- |
| #762 — Migrate mobile to TypeScript | v2 is strict TS from scratch |
| #782 — MANAGE_EXTERNAL_STORAGE notification | Permission model doesn't exist in the Expo stack |

**Partially addressed — keep open, shrink scope:** #591 (only the in-app
face-ID UI lands, P1), #843 (memories notifications now P2, see doc 05),
#924 (native app resolves the driver; web "remember me" remains).

**Explicitly out of scope (re-label, don't close):** #844 (memories backend —
prerequisite for the P2 row in doc 05), #973 (web responsive), #911
(collaborative albums), #883, #527, #870.

## Definition of done (v2.0 release)

- All P0 rows in doc 05 shipped; airplane-mode browse + mutate + backup-catchup
  demo passes.
- Convergence test, EXPLAIN-plan assertions, contract tests, Maestro golden
  flows green in CI.
- Play Store, App Store, F-Droid builds from the same commit.
- Docs: user-facing setup page in `apps/docs`, developer README in
  `apps/mobile-v2`.

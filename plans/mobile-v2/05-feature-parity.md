# 05 — Feature Parity Matrix

Inventory of every web frontend route (`apps/frontend/src/routes/_protected/`)
mapped to the mobile plan. **Data source** says where the screen reads from:
`mirror` (SQLite, offline), `query` (api-client + TanStack Query,
online-only), `local` (camera roll). **Offline mutations** = goes through the
outbox (doc 03 §6).

Priorities: **P0** = launch blocker (parity core), **P1** = fast-follow,
**P2** = later/maybe, **—** = intentionally not on mobile.

## Timeline & photo browsing

| Frontend route | Mobile screen | Pri | Data | Notes |
| --- | --- | --- | --- | --- |
| `/` + `/photos` (timeline) | Photos tab | P0 | mirror + local | Merged timeline (doc 02 §4), day/month headers, scrubber, multi-select |
| `/photo/$id` (viewer) | `photo/[id]` modal | P0 | mirror + query | Swipe pager, zoom, video (expo-video), filmstrip, face overlay. Info = a **draggable three-detent bottom sheet** (no sidebar fits a phone): caption edit + rating + albums offline via the outbox; EXIF/camera/people/similar/scene-tags from `remote_photo_detail` (cached → offline once seen); location shown as an OSM raster-tile preview (no native map module needed — the *interactive* map stays P2). Full matrix: [07-lightbox-parity.md](./07-lightbox-parity.md) |
| `/favorites` | Photos filter | P0 | mirror | Flag filter; offline mutation ✅ |
| `/hidden` | Photos filter | P0 | mirror | Offline mutation ✅ |
| `/deleted` (trash) | Photos filter | P0 | mirror | Trash/restore offline ✅; empty-trash online-only |
| `/recent` (recently added) | Photos filter | P0 | mirror | Sort by `added_on` |
| `/videos` | Photos filter | P0 | mirror | `type` filter |
| `/notimestamp` | Photos filter | P1 | mirror | `timestamp IS NULL`; timestamp-edit mutation online-only v1 |
| `/library` | Profile → Library | P2 | query | Scan controls (see Admin) |

Selection actions on all grids: favorite/unfavorite, hide, trash, add-to-album
(offline ✅); download-to-device, share-link, delete-permanently (online).

## Albums

| Frontend route | Mobile screen | Pri | Data | Notes |
| --- | --- | --- | --- | --- |
| `/album/user` + `$id` | Albums → My Albums | P0 | mirror | Membership mirrored (doc 04 §3); create/rename/add/remove offline ✅ |
| `/album/events` + `$id` (auto) | Albums → Events | P0 | mirror | Read-only-ish; favorite offline ✅ |
| `/album/persons` + `$id` | Albums → People | P0 | mirror (list) + query (grid) | Person rename offline ✅; photo grid per person via query v1, mirrored membership P1 |
| `/album/places` + `$id` | Albums → Places | P1 | mirror (list) + query (grid) | Map view P2 (react-native-maps needs config plugin — fine) |
| `/album/things` + `$id` | Albums → Things | P1 | mirror (list) + query (grid) | |
| `/album/tags` + `$id` | Albums → Tags | P1 | mirror (list) + query (grid) | |
| `/album/folder` + `$id` | Albums → Folders | P2 | query | Server directory browse; inherently online |

## Search

| Frontend route | Mobile screen | Pri | Data | Notes |
| --- | --- | --- | --- | --- |
| `/search/$query` | Search tab | P0 | query | Semantic/CLIP search is server-side, online-only by nature. Offline fallback: local SQL over `search_location`, people names, album titles — clearly labeled "offline results" |

## Faces & organization

| Frontend route | Mobile screen | Pri | Data | Notes |
| --- | --- | --- | --- | --- |
| `/faces` (tag/train UI) | Profile → Face tagging | P1 | query | Online-only; the bulk-workflow UI simplified for touch (accept/reject inferred faces, assign name) |
| `/organizing.$tab` (stacks/dupes review) | — | P2 | query | Desktop-shaped workflow; revisit after v1 |
| `/stacks` | Viewer affordance | P2 | mirror | Show stack badge + expand in viewer; management stays web |

## Sharing

| Frontend route | Mobile screen | Pri | Data | Notes |
| --- | --- | --- | --- | --- |
| `/sharing` hub, `byme/$tab`, `withme/$tab` | Profile → Sharing | P1 | mirror | Shared-with-me photos are in the mirror (visibility rules doc 04 §2); share/un-share actions online |
| `/sharing/links` (public links) | Profile → Sharing → Links | P1 | query | Create/copy/revoke link |
| `/sharing/public`, `/public/*` routes | — | — | | Public web surfaces; a phone shares the URL instead |

## Mobile-specific (no web equivalent)

| Feature | Pri | Notes |
| --- | --- | --- |
| Camera-roll backup (album selection, wifi/charging rules, queue UI) | P0 | Docs 02–03; the reason the app exists |
| Merged local+remote timeline with upload badges | P0 | |
| Offline mode end-to-end | P0 | Mirror + thumb cache + outbox |
| System share-sheet target ("Upload to LibrePhotos") | P1 | expo share-intent config plugin |
| Sync status screen (cursors, counts, log export, repair/reseed) | P0 | Doc 03 §8 |
| Memories ("on this day") card + optional notification | P2 | User demand on record (librephotos#844, #843). Needs a backend memories endpoint first (net-new, not part of the sync API); notification delivery constrained by the no-push stance (doc 03 §7) — local scheduled notifications are the F-Droid-compatible route |

## Settings / profile / admin

| Frontend route | Mobile screen | Pri | Data | Notes |
| --- | --- | --- | --- | --- |
| `/settings` | Profile → Settings | P0 | query + local | Server-side prefs (favorite_min_rating…) via query; app prefs (theme, wifi-only, cache size) local zustand |
| `/profile` | Profile tab | P0 | query | Avatar, password change |
| `/admin` + `/admin/job.$id` | Profile → Server (admin only) | P2 | query | v1: read-only job/worker status + trigger scan; user management stays web |
| `/statistics/*` (wordclouds, socialgraph, placetree, faceclusters, timeline viz) | — | P2/— | query | Desktop dataviz; at most a lightweight "library stats" card |
| Login (`/login`, first-run server URL) | (auth)/login | P0 | — | Server URL + credentials; secure-store tokens; multi-server P2 |
| `/signup`, password reset | — | P1 | query | First-admin signup is a web flow; password-reset request P1 |

## Parity gaps accepted at v1 launch (explicit)

1. Search is online-only (server ML) — degraded local search offered.
2. Face tagging, dupes/stacks organizing: online-only or web-only workflows.
3. Statistics/dataviz pages: not on mobile.
4. Admin: status-only.
5. Per-thing/place/tag photo grids: online (lists mirrored, membership not).

Each gap is either inherently server-bound (ML), or a desktop-shaped workflow
whose mobile redesign is deferred rather than skipped.

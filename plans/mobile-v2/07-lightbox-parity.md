# 07 — Lightbox Parity

The web frontend's lightbox (`apps/frontend/src/components/lightbox/`, 29 files,
~4,500 lines) is the densest surface in LibrePhotos: a full-screen media viewer
with a 400px metadata sidebar, eleven keyboard shortcuts, a slideshow, and
fifteen editable sub-sections. The mobile viewer
(`apps/mobile-v2/src/features/viewer/`) shipped as a pager + zoom + a five-row
detail box.

This document decides, capability by capability, what mobile ships, what it
adapts, and what it defers — and defines the presentation model those decisions
hang off.

It supersedes the single viewer row in
[05-feature-parity.md](./05-feature-parity.md); that row has been updated to
point here (see §7).

---

## 1. The presentation model

### 1.1 A phone has no sidebar

The web lightbox puts everything in a 400px column pinned to the right of the
image, permanently visible on desktop. There is no phone-shaped version of
that: at 390pt wide a persistent side panel leaves the photo 0pt of room, and
the frontend's own `base: "100%"` breakpoint already degrades it into a
full-screen overlay that hides the photo entirely.

The mobile form is a **draggable bottom sheet** over the photo, with three
detents:

| Detent | Height | What it shows |
| --- | --- | --- |
| `hidden` | 0 | Photo only. Default. |
| `peek` | ~34% | Header (date, place, caption) — the "what am I looking at" answer, without covering the subject. |
| `full` | ~88% | All sections, scrollable. |

Rules:

- A **single tap** on the photo toggles *chrome* (top bar + action bar +
  filmstrip), not the sheet — same as the platform Photos apps. The sheet has
  its own affordance (an info button, and a swipe-up from the action bar).
- The sheet is **dragged**, not just toggled: a pan gesture moves it
  continuously and snaps to the nearest detent on release, with velocity
  projection so a flick overshoots to the next detent. Below the `peek` detent
  it dismisses.
- The sheet **never blocks paging**: it is a sibling of the pager, and while it
  is open the pager still swipes underneath. Its content changes with the
  active slide.
- It is built in-repo (`src/components/BottomSheet.tsx`) on
  `react-native-gesture-handler` + `react-native-reanimated`, both already
  dependencies. No `@gorhom/bottom-sheet`: a new dependency for ~120 lines of
  gesture math is not worth the hoisting risk documented in the README's
  "Dependency constraints".

### 1.2 Layer stack

```
┌ black backdrop ────────────────────────────────────────┐
│ ┌ pager (FlashList, horizontal, paging) ─────────────┐ │
│ │  slide = ZoomableImage | VideoSlide (expo-video)   │ │
│ │  + FaceOverlay on the active slide                 │ │
│ └────────────────────────────────────────────────────┘ │
│  ViewerTopBar     (back · title · info)   [chrome]     │
│  ThumbnailStrip   (filmstrip, tap to jump)[chrome]     │
│  ViewerActionBar  (favorite · hide · …)   [chrome]     │
│  PhotoInfoSheet   (draggable, 3 detents)               │
└────────────────────────────────────────────────────────┘
```

Everything respects `useSafeAreaInsets()`; every tappable control is ≥44pt;
every colour comes from `useTheme()` so dark mode is automatic. The chrome sits
on translucent scrims (the photo behind it is arbitrary), so it uses fixed
on-scrim colours rather than theme text colours — that is the one deliberate
exception and it is confined to `ViewerChrome`.

### 1.3 Three data tiers, three offline states

The rule from [01-architecture.md](./01-architecture.md) — *synced entities from
SQLite, everything else through TanStack Query, never both for one entity* —
maps onto the viewer as three tiers:

| Tier | Source | Offline behaviour |
| --- | --- | --- |
| **A — mirror** | `remote_photo`, `user_album_photo`, `auto_album_photo`, `person`, `local_asset` | Always available. Flags, rating, timestamp, place name, album membership. |
| **B — cached detail** | `remote_photo_detail` (whole `Photo` payload, cache-then-network via `usePhotoDetail`) | Available **if this photo has been opened online before**. Renders with a "showing cached details" note. Otherwise an explicit offline state. |
| **C — online-only** | separate endpoints not in the mirror or the detail payload | Rendered as a disabled row with `offline.needsConnection`, never as a blank. |

Tier B is larger than it looks: the cached `Photo` payload already carries
camera, lens, f-stop, shutter, ISO, focal length, dimensions, byte size, file
paths, GPS, `search_location`, `captions_json` (AI caption + scene tags),
`people` (with face bounding boxes), `similar_photos`, and `ocr`. So "full
EXIF, people, similar photos" are offline-capable *once seen*, which is exactly
the honest promise to make. What is **not** in it: tags, keywords, structured
metadata + edit history, file variants, stacks, photo→album lists.

**No section ever renders blank.** Each has three explicit states: content,
"nothing here yet", and "needs a connection" / "not synced yet".

### 1.4 Local-only photos are a first-class case

A camera-roll photo that has not been uploaded has no `remote_photo` row and no
image hash. This was a real device bug — every grid guarded on `item.imageHash`,
so tapping such a photo did nothing and the lightbox was reported as
unimplemented.

The contract: the viewer opens from **any** identity (remote id, image hash,
local asset id), renders from the `ph://`/`content://` uri, and **degrades with
an explanation**. Server-backed sections render a single "still only on this
device" row rather than vanishing (a vanished section reads as "this photo has
no metadata", which is a different and wrong claim). Mutating controls are
absent rather than present-and-inert.

### 1.5 Mutations: outbox or explicitly online

Anything in the offline-capable set goes through `useMutations()` → the outbox,
optimistically applied to the mirror so the UI updates instantly:

`caption` · `rating` · `favorite` · `hide` · `trash`/`restore` ·
`album_add` · `album_remove` · `person_rename`

Everything else is a **direct api-client call, disabled while offline**, using
the same pattern as `SelectionActionBar`: `useOnlineStatus()` +
`isGridActionAvailable()`-style gating, with `offline.needsConnection` as the
disabled explanation. `src/features/mutations/offline.ts` gains a
`ViewerAction` set that is no longer "everything is offline-capable" — it now
distinguishes the outbox set from `timestamp`, `makePublic`, `generateCaption`,
`rotate`.

---

## 2. Parity matrix

**Ship now** = lands in this pass. **Adapt** = lands, in a deliberately
different shape than the web. **Defer** = explicitly not now, with the reason.

### 2.1 Viewer shell (`ContentViewer`, `Lightbox`)

| # | Web capability | Verdict | Reason |
| --- | --- | --- | --- |
| 1 | Full-screen modal shell | **Ship** | Already the mobile route; gains safe-area chrome. |
| 2 | Prev/next navigation over a photo list | **Ship** | Pager over the mirror timeline window already works. |
| 3 | Deleted-photo stable-navigation snapshot | **Adapt** | The mirror is the list; a trashed photo leaves the visible set on the next live-query fire. The pager freezes its slide array per screen instance, which gives the same "don't yank the page out from under the user" guarantee for free. |
| 4 | Pinch / drag / double-click zoom | **Ship** | `ZoomableImage` already does pinch + double-tap + pan-while-zoomed. |
| 5 | Image preloading of prev/main/next | **Ship** | `Image.prefetch` on the ±2 neighbours; expo-image disk cache makes it durable. |
| 6 | Thumbnail navigation strip | **Adapt** | Web shows exactly 3 tiles (prev/main/next). Mobile ships a scrollable filmstrip over the whole pager window — more useful on a device where swiping is the primary gesture. |
| 7 | Video playback | **Ship** | `expo-video` (`useVideoPlayer` + `VideoView`), bundled in Expo Go. |
| 8 | GIF / animated originals | **Ship** | `expo-image` animates GIFs from the originals endpoint. |
| 9 | Embedded media (motion photos) | **Defer** | `embedded_media` needs the `/media/embedded_media/` route plus a still↔video switch UI; no mirror column and low value before stacks. |
| 10 | Slide-change fade/scale animation | **Adapt** | The pager's own paging is the transition; a second animation on a 60fps swipe is noise. |
| 11 | Keyboard shortcuts (11 hotkeys) | **Defer** | No keyboard. Each shortcut's *action* ships as a control. |
| 12 | Fullscreen toggle (`G`) | **Defer** | The mobile viewer is already fullscreen. |
| 13 | Slideshow + interval picker + ring progress | **Defer** | Genuinely mobile-appropriate (cast-to-TV, photo frame) but orthogonal to parity of *information*; P2, tracked in doc 06. |
| 14 | Rotate CW/CCW with optimistic transform | **Defer** | Needs `/photosedit/rotate` in `packages/api-client` (absent) and is inherently online — the mirror has no rotation column to apply optimistically to. |
| 15 | OCR "live text" selectable overlay | **Defer** | The web overlay relies on native SVG text selection; RN has no equivalent selectable text-on-image primitive. The `ocr.text` is in the cached payload, so a "copy text from photo" sheet row is the mobile shape — P2. |
| 16 | Face bounding-box overlay | **Ship** | Web draws it on sidebar hover; mobile draws it when a person chip is tapped (there is no hover). |

### 2.2 Toolbar (`LightboxControls`)

| # | Web capability | Verdict | Reason |
| --- | --- | --- | --- |
| 17 | Favorite toggle | **Ship** | Outbox (`favorite`). |
| 18 | Hide / unhide | **Ship** | Outbox (`hide`). |
| 19 | Delete (→ trashcan) | **Ship** | Outbox (`trash`), with restore when already trashed. |
| 20 | Star rating 0–5 | **Ship** | Outbox (`rating`). Web only exposes it implicitly via `favorite_min_rating`; mobile's explicit row is better and already exists. |
| 21 | Make public + copy share URL | **Adapt** | Ships **online-only** (`setPhotosPublic` + `expo-clipboard`), disabled offline. `is_public` is mirrored so the state is readable offline. |
| 22 | Info-panel toggle | **Adapt** | Becomes the sheet's info button + swipe-up. |
| 23 | Close | **Ship** | Back button via `goBackOr`. |
| 24 | Loading state while detail is in flight | **Ship** | Sheet header skeleton. |

### 2.3 Sidebar sections

| # | Web capability | Verdict | Reason |
| --- | --- | --- | --- |
| 25 | Timestamp display (date, weekday, time) | **Ship** | Tier A (`remote_photo.timestamp`) with tier B refinement; `formatFullDate` / `formatDayHeading`. |
| 26 | Timestamp **edit** (date + time picker, undo) | **Adapt** | Ships as an **online-only** direct `PATCH /photos/edit/{hash}/`, disabled offline — matching doc 05's "timestamp-edit mutation online-only v1". No outbox kind, because a bad timestamp silently reordering the offline timeline is worse than a disabled button. Undo is the same edit re-applied, so it needs no extra state. |
| 27 | File info: filename, W×H, size | **Ship** | Tier B. `formatBytes` already exists. |
| 28 | File path / breadcrumb | **Ship** | Tier B, inside "show more". |
| 29 | Camera info: camera, lens, ƒ, shutter, focal, ISO | **Ship** | Tier B. |
| 30 | Extra EXIF: subject distance, digital zoom, 35mm eq | **Ship** | Tier B, inside "show more". |
| 31 | File variants (RAW/JPEG/video siblings) | **Defer** | `file_variants` is absent from `packages/api-client`'s `Photo` schema; adding it is a schema+backend-contract change, not a viewer change. |
| 32 | Duplicates list | **Defer** | Desktop review workflow; doc 05 already routes duplicates to the web. |
| 33 | Structured metadata + edit history + revert | **Defer** | Three endpoints (`/photos/{id}/metadata`, `/metadata/history`, revert) absent from api-client; an audit-log timeline with per-row revert is a desktop shape. |
| 34 | Stack section (raw/burst/bracket/live groups) | **Defer** | `stacks` absent from the mobile `Photo` schema; doc 05 already lists stacks as P2 "badge + expand". Ships as a badge only once the schema carries it. |
| 35 | Location: place name | **Ship** | Tier A (`remote_photo.search_location`) — offline without ever having opened the photo. |
| 36 | Location: map | **Adapt** | No native map module in Expo Go that is safe to add. Ships as an **OSM raster-tile preview** (`expo-image`, disk-cached ⇒ works offline once seen) with a pin, honouring the server's `map_tile_provider` setting exactly like the web (`none` ⇒ placeholder, never a broken tile grid). Tapping opens the platform maps app via `Linking`. |
| 37 | Location **edit** (pick on map) | **Defer** | Needs an interactive map (drag a pin), which the tile preview cannot be. |
| 38 | People: face chips with avatars | **Ship** | Tier B (`people[]` with `face_url`). |
| 39 | People: hover → highlight face on photo | **Adapt** | Tap-to-highlight (no hover on touch), toggling the `FaceOverlay`. |
| 40 | People: open person's album | **Ship** | Routes to the existing `/albums/people/[id]` screen. |
| 41 | People: rename person | **Ship** | Outbox (`person_rename`). |
| 42 | People: confirm / reject / delete face | **Defer** | The app already has a purpose-built `FaceTaggingScreen` for exactly this bulk workflow; duplicating four destructive per-face controls into a photo sheet is worse UI, not more parity. The sheet links there. |
| 43 | Face probability indicator | **Ship** | A small confidence dot on the chip, reusing the web's colour thresholds. |
| 44 | Caption display | **Ship** | Tier B (`captions_json.user_caption`). |
| 45 | Caption **edit** | **Ship** | Outbox (`caption`), inline in the sheet — replaces today's modal prompt. |
| 46 | Caption: `#hashtag` mentions with autocomplete | **Defer** | A tiptap mention plugin over a thing-album list; the RN equivalent is a bespoke inline-autocomplete text input. Hashtags still round-trip as plain text, so nothing is lost. |
| 47 | AI caption suggestion chip (im2txt) | **Ship** | Tier B — `captions_json.im2txt` is already in the payload; tapping it fills the editor. |
| 48 | AI caption **generation** (`/im2txt`) | **Defer** | Online-only ML trigger; absent from api-client and a long-running server job with no mobile progress surface. |
| 49 | Scene tags (places365 attributes/categories, siglip2 tags) | **Ship** | Tier B; chips that route into search, matching the web's behaviour. |
| 50 | Tags section (add/remove user tags) | **Defer** | Five tag CRUD endpoints absent from api-client, and no `tag→photo` membership in the mirror, so it could not be offline-capable anyway. |
| 51 | Keywords section (IPTC keywords) | **Defer** | Lives behind the same absent metadata endpoint as #33. |
| 52 | Albums containing this photo | **Ship** | Tier A from `user_album_photo` / `auto_album_photo` — **fully offline**, better than the web (which spends a request). |
| 53 | Remove from album | **Ship** | Outbox (`album_remove`). |
| 54 | Add to album | **Ship** | Outbox (`album_add`); already wired, moves into the sheet. |
| 55 | Similar photos grid | **Ship** | Tier B (`similar_photos` is in the payload). |
| 56 | Public-album / sharing-settings sidebar variants | **Defer** | Mobile has no public-album route; a phone shares the URL (doc 05). |
| 57 | `StackLightbox` (dedicated stack viewer) | **Defer** | Follows #34. |

### 2.4 Totals

| Verdict | Count |
| --- | --- |
| **Ship now** | 27 |
| **Adapt** | 12 |
| **Defer** | 18 |
| **Total capabilities** | 57 |

Of the 18 deferred, **11 are blocked on data** the mobile API client or the
mirror does not carry (file variants, stacks, tags, keywords, structured
metadata, rotate, embedded media, AI generation, duplicates, `StackLightbox`,
location edit), **4 are desktop-shaped input** (keyboard shortcuts, fullscreen,
mention autocomplete, per-face review — the last redirected to a better mobile
screen that already exists), and **3 are scope calls** (slideshow, live-text
overlay, public-album sidebar).

---

## 3. Sheet structure

Section order is "what identifies this photo" → "what it is about" → "where it
lives" → "how it was made". Each is a collapsible `Section` with a title, an
`Icon`, and its own state machine.

```
PhotoInfoSheet
├─ Header            date · time · place · "cached details" note
├─ Caption           text + edit (outbox) + AI-suggestion chip
├─ SceneTags         places365 / siglip2 chips → search
├─ People            face chips → highlight · open person · rename (outbox)
├─ Location          place name · OSM tile preview · open in maps
├─ Albums            mirror membership · remove (outbox) · add (outbox)
├─ SimilarPhotos     thumbnails → open
├─ FileInfo          filename · W×H · size · [more: path]
├─ CameraInfo        camera · lens · ƒ · shutter · focal · ISO · [more: 35mm eq…]
└─ OnlineOnlyNote    what this build cannot show offline
```

Local-only photos render `Header` (from `local_asset`) and a single
`viewer.localOnly` explanation in place of everything below it.

---

## 4. Mutation routing

| Action | Route | Offline |
| --- | --- | --- |
| favorite / hide / trash / restore | outbox | ✅ |
| rating | outbox | ✅ |
| caption | outbox | ✅ |
| add to album / remove from album | outbox | ✅ |
| rename person | outbox | ✅ |
| edit timestamp | direct `PATCH /photos/edit/{hash}/` | ❌ disabled |
| make public + copy link | direct `POST /photosedit/makepublic/` | ❌ disabled |
| rotate · generate caption · edit tags/keywords · face review | — | deferred |

Disabled controls always say **why** (`offline.needsConnection`); they are never
silently inert. That is the same contract the grid's `SelectionActionBar`
already honours.

---

## 5. Implementation order

Each step is independently shippable and independently testable. **All fourteen
have landed** — the status column records where each one lives.

| # | Step | Lands in |
| --- | --- | --- |
| 1 | `BottomSheet` — gesture, detents, velocity snapping | `src/components/BottomSheet.tsx` |
| 2 | `PhotoInfoSheet` shell — sections, three-state rendering, local-only path | `src/features/viewer/PhotoInfoSheet.tsx`, `InfoPrimitives.tsx` |
| 3 | File info + camera info + extra EXIF | `InfoSections.tsx`, `exif.ts` |
| 4 | Location — place name, OSM tile preview, open-in-maps | `MapPreview.tsx` |
| 5 | People + face overlay | `InfoSections.tsx`, `FaceOverlay.tsx` |
| 6 | Caption through the outbox, AI-suggestion chip, scene tags | `InfoSections.tsx` |
| 7 | Timestamp display + online-only edit | `timestamp.ts`, `endpoints.setPhotoTimestamp` |
| 8 | Albums from the mirror, add/remove through the outbox | `db/queries/detail.ts` (`albumsContainingPhoto`) |
| 9 | Similar photos | `InfoSections.tsx` |
| 10 | Chrome — top bar, icon action bar, tap-to-toggle, safe areas | `ViewerChrome.tsx`, `ViewerActionBar.tsx` |
| 11 | Thumbnail filmstrip | `ViewerChrome.tsx` |
| 12 | Video via `expo-video` (+ animated GIFs from the originals endpoint) | `VideoSlide.tsx`, `PhotoViewerScreen.tsx` |
| 13 | Neighbour preloading (±2, into `expo-image`'s disk cache) | `PhotoViewerScreen.tsx` |
| 14 | Make public (online-only) + copy link | `ViewerActionBar.tsx` |

The one dependency added for all of it is `expo-video` (`~3.0.16`, the SDK 54
version), which Expo Go bundles. Nothing else needed a new package — the sheet,
the map and the face overlay are all built on gesture-handler, reanimated and
expo-image, which the app already had.

---

## 6. Non-goals

- Reproducing the sidebar as a side panel in landscape. The sheet is the form
  factor at every orientation; a tablet layout is a later, separate decision.
- Editing anything the mirror cannot represent offline. If a field cannot be
  optimistically applied to SQLite and replayed, it is an online-only direct
  call, never a fake-success.
- A second thumbnail cache. The filmstrip and the preloader both go through
  `expo-image`'s disk cache and the existing `thumb_cache`.

---

## 7. Reconciliation with doc 05

Doc 05's viewer row previously read:

> Swipe pager, zoom, video (expo-video), info sheet: EXIF/map/people from
> `remote_photo_detail`

That is the correct skeleton and this document keeps all of it. Three
deviations, now reflected in doc 05:

1. **"Info sheet" is specified as a draggable three-detent bottom sheet**, not
   an undifferentiated panel — §1.1.
2. **The sheet's scope is wider than EXIF/map/people**: it also carries caption
   editing, albums (from the mirror, not the detail payload), similar photos and
   scene tags. Albums in particular are *more* offline-capable than doc 05
   implied, because membership is already mirrored.
3. **The map is an OSM raster-tile preview, not an interactive map.** Doc 05
   listed a map view as P2 pending `react-native-maps` and a config plugin; the
   tile preview needs neither, so the *display* half lands now and only the
   *edit/interactive* half stays deferred.

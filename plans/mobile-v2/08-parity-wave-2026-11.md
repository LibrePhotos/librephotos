# 08 — Parity wave (November 2026)

Doc 05 was written in July. Since then the web app gained a scrubber, timeline
filters, archive/screenshots/documents views, a places map, person pages with
merge/groups, library sharing, album collections, organizing (duplicates,
stacks), date tools and more. The mobile app moved little (#2189, #2780, #2803,
#2813). This doc is the gap list and the plan to close it with a phone-first
UX instead of a port of the web layout.

## Navigation: three tabs plus an avatar

Google Photos (Photos / Collections / Search) and Apple Photos on iOS 26
(Library / Collections / Search) both keep the tab bar small and put
everything else one tap away. The app today has five tabs (Photos, Albums,
Search, Backup, Profile), and six filter screens that nothing links to.

| Today | New home |
| --- | --- |
| Photos tab | **Photos** tab: timeline, Memories strip, scrubber, filter sheet, view switcher |
| Albums tab | **Collections** tab: albums, people, places, things, events, tags, folders, sharing, plus a "Utilities" list (favorites, videos, screenshots, documents, recently added, hidden, archive, trash, duplicates) |
| Search tab | **Search** tab: query, chips for people/places/things, filter sheet, recent searches |
| Backup tab | Avatar in the Photos header with a backup progress ring (same idea as the web worker ring, #2186); tapping it opens the account sheet with the backup card first |
| Profile tab | Account sheet: backup, library (scan, jobs), settings, profile, faces, admin, what's new, logout |

The account sheet and the Collections utilities replace the web sidebar,
footer and the Photos view-switcher dropdown.

## Gap list

Legend: **P1** = this wave, **P2** = next, **web** = deliberately web-only.

### Shell and browsing
- P1 Three-tab layout, avatar + backup ring, account sheet.
- P1 Collections hub with the utilities list (fixes the orphaned filter routes).
- P1 New list views: archive, screenshots, documents, without location, not in album (endpoints exist).
- P1 Search tab reads `q` (scene-tag and person links currently open an empty search).
- P1 Local app settings persist across restarts (theme, language, cache cap).
- P1 Scroll scrubber with date labels.
- P1 Timeline filter sheet (media type, hide screenshots/documents, favorites only, save as default via `User.default_timeline_filter`).
- P2 Pinch to change grid density (day ⇄ month ⇄ year), sort order.

### Viewer
- P1 Share to other apps / save to device, delete permanently, archive, rotate.
- P1 Edit location and date as proper pickers (date is a free-text prompt today).
- P1 Tags edit, set as album cover.
- P1 Video with a local copy plays (it renders as an image today).
- P2 OCR text overlay, stacks, panorama, all-metadata, comments/likes.

### Selection
- P1 Wire the dead Download and Delete permanently buttons; add archive, rating, select all.
- P2 Bulk date shift, bulk location, categorize, stacks.
- web Move to folder, rename by pattern, rights/license.

### Collections
- P1 Person page (stub today): photos, rename, set cover, merge, delete.
- P1 Folder browser (stub today).
- P1 User albums: delete, set cover, sort.
- P2 Places map, your places, album collections, person groups, tag rename/merge.

### People and organizing
- P2 Faces: labeled/inferred/unknown tabs (today: suggested/unknown only), delete/restore.
- P2 Duplicates review as a swipe-through card flow; stacks review.

### Sharing
- P2 Library sharing, links management (copy/revoke), album members and public link, leave shared album.

### Account
- P1 Profile: name, email, avatar, language.
- P1 Library: processing status, scan/rescan, jobs list with cancel.
- P2 SSO login (needs the allauth redirect flow, not in api-client), what's new, upload into an album.
- web Statistics, date/burst rule tables, site settings, email setup, logs, first-time setup, Nextcloud.

## Constraints
- Expo Go first (SDK 57): no native modules outside Expo Go. `expo-sharing`, `expo-media-library` and `expo-image-manipulator` are in Expo Go; check `react-native-maps` before relying on it for the places map.
- Offline first: new mutations that can be queued go through the outbox; online-only ones show the offline state.
- Every string through `t()`.

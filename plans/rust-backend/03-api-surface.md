# 03 — API Surface: What the React Frontend Actually Uses

The contract is **exactly what `apps/frontend` calls, and exactly the fields
it reads**. The inventory was taken from `dev` @ 3bbef0e9a. It covers:

- `apps/frontend/src/api_client/**`
- every `fetchClient` / raw `fetch`
- the 12 functions the frontend imports from `packages/api-client`

**142 distinct (method, path) operations** are live. Another 8 are only called
from dead code and are skipped (§8).

## 1. Contract policy

1. **Paths as the frontend writes them.**
   - A router middleware strips one trailing slash before matching, so
     `/sitesettings`, `/albums/date/{id}` and `/exists/{h}` all match directly.
   - Django answers two of these with a **301 on every call**. On
     `/albums/date/{id}`, that means every timeline page fetch is 2 requests
     on Django and 1 on Rust. The benchmark reports this separately (05).
2. **Response bodies must pass the frontend's own zod schemas**, imported
   directly by the contract harness (06).
   - zod strips unknown keys by default, so **extra fields are free** and
     **missing required fields are fatal**: a parse failure throws and shows
     a toast.
   - Some responses are unvalidated, typed only with TS interfaces: photo
     detail, duplicates, folder subfolders, the SSO config. For these, the
     fields listed in §6 are the contract.
3. **Emit what the frontend reads, not what Django happens to serialize.**
   The biggest example: photo detail's `exif_json` is the heaviest field and
   is never read. Dropping it is a legitimate rewrite win, and payload bytes
   are reported per endpoint (05).
4. **Envelopes, error shapes and status codes** as in §7. Where a status has
   meaning for the UI, it's reproduced (404 on public links, 403 +
   `X-Media-Error` on media).
5. **Known frontend/backend drift is resolved in favor of the frontend.** The
   backend can emit legacy stack types `raw_jpeg` / `live_photo`, which fail
   `StackTypeEnum`. Rust emits only `burst` / `bracket` / `manual`.

## 2. Auth

| Piece | Behavior the frontend depends on |
| --- | --- |
| Login | `POST /auth/token/obtain/` `{username (lower-cased), password}` → `{refresh, access}`. A bad login returns 401 with `{"errors":[{"field":"detail","message":…}]}`. |
| Token cookies | The SPA stores `access` / `refresh` in **JS-readable** cookies itself. |
| `jwt` cookie | **The backend must also set a `jwt` cookie = access token** on obtain and on refresh. `<img>`/`<video>` send no headers, so media auth relies entirely on it. It stays fresh only because the 2 s `/rqavailable/` poll keeps refreshing the 5-minute access token. |
| Refresh | `POST /auth/token/refresh/` `{refresh}` → `{access}`. **No rotation**: the client never stores a new refresh token. |
| Logout | `POST /auth/token/blacklist/` `{refresh}` |
| Claims read | `exp`, `user_id` (parsed with `parseInt`), `is_admin`, `name`. Rust keeps simplejwt's layout (`token_type`, `jti`, `iat`) so Django- and Rust-issued tokens are interchangeable, which the benchmark needs. |
| Passwords | Verify Django's `argon2$argon2id$…` and `pbkdf2_sha256$…`; hash new ones as Django-format Argon2id |
| Refresh-token store | New table `refresh_token(jti, user_id, expires_at, revoked_at)`. The blacklist writes `revoked_at`, and a daily job prunes it. Django's `token_blacklist_*` tables are neither read nor written, so a logout on one backend does not revoke the refresh token on the other; only one backend serves a library at a time. |
| First-time setup | `GET /firsttimesetup/` → `POST /user/` → token → optional `POST /sitesettings` → `GET /dirtree/` → `PATCH /manage/user/{id}/` → optional `POST /scanphotos/` |
| Password reset | `POST /auth/password/reset/` `{email}`, `POST /auth/password/reset/confirm/` `{uid, token, new_password}`. Rust issues its own HMAC tokens; compatibility with Django-issued links isn't needed. |
| SSO (optional, M5) | `GET /auth/sso/config/` → a plain link to `/api/accounts/oidc/{id}/login/` → IdP → the backend sets `access`/`refresh`/`jwt` and redirects to `/`. Errors go back as `?sso_error=` with `signup_disabled \| email_not_verified \| not_authenticated \| public_url_not_configured`. |

**Dropped:**
- HTTP Basic
- allauth account pages
- Django sessions/CSRF
- the unused custom claims: `first_name`, `last_name`, `scan_directory`,
  `confidence`, `semantic_search_topk`, `nextcloud_*`. Including them is
  harmless and keeps token parity, so they stay in, but nothing needs them.

## 3. Media

URLs are `/media/<kind>/<id>`:

| Kind | Id | Used for |
| --- | --- | --- |
| `square_thumbnails_small` | `item.url` (= image hash) | grid tiles < 250 px, 20 px blur placeholder |
| `square_thumbnails` | hash | tiles ≥ 250 px, covers. **For videos this is an mp4**: `<video src>` points here. |
| `thumbnails_big` | hash, plus `?v=N` after rotation | lightbox, preloads, clipboard copy |
| `photos` | `{hash}`, `{hash}.mp4`, `{hash}.jpg` | originals, video playback. **HEAD** is used to diagnose video failures. |
| `embedded_media` | hash | motion photos |
| `faces` | basename of `face.image` | face crops |
| `zip` / avatars | as today | |

**Authorization** is a port of `api/views/media.py`: the grant order, and the
"album share vouches only for the owner's photos" rule (02 §4).

- **Refusal:** anonymous → 403 + `X-Media-Error: authentication`; signed-in →
  **404** (an unknown hash and a private hash are indistinguishable).
- **Delivery:**
  - `LP_MEDIA_MODE=x-accel`: an empty body + `X-Accel-Redirect` into nginx's
    internal locations.
  - `LP_MEDIA_MODE=direct`: tower-http file serving with ranges and HEAD.
- **Always:** paths are canonicalized and confined to `MEDIA_ROOT` / the photo
  roots. Never join raw URL text.
- **Live transcode:** as in 04 §6.

**`/api/downloads/{uuid}{userId}`** is served by nginx only (unauthenticated)
today, and 404s without nginx. Rust serves it directly too, authenticated, so
native dev with the Vite proxy works.

## 4. The timeline, precisely

This is the hottest flow and the one M1 optimizes for:

1. `GET /albums/date/list/?<filters>` → `{results: [{id, date, location,
   incomplete: true, numberOfItems, items: []}]}`.
   - Filters: `favorite`, `public`, `hidden`, `in_trashcan`, `photo`,
     `video`, `is_screenshot` (each `"true"` or absent), `person`,
     `username`, `folder`.
   - It returns one entry per date group for the whole library, which makes
     it the **biggest single payload at scale**.
2. As the user scrolls, `GET /albums/date/{id}?<filters>&page=N` →
   `{results: {…group, items: PigPhoto[≤100]}}`.
   - The page size is **hard-coded to 100** on the frontend.
   - At most one page per 500 ms tick.
3. Tiles then fetch `square_thumbnails_small` / `square_thumbnails`.

**Group fields read:** `id`, `date` (header + scrubber), `location`,
`numberOfItems`, `items`.

**`PigPhoto` fields read:**
- `id` (uuid, required), `image_hash`, `url`, `aspectRatio` (required)
- `dominantColor`, `type`, `video_length`, `rating`, `date`
- `stacks[]{type ∈ burst|bracket|manual, …}`, `has_raw_variant`
- `owner` (shared-with-me only)

**Droppable:** `location`, `birthTime`, `exif_gps_lat/lon`, `removed`,
`in_trashcan`, `shared_to`, `local_orientation`.

**Every protected page** also fires:
- `/rqavailable/` every 2 s
- `/user/{id}/` (twice, from two query-key spellings)
- `/sitesettings`, `/storagestats/`, `/imagetag/`, `/searchtermexamples/`
- `/albums/place/list/`, `/albums/thing/list/`, `/albums/user/list/`
- `/persons/?page_size=1000`
- on the timeline: `/user/` and `/tags/` as well

These are cheap individually but multiply by open tabs. Journey J6 measures
them.

## 5. Inventory by area

**M** = the milestone that ports it (07). **M1** is the speed slice.

| Area | Ops | M | Endpoints |
| --- | --- | --- | --- |
| Auth | 7 | M0/M5 | obtain, refresh, blacklist (M0); firsttimesetup, sso/config, password reset ×2 (M5) |
| User & settings | 17 | M1/M2/M3 | `GET /user/{id}/`, `GET /user/`, `GET /sitesettings` (M1); `POST /user/`, `PATCH /user/{id}/` (whole object or multipart avatar), `PATCH /manage/user/{id}/`, `DELETE /delete/user/{id}/`, `POST /sitesettings`, email-config ×3, `/timezones/` + `/predefinedrules/` + `/predefinedburstrules/` (**JSON-encoded strings** the frontend `JSON.parse`s), `/dirtree/`, nextcloud ×2 (optional) |
| Timeline & photosets | 5 | M1/M2 | date list + date page (M1); `recentlyadded`, `notimestamp`, `memories` (M2) |
| Photo detail & lightbox | 7 | M1/M2 | `GET /photos/{hash\|uuid}/`, `GET /photo/share/list` (M1); `/photos/{h}/albums/`, metadata GET/PATCH, `/media/diagnostics/{h}/`, `POST /photo/share` (M2/M3) |
| Photo edits | 10 | M3 | `PATCH /photos/edit/{h}/`; `photosedit/` favorite, hide, setdeleted, **DELETE-with-body** delete, makepublic, share, savecaption, generateim2txt, rotate. Bulk ops accept `image_hashes` **or** `{select_all, query, excluded_hashes}`. |
| Albums | 29 | M1/M2/M3 | user/place/thing lists (M1: spotlight); user album detail (bare object), auto list/detail, thing/place detail (`{results:{id: string, title, grouped_photos}}`), `/locclust/`, `/folders/subfolders/`, tags list/detail (M2); album CRUD, sharing, auto-album delete/delete_all/generate, tag CRUD/add/remove/merge (M3) |
| People & faces | 11 | M1/M2/M3 | `GET /persons/?page_size=1000` (M1); `/faces/incomplete/` (bare array), `/faces/?person&page&inferred&order_by…` (M2); person PATCH/DELETE, labelfaces, deletefaces, addface, trainfaces, **GET** `/scanfaces` (starts a job!), `/clusterfaces` (M3/M4) |
| Search | 2 | M1 | `/photos/searchlist/?search=` (grouped `{date, location, items}`, or a flat `PigPhoto[]` when `semantic_search_topk` is set), `/searchtermexamples/` |
| Sharing & public | 5 | M2 | `photos/shared/fromme` + `tome` (`owner` required), `/public/albums/s/{slug}/`, `/public/albums/s/{slug}/photos/{h}/`, `/public/photo/{slug}/` (anonymous, raw fetch) |
| Jobs & worker | 9 | M1/M4 | `GET /jobs/?page_size=10&page&mine`, `GET /rqavailable/` (M1); job detail/cancel/delete, scanphotos, fullscanphotos, deletemissingphotos, generateocr (M4) |
| Upload | 3 | M4 | `GET /exists/{md5+uid}` (no slash), `POST /upload/` (1 MB chunks; `Content-Range` total = **chunk** size), `POST /upload/complete/` |
| Zip | 4 | M4 | `POST /photos/download`, poll `GET ?job_id=` every 3 s, `GET /downloads/{uuid}{uid}`, `DELETE /delete/zip/{uuid}` |
| Stats | 6 | M2 | `/stats/`, `/photomonthcounts/`, `/wordcloud/`, `/socialgraph/`, `/locationsunburst/`, `/locationtimeline/` |
| Server & admin | 9 | M1/M2/M5 | `/storagestats/`, `/imagetag/` (M1: every page); `/serverstats/`, `/serverlogs` (blob), `/serverlogs/view?lines=` (M2); `/services/` list + status (polled every 15 s) + start/stop (M5) |
| Stacks | 9 | M2/M3 | list (`{results, count, num_pages, page, page_size, has_next, has_previous}`), detail, stats; delete, remove, merge, manual, detect, primary |
| Duplicates | 8 | M2/M3 | list, detail, stats (no trailing slashes, unvalidated); detect, resolve, dismiss, revert, delete |
| Geocode | 1 | M3 | `/geocode/search?q=` → bare array |
| **Total** | **142** | | M1 ≈ 25 ops, M2 ≈ 45, M3 ≈ 45, M4 ≈ 20, M5 ≈ 7 |

## 6. Fields for unvalidated responses

**Photo detail** (`GET /photos/{h}/`):

- **Top-level fields read:** `id`, `image_hash`, `image_path`, `video`,
  `embedded_media.length`, `rating`, `hidden`, `exif_timestamp`,
  `exif_gps_lat/lon`, `search_location`, `camera`, `lens`, `fstop`, `iso`,
  `focal_length`, `shutter_speed`, `subjectDistance`,
  `focalLength35Equivalent`, `digitalZoomRatio`, `width`, `height`, `size`.
- **Nested fields read:**
  - `captions_json.{user_caption, im2txt, <tagging_model>.tags}`
  - `people[]{name, face_url, face_id, location, type, probability}`
  - `similar_photos[]{image_hash, type}` (similarity sidecar)
  - `file_variants[]{hash, path, type, is_main, filename}`
  - `stacks[]{id, type, type_display, photo_count, is_primary,
    photos[]{id, image_hash, is_primary, thumbnail_url, size, width, height}}`
  - `ocr.blocks`
- **Not read:** `exif_json`, `geolocation_json`, `search_captions`, URLs,
  flags, `owner`, `metadata`.

**Album lists** (validated, fields read):

| List | Fields |
| --- | --- |
| User albums | `id`, `title`, `cover_photo.{image_hash, video}`, `photo_count`, `owner`, `shared_to`, `created_on`, `public` |
| Auto albums | `id`, `title`, `timestamp`, `photos.{image_hash, video}`, `photo_count`; the detail page also reads `photos[].geolocation_json.features[len-3].text` and `people[].face_url` |
| Thing / place / tag | `id`, `title`/`name`, `cover_photos[0]`, `photo_count`; places also `geolocation_level` |
| Persons | `id`, `name`, `face_count`, `face_photo_url` (**an image hash**, despite the name), `face_url`, `video` |

## 7. Envelopes and errors

| Shape | Endpoints |
| --- | --- |
| DRF page `{count, next, previous, results}` | `/persons/`, `/faces/`, `/jobs/`, `/user/`, `/photos/notimestamp/`. `next`/`previous` are absolute URLs; only jobs uses `count`. |
| `{results}` | all album/tag/search/share lists; date, thing, place, tag detail |
| Bare object | user album detail, auto album detail |
| Bare array | `/faces/incomplete/`, `/locclust/`, `/photomonthcounts/`, `/locationtimeline/`, `/geocode/search`, `/dirtree/`, `/nextcloud/listdir/` |
| Custom paging | stacks, duplicates, `/folders/subfolders/` (`pagination.has_next`) |
| JSON-encoded string | `/timezones/`, `/predefinedrules/`, `/predefinedburstrules/` |

**Errors:** `{"errors":[{"field","message"}]}`. The UI shows the first
`message`, falling back to `detail`. A 500 body is never shown.

**404 has UI meaning in four places:**
- public album
- public photo (link revoked)
- the album slug availability check (any error means "free")
- video classification

**Methods:** HEAD on media; DELETE with a JSON body on `/photosedit/delete/`.

## 8. Not ported

- **Dead-code calls:** `/generateeventalbums/titles/`,
  `/photosedit/duplicate/delete/`, metadata history/revert ×3, metadata bulk
  GET/PATCH, `/stacks/{id}/add/`.
- **Backend-only surface:** Django admin, allauth
  account pages, DRF schema/swagger/browsable API, silk, HTTP Basic, unused
  `ModelViewSet` writes, `/api/photos/{h}/file/{fh}`.
- **Frontend bugs, listed for separate fixes** (the experiment doesn't
  change the frontend):
  - the 301 per timeline page (missing trailing slash)
  - the double `/user/{id}/` fetch
  - the login page firing 5 authenticated GETs that 401
  - `/persons/?page_size=1000` silently truncating
  - file-variant links (`/media/photos/{variant.hash}`) that can't resolve
  - `/api/downloads` only working behind nginx

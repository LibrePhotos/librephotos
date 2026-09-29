# Rust backend tests: fixture, contract, twin, authz, mutation diffs

Implements layers 1–5 of [plans/rust-backend/06-testing.md](../../../plans/rust-backend/06-testing.md).
Django is the reference implementation, the frontend's zod schemas are the
contract, and every case runs against a clone of one deterministic fixture.

```
tests/
├── fixture/                  pack build + server scripts (Git Bash)
│   ├── env.sh                shared settings, sourced by every script
│   ├── build_fixture.sh      fresh DB → migrate → seed_fixture → template lp_fixture
│   ├── clone_db.sh           <newdb> [media_dir]   CREATE DATABASE … TEMPLATE lp_fixture
│   ├── drop_db.sh            <db> [media_dir]      drop your clone (prefix-guarded)
│   ├── run_django.sh         <db> <port> [direct]  Django reference server
│   ├── wait_http.sh          <url> [timeout]       wait for /api/healthz
│   ├── lp_twin_settings.py   Django settings used by the scripts
│   └── dump_state.py         canonical DB / media dumps + diff for mutation cases
└── contract/                 TypeScript harness (vitest + zod, Node 22)
    ├── src/                  client, manifest, schema, twin, authz, projection
    └── tests/                examples/ (login, user, date list), harness/ (self-tests)
```

The seed command itself is `apps/backend/api/management/commands/seed_fixture.py`.

## Prerequisites

| What | Where |
| --- | --- |
| Postgres 16 | `localhost:5433`, user `postgres`, any password; binaries in `C:\Users\Niaz\librephotos\rust-pg\pginstall\bin` |
| Django venv | `C:\Users\Niaz\librephotos\wt-windev\apps\backend\.venv-win\Scripts\python.exe` |
| Node 22 | `export PATH="/c/Users/Niaz/AppData/Roaming/fnm/node-versions/v22.23.3/installation:$PATH"` |

Every path, host and name in `fixture/env.sh` can be overridden from the
environment (`LP_PG_*`, `LP_DJANGO_PY`, `LP_FIXTURE_ROOT`,
`LP_FIXTURE_TEMPLATE`, `LP_RUNS_ROOT`, `LP_SECRET_KEY`).

## 1. The fixture pack

```bash
apps/backend-rs/tests/fixture/build_fixture.sh      # ~1 minute
```

It recreates `lp_fixture_build`, runs `migrate` and `seed_fixture`, `VACUUM
ANALYZE`s, drops the old `lp_fixture` template and renames the build to it
(`IS_TEMPLATE true`). Output under `C:/Users/Niaz/librephotos/rust-pg/fixture`:

- `data/<user>/…` the photo trees (`PHOTOS`), `protected_media/…` thumbnails and face crops
- `manifest.json` everything a test needs to address the fixture
- `lp_fixture.dump` `pg_dump -Fc` of the template (for CI caching / other machines)

The build is deterministic: rebuilding gives the same photo UUIDs, hashes,
ids, thumbnails and manifest (only `built_at`, salted password hashes, and
`added_on`/`last_modified`-style timestamps change). Never connect to
`lp_fixture` directly; clone it.

How it is made: files from `deploy/e2e/photos` plus generated ones (PNG,
HEIC, an ffmpeg mp4, a JPEG + `.xmp` sidecar, a JPEG + fake `.dng` variant,
a filename-dated screenshot, a burst, GPS trips) are ingested synchronously
through the real `handle_file_group` handler (thumbnails, EXIF, dates, pHash;
the exif sidecar runs in-process). ML is off; faces (synthetic 512-d
encodings), persons, clusters, captions, tagging-model tags (thing albums),
`Tag` rows, OCR and reverse-geocoded places (canned geocoder answers, real
`geolocate_photo`) are injected afterwards. Event albums come from the real
`generate_event_albums`.

### Roles

| Role | Setup |
| --- | --- |
| `admin` | superuser, 1 photo |
| `alice` | owns almost everything (32 photos, albums, persons, stacks, duplicates, jobs) |
| `bob` | 1 own photo + a byte-identical copy of `alice/e2e_01` (same md5, different `image_hash`); `alice/e2e_06` and `e2e_07` shared to him directly |
| `carol` | album "Shared with Carol" (alice's) is shared to her; it contains `bob/own_02`, which the share must not vouch for (GHSA-phvg) |
| `dave` | stranger with 1 own photo |
| `anonymous` | public photos `alice/e2e_05` + `alice/berlin_01`, public album slug `fixture-public-trip`, expired slug `fixture-expired-share`, photo share slug `fixture-photo-share` |

Passwords are in `manifest.json` (`users.<name>.password`), never in code.

### manifest.json keys

| Key | Contents |
| --- | --- |
| `users.<name>` | `id`, `username`, `password`, `is_admin`, `scan_directory`, `photo_count` |
| `system_users.deleted` | the `deleted` placeholder user |
| `photos.<owner>/<name>` | `id` (uuid), `image_hash`, `owner`, `path`, `main_file`, `files[]`, `exif_timestamp`, flags (`video`, `hidden`, `in_trashcan`, `removed`, `public`, `is_screenshot`, `is_document`), `rating`, `perceptual_hash`, `aspect_ratio`, `shared_to` |
| `categories.<name>` | lists of photo keys: `e2e`, `hidden`, `trashed`, `removed`, `no_timestamp`, `no_thumbnail`, `public`, `shared_to_bob`, `same_file_two_users`, `burst_stack`, `manual_stack`, `duplicate_group`, `unicode_names`, `video`, `heic`, `png`, `raw_variant`, `xmp_sidecar`, `screenshot`, `ocr`, `gps`, `captioned`, `ghsa_foreign_photo_in_carol_album`, `photo_share`, `rated` |
| `albums.user.<name>` | `vacation`, `shared_to_carol`, `public_trip`, `expired`, `unicode`, `bob_album`: `id`, `title`, `owner`, `photos` (uuids), `cover_photo`, `shared_to` |
| `albums.auto / date / thing / place` | every row with `id`, `title`/`date`, `owner`, counts |
| `shares` | `public_album`, `expired_album` (`slug`, `album_id`), `photo_share` (`slug`, `photo`), `album_shared_to_carol` (`album_id`, `foreign_photo`) |
| `persons.<name>` | `anna` (user-labelled), `ben` (user-labelled, plus an inferred face), `cluster_1` (CLUSTER kind, inferred faces only), `bobs_friend` |
| `faces.<group>` | face ids: `anna`, `ben`, `inferred_ben`, `cluster_1`, `unknown`, `deleted`, `bob` |
| `tags[]`, `stacks.burst/manual`, `duplicates.visual`, `jobs.finished/failed/running`, `scan_jobs.<user>` | ids |

Look photos up by key (`photo("alice/e2e_01").id`), never hard-code ids.

## 2. Servers on clones

Name your clones with your own prefix: `drop_db.sh` only drops names starting
with `lp_t_`, `lp_twin_`, `lp_mut_` or `lp_run_` (override `LP_CLONE_PREFIXES`).
Pick ports nobody else uses (e.g. 89xx per agent).

```bash
F=apps/backend-rs/tests/fixture
$F/clone_db.sh lp_twin_albums_ref                 # read-only cases share the fixture media
$F/run_django.sh lp_twin_albums_ref 8941 &        # X-Accel mode, like production behind nginx
$F/run_django.sh lp_twin_albums_ref 8942 direct & # Django streams media itself (SERVE_FRONTEND)
$F/wait_http.sh http://127.0.0.1:8941
```

`run_django.sh` runs uvicorn with 1 worker and no reload, `SECRET_KEY=rust-bench-secret`
(so Django and Rust tokens are interchangeable), all `FEATURE_*` ML flags off,
logs in `$LP_RUNS_ROOT/<db>-<port>/logs`. Stop it by the PID you started.

The media tree is shared read-only between clones. **A mutation case must copy
it**: `clone_db.sh <db> <media_dir>` copies `data/` + `protected_media/` into
`media_dir` and rewrites the absolute paths stored in the clone; then start the
server with `LP_MEDIA_ROOT=<media_dir> run_django.sh <db> <port>`.

The Rust server should get the same `DB_*`-equivalent database, `BASE_DATA`
(= the fixture root or your media copy) and `SECRET_KEY`.

## 3. Contract and twin harness

```bash
cd apps/backend-rs/tests/contract
npm install                                    # node_modules is gitignored
LP_BASE_URL=http://127.0.0.1:8932 LP_REF_URL=http://127.0.0.1:8931 npx vitest run
```

| Env | Meaning |
| --- | --- |
| `LP_BASE_URL` | server under test (Rust). Unset: live cases are skipped. |
| `LP_REF_URL` | Django on a clone of the same template. Defaults to `LP_BASE_URL` (self-compare, how the examples are validated on Django) |
| `LP_MANIFEST` | default `C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json` |

Add your area's cases as `tests/<area>/*.test.ts`. Helpers (all in `src/`,
re-exported from `src/index.ts`):

- `call(role, { method, path, query, body, headers, redirect }, baseUrl?)` → `{status, headers, body, text}`.
  Roles are `admin | alice | bob | carol | dave | anonymous`; tokens come from
  `POST /api/auth/token/obtain/` with the manifest passwords and are cached per
  server for 4 minutes (access tokens live 5). Paths include `/api` and are
  written exactly like the frontend writes them (trailing slash or not).
- `expectSchema(schema, body)` parses with a frontend schema and fails with the zod issue paths.
- `expectTwin(role, req, spec)` / `twin(...)` compare reference and actual.
- `authzMatrix(cases)` + `authzProblems(case, cells)` for role × request status matrices.
- `manifest()`, `photo(key)`, `category(name)`, `user(name)` read the manifest.

### Contract cases

Import the schema the frontend really parses the response with:

```ts
import { User } from "@fe/user/types";                             // apps/frontend/src/api_client/user/types.ts
import { FetchDateAlbumsListResponse } from "@librephotos/api-client"; // packages/api-client/src/schemas/*
```

`@librephotos/api-client` is aliased to the schema barrel only (the package
root would pull in the TanStack hooks and React); `@api-schemas/<file>` reaches
a single schema file. Only import `types.ts` / schema files. When the schema
the frontend uses is defined inside a hook file (e.g. `LoginResponse` in
`auth/hooks/useLoginMutation.ts`, which imports React and the router), import
the identical schema from `packages/api-client` if there is one, or copy it
into `src/schemas/<area>.ts` with a comment naming the source file. Responses
the frontend never validates (photo detail, duplicates, folder subfolders, SSO
config) get a schema in `src/schemas/` written from the field lists in
03-api-surface.md §6.

A contract case that fails on Django is a harness bug or a real Django/frontend
drift; note it in the test (`it.fails` or a comment) rather than loosening the
schema.

### Twin cases

```ts
await expectTwin("alice", { path: "/api/albums/date/list/", query: { favorite: "true" } }, {
  project: ["results[].id", "results[].date", "results[].numberOfItems"],
  unordered: [],            // array paths Django does not order, e.g. "results" or "results[].items"
  headers: [],              // response headers that must match, e.g. "x-media-error"
  numericStrings: false,    // compare "1.50" and 1.5 as numbers
  refStable: true,          // call Django twice first; fails if it disagrees with itself
});
```

Projection paths: `a.b`, `list[].field`, `list[].nested[].field`, `list[].*`
(every key), `*` (whole body). Only project fields the frontend reads (03 §4,
§6). Datetimes compare as instants, numbers numerically, absolute URLs with
the server origin stripped, missing fields as `<missing>`. Status codes are
always compared. Set `refStable: false` for requests that change state.

### Authz matrix

```ts
const cases: AuthzCase[] = [
  { name: "thumbnail of a photo shared to bob", req: { path: `/media/thumbnails_big/${photo("alice/e2e_06").image_hash}` },
    headers: ["x-media-error"], expect: { alice: 200, bob: 200, dave: 404, anonymous: 403 } },
];
it.each(cases)("$name", async c => {
  const matrix = await authzMatrix([c]);
  expect(authzProblems(c, matrix[c.name]!)).toEqual([]);
});
```

Expected statuses come from the reference at run time; `expect` optionally
pins what Django must answer (so a surprise on the reference side fails too).
Redirects are not followed in matrices. `formatMatrix(matrix)` prints the
table, handy for writing the `expect` pins. Seed cases from
`apps/backend/api/tests/media_serving/` and `api/tests/sharing_and_public/`.
Media requests: use `run_django.sh … direct` for the reference when you need
bodies, X-Accel mode when you want to compare `x-accel-redirect` targets.

## 4. Mutation state diffs

Run the same request against Django and the server under test, each on its
own clone with its own media copy, then compare the database and the files.

```bash
F=apps/backend-rs/tests/fixture; PY=$LP_DJANGO_PY; M=C:/Users/Niaz/librephotos/rust-pg/fixture-runs
$F/clone_db.sh lp_mut_ref $M/mut_ref;  LP_MEDIA_ROOT=$M/mut_ref $F/run_django.sh lp_mut_ref 8951 &
$F/clone_db.sh lp_mut_rs  $M/mut_rs    # start the Rust server on lp_mut_rs with BASE_DATA=$M/mut_rs
# ... send the mutation to both (same role, same body) ...
$PY $F/dump_state.py db lp_mut_ref --baseline lp_fixture --media-root $M/mut_ref -o ref.json
$PY $F/dump_state.py db lp_mut_rs  --baseline lp_fixture --media-root $M/mut_rs  -o rs.json
$PY $F/dump_state.py diff ref.json rs.json              # exit 1 and a line per difference
$PY $F/dump_state.py files $M/mut_ref --content -o ref-files.json   # same for the trees
$PY $F/dump_state.py files $M/mut_rs  --content -o rs-files.json
$PY $F/dump_state.py diff ref-files.json rs-files.json      # drop --content above to compare names/sizes only
$F/drop_db.sh lp_mut_ref $M/mut_ref; $F/drop_db.sh lp_mut_rs $M/mut_rs
```

`dump_state.py db` dumps every `api_*` table (`--like` to change) keyed by
primary key; M2M through tables are keyed by their two foreign keys, so
insertion order does not matter. Timestamps become `<unchanged>` / `<bumped>`
against the baseline row, `<set>` on new rows; UUIDs minted by the mutation
become `<new-uuid>`; the clone's media root becomes `<media>`. Use
`--ignore table` or `--ignore table.column` on `diff` for known, accepted
differences (e.g. `api_user.password`: salted hashes never match). A mutation
case is done when the diff is empty. Thumbnails re-encoded by a different
encoder will differ byte-wise; compare those trees without `--content`.

Mutations that write metadata to files (XMP write-back) need the exif
sidecar: `python apps/backend/service/exif/main.py` listens on the fixed port
8010, shared by everything on this machine, so coordinate before starting one.

## Caveats

- Windows cannot store `?` in a file name, so the `%?#;` case is covered by
  `names/100% #1; semi.jpg` (and the album title `Ünïcödé ☀ 100% #;`), not `?`.
- `raw/DSC_0001.dng` is a TIFF carrying `DNGVersion`, not a decodable RAW; it
  exists so `has_raw_variant` and `file_variants[]` have data.
- No motion photo: none can be generated without a real device sample.
- The `running` job row stays "running" forever; anything that reaps stuck
  jobs (> 24 h) will eventually mark it failed in a long-lived clone.
- Stored paths are Windows paths with backslashes (`C:\Users\...\fixture\data\alice\...`).
- The shared Postgres build shipped without `share/postgresql/timezone`, so
  `SET TimeZone = 'UTC'` failed and Django 500'd on every request thread;
  the zoneinfo files from the venv's `tzdata` package were copied there.

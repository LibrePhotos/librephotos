# 06 — Testing: Proving the Frontend Still Works

The Django suite (~30k LOC of `TestCase`) can't run against Rust. Correctness
is established from the outside, with the frontend as the oracle and Django as
the reference implementation. There are six layers, cheapest first.

## 1. Fixture packs

A Django management command on this branch, `seed_fixture`, builds a
deterministic library. Django still exists in the repo, so it's the easiest
way to produce realistic rows.

**Build steps:**

1. Scan `deploy/e2e/photos` plus a small format corpus with ML off. The corpus
   covers a JPEG with an XMP sidecar, HEIC, RAW, a motion photo, a video, and
   a filename-dated screenshot.
2. Inject ML-derived rows through the ORM: faces with synthetic encodings,
   persons, clusters, tags, captions, OCR text.
3. Cover the authz roles:

| Role | Setup |
| --- | --- |
| `admin` | superuser |
| `alice` | owner of most photos |
| `bob` | direct photo shares |
| `carol` | album shares, including one of an album that contains someone else's photo (the GHSA-phvg case) and an expired public share |
| `dave` | stranger |
| anonymous | public photos, a public album slug, a photo share link |

4. Cover the edge states: hidden, trashed, removed, no-timestamp,
   no-thumbnail, the same file hash under two users, stacks, duplicates,
   unicode and `%?#;` filenames.

The output is a pack: a Postgres dump plus a media tree. Every layer below
starts from a fresh `CREATE DATABASE … TEMPLATE` clone of it.

## 2. Contract harness (TypeScript, vitest)

`apps/backend-rs/tests/contract/` imports the **frontend's own schemas**
directly: `packages/api-client/src/schemas/*` and
`apps/frontend/src/api_client/**/types.ts`.

- Each of the 142 inventory operations (03 §5) has a case: role, request,
  expected status, schema.
- **Unvalidated responses** (photo detail, duplicates, folder subfolders, SSO
  config) get a zod schema written from the field list in 03 §6. It lives in
  the harness, not the frontend.
- **Runs against Rust** on every PR, and **against Django** in the same job as
  a sanity check. A case that fails on Django is a harness bug, or a
  Django/frontend drift worth knowing about, like the legacy stack types.
- It generalizes `packages/api-client/src/__tests__/live.contract.test.ts`
  (about 25 endpoints today).

## 3. Differential semantics vs Django

Schemas prove shape, not truth: a timeline with the wrong photos still parses.
`tests/twin` sends each read case to Django and Rust on clones of the same
pack and compares the **projection onto the fields the frontend reads**
(03 §4, §6):

- **Ordering:** exact where the UI relies on it (timeline, pages); set
  comparison where Django itself is unordered. Each case runs twice against
  Django first to detect that.
- **Datetimes:** compared as instants, not strings.
- **Numbers:** compared numerically.
- **Counts, ids, hashes, grouping boundaries:** exact.

## 4. Authorization matrix

Every media kind, photo detail, album detail and public link is requested as
each role. The expected status per cell comes from Django on the same fixture.

The cases are seeded from the two existing spec suites:
- `apps/backend/api/tests/media_serving/`: 11 modules, 249 tests
- `api/tests/sharing_and_public/`

Converting them into matrix cases is a mechanical agent task. This layer is
non-negotiable even for an experiment: a fast backend that leaks private
photos is worse than no backend.

## 5. Mutation state diffs

For each mutation case, run it against Django and against Rust, each on its
own clone. Then compare:

- **The DB:** all `api_*` tables as canonical JSON. Rows are keyed by stable
  natural keys, and timestamps become `bumped` / `unchanged` markers.
- **The files:** `protected_media` and the photo trees, including XMP
  write-back.

A mutation is only done when this diff is clean. That is how the side-effect
list in 02 §5 gets proven rather than assumed.

## 6. Golden vectors for pure logic

Python scripts in `apps/backend-rs/tests/goldens/` import the real Django
functions and emit JSON that Rust unit tests assert against.

| Area | Vectors |
| --- | --- |
| Date extraction | rules × filenames × EXIF × timezones, incl. tz-border coordinates |
| pHash | corpus thumbnails + degenerate images → hex |
| File grouping | path lists → groups, incl. XMP forms and skip patterns |
| Burst rules / auto-album gap rule | sequences → groups |
| Auth | Django-made Argon2/PBKDF2 hashes verify in Rust; JWTs verify both ways |
| Codecs | face-encoding hex, constance values, `"[r, g, b]"`, `round(w/h, 2)` over 10k random ratios |
| ExifTool attribution | `get-tags` requests → values |

## 7. End-to-end

- The existing Playwright smoke suite (`apps/frontend/e2e`, `E2E_BASE_URL`)
  runs against the Rust compose stack.
- The benchmark journeys J1–J6 (05) are Playwright scripts too. They're
  used to record HARs for k6, and they double as extra e2e coverage.

## 8. Rust-side tests

- `sqlx::test` integration tests per handler module, each on a fresh DB built
  from migrations plus the fixture.
- insta snapshots for response DTOs.
- proptest for filter builders and codecs.
- `cargo clippy -D warnings` and `cargo deny` (no `sqlx prepare`: queries are runtime-checked, 02 §2).

## CI

A single workflow, `backend-rs.yml`, path-filtered to `apps/backend-rs/**`:

1. build + clippy + unit tests
2. build the fixture pack (cached on the migration and seed-command hash)
3. contract harness against Rust (and Django)
4. twin diff + authz matrix
5. Playwright smoke

Benchmarks don't run in CI. They need a quiet machine (05).

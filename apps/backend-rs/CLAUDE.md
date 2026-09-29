# backend-rs: conventions for area agents

Experimental Rust rewrite of the LibrePhotos backend (spec: `plans/rust-backend/`).
Goal: measure speed vs Django. Only the React frontend matters: **responses must
pass the frontend's zod schemas** (`packages/api-client/src/schemas/*`,
`apps/frontend/src/api_client/**/types.ts`) and carry the fields listed in
`plans/rust-backend/03-api-surface.md`. Extra fields are harmless; a missing
required field breaks the UI.

## Layout

```
crates/
  lp-core      Config (Django env vars), AppState, ApiError envelope, extractors,
               codecs, Python/DRF time formats, django_crypto, SiteSettings
  lp-db        pool, migrations, adopt, users, scope (authz), pig (photo summary),
               settings, write/ (all mutations), one module per area
  lp-auth      JWT (simplejwt-compatible), Django password hashers, extractors,
               /api/auth/token/{obtain,refresh,blacklist}
  lp-jobs      job_queue enqueue/claim, LongRunningJob helpers, HandlerRegistry, Worker
  lp-api       handlers: src/<area>/ per API area, src/common/ (DRF pagination)
  lp-media     /media/*, /api/downloads/*, /api/public/photo/{slug}/media/*
  lp-ingest    scan pipeline          lp-tasks   sidecar-backed follow-ups
  lp-exif      ExifTool pool (leaf)   lp-sidecars typed sidecar clients (leaf)
  lp-server    binary `librephotos-rs`: serve | worker | migrate | adopt | createadmin
  lp-testkit   test DBs, in-process app, users, tokens
migrations/    0000_baseline.sql (Django api.0142 schema) + additive Rust migrations
```

Dependency direction: exif/sidecars <- core <- db <- {jobs, auth} <- media <- ingest <- tasks <- api <- server <- testkit.

## Where your code goes (no shared-file edits)

Areas: `users_settings`, `timeline_photos`, `photo_edits`, `albums_tags`,
`people_faces`, `search_sharing_public`, `stats_admin_stacks_dupes`,
`jobs_zip_services`, `upload` (+ `auth`, done).

| What | Where |
| --- | --- |
| Handlers + DTOs | `crates/lp-api/src/<area>/` (add submodules freely) |
| Routes | `<area>::routes()` in `lp-api/src/<area>/mod.rs` (already merged by `lp_api::routes()` and `lp-server`) |
| Read queries + row types | `crates/lp-db/src/<area>/` (declared in `lp-db/src/lib.rs` already) |
| Writes (INSERT/UPDATE/DELETE) | `crates/lp-db/src/write/<area>.rs` (turn into `write/<area>/mod.rs` if it grows) |
| Job handlers | `<area>::register_jobs(reg)` (api areas), `lp_ingest::register_jobs`, `lp_tasks::register_jobs`, `lp_media::register_jobs` |
| Media routes | `lp_media::routes()` |
| New migration | `migrations/<YYYYMMDDHHMM>_<area>_<what>.sql` (timestamp version, unique across agents; additive only) |

Do not edit `Cargo.toml` files: every dependency is already declared in every
crate (see `[workspace.dependencies]`). If something is truly missing, add it to
`[workspace.dependencies]` and to your crate only, and say so in your report.
Shared files (`lp-api/src/lib.rs`, `lp-api/src/common/`, `lp-db/src/{scope,pig,users}.rs`,
`lp-core`, `lp-server`) change only for real cross-area needs; keep such edits small.

## Routing

- Full paths, **no trailing slash**: `.route("/api/albums/date/list", get(h))`.
  A middleware strips ONE trailing slash before matching, so `/x/` and `/x` both work.
- axum 0.8 path syntax: `/api/albums/date/{id}`. Two areas registering the same
  path+method panic at startup (the `lp-server` tests build the app).
- Handlers take `State(state): State<AppState>` and return `ApiResult<impl IntoResponse>`.
- `AppState` fields: `db: PgPool`, `config: Arc<Config>`, `settings: Arc<ArcSwap<SiteSettings>>`
  (read with `state.settings()`), `http: reqwest::Client`, `jwt: Arc<JwtKeys>`,
  `exif: lp_exif::ExifPool`, `sidecars: lp_sidecars::Sidecars`, `cpu: Arc<Semaphore>`
  (use `state.blocking(|| ...)` for CPU work), `job_wakeup: Arc<Notify>`, `started_at`.
- Unmatched `/api` and `/media` requests are proxied to `LP_DEV_FALLBACK` (a running
  Django) when set, else 404 envelope.

## Auth

- Extractors (`lp_auth`): `AuthUser` (401 if anonymous), `OptionalUser`, `AdminUser`
  (403 unless `is_staff`, i.e. DRF `IsAdminUser`). All deref to `lp_db::users::User`
  (every `api_user` column). Token from `Authorization: Bearer` (case-insensitive),
  else the `jwt` cookie. A bad header token is a 401 even on anonymous endpoints; a
  bad cookie is just anonymous. The JWT `is_admin` claim is `is_superuser`.
- Tokens are interchangeable with Django (same `SECRET_KEY`, simplejwt claim layout,
  `user_id` as a string). Verified both directions against a running Django.
- Passwords: `lp_auth::password::{verify, hash}` (Django argon2 / pbkdf2_sha256 / sha1);
  hashing is slow, run it via `state.blocking`.

## Responses and errors

- Errors: `lp_core::ApiError` renders `{"errors":[{"field","message"}]}`. Helpers:
  `bad_request(field, msg)`, `validation(msg)` (`non_field_errors`), `unauthorized(msg)` /
  `not_authenticated()` (field `detail`), `forbidden(msg)` / `permission_denied()`,
  `not_found()` (`"Not found."`), `internal(err)`, `status_only(code)`, `.with_header(..)`.
  `?` works on sqlx (`RowNotFound` -> 404), anyhow, io, serde_json errors.
- Inputs: `ApiJson<T>` (400 envelope on bad JSON, tolerates missing content-type),
  `QueryMap` (Django `query_params`: last value wins, `flag(k)` = any non-empty value is
  true, `int(k)`), `ApiQuery<T>`, `lp_core::extract::py_truthy` for JSON bodies.
- Envelopes: DRF page `{count,next,previous,results}` via `lp_api::common::{DrfPage, PageRequest}`
  (absolute next/previous like DRF). Others per 03 §7.
- Serialize with struct field order = Django serializer `fields` order (serde_json has
  `preserve_order`). Time formats (`lp_core::time`):
  `py_isoformat` (`...+00:00`, what serializers get from `.isoformat()`) vs
  `drf_datetime` (`...Z`, DRF `DateTimeField` and raw datetimes from method fields);
  serde helpers `ser_drf`, `ser_drf_opt`, `ser_iso`, `ser_iso_opt`. Microseconds only when non-zero.
- Codecs (`lp_core::codecs`): `FileHash`, `FaceEncoding` (hex f64 LE), `ClipEmbedding`
  (tolerates double-encoded string), `DominantColor` (`"[r, g, b]"`, `css_hex`),
  `py_round(x, n)` / `aspect_ratio(w, h)` (Python rounding, not `(x*100).round()`).
  Encrypted Django fields (`nextcloud_app_password`, SMTP secret): `lp_core::django_crypto::DjangoCrypto`.

## Database

- Runtime-checked sqlx only: `sqlx::query_as::<_, Row>(SQL)` + `#[derive(FromRow)]`,
  `QueryBuilder` for dynamic SQL. No `query!` macros, no `.sqlx/`, no DATABASE_URL at build time.
- `clippy.toml` forbids `sqlx::query*` / `QueryBuilder::new` in lp-api, lp-media and
  lp-auth: SQL lives in lp-db (and lp-jobs/ingest/tasks). Integration tests that need
  raw SQL add `#![allow(clippy::disallowed_methods)]`.
- Authorization (`lp_db::scope`, never inline these): `owned_by`, `visible_to`
  (EXISTS on shared_to), `visible_manager` (`Photo.visible`), `photo_filters` +
  `PhotoFilterParams::{from_query, from_json}` (= `build_photo_queryset`, always
  owner-scoped), building blocks `has_thumbnail_sql`, `stack_visible_sql`, `person`,
  `tag`, `folder` (+ `folder_path_prefixes`, `like_escape`), and
  `album_share_grants(db, photo_id, user) -> PhotoGrants` for media (album shares vouch
  only for the album owner's photos, GHSA-phvg). Each pusher appends one parenthesized
  expression over the photo alias you pass (`"p"`).
- **PigPhoto** (`lp_db::pig`), used by timeline/albums/search/sharing: `pig::by_ids(db, &ids)`
  (order kept) or `pig::query()` + your `WHERE/ORDER/LIMIT` on alias `p` + `pig::fetch`.
  One query, no N+1. `pig::group_by_date(photos)` = `get_photos_ordered_by_date`
  (consecutive UTC-date runs, trailing `"No timestamp"` group). Diffed against Django's
  `PhotoSummarySerializer` on the fixture: identical except stack `photo_count`, where
  Django always reports 1 (its prefetch counts the joined row); Rust returns the real count.
- Writes go through `lp_db::write::*` (see its module docs): supply every NOT NULL
  column (Django columns have no DB defaults), bump `last_modified`/`updated_at`,
  side effects from 02 §5 in the same transaction, file deletions via `AfterCommit`
  after commit. Rows must stay readable by Django (it may run on the same DB).
- Users: `lp_db::users::{by_id, by_username, User, SimpleUser}`, creation with Django
  defaults `lp_db::write::users::create_user`. Site settings: `state.settings()`, write
  with `lp_db::write::settings::save(&state, &[("ALLOW_UPLOAD", json!(true))])`
  (also mirrors into `constance_constance`).

## Jobs

- `lp_jobs::enqueue(&state, "zip.build", json!({...}), EnqueueOptions::tracked(JobType::DownloadPhotos, user.id))`
  returns `Enqueued { id, lrj_id }` (`lrj_id` = the `api_longrunningjob.job_id` the UI polls).
  Inside a transaction: `enqueue_in(&mut tx, ..)` then `lp_jobs::wake(&state)` after commit.
- Handlers: `reg.register("zip.build", |ctx: JobCtx| async move { ... })` in your
  `register_jobs`; kinds are `<domain>.<verb>`; duplicates panic at startup.
  `ctx.state`, `ctx.job.payload`, `ctx.job.lrj_id`.
- Progress/results: `lp_jobs::lrj::{start, set_target, set_step, set_result, finish, fail,
  cancel, is_cancelled}`, batched `Progress`, `JobErrors` (04 §2 result shape).
- The worker loop itself is still a TODO (`lp_jobs::Worker::run`): jobs stay queued until
  the jobs agent lands it.

## Testing

- `cargo test` (debug; one target dir per worktree). Tests need the dev Postgres
  (`LP_TEST_PG_HOST/PORT/USER/PASS`, default `localhost:5433 postgres/x`).
- `lp_testkit::TestApp::new()` = private DB (mutations OK; ~10 s to create on this Windows box),
  `TestApp::shared()` = one DB per test binary (read-only or unique-named rows; fast),
  `TestApp::attach(db, env)` = existing DB. DBs come from `LP_TEST_TEMPLATE`
  (default `lp_fixture`, adopted/migrated on clone), else an empty schema from migrations.
  Helpers: `create_user(name, pw, admin)`, `token_for(&user)`, `get/post_json/patch_json/delete`,
  `request(req)`, `TestResponse::{json, text, header}`. Always `app.cleanup().await`.
  Leftover `lptest_*` DBs of dead processes are swept automatically.
- Put DB tests in `crates/<crate>/tests/*.rs` (integration tests), not `#[cfg(test)]`
  in lib code (lp-testkit depends on your crate).
- Contract: check your JSON against the zod schema field list and 03 §6; for exact
  parity diff against Django on the same DB (recipe below).
- Before committing: `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.

## Running

```bash
# env (same names as Django); Postgres on :5433, trust auth
export BASE_DATA=<dir> BASE_LOGS=<dir>/logs SECRET_KEY=rust-bench-secret \
  DB_NAME=<yourdb> DB_USER=postgres DB_PASS=x DB_HOST=localhost DB_PORT=5433 \
  LP_BIND=127.0.0.1:8001 LP_MEDIA_MODE=direct
V=/c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Lib/site-packages
export LP_EXIFTOOL=$V/exiftool_bin/exiftool.exe LP_FFMPEG=$V/ffmpeg_bin/bin/ffmpeg.exe \
  LP_FFPROBE=$V/ffmpeg_bin/bin/ffprobe.exe LP_VIPS_LIB=$V/libvips-42-e6cc51bbc763e7deda536c6f56ce96b4.dll
createdb -h localhost -p 5433 -U postgres -T lp_fixture <yourdb>   # or -T lp_django (empty)
cargo run -p lp-server -- adopt          # once per Django DB copy
cargo run -p lp-server -- createadmin admin admin@example.com   # ADMIN_PASSWORD=...
cargo run -p lp-server -- serve          # optional LP_DEV_FALLBACK=http://127.0.0.1:<django port>
```

Fresh empty DB instead: `createdb` + `librephotos-rs migrate`. Other env: `LP_DB_POOL`,
`LP_EXIF_POOL`, `WORKER_CONCURRENCY`, `LOG_LEVEL`/`RUST_LOG`, `FEATURE_*`, `TRANSCODE_*`,
`REFRESH_TOKEN_DAYS`, `MAP_*`, `ALLOW_UPLOAD` (see `lp_core::config`).

### Django reference server (same DB, for diffs)

```bash
PY=/c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Scripts/python.exe
cd <your worktree>/apps/backend
BASE_DATA=... BASE_LOGS=... SECRET_KEY=rust-bench-secret DB_BACKEND=postgresql DB_NAME=<db> \
DB_USER=postgres DB_PASS=x DB_HOST=localhost DB_PORT=5433 BACKEND_HOST=127.0.0.1 \
DJANGO_SETTINGS_MODULE=librephotos.settings.production \
  $PY -m uvicorn librephotos.asgi:application --host 127.0.0.1 --port <port>   # never --reload
```

`BACKEND_HOST=127.0.0.1` is needed or Django answers 400 (ALLOWED_HOSTS). Django and
Rust can share one adopted DB (Rust migrations are additive). Kill only PIDs you started.
Token interop check: `cargo test -p lp-auth --test django_interop -- --ignored` (env in the file).

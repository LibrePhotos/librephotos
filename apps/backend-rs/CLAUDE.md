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
  lp-ml        in-process ML (ONNX Runtime), model store, sidecar/in-process switch
  lp-server    binary `librephotos-rs`: serve | worker | migrate | adopt | the manage.py
               command ports (createadmin, createuser, scan, save_metadata, ...; CLI.md)
  lp-testkit   test DBs, in-process app, users, tokens
migrations/    0000_baseline.sql (Django api.0142 schema; also api.0143/0144, SQLite-only) + additive Rust migrations
```

Dependency direction: exif/sidecars <- ml <- core <- db <- {jobs, auth} <- media <- ingest <- tasks <- api <- server <- testkit.

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
  `exif: lp_exif::ExifPool`, `sidecars: lp_sidecars::Sidecars`, `ml: lp_ml::Ml` (call through
  `state.ml()`), `cpu: Arc<Semaphore>`
  (use `state.blocking(|| ...)` for CPU work), `job_wakeup: Arc<Notify>`, `started_at`.
- Unmatched `/api` and `/media` requests are proxied to `LP_DEV_FALLBACK` (a running
  Django) when set, else 404 envelope.

## Auth

- Extractors (`lp_auth`): `AuthUser` (401 if anonymous), `OptionalUser`, `AdminUser`
  (403 unless `is_staff`, i.e. DRF `IsAdminUser`). All deref to `lp_db::users::User`
  (every `api_user` column). Like DRF's default authentication they read only
  `Authorization: Bearer` (exact scheme); the ambient `jwt` cookie is ignored, so
  cross-site requests carry no credentials. `CookieUser` / `CookieOptionalUser`
  (Django's `JWTCookieAuthentication`, for media and downloads only) also accept
  any-case `bearer` and fall back to the `jwt` cookie. A bad header token is a 401
  even on anonymous endpoints; a bad cookie is just anonymous. The JWT `is_admin`
  claim is `is_superuser`.
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
- Chains (Django `Chain`): `EnqueueOptions::tracked(..).after(other.id)` stores `depends_on`;
  the row is claimable only once every dependency left queued/running (done, failed,
  cancelled or deleted all release it), and the worker is woken when one finishes.
- Handlers: `reg.register("zip.build", |ctx: JobCtx| async move { ... })` in your
  `register_jobs`; kinds are `<domain>.<verb>`; duplicates panic at startup.
  `ctx.state`, `ctx.job.payload`, `ctx.job.lrj_id`.
- Progress/results: `lp_jobs::lrj::{start, set_target, set_step, set_result, finish, fail,
  cancel, is_cancelled}`, batched `Progress`, `JobErrors` (04 §2 result shape).
- `serve` embeds the worker (`worker` runs it alone). It claims only registered kinds,
  runs the `maintenance.*` schedules, and fails a handler's LongRunningJob only after
  the last attempt; handlers finish their own LRJ.
- Shutdown (Ctrl-C, SIGTERM; Ctrl-Break / console close on Windows): the listener stops,
  the worker claims nothing new and gives running jobs `LP_SHUTDOWN_GRACE_SECS` (8) to stop.
  Long handlers check `lp_jobs::shutting_down()` at safe points and return
  `lp_jobs::interrupted()` (cleaning partial output first); the row goes back to the queue
  (attempt not counted, LRJ left running). Handlers still running after the grace are
  aborted and handed back the same way, so keep partial files behind drop guards
  (zip `.part`, ffmpeg output). Scan and zip have safe points.

## ML (`lp-ml`)

- Every ML capability is a trait in `lp_ml::<service>` with two impls, the HTTP
  sidecar client (`lp_sidecars::Sidecars`) and `lp_ml::<service>::InProcess`:
  `clip::ClipApi`, `similarity::SimilarityApi`, `tags::TagsApi`, `ocr::OcrApi`,
  `face::FaceApi`, `caption::CaptionApi`, `face_cluster::FaceClusterApi`,
  `raw_thumbnail::RawThumbnailApi`. Callers use `state.ml().clip().query_embedding(..)`
  (never `state.sidecars.*` or raw sidecar URLs); blocking code takes `state.ml_handle()`.
- Selection per call: `LP_ML_<SERVICE>=inprocess|sidecar|auto` (`CLIP`, `SIMILARITY`,
  `TAGS`, `OCR`, `FACE`, `CAPTION`, `FACE_CLUSTER`, `RAW_THUMBNAIL`; default auto).
  Auto = in-process when `InProcess::IMPLEMENTED` (all eight are) and the sidecar
  is not redirected (`LP_SIDECAR_<NAME>_URL` / a test's `with_base` mock); a
  missing model is `unavailable` in-process (and queues `models.download`), not
  a sidecar fallback. The Python sidecars are opt-in (`LP_ML_<SERVICE>=sidecar`):
  the worker supervises (starts) only those, unless `LP_SUPERVISE_SIDECARS=0|1`
  forces it. Tests override with `state.ml.set_mode(Service::Clip, Mode::Sidecar)`.
- Errors stay `SidecarError`: `lp_ml::bad_input` (400), `failed`/`failed_from` (500),
  `unavailable` (no model/runtime).
- A port fills only `crates/lp-ml/src/<service>/inprocess.rs` (+ submodules): load
  models through `ctx.slot::<T>(Service::X, "label")` (`ModelSlot::run(key, load, f)`:
  lazy, per-model concurrency `LP_ML_<SERVICE>_CONCURRENCY`, idle unload after
  `LP_ML_IDLE_UNLOAD_SECS`=120), sessions via `lp_ml::runtime::session(path)`
  (`ONNX_PROVIDERS`, `ONNX_INTRA_OP_THREADS`), preprocessing from `lp_ml::preprocess`
  (Pillow-exact `pil::resize`, cv2-exact `cv2::resize_linear/area`, `to_chw`, `load_rgb`) and
  `lp_ml::tokenize`; flip `IMPLEMENTED` when its goldens pass. `build_state` installs
  `lp_ingest::vips::install_ml_decoder`, so `load_rgb` decodes JPEG through libvips
  (bit-exact with Pillow/cv2) when `LP_VIPS_LIB` is set.
- ONNX Runtime is loaded at runtime (`ort` load-dynamic): `LP_ORT_LIB` (or
  `ORT_DYLIB_PATH`) = `.../onnxruntime/capi/onnxruntime.dll` of the Django venv here.
  GPU: `ONNX_PROVIDERS` = `dml` (DirectML build, `onnxruntime-directml`: `onnxruntime.dll` +
  `DirectML.dll`, preloaded from beside it) or `cuda` (`onnxruntime-gpu` 1.27 = CUDA 13 + cuDNN 9 on
  `PATH`; cuDNN 9.27 is ~30x slower on Turing for MobileCLIP, 9.13 is fine); unset = CUDA, DirectML,
  CPU, whichever the loaded runtime offers (bench: `ml_footprint.py --gpu-ort dml|cuda`, runtimes in
  `rust-pg/gpu`).
  Every model call goes through `lp_ml::runtime::run(&mut session, inputs)` (it applies
  the CPU arena mode: `LP_ORT_CPU_ARENA=shared` by default, one environment-wide arena
  shrunk after each run); `run_keep` only for steps that reuse the buffers (decoder loops).
- Models: `lp_ml::models` (the `api/ml_models.py` catalog, sha256 pins, `.part` +
  rename); job `models.download` (`lp_tasks::models`), queued by the triggers when
  models are missing (`LP_ML_AUTO_DOWNLOAD`, off in `TestApp`); ML jobs wait for a
  running download. CLI: `librephotos-rs models [--download NAME.. | --all]`.
- Semantic search model: site setting `SEMANTIC_SEARCH_MODEL` (`mobileclip_s2` default,
  `clip_vit_b32`; `lp_ml::clip::SemanticModel`, `state.ml().semantic_model()`). With MobileCLIP
  as tagger and search model (`semantic_shares_tagger()`), `tags.generate` stores the search
  embedding from the tagger's run and `clip.embed` only fills gaps. Every Rust write of
  `clip_embeddings` also sets `clip_embeddings_model` (NULL = Django = `clip_vit_b32`,
  `SemanticModel::stored`; a trigger resets it when a non-`librephotos-rs` connection changes the
  embedding). The index and similar photos use only the selected model's embeddings; others are
  re-embedded in place, never NULLed (`lp_tasks::clip::reembed_mismatched` queues `clip.embed`).
- Goldens: `tests/ml/README.md` (Python generators) + `lp_ml::golden` (Rust loader).
  Shared test models: `<librephotos>/rust-pg/ml/protected_media/data_models`.

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
`LP_EXIF_POOL` (2) / `LP_EXIF_IDLE_SECS` (15, idle ExifTool processes stop), `LP_ORT_CPU_ARENA`
(`shared` default, `1`/`0`/`shrink`), `LP_VIPS_CONCURRENCY` (1), `LP_THUMB_KEEP` (`icc` default:
thumbnails carry no EXIF/GPS; `all`, `none`), `LP_THUMB_SMALL_Q` (80: WebP quality of the 500/250 px
squares; big stays 95), `LP_SCAN_CONCURRENCY` (0 = max(workers, min(cores, 8))
groups a scan renders at once), `LP_ML_PIPELINE` (on: ML jobs prepare photos outside the model slot,
`0` = serial), `LP_SCAN_INLINE_ML` (`auto`: on a GPU the scan runs tags/embedding/faces per photo
as it renders; `1`/`0`), `LP_SCAN_INLINE_ML_SOURCE` (`webp` default = the decoded big WebP, exact
parity with the follow-up jobs; `pixels` = libvips' pixels before the encode), `LP_ML_BATCH`,
`LP_TAG_STORE_BATCH` (64), `LP_TAG_STORE_WAIT_MS` (500: the tag writer waits this long for a fuller batch), `LP_SCAN_VIDEOS_FIRST` (on), `LP_SCAN_TIMERS` (off; per-stage scan timers in the log), `LP_THUMB_EFFORT` / `LP_THUMB_SMALL_EFFORT` (2), `LP_SCAN_REGION_PROBE` (off), `LP_FACE_DET_SIZE` (`640`; `480`/`320`/`auto` fast modes), `LP_OCR_PREPASS` (off; e.g. `640`:
skip full OCR when a coarse detection finds no text), `WORKER_CONCURRENCY`, `LOG_LEVEL`/`RUST_LOG`, `FEATURE_*`, `TRANSCODE_*`,
`REFRESH_TOKEN_DAYS`, `MAP_*`, `ALLOW_UPLOAD` (see `lp_core::config`), `FRONTEND_BASE_URL`
(public origin for the OIDC callback), `LP_OIDC_PROVIDERS` (JSON `[{id, name, client_id, secret,
server_url, settings?}]`, OIDC providers for databases without allauth's `SocialApp` table).
Logs go to stdout and to `BASE_LOGS/ownphotos.log` (Django's line layout, rotated at
200 MB), which the admin log viewer reads.

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

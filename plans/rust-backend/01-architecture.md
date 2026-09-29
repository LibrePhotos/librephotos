# 01 — Architecture

## Process layout

```
                         ┌──────────────── backend container (Rust image) ────────────────┐
browser ── nginx ──/api,/media──► librephotos-rs :8001                                     │
 (React)   (unchanged)│         ├─ axum API ─────────────► Postgres (existing schema)      │
   ▲                  │         ├─ job worker (tokio) ────► exiftool pool (-stay_open)      │
   │ X-Accel-Redirect │         │                    ├────► ffmpeg / ffprobe                │
   └──────────────────│         │                    ├────► libvips (FFI)                   │
                      │         └─ sidecar supervisor ───► Python sidecars (unchanged):     │
                      │                                    similarity 8002, thumbnail 8003, │
                      │                                    face 8005, clip 8006,            │
                      │                                    caption 8007, tags 8011,         │
                      │                                    ocr 8012, + face_cluster 8013    │
                      └────────────────────────────────────────────────────────────────────┘
```

**Replaced:**
- Django + DRF under uvicorn/a2wsgi
- django-q2 `qcluster` and its 5 recurring schedules
- the Python exif sidecar (8010)
- `manage.py start_service` and its watchdog

**Kept:** nginx and the frontend container, both unchanged. The Python ML
sidecars are kept too, since they never imported Django; the only difference
is that Rust launches them.

**One new Python sidecar, `face_cluster`.** Face clustering (HDBSCAN + two
sklearn `MLPClassifier` passes + PCA for the scatter plot) currently lives
inside Django in `api/face_classify.py`. It moves, logic unchanged, into a
Django-free Flask service. The service receives encodings and user labels and
returns cluster assignments and predictions. Porting clustering to Rust is out
of scope (see 04).

## One binary, several subcommands

| Command | Does |
| --- | --- |
| `librephotos-rs serve` | API + embedded worker + sidecar supervisor. This is the default container command. |
| `librephotos-rs worker` | Worker only, for splitting API and background load across processes when benchmarking |
| `librephotos-rs migrate` | Apply Rust migrations |
| `librephotos-rs adopt` | Take over an existing Django database (02 §1) |
| `librephotos-rs createadmin` | First admin user (entrypoint parity with `ADMIN_USERNAME`/`ADMIN_EMAIL`) |

## Workspace (`apps/backend-rs`)

```
apps/backend-rs/
  Cargo.toml              # workspace, edition 2024, rust-toolchain.toml pinned
  crates/
    lp-server/            # bin: CLI, config, router assembly, sidecar supervisor
    lp-api/               # handlers + DTOs, one module per frontend feature area (03)
    lp-db/                # sqlx queries, codecs, authz scopes, write services (side effects)
    lp-auth/              # JWT issue/verify, cookies, Django-compatible password hashers
    lp-media/             # /media/* serving: X-Accel or direct with ranges, path confinement
    lp-jobs/              # Postgres job queue, LongRunningJob progress, scheduler
    lp-ingest/            # scan pipeline, thumbnails (libvips), pHash, video, motion photos
    lp-exif/              # ExifTool -stay_open pool (read + write)
    lp-sidecars/          # typed HTTP clients for the Python sidecars
  migrations/             # sqlx migrations; 0000 = adopted Django schema baseline
  sidecars/face_cluster/  # the one new Python sidecar
  bench/                  # 05
  tests/                  # 06: contract, differential, authz matrix
```

Several crates keep incremental compiles fast while agents iterate. Handlers
depend on `lp-db`/`lp-auth`/`lp-media`, never the other way round.

## Crate choices

| Concern | Choice | Why |
| --- | --- | --- |
| HTTP | **axum 0.8**, tokio, tower-http (trace, timeout, cors, request-id) | Default modern stack; tower-http `ServeFile` gives range support for direct media |
| DB | **sqlx 0.8 (Postgres)**, runtime-checked `query_as::<_, T>` + `FromRow`, `QueryBuilder` for dynamic filters (02 §2) | No ORM layer means no ORM overhead in a speed experiment. Runtime checking lets parallel agents build without a database or `.sqlx/` files. |
| JSON | serde + serde_json | Struct field order is preserved. Swap in simd-json/sonic-rs only if profiling says so. |
| Auth | jsonwebtoken, argon2, pbkdf2 + sha2 | Existing users log in with their Django password hashes |
| Time | jiff (or chrono + chrono-tz), tzf-rs | tzf-rs replaces `timezonefinder` (loaded once, not per call) |
| Regex | fancy-regex | User date-extraction rules are Python-syntax regex with lookbehind |
| Imaging | libvips via FFI (rs-vips / libvips-rs), md-5, memchr, infer | Same engine as today's pyvips; fast |
| Metadata | ExifTool subprocess pool | Nothing in Rust matches ExifTool's coverage |
| Video | ffmpeg / ffprobe via tokio::process | Same binaries and args as today |
| HTTP client | reqwest (rustls) | Sidecars, geocoding providers |
| Email | lettre | Password reset and test email |
| OIDC (optional) | openidconnect | Only if SSO makes the cut (07) |
| Observability | tracing, tracing-subscriber, metrics + Prometheus exporter | Per-route histograms feed the benchmark report |
| Tests | `sqlx::test` (a fresh DB per test), insta, proptest | |

## Configuration: the same env as today

`librephotos-rs` reads the **existing environment variable names**, so the
current `librephotos.env` and compose files work with only an image swap:

- **Paths and secrets:** `BASE_DATA`, `BASE_LOGS`, `PHOTOS`, `SECRET_KEY`
  (else `$BASE_LOGS/secret.key`, generated if missing)
- **Database:** `DB_NAME/USER/PASS/HOST/PORT`
- **Features:** `FEATURE_*`, `ALLOW_UPLOAD`, `TRANSCODE_*`,
  `REFRESH_TOKEN_DAYS`, `MAP_API_PROVIDER` / `MAPBOX_API_KEY` /
  `MAP_TILE_PROVIDER`
- **Process tuning and logging:** `WORKER_CONCURRENCY`, `LOG_LEVEL`,
  `ONNX_PROVIDERS` (passed through to sidecars)
- **Admin bootstrap:** `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD`

New variables:

| Var | Default | Meaning |
| --- | --- | --- |
| `LP_MEDIA_MODE` | `x-accel` | `direct` streams files from Rust. Used for native dev behind Vite's proxy, and as a benchmark variant. |
| `LP_DB_POOL` | `2 × cores` | sqlx pool size |
| `LP_EXIF_POOL` | `min(4, cores)` | ExifTool processes per pool (plain + `-struct`) |
| `LP_SIDECARS` | from `FEATURE_*` | Which Python sidecars to supervise |

Site settings (formerly constance) live in a `site_settings` table (02 §4).

## Deployment

- **Image:** `deploy/docker/backend-rs/Dockerfile` has two stages.
  - **Builder:** `rust:1.95` + `libvips-dev`, building a release binary with
    `lto = "thin"` and `codegen-units = 1`.
  - **Runtime:** `ubuntu:noble` with `libvips42`, exiftool (perl), ffmpeg,
    python3, and a **sidecar-only** requirements file (`sidecars.txt`):
    flask, gevent, onnxruntime, insightface, numpy, pillow, rawpy,
    faiss-cpu, tokenizers, sentencepiece, opencv-headless, pyclipper,
    hdbscan, scikit-learn. No Django, DRF, django-q2 or allauth.
- **arm64:** built on native `ubuntu-24.04-arm` runners, not QEMU. Production
  users are on arm64.
- **Compose:** `deploy/compose/docker-compose.rs.yml` overrides only the
  `backend` service image and command. Volumes, env and nginx stay identical,
  so switching back is one flag.
- **Native dev (Windows/Linux):**
  - Postgres runs locally or via pgserver.
  - `cargo run -p lp-server -- serve` with `LP_MEDIA_MODE=direct`, and the
    frontend's `yarn start` with `VITE_BACKEND_URL=http://localhost:8001`.
  - ML features off unless the sidecars' Python env is present.

## Performance-relevant runtime choices

- **Threads:** a tokio multi-thread runtime with worker threads = cores. CPU
  work (libvips, MD5, pHash, zip) runs on `spawn_blocking` with a bounded
  semaphore. API latency never shares a thread with a thumbnail encode.
- **Limit external resources explicitly:** the ExifTool pool, an ffmpeg
  budget, per-sidecar in-flight limits, and `VIPS_CONCURRENCY`. Today nothing
  caps libvips threads per worker.
- **No per-request allocation storms:** prepared statements (sqlx caches
  them), `Arc`-shared config and site settings (reloaded on write, not read
  per request), and streaming for large JSON lists.
- **Compression:** neither nginx nor Django compresses API responses today.
  Keep it off on both sides for the headline numbers. Measure an
  nginx-gzip variant separately: large timeline JSON is where compression
  matters.

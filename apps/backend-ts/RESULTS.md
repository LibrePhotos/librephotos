# Django vs Rust vs TypeScript (Bun + TanStack Start + Drizzle): results (2026-10-07)

Third contender in the backend experiment. `apps/backend-ts` is a big-bang
rewrite of the React-facing API in TypeScript, with the same scope and the
same yardsticks as the Rust rewrite (`apps/backend-rs`, `plans/rust-backend/`):

- **Runtime:** Bun 1.4.2 serving TanStack Start 1.168 server routes.
- **Database:** Drizzle 0.45 over Bun's built-in Postgres driver.
- **Jobs and ML:** the job worker runs in the same process, and ML runs in-process
  through onnxruntime-node.

Two rounds were measured on the same day:

- **wave 1:** the first complete port, on Bun 1.3.14, with ML through Django's
  Python sidecars.
- **wave 2:** an optimization pass, then the in-process ML port. Both are
  described below.

## Completeness and correctness

- **Routes:** all 183 of the (method, path) pairs that `librephotos-rs` serves
  have a TS route (`python apps/backend-ts/scripts/route_coverage.py`). That
  covers the 142 live frontend operations plus the Rust extras: mobile sync,
  health probes, services, downloads and the OIDC callback.
- **Contract suite** (`LP_SUITE_RS=ts run_suite.sh`, every unit, Django as the
  reference on a clone of the same fixture):
  - On the final wave-2 code, all 13 read units and all 15 mutation units pass,
    with 0 failures.
  - The mutation state diffs contain only the lines already accepted for Rust:
    salted password hashes, share slugs and face-crop encoder bytes.
- **Scan parity:** `tests/ingest/scan_diff_ts.sh` finds 0 differences against
  Django's scan of the fixture tree. That covers rows, pHash, dates, albums,
  colours, and byte-identical thumbnails at `LP_THUMB_SMALL_Q=95`.
- **ML parity, in-process.** These are the same goldens Rust is tested
  against: reference outputs of the Python model code.
  - **CLIP / MobileCLIP / tagger / similarity:** bit-exact on MobileCLIP
    (tags, embeddings and index files are byte-identical to Rust's output).
  - **Faces:** boxes exact, encodings bit-identical to Rust on a 32-photo run.
  - **HDBSCAN / MLP:** labels identical.
  - **OCR:** text and boxes bit-exact.
  - **LFM2-VL captions:** token-identical on 64/64 cases, where Rust gets 62/64.
- **ML task parity, sidecar mode:** `tests/tasks/run_diff.sh` with
  `LP_DIFF_SUT=ts` diffs clean against Django on the mock sidecars.

## Setup

Hardware and environment:

- Ryzen 5 2600X (6C/12T), 32 GB, NVMe, Windows 11, native, no nginx.
- Postgres 16 on the same box, fsync off.
- API and scan runs pin the server to 6 logical CPUs, Postgres to 4 and the
  load client to 2. Media is served directly by each server.

Contenders:

- **django-tuned:** uvicorn, 6 workers × 4 threads, no recycling.
- **rust:** the `librephotos-rs` release build (experiment/rust-backend, built
  2026-10-05), pool 12.
- **ts:** `bun run server.ts` after `bun run build`, pool 12. **One process,
  one JS thread for HTTP.**
  - Bun's `reusePort` and `node:cluster` do not load-balance on Windows. Both
    were tested: every connection lands on the first process.
  - So TS gets one core for request handling, while Rust and Django use 6.
  - On Linux, `reusePort` would allow N processes.

## API throughput (`bench/quick.py --ds 50k`, synthetic 50k-photo library, c=32, 4 s/cell)

Requests per second. Every response is checked against the endpoint plan
(status, counts, ids, media bytes); all three had 0 check failures and 0
errors. The wave-1 TS column comes from the first report; the other three
columns are the wave-2 run (label "wave2 final", 2026-10-07 17:4x). Django
varies by about ±25% between runs.

| endpoint | django-tuned | rust | ts wave 1 | **ts wave 2** | ts / rust |
|---|---:|---:|---:|---:|---:|
| user album detail | 10.5 | 768 | 739 | **781** | 1.02 |
| thing album list | 49.5 | 746 | 715 | **810** | 1.09 |
| user self | 147 | 621 | 731 | **752** | 1.21 |
| persons | 102 | 494 | 522 | **524** | 1.06 |
| user album list | 16.5 | 98 | 95 | **96** | 0.98 |
| timeline day page | 104 | 1,956 | 1,416 | **1,912** | 0.98 |
| timeline deep page | 42.2 | 263 | 257 | **260** | 0.99 |
| timeline date list | 11.2 | 20.5 | 23.2 | **20.2** | 0.99 |
| place album list | 8.8 | 18.2 | 18.0 | **18.0** | 0.99 |
| text search ("beach") | 0 (none finished) | 5.0 | 3.8 | **4.8** | 0.96 |
| photo detail | 146 | 3,134 | 1,975 | **2,513** | 0.80 |
| small thumbnail | 435 | 3,466 | 1,155 | **1,952** | 0.56 |
| big thumbnail | 445 | 3,488 | 764 | **1,927** | 0.55 |
| jobs list | 429 | 5,327 | 2,043 | **2,615** | 0.49 |
| site settings | 332 | 8,113 | 2,334 | **3,285** | 0.40 |
| rqavailable (2 s poll) | 685 | 7,585 | 2,388 | **3,089** | 0.41 |

- **Database-bound endpoints** (album detail and lists, persons, users, the
  timeline pages, the date list, search): TS is level with Rust. Both send
  Postgres the same 1–3 statements, and Postgres does the work. Django is 2–74×
  slower here, mostly because of its queries, not the language.
- **JSON-heavy pages:** the day page is now at 98% of Rust and photo detail at
  80%.
- **Tiny endpoints and media:** TS runs at 40–56% of Rust. The cost is per
  request: about 125 µs for HTTP plus Start routing, and 50–100 µs of CPU per
  Postgres round trip in Bun's driver, all on one JS thread. Rust spreads the
  same work over 6 cores.

## Scan (`bench/w4.py scan`, 2,025 generated files, ML off, 6 workers)

| | wall time | files/s | peak memory (tree) | CPU s | no-change rescan |
|---|---:|---:|---:|---:|---:|
| rust | 117.9 s | 17.2 | 1,129 MiB | 666 | 0.59 s |
| **ts wave 2** | **131.3 s** | **15.4** | 1,271 MiB | 730 | **0.58 s** |
| ts wave 1 | 149.2 s | 13.6 | 1,298 MiB | 730 | 1.10 s |
| django-tuned | 288.0 s | 7.0 | 3,024 MiB | 842 | 1.93 s |

- **Outcome:** all three produced the same result: 2,025 photos, 6,075
  thumbnail files and 1,571 date albums. Rust and TS wrote byte-identical
  thumbnail totals.
- **Speed:** TS reaches 90% of Rust and is 2.2× faster than Django.
- **Memory:** about 950 MiB of every peak is the ffmpeg video transcodes. The
  Bun process itself peaks at 264 MiB, against 54 MiB for the Rust process.

## ML-on scan (`bench/ml_footprint.py scan <side> --concurrency 1`, 290 photos, 4 pinned CPUs)

The sequence for each backend:

1. Scan, with the tags, CLIP and faces follow-ups.
2. Face clustering and training.
3. An OCR full scan (`ppocrv6_small`).
4. 10 captions on demand (LFM2.5-VL-450M).

All ML runs on the CPU with 4 ONNX threads. Rust and TS run it in-process;
Django uses its 8 Python sidecars.

| | scan+tags+CLIP+faces | files/s | OCR (289) | 10 captions | idle RSS | peak RSS | peak private |
|---|---:|---:|---:|---:|---:|---:|---:|
| rust | 58.8 s | 4.93 | 135.1 s | 30.4 s | 15 MB | 765 MB | 737 MB |
| **ts** | **79.5 s** | **3.65** | **217.5 s** | **35.5 s** | **68 MB** | **1,852 MB** | **2,323 MB** |
| ts, `LP_ORT_CPU_ARENA=0` | 80.4 s | 3.61 | 237.8 s | 39.8 s | 68 MB | 1,416 MB | 1,794 MB |
| django + 8 sidecars | 274.2 s | 1.06 | 167.3 s | 31.2 s | 1,440 MB | 4,283 MB | 12,445 MB |

- **Matching results.** All four runs agree: 51 faces, all clustered, and 10
  captions.
  - TS and Django handle the HEIC sample through Pillow, so they report
    290/290 photos tagged and embedded and 289 OCR rows.
  - The Windows libvips that Rust uses cannot decode HEIC, so Rust reports
    289/288.
- **Speed.**
  - Scan stage: TS is 74% of Rust's speed and 3.4× Django's.
  - Captions: within 15% of Rust, because ONNX Runtime does nearly all of the
    work.
  - OCR: TS is the slowest of the three. Detection and recognition run at
    ONNX Runtime speed, but the box geometry, warps and resizes are plain JS on
    the main thread; Rust runs them natively.
- **Memory.** TS peaks at about 2.4× Rust, but at less than half of Django. The
  causes:
  - Each onnxruntime-node session keeps its own memory arena at its peak, and
    there is no shared, shrinkable arena like the one Rust uses.
  - The JS heap is larger.
  - Tensors are copied to the ORT worker threads.
  
  Turning the arena off saves 436 MB at the peak, for about 10% slower OCR and
  captions.

## Footprint (API server only, 50k library)

| | cold start | idle working set | idle private | after 5 s of load |
|---|---:|---:|---:|---:|
| rust | 0.53 s | 21.4 MiB | - | 28.4 MiB |
| ts wave 2, `bun run server.ts` | 0.57 s | 75.2 MiB | 280 MiB | 113.2 MiB |
| ts wave 2, AOT bytecode (`start:aot`) | 0.58 s | 81.6 MiB | 160 MiB | 127 MiB |
| ts wave 1 (Bun 1.3.14) | 0.64 s | 145.8 MiB | 480 MiB | 199.7 MiB |
| django-shipped | 4.66 s | 199.5 MiB | - | 228.2 MiB |

`bench/footprint_ts.py` and `bench/ts_tune.py` measured these. The TS cold
start excludes `bun run build`, which runs once.

## Wave 2: what changed and what each step bought

| change | effect |
|---|---|
| Bun 1.3.14 → 1.4.2 (`engines >= 1.4.2`, `LP_BUN` in the harness) | +20–50% req/s on every endpoint; idle 142 → 96 MiB working set, 480 → 309 MiB private |
| Prepared statements for the per-request user lookup | Drizzle's builder costs about 7 µs per selected column on Bun, so the 45-column lookup spent 0.35 ms per request building SQL; the lookup went from 1.9k to 12k/s |
| One module graph: a custom TanStack Start server entry (`src/server.ts`) | The root `server.ts` had imported `src/` next to the built bundle, so every module existed twice, including the connection pool (24 connections for `LP_DB_POOL=12`) |
| Native packages and job handlers load on first use (`src/lib/native.ts`, `registerLazyJobs`) | Start evaluates every route at boot, so a static `import sharp` loaded libvips, ExifTool and ORT into every idle server |
| `/media/*` skips the router; files go out as `Bun.file` slices | Thumbnails 1.2k → 1.95k req/s (small), 0.76k → 1.93k (big) |
| Static datetime SQL fragments; `encodeURIComponent` for Django-style path quoting | In-process: rqavailable 3.9k → 5.5k req/s, photo detail 2.3k → 3.0k |
| Scan: pHash and dominant colour on worker threads (`LP_SCAN_HASH_WORKERS`) | Pillow-exact JS took about 15 ms per photo on the main thread; scan 13.6 → 15.4 files/s with identical pHashes |
| ONNX Runtime sessions on worker threads (`LP_ML_THREADS`, default 2) | onnxruntime-node's `run()` blocks the calling JS thread: during ten 120 ms runs a 10 ms timer fired 9 times instead of ~120, freezing the API. With the worker threads it fires 119 times (1 ms lag), with the same outputs |
| AOT = JSC bytecode (`build:aot`: `bun build --bytecode`, packages external) | Same speed and cold start; private memory 280 → 160 MiB |

Tried and dropped:

- **A single-file `--compile` executable.** Packages loaded from disk resolve
  their own imports only inside the executable's virtual root, so sharp,
  ExifTool and ORT cannot load on Windows.
- **`--smol`.** No gain.
- **Bypassing Drizzle's `execute()` for raw SQL.** No gain on Bun 1.4.2.
- **libuv threadpool and libvips concurrency settings.** Within noise.
- **`node:cluster`.** Doesn't load-balance on Windows.

## Code

| | lines | notes |
|---|---:|---|
| ts (`apps/backend-ts/src`, excl. generated schema) | 38,600 | 30,600 for the API and scan port and 8,000 for in-process ML (plus 2,100 lines of golden/bench scripts), written within a day by parallel agents porting from Rust |
| rust (`apps/backend-rs/crates/*/src`) | 62,600 + 14,400 lp-ml | includes the SQLite dual-dialect layer and the CLI |
| django (`apps/backend/api`, excl. tests and migrations) | 32,900 | ML lives in the separate Python sidecars |

## What we learned about the stack

**Bun's Postgres driver:**

- It is twice as fast as postgres.js through Drizzle.
- It parses `timestamptz` into a millisecond `Date`, so every API datetime is
  formatted in SQL to keep Django's microseconds.
- `bigint` comes back as a string.
- Drizzle's `jsonb()` double-encodes on it, so `schema.ts` uses a custom type.
- Array parameters need a literal.
- A pool idle timeout fails in-flight queries, so the pool has none.

**Drizzle:** fine as the schema and query builder, but its builder and `sql`
rendering run on every call. Hot queries need `.prepare()` or static
fragments.

**TanStack Start as an API-only server:**

- It still builds a React client bundle.
- A method without a handler renders the SSR page as an HTML 200.
- It re-reads `Response.body`, which drops `Content-Length` on `Bun.file`.
- It evaluates every route module at boot.
- The custom server entry is the right place for the fetch wrapper.
- Routing itself is cheap: an unauthenticated 401 runs at 29k req/s in-process.

**onnxruntime-node:** ORT speed per inference is the same as Rust's. But
`run()` blocks the calling thread, every output is copied, and there is no
shared or shrinkable arena.

**Windows:**

- There is no multi-process load balancing.
- sharp locks files it opened by path, so images are passed as buffers.
- `bun run build` has to run vite under Bun.

## Verdict

**Against Django:**

- 2–74× faster on every API endpoint.
- 2.2× faster scanning at 42% of the peak memory.
- 3.4× faster ML-on scanning at 43% of the peak memory and 5% of the idle
  memory.
- About 8× faster cold start.

**Against Rust:**

- **Database-bound endpoints:** TS ties.
- **Mid-weight pages, plain scan, captions:** TS reaches 80–98% of Rust.
- **Tiny endpoints and thumbnails:** 40–56% of Rust, because one JS thread
  meets 6 Rust cores.
- **ML-on scan:** TS reaches 74% of Rust's speed and 62% for OCR.
- **Memory:** TS uses about 3.5× Rust's at idle (75 vs 21 MiB) and about 2.4×
  at the ML peak.

**For a Raspberry Pi-class box,** Rust is still the right choice: 15 MB idle,
and 765 MB peak with every model.

**For a typical server,** the TS stack gets most of Rust's speed:

- Its speed comes from the same queries.
- It is written in the frontend's language.
- Drizzle pulled the schema from the database in one command.
- Bun already runs ONNX inference at native speed.

The remaining gaps are the single-threaded HTTP path on Windows, pixel work in
JS, and onnxruntime-node's memory model.

## Reproduce

```bash
cd apps/backend-ts && bun install && bun run build          # Bun >= 1.4.2 (LP_BUN for the harness)
cd ../backend-rs/bench
export LP_BUN=<bun.exe> LP_RS_BIN=<librephotos-rs.exe> LP_LPBENCH=<lpbench.exe>
python quick.py --ds 50k --contenders django-tuned,rust,ts                          # ~10 min
python w4.py scan --out results/<dir> --reps 1 --variants ts --drain-timeout 60     # per contender, <10 min
python footprint_ts.py --contenders django-shipped,rust,ts
python ts_tune.py --bun $LP_BUN [--cmd "dist/aot/server.js"]                        # one-server A/B loop
<venv python> ml_footprint.py scan ts --concurrency 1 --out ts1.json                # also rs, dj; --no-arena
cd ../tests/contract && LP_SUITE_RS=ts LP_BUN=$LP_BUN LP_DB_POOL=4 bash run_suite.sh  # full suite, ~40 min
```

Raw numbers:

- `apps/backend-rs/bench/results/quick.jsonl` (labels "ts prepared auth", "ts no idle timeout", "wave2 final (bun 1.4.2)").
- `results/2026-10-07-ts-scan/` and `results/2026-10-07-wave2-scan/`, the scan `scan.jsonl` files.
- `results/2026-10-07-ts-ml/*.json`, the ML-on scans.
- `results/ts_tune.jsonl`, the A/B loop.

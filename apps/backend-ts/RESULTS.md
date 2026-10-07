# Django vs Rust vs TypeScript (Bun + TanStack Start + Drizzle): results (2026-10-07)

Third contender in the backend experiment. `apps/backend-ts` is a big-bang
rewrite of the React-facing API in TypeScript: Bun 1.3.14 serving TanStack
Start 1.168 server routes, Drizzle 0.45 over Bun's built-in Postgres driver,
the job worker in the same process. Same scope and same yardsticks as the
Rust rewrite (`apps/backend-rs`, `plans/rust-backend/`).

## Completeness and correctness

- **Routes:** 183/183 (method, path) pairs that `librephotos-rs` serves have a
  TS route (`python apps/backend-ts/scripts/route_coverage.py`). That is the
  142 live frontend operations plus the Rust extras (mobile sync, health
  probes, services, downloads, OIDC callback).
- **Contract suite** (`LP_SUITE_RS=ts run_suite.sh`, every unit, Django as the
  reference on a clone of the same fixture): all 13 read units and all 15
  mutation units pass, 0 failures. Mutation state diffs are empty apart from
  the lines already accepted for Rust (salted password hashes, share slugs,
  face-crop encoder bytes).
- **Scan parity:** `tests/ingest/scan_diff_ts.sh` finds 0 differences against
  Django's scan of the fixture tree (rows, pHash, dates, albums, colours,
  byte-identical thumbnails at `LP_THUMB_SMALL_Q=95`).
- **ML task parity:** `tests/tasks/run_diff.sh` with `LP_DIFF_SUT=ts` diffs
  clean for classify, clip, geo, faces, cluster, tags, train and caption
  against Django on the mock sidecars.

ML runs through Django's Python sidecars over HTTP (Rust runs ONNX
in-process), so ML is out of the measurements below for all three, as in the
first Rust report.

## Setup

Ryzen 5 2600X (6C/12T), 32 GB, NVMe, Windows 11, native, no nginx. Postgres 16
on the same box (fsync off). Server pinned to 6 logical CPUs, Postgres to 4,
load client to 2. Media served directly by each server. Contenders:

- **django-tuned:** uvicorn, 6 workers × 4 threads, no recycling.
- **rust:** `librephotos-rs` release build (experiment/rust-backend, built 2026-10-05), pool 12.
- **ts:** `bun run server.ts` after `bun run build`, pool 12. **One process,
  one JS thread:** Bun's `reusePort` does not load-balance on Windows (all
  connections land on the first listener; tested with 3 processes), so the
  TS server cannot use the other 5 CPUs here. On Linux it could run N
  processes on one port.

## API throughput (`bench/quick.py --ds 50k`, synthetic 50k-photo library, c=32, 4 s/cell)

Requests/s, every response checked against the endpoint plan (status, counts,
ids, media bytes): 0 check failures and 0 errors for all three. Rows marked *
come from the rerun after the idle-timeout fix (below), the rest from the run
before it; django-tuned varies about ±25% between runs.

| endpoint | django-tuned | rust | ts | rust / django | ts / django | ts / rust |
|---|---:|---:|---:|---:|---:|---:|
| user album detail | 14.2 | 756 | 739 | 53× | 52× | 0.98 |
| thing album list | 44.2 | 725 | 715 | 16× | 16× | 0.99 |
| timeline day page | 109 | 1,933 | 1,416 | 18× | 13× | 0.73 |
| photo detail (lightbox) | 152 | 2,962 | 1,975 | 20× | 13× | 0.67 |
| site settings * | 249 | 6,630 | 2,334 | 27× | 9.4× | 0.35 |
| user self * | 88 | 619 | 731 | 7.0× | 8.3× | 1.18 |
| user album list | 15.0 | 98 | 95 | 6.5× | 6.3× | 0.96 |
| timeline deep page | 44.0 | 263 | 257 | 6.0× | 5.8× | 0.98 |
| jobs list * | 461 | 4,849 | 2,043 | 11× | 4.4× | 0.42 |
| persons | 117 | 501 | 522 | 4.3× | 4.4× | 1.04 |
| rqavailable (2 s poll) * | 610 | 6,433 | 2,388 | 11× | 3.9× | 0.37 |
| timeline date list | 7.0 | 20.0 | 23.2 | 2.9× | 3.3× | 1.16 |
| small thumbnail | 440 | 3,561 | 1,155 | 8.1× | 2.6× | 0.32 |
| place album list | 9.2 | 18.2 | 18.0 | 2.0× | 1.9× | 0.99 |
| big thumbnail | 427 | 3,314 | 764 | 7.8× | 1.8× | 0.23 |
| text search ("beach") | 0 (none finished in 4 s) | 4.8 | 3.8 | – | – | 0.79 |

Three groups:

1. **Postgres- or query-shape-bound** (album detail and lists, persons, user
   self, deep pages, date list, place list, search): TS matches Rust within a
   few percent, sometimes ahead. Both issue the same 1–3 statements, and the
   database does the work. The speedup over Django here comes from the
   queries (Django issues 9–2,700 statements per request), not the language.
2. **Mid-weight JSON endpoints** (day page, photo detail): TS reaches 67–73%
   of Rust. Row decoding and JSON building run on one JS thread.
3. **Tiny endpoints and media** (settings, rqavailable, jobs, thumbnails):
   TS tops out at about 1–2.4k requests/s, a third of Rust or less. This is
   the per-request floor of one JS thread: about 125 µs for HTTP plus Start
   routing (8.3k req/s on `/api/healthz`), plus 50–100 µs of CPU per
   Postgres round trip in Bun's driver, plus Drizzle's row mapping. Rust runs
   the same work on 6 cores. Media also pays for file reads on the event
   loop (sync reads; Bun's async file reads reached only ~400/s on this box).

## Scan (`bench/w4.py scan`, 2,025 generated files, ML off, 6 workers, 1 rep each)

| | wall time | files/s | peak memory (tree) | CPU s | no-change rescan |
|---|---:|---:|---:|---:|---:|
| rust | 117.7 s | 17.2 | 1,154 MiB | 664 | 0.59 s |
| ts | 149.2 s | 13.6 | 1,298 MiB | 730 | 1.10 s |
| django-tuned | 288.0 s | 7.0 | 3,024 MiB | 842 | 1.93 s |

All three produced the same outcome: 2,025 photos, 5 videos, 2,020
timestamps, 2,025 pHashes, 6,075 thumbnail files and 1,571 date albums. Rust
and TS wrote byte-identical thumbnail totals (both encode the small squares at
Q80; Django's are Q95, hence its larger square files).

TS is 1.9× faster than Django and at 79% of Rust's speed. The heavy lifting
(libvips through sharp, ExifTool, ffmpeg) is native in both rewrites, so the
gap is the JS orchestration and DB writes on one thread. About 950 MiB of
every peak is the ffmpeg video transcodes (5 processes). The Bun process
itself peaked at 267 MiB (Rust's process: 62 MiB).

## Footprint (API server only, 50k library, `bench/footprint_ts.py`)

| | cold start | idle working set | after 5 s of load |
|---|---:|---:|---:|
| rust | 0.51 s | 21.5 MiB | 28.8 MiB |
| ts | 0.64 s | 145.8 MiB | 199.7 MiB |
| django-shipped | 4.66 s | 199.5 MiB | 228.2 MiB |

The TS cold start excludes `bun run build` (done once) and `adopt`. Runtime
footprint on disk: `bun.exe` 94 MiB, `node_modules` 263 MiB (most of it
build-time: vite, TypeScript, the React client bundle Start insists on), the
server bundle 1.4 MiB.

## Code

| | lines | notes |
|---|---:|---|
| ts (`apps/backend-ts/src`) | 30,100 + 2,240 schema | 305 files, 152 route files; written in about four hours by 10 parallel agents porting from Rust |
| rust (`apps/backend-rs/crates/*/src`, excluding lp-ml and lp-testkit) | 62,600 | includes the SQLite dual-dialect layer and CLI ports |
| django (`apps/backend/api`, excluding tests and migrations) | 32,900 | |

## What we learned about the stack

**Bun's Postgres driver plus Drizzle:**

- Bun's built-in driver is twice as fast as postgres.js through Drizzle.
- It parses `timestamptz` into a millisecond `Date`, so every API datetime is
  formatted in SQL (`drfTs` / `pyIsoTs`) to keep Django's microseconds.
- `bigint` comes back as a string.
- Drizzle's `jsonb()` double-encodes values on this driver, so `schema.ts`
  uses a custom `jsonb` type.
- Array parameters need a literal (`pgArray`).
- A pool `idleTimeout` makes Bun fail in-flight queries after idle gaps, so
  the pool has none.

**Drizzle's builder** costs about 7 µs per selected column on Bun/JSC. The
45-column user lookup that authenticates every request spent 0.35 ms just
building SQL. Prepared once with `.prepare()`, the lookup went from 1.9k to
12k/s, and the light endpoints doubled.

**TanStack Start** as an API-only server works, with friction:

- It still builds a React client bundle.
- A method without a handler falls through to the SSR page as an HTML 200,
  so `server.ts` turns that into DRF's 405.
- It re-reads `Response.body`, which drops `Content-Length` on `Bun.file`
  bodies, so large media files bypass it.
- Handlers must be written inline in the route, or tree-shaking pulls the DB
  layer into the client bundle.
- Routing itself is cheap: an unauthenticated 401 runs at 29k/s in-process.

**Windows specifics:**

- `reusePort` doesn't load-balance, so the server is one process.
- sharp keeps path-opened files locked, so images are passed as buffers.
- `bun run build` must run vite under Bun (`bun --bun`).

## Verdict

- **Against Django:** TS is a large win. It is 2–52× faster on every endpoint,
  1.9× faster at scanning at less than half the peak memory, and starts 7×
  faster. Most of the API gain comes from the rewrite's queries, which TS
  shares with Rust.
- **Against Rust:** TS ties on database-bound endpoints, which include the
  heaviest pages (album detail, date list, search). It reaches 67–79% of Rust
  on JSON-heavy pages and the scan. It falls to 25–40% on tiny endpoints and
  thumbnails, where one JS thread meets 6 Rust cores. It also uses about 7×
  more memory at idle.
- **Choosing between them:** on a box with spare cores and Linux `reusePort`,
  a few TS processes would close most of the tiny-endpoint gap but not the
  memory gap. For a Raspberry Pi-class deployment Rust stays ahead (21 MiB
  vs 146 MiB idle). The TS stack is the faster one to write and change: same
  language as the frontend, and Drizzle's schema came from the database in
  one command.

## Reproduce

```bash
cd apps/backend-ts && bun install && bun run build
cd ../backend-rs/bench
export LP_RS_BIN=<librephotos-rs.exe> LP_LPBENCH=<lpbench.exe>
python quick.py --ds 50k --contenders django-tuned,rust,ts          # ~10 min
python w4.py scan --out results/<dir> --reps 1 --variants ts --drain-timeout 60   # per contender, <10 min each
python footprint_ts.py --contenders django-shipped,rust,ts
cd ../tests/contract && LP_SUITE_RS=ts LP_DB_POOL=4 bash run_suite.sh   # full suite, ~35 min
```

Raw numbers: `apps/backend-rs/bench/results/quick.jsonl` (labels "ts prepared
auth", "ts no idle timeout"), `apps/backend-rs/bench/results/2026-10-07-ts-scan/scan.jsonl`.

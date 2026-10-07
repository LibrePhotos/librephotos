# Rust vs Django: results (2026-09-30)

Machine: Ryzen 5 2600X (6C/12T), 32 GB, NVMe, Windows 11, native (no Docker, no nginx).
Postgres 16 on the same box (fsync off, same for both). Server pinned to 6 logical CPUs,
Postgres to 4, load client to 2. Django = `apps/backend` of the same commit, production
settings, DEBUG off. Rust = `librephotos-rs` release build. Both serve media directly.

Contenders: **django-shipped** (uvicorn 1 worker × 16 threads, the image default),
**django-tuned** (6 workers × 4 threads, no recycling), **rust** (tokio, pool 12).

## API throughput (`quick.py`, synthetic 50k-photo library, c=32, 4 s/cell)

After fixing three slow Rust queries (place list, search tag branch, user counts):

| endpoint | django-tuned req/s | rust req/s | speedup |
|---|---:|---:|---:|
| user album detail | 13.2 | 648.5 | 48.9× |
| site settings | 271 | 5,638 | 20.8× |
| photo detail (lightbox) | 121 | 2,466 | 20.4× |
| thing album list | 37 | 725 | 19.6× |
| rqavailable (2 s poll) | 355 | 4,507 | 12.7× |
| timeline day page | 115 | 1,320 | 11.5× |
| jobs list | 388 | 3,934 | 10.1× |
| user album list | 8.5 | 71 | 8.4× |
| small thumbnail | 420 | 3,134 | 7.5× |
| big thumbnail | 324 | 2,248 | 6.9× |
| timeline deep page | 39 | 240 | 6.1× |
| persons | 85 | 457 | 5.4× |
| user self | 124 | 584 | 4.7× |
| place album list | 7.5 | 12 | 1.6× |
| timeline date list | 10.8 | 14.0 | 1.3× |
| text search ("beach", ~900 hits) | 0 (none finished in 4 s) | 2.0 | – |

Every response was checked against Django's (status, counts, ids, media byte length).
The last three rows are Postgres-bound on both sides: they must touch every photo or
return all matches unpaginated, so the language barely matters there.

## SQL per request (single request, statement log)

Rust issues 2–3 statements for almost every endpoint; Django issues 9 per timeline day
page, 18–21 per photo detail, ~200 per user album detail, and 2,700 (50k) to 14,000
(250k) for one text search. Most of the API speedup is Rust's app layer plus far fewer
round trips; Django could win back part of the second half with query work.

## Scan (2,025 generated files, ML off, 6 workers)

| | wall time | files/s | peak memory | CPU s |
|---|---:|---:|---:|---:|
| rust | 129 s | 15.7 | 1.3 GB | 694 |
| django-tuned (2 runs) | 294–321 s | 6.3–6.9 | 2.9–3.0 GB | 871–938 |
| django-shipped | 342 s | 5.9 | 2.9 GB | 1,092 |

No-change rescan: rust 0.8 s, Django 1.6–2.0 s. Identical results (photos, thumbnails,
pHash, dates, date albums).

## Footprint (API server only, sidecars off on both)

| | cold start | idle memory | after 5 s load |
|---|---:|---:|---:|
| rust | 0.5 s | 15 MiB | 19 MiB |
| django-shipped | 5.4 s | 193 MiB | 240 MiB |
| django-tuned | 13.4 s | 1.0 GiB | 1.2 GiB |

## Correctness state

142/142 frontend operations implemented; contract (frontend zod), twin (vs Django) and
mutation state-diff suites green; real React frontend walked for 100 steps against both
backends with no Rust-only failures; security review found no exploitable divergence.

## Caveats

Windows, not Linux containers; no nginx (X-Accel path unmeasured); synthetic libraries
grown from a 32-photo fixture; fsync off; ML sidecars off (they are Python in both
worlds). Full-plan runs (`run_bench.py`, `REPORT.md` in `results/`) were cut short on
purpose; `quick.py` is the ≤10-minute loop for further tuning.

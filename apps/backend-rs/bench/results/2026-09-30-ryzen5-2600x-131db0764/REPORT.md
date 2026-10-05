# Django vs Rust backend benchmark — 2026-09-30-ryzen5-2600x-131db0764

Plan: `plans/rust-backend/05-benchmarks.md`. Scripts: `apps/backend-rs/bench/` (`run_bench.py`, `w4.py`, `lpb.py`, load client `client/` = `lpbench`). Raw data: the `*.jsonl` files next to this report; aggregated: `results.json`.

## Environment

- **Hardware:** AMD Ryzen 5 2600X Six-Core Processor, 12 logical CPUs (6 cores × SMT), 32 GB RAM, NVMe SSD
- **OS:** Microsoft Windows 11 Home 10.0.26100
- **Commit:** experiment/rust-backend @ 131db0764 (Django = apps/backend of the same commit)
- **Rust:** rustc 1.95.0 (59807616e 2026-04-14), release profile lto=thin, codegen-units=1
- **Python:** CPython 3.11.9, Django 5.2.17, uvicorn 0.53.0, a2wsgi 1.10.10, psycopg 3.3.4, django-q2 1.11.1, libvips 8.18
- **Postgres:** 16.2 on localhost:5433, shared_buffers 128MB, work_mem 4MB, fsync=off, synchronous_commit=off, full_page_writes=off (dev server, same for both backends)
- **CPU sets:** server CPUs 0-5 (mask 0x3f), Postgres 6-9 (0x3c0), load client 10-11 (0xc00); set with SetProcessAffinityMask on the process trees after start-up
- **Contenders:** django-shipped = uvicorn 1 worker × WEB_THREADS=16; django-tuned = uvicorn 6 workers × WEB_THREADS=4; rust = librephotos-rs serve, tokio default workers, LP_DB_POOL=12, LP_MEDIA_MODE=direct. Django: production settings, DEBUG off, CONN_MAX_AGE=600, no access log, SERVE_FRONTEND direct media (no nginx on this box). Same SECRET_KEY, same JWT for all.

## Attribution: runtime, queries or payload?

One request per endpoint on a dedicated clone with `log_min_duration_statement = 0` (median of 3 after 3 warm-ups); statements and their summed duration are read from the Postgres log (pg_stat_statements is not available on this server). `queries` counts executed statements (simple `statement` + extended `execute`); `DB ms` sums parse + bind + execute durations; app time ≈ W1 p50 at c=1 − DB ms. Classification rules: *query* = fewer statements or < 70 % DB time; *payload* = < 80 % bytes; *runtime* = < 70 % app time; LOSS = the reverse by 30 %.

### 50k

| endpoint | queries tuned | queries rust | DB ms tuned | DB ms rust | bytes tuned | bytes rust | app ms tuned | app ms rust | classification |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| date_list | 3 | 2 | 199.70 | 95.30 | 121457 | 121457 | – | – | query |
| date_page_1 | 9 | 2 | 33.69 | 6.26 | 12504 | 12504 | – | – | query |
| date_page_deep | 9 | 2 | 57.93 | 18.66 | 42671 | 42671 | – | – | query |
| photo_detail | 21 | 2 | 49.11 | 15.51 | 2546 | 2529 | – | – | query |
| persons | 4 | 2 | 29.57 | 9.66 | 18479 | 18479 | – | – | query |
| user_self | 21 | 3 | 9.48 | 17.54 | 5858 | 5858 | – | – | query |
| sitesettings | 14 | 2 | 5.93 | 0.21 | 400 | 400 | – | – | query |
| rqavailable | 4 | 2 | 4.71 | 0.62 | 470 | 470 | – | – | query |
| jobs | 5 | 3 | 1.20 | 0.85 | 1909 | 1909 | – | – | query |
| album_user_list | 6 | 2 | 131.07 | 35.60 | 59968 | 59968 | – | – | query |
| album_thing_list | 6 | 2 | 19.61 | 5.16 | 54472 | 54472 | – | – | query |
| album_place_list | 5 | 2 | 200.94 | 1756.76 | 14580 | 14578 | – | – | query |
| search_text | 2732 | 2 | 976.33 | 2269.91 | 536007 | 536007 | – | – | query |
| album_user_detail | 196 | 3 | 61.19 | 5.89 | 15553 | 15553 | – | – | query |
| media_square_small | 5 | 2 | 1.62 | 2.57 | 5402 | 5402 | – | – | query |
| media_big | 5 | 2 | 1.81 | 2.83 | 15548 | 15548 | – | – | query |

### 250k

| endpoint | queries tuned | queries rust | DB ms tuned | DB ms rust | bytes tuned | bytes rust | app ms tuned | app ms rust | classification |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| date_list | 3 | 2 | 428.32 | 645.54 | 238555 | 238555 | – | – | query |
| date_page_1 | 9 | 2 | 30.39 | 7.33 | 24894 | 24894 | – | – | query |
| date_page_deep | 9 | 2 | 209.54 | 36.70 | 46450 | 46450 | – | – | query |
| photo_detail | 18 | 2 | 28.67 | 13.01 | 1753 | 1736 | – | – | query |
| persons | 4 | 2 | 395.97 | 112.29 | 91181 | 91181 | – | – | query |
| user_self | 21 | 3 | 56.84 | 111.98 | 5860 | 5860 | – | – | query |
| sitesettings | 14 | 2 | 6.50 | 0.19 | 400 | 400 | – | – | query |
| rqavailable | 4 | 2 | 4.75 | 0.56 | 470 | 470 | – | – | query |
| jobs | 5 | 3 | 0.96 | 0.98 | 1909 | 1909 | – | – | query |
| album_user_list | 6 | 2 | 599.70 | 165.52 | 290891 | 290891 | – | – | query |
| album_thing_list | 6 | 2 | 6.61 | 4.50 | 54564 | 54564 | – | – | query |
| album_place_list | 5 | 12 | 1174.94 | 13195.73 | 14613 | 14609 | – | – | query LOSS |
| search_text | 14039 | 2 | 4602.12 | 12603.60 | 2693558 | 2693558 | – | – | query |
| album_user_detail | 202 | 3 | 36.53 | 6.62 | 15847 | 15847 | – | – | query |
| media_square_small | 5 | 2 | 1.42 | 3.08 | 5010 | 5010 | – | – | query |
| media_big | 5 | 2 | 1.34 | 2.88 | 13612 | 13612 | – | – | query |

## Correctness guard

Before any load, every W1 endpoint was requested from all three contenders on their own clone of the same template and checked against django-tuned's answer (status, item counts, first ids / key values; media: exact byte length). During the runs every measured response is checked the same way by `lpbench`. Pointers the contenders disagreed on would have been dropped from the checks and listed here:

- **fixture**: 16 endpoints; mismatches: none; dropped checks: none
- **50k**: 16 endpoints; mismatches: none; dropped checks: none
- **250k**: 16 endpoints; mismatches: none; dropped checks: none

W1 paths:

- fixture: `date_list` = `/api/albums/date/list/`, `date_page_1` = `/api/albums/date/5/?page=1`, `date_page_deep` = `/api/albums/date/5/?page=1`, `photo_detail` = `/api/photos/78abeabed7ae10ae8897978f4bbea4c12/`, `persons` = `/api/persons/?page_size=1000`, `user_self` = `/api/user/2/`, `sitesettings` = `/api/sitesettings`, `rqavailable` = `/api/rqavailable/`, `jobs` = `/api/jobs/?page_size=10&page=1&mine=true`, `album_user_list` = `/api/albums/user/list/`, `album_thing_list` = `/api/albums/thing/list/`, `album_place_list` = `/api/albums/place/list/`, `search_text` = `/api/photos/searchlist/?search=beach`, `album_user_detail` = `/api/albums/user/5/`, `media_square_small` = `/media/square_thumbnails_small/78abeabed7ae10ae8897978f4bbea4c12`, `media_big` = `/media/thumbnails_big/78abeabed7ae10ae8897978f4bbea4c12`
- 50k: `date_list` = `/api/albums/date/list/`, `date_page_1` = `/api/albums/date/1010/?page=1`, `date_page_deep` = `/api/albums/date/949/?page=11`, `photo_detail` = `/api/photos/3e9367a8cf8bf783f50ade55282dc5022/`, `persons` = `/api/persons/?page_size=1000`, `user_self` = `/api/user/2/`, `sitesettings` = `/api/sitesettings`, `rqavailable` = `/api/rqavailable/`, `jobs` = `/api/jobs/?page_size=10&page=1&mine=true`, `album_user_list` = `/api/albums/user/list/`, `album_thing_list` = `/api/albums/thing/list/`, `album_place_list` = `/api/albums/place/list/`, `search_text` = `/api/photos/searchlist/?search=beach`, `album_user_detail` = `/api/albums/user/108/`, `media_square_small` = `/media/square_thumbnails_small/3e9367a8cf8bf783f50ade55282dc5022`, `media_big` = `/media/thumbnails_big/3e9367a8cf8bf783f50ade55282dc5022`
- 250k: `date_list` = `/api/albums/date/list/`, `date_page_1` = `/api/albums/date/687/?page=1`, `date_page_deep` = `/api/albums/date/317/?page=32`, `photo_detail` = `/api/photos/457b16806fd4d27dbce54062e656ffec2/`, `persons` = `/api/persons/?page_size=1000`, `user_self` = `/api/user/2/`, `sitesettings` = `/api/sitesettings`, `rqavailable` = `/api/rqavailable/`, `jobs` = `/api/jobs/?page_size=10&page=1&mine=true`, `album_user_list` = `/api/albums/user/list/`, `album_thing_list` = `/api/albums/thing/list/`, `album_place_list` = `/api/albums/place/list/`, `search_text` = `/api/photos/searchlist/?search=beach`, `album_user_detail` = `/api/albums/user/324/`, `media_square_small` = `/media/square_thumbnails_small/457b16806fd4d27dbce54062e656ffec2`, `media_big` = `/media/thumbnails_big/457b16806fd4d27dbce54062e656ffec2`

## Deviations from 05-benchmarks.md (this Windows box)

- **No containers, no cgroups, no nginx.** Processes run natively on Windows 11. CPU sets are
  `SetProcessAffinityMask` on each process tree after start-up (server 0-5, Postgres 6-9, load
  client 10-11 of 12 logical CPUs = 3 physical cores for the server). Because the mask is applied
  after start-up, Rust's `available_parallelism()` still sees 12 CPUs: tokio runs 12 workers (and
  a 12-permit CPU semaphore) on the 6 pinned logical CPUs. django-tuned runs 6 uvicorn workers
  (= logical CPUs of its set; the task's "cores/2" of 12). The headline is therefore "N = 6 logical
  CPUs (3 cores + SMT)", not the plan's N=4 / N=1 cells; no arm64 run.
- **Media without nginx.** Django serves media itself (`SERVE_FRONTEND`, i.e. the direct mode of
  `run_django.sh`), Rust uses `LP_MEDIA_MODE=direct` (the plan's `rust-direct`). The X-Accel path of
  production is not measured on either side.
- **Resources** are the Windows working set (RSS equivalent) and process CPU times of the process
  tree, sampled by `lpbench procstat` (Toolhelp + GetProcessMemoryInfo/GetProcessTimes), not cgroup
  `memory.current` / `cpu.stat`. No image size (no images built).
- **Load tools.** `oha`/`k6` are replaced by `lpbench` (bench/client, Rust, tokio + reqwest + HDR
  histograms): one tool for W1 (closed loop), W2 (open-model journeys) and W3 (bursts) so every
  response is checked in the same way. Journeys are the request sequences of 03-api-surface §4 and
  the recorded frontend walk (tests/smoke), replayed per "tab" with ≤ 6 requests in flight; no
  Playwright/HAR recording. J4's "semantic" search is a plain `searchlist` search (the ML sidecars
  are off on both sides).
- **W1 timing**: 20 s per cell after a 2 s warm-up (the plan says 30 s + 10 s; the task says 20 s).
  Before every cell the harness waits until all servers and Postgres are idle (< 0.15 CPU) so a
  contender still draining a timed-out backlog cannot slow the next one.
- **SQL attribution** comes from the Postgres statement log (`log_min_duration_statement = 0` on a
  dedicated clone, one request at a time, median of 3) instead of `pg_stat_statements`, which this
  Postgres build does not ship. Logging every statement inflates the absolute DB ms on both sides
  equally; use it for ratios. Rows per statement are not available.
- **Datasets.** `real-m` (Pexels library scanned by Django with ML on) does not exist on this box:
  `synth-50k` / `synth-250k` are grown from the 32-photo fixture library of alice (`bench/synth/`),
  not from real-m. No `yours` dataset.
- **W4 scan.** Library = 2025 generated files instead of real-m. ML on is not measured (sidecars
  off). Django's scan is enqueued straight into django-q (`AsyncTask(scan_photos, …)`), because
  `ScanPhotosView` would first chain `download_models` (no model files here); Rust gets
  `GET /api/scanphotos/`. The no-change rescan runs on the W4 library, not on synth-250k (whose
  synthetic files do not exist on disk, so a rescan there would only walk the fixture's 32 files and
  then mark 250k photos missing). Face clustering wall time is not measured (ML off). Duplicate
  detection runs on synth-50k and synth-250k.
- **Follow-up for honesty** (`django-optimized`, hand-applying Rust's query shapes to Django) is not
  done in this run.
- **Report** is generated by `bench/report.py` (Markdown + results.json), not a Rust `bench/report` bin;
  no HTML and no latency-vs-load plots.


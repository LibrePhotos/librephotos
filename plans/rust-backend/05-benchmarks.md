# 05 — Benchmarks: Measuring "Faster" Honestly

**The question:** on the same library, the same Postgres and the same hardware,
how much faster and cheaper is the Rust backend at what the React frontend
does? And **where does the difference come from**: the runtime, or the
rewrite issuing better SQL?

Everything lives in `apps/backend-rs/bench/`. Results are committed to
`bench/results/<date>-<machine>-<commit>/`.

## 1. Contenders

| Name | Config |
| --- | --- |
| `django-shipped` | The current backend image unchanged: uvicorn **1 worker** × 16 a2wsgi threads (GIL-bound), `DEBUG=0`, `CONN_MAX_AGE=600` |
| `django-tuned` | uvicorn workers = N cores, no 50-request recycling, `WEB_THREADS=4`. This is the fair comparison. |
| `rust` | `librephotos-rs serve`, tokio workers = N, sqlx pool = 2N |
| `rust-direct` | Same, with `LP_MEDIA_MODE=direct` (Rust streams files instead of nginx X-Accel). Media runs only. |

**Both backends share `SECRET_KEY`.** Rust issues and verifies
Django-compatible JWTs, so **one set of tokens drives both** and load scripts
don't care which side they hit.

## 2. Environment

- **Hardware:** one quiet machine, and ideally two: the x86 dev box and an
  arm64 Hetzner VM (production-like).
- **Topology:** fixed CPU sets via `docker --cpuset-cpus`.
  - App server: N=4 cores for headline numbers, and N=1 for per-core
    efficiency.
  - Postgres (16) on its own cores.
  - Load generator on a separate machine, or on the remaining cores.
- **DB state:** each dataset is a **template database**, already `ANALYZE`d.
  Every run starts from `CREATE DATABASE run TEMPLATE lp_bench_<ds>`, so both
  contenders see byte-identical data and planner statistics. Rust's additive
  indexes are in the template, so Django gets them too.
- **Path:**
  - API runs hit the app port directly, which isolates the app.
  - Media runs go through the real nginx config, which is realistic for
    X-Accel.
- **Repetitions:** a warm-up run is discarded, then 5 repetitions per cell in
  **alternating order** (A B A B) to cancel thermal and cache drift. Report
  the median and the spread.

## 3. Datasets

| Name | Contents | Built by |
| --- | --- | --- |
| `tiny` | `deploy/e2e/photos` (8 JPEGs) | smoke only |
| `real-m` | The Pexels sample library from the docs landing-page pipeline, scanned by Django with ML on (faces, persons, CLIP, tags, captions, OCR) | Django scan, then `pg_dump` + media tarball |
| `synth-50k`, `synth-250k` | `real-m` cloned K times in SQL: timestamps shifted across years, GPS jittered, hash suffixed per clone, faces/persons/albums scaled with realistic distributions (photos per day, faces per photo, album sizes, a few shared albums). Thumbnails are **hard links** to the originals' files. | `bench/synth/*.sql` + a small linker script |
| `yours` (optional) | A copy of the maintainer's own production DB, with media mounted read-only | `pg_dump` |

Synthetic data only needs to exercise query shapes and payload sizes: the
pixels never matter for API benchmarks.

## 4. Workloads

| Id | Workload | Tool | Shape |
| --- | --- | --- | --- |
| **W1** | Per-endpoint micro-benchmarks for every hot endpoint in 03, with the frontend's real params and page sizes | `oha` | Concurrency sweep 1 / 8 / 32 / 128, 30 s each after 10 s warm-up |
| **W2** | **User journeys**, recorded from the real frontend: Playwright drives the UI against Django, the HAR becomes a k6 scenario | `k6` | Open model: ramp arrival rate until p99 > 500 ms. Report max sustainable journeys/s. |
| **W3** | Thumbnail storm: the burst of ~200 small thumbnails the timeline fires on first paint | `k6` | Time-to-last-byte of the burst, via nginx X-Accel vs `rust-direct` |
| **W4** | Background work | built-in timers | See the table below |
| **W5** | Resources | cgroup sampler | See the table below |

W2 journeys:

| Id | Journey |
| --- | --- |
| J1 | Open app, then scroll the timeline 20 date groups |
| J2 | Lightbox through 20 photos |
| J3 | People page, then one person, then their photos |
| J4 | 5 searches (text, place, person, semantic) |
| J5 | Albums browse |
| J6 | An idle tab, which still polls jobs every 2 s. Matters with many open tabs. |

W4 background runs:

| Run | Dataset / setting |
| --- | --- |
| Full scan | `real-m`, from empty: ML off, and ML on |
| No-change rescan | `synth-250k` |
| Duplicate detection | `synth-50k` and `synth-250k` |
| Face clustering | Wall time. Both call the same Python logic, so this isolates orchestration. |

W5 resources:

- idle RSS for the whole container, with a per-process breakdown
- RSS under J1 at 50 virtual users
- cold start to `/api/healthz` ready
- image size

**Correctness guard.** Every load script checks status plus a cheap checksum
per response: item count, first id. A fast-but-wrong endpoint fails the run
instead of winning it.

## 5. Metrics and collection

| Metric | Source |
| --- | --- |
| Latency p50/p95/p99, throughput | oha / k6 HDR histograms |
| **CPU-seconds per 1k requests** | cgroup `cpu.stat` `usage_usec` delta |
| RSS | cgroup `memory.current` + per-process `smaps_rollup`, 1 Hz |
| **SQL per request** | `pg_stat_statements`, reset before each run: calls, exec time and rows per endpoint; top statements |
| Errors | non-2xx counts, checksum failures |

## 6. Attribution: Rust or rewrite?

For each endpoint the report shows:

- **Speedup** = `django-tuned / rust`, on p50 latency and on max throughput.
- **DB time per request** on both sides, from `pg_stat_statements`. App time
  ≈ latency − DB time.
- **Queries per request** on both sides.
- **Response bytes** on both sides. Rust emits only the fields the frontend
  reads (03 §1). Photo detail is measured once with the full Django field set
  (`exif_json` included) to show how much of its win is payload.
- A **classification**:
  - *runtime win*: same queries and payload, faster app layer
  - *query win*: fewer or better queries
  - *payload win*: smaller responses
  - a combination of these

**Redirects are reported separately.** On Django, the frontend's
`/albums/date/{id}` and `/exists/{h}` calls each cost a 301 plus a second
request, because the trailing slash is missing. Rust answers directly. W1
calls Django's slash form, so micro-benchmarks exclude this. The journeys
(W2) include it, because it's what users actually pay, and the report states
how much of the journey delta it explains.

**Follow-up for honesty.** For the top 5 query wins, hand-apply the Rust query
shape to Django (`only()`, `prefetch_related`, SQL grouping) and re-measure
`django-optimized`. The remaining gap is what Rust itself buys. The part that
closes is a free improvement for the Python backend.

## 7. Report

`bench/report` (a small Rust bin) turns the results JSON into a Markdown +
HTML report:

- per-endpoint tables
- latency-vs-load curves per journey
- the resource table
- scan timings
- the attribution section
- the environment (hardware, versions, commits) on the first page

## 8. Fairness checklist

- [ ] Django: `DEBUG=0`, no silk, same log level, no request logging on only one side
- [ ] Same Postgres, same template DB, same indexes, same `ANALYZE` stats
- [ ] Same JWTs; same user; same query params and page sizes (taken from the frontend, not guessed)
- [ ] Warm-up discarded; OS page cache and shared buffers warm on both sides
- [ ] Same nginx config for media runs; no compression on either side (a gzip variant is reported separately)
- [ ] Alternating run order, 5 repetitions, median + spread
- [ ] Checksum validation on every response
- [ ] Both configurations of Django reported; headline numbers use `django-tuned`

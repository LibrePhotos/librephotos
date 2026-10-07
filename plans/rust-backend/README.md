# LibrePhotos Backend in Rust — Big-Bang Rewrite (Experimental)

An experiment to find out **how much faster LibrePhotos gets with a Rust
backend**. The approach is a clean-room rewrite of the API surface the React
frontend uses, benchmarked head-to-head against Django on the same database
and the same photos.

It lives on `experiment/rust-backend`, in `apps/backend-rs`. Nothing in
`apps/backend` changes. If the numbers disappoint, the branch and its
benchmark report are the deliverable.

## Documents

| Doc | Contents |
| --- | --- |
| [01-architecture.md](01-architecture.md) | One Rust binary replacing Django + django-q2; crates; process and deployment layout; what stays Python |
| [02-data-layer.md](02-data-layer.md) | Postgres-only, the existing schema adopted as the baseline, sqlx, Django storage codecs, authz scopes, side effects made explicit |
| [03-api-surface.md](03-api-surface.md) | The frontend's actual API: inventory, auth, media, response contract, what gets dropped |
| [04-jobs-and-ingest.md](04-jobs-and-ingest.md) | Own job queue, scan pipeline in Rust, Python ML sidecars kept behind HTTP |
| [05-benchmarks.md](05-benchmarks.md) | How "faster" is measured fairly: datasets, workloads, configs, attribution, report |
| [06-testing.md](06-testing.md) | Frontend zod schemas as the contract oracle, differential diffs vs Django, authz matrix, e2e |
| [07-roadmap.md](07-roadmap.md) | Milestones (numbers after ~3 weeks), risks, open questions |

## The shape of it

- **One binary, `librephotos-rs`:** HTTP API + job worker + migrations. It
  replaces the Django backend, `qcluster`, and the Python exif sidecar. It
  listens on :8001, so nginx and the frontend container don't change.
- **Same database, same files.** The Rust app adopts the existing Postgres
  schema as its migration baseline and reads today's `protected_media`
  layout. It can be pointed at **a copy of a real Django library** and serve
  it immediately. That's what makes the benchmark apples-to-apples, and it
  means you can try it on your own photos.
- **The frontend is the spec.** The React app's requests and its zod schemas
  define the contract. Anything the frontend doesn't call or read is out:
  - Django admin, allauth account pages, and the DRF browsable API
  - HTTP Basic auth and unused viewset writes
  - SQLite and the Windows standalone build
- **ML stays Python, behind HTTP.** The face, CLIP, tags, OCR, captioning and
  similarity sidecars are already Django-free Flask services that take file
  paths. The Rust worker calls them unchanged. ExifTool is driven directly
  from Rust through a process pool, which removes today's biggest scan
  bottleneck.
- **Numbers early.** Milestone 1 ports the hot read path first: login,
  timeline, photo detail, media, albums, people, search, and job polling. A
  benchmark report comes out after about 3 weeks. Everything after that is
  filling in the surface.

## What "faster" will mean

The main comparison is against **both Django as shipped and Django tuned**.
The as-shipped config is 1 uvicorn worker × 16 a2wsgi threads under the GIL,
recycled every 50 requests when there are more workers. Measured per
endpoint and per user journey:

| Dimension | Metrics |
| --- | --- |
| Throughput | Requests per second at a p99 latency budget |
| Latency | p50/p99 at fixed load |
| Efficiency | CPU per 1k requests, RSS idle and under load |
| Startup | Cold start |
| Background work | Scan throughput |

SQL query counts are recorded for every endpoint on both sides. The report can
then separate "Rust is faster" from "the rewrite issues better SQL". The second
part is something Django could partly copy. Details are in
[05](05-benchmarks.md).

## Non-goals

- Changing the React frontend. It must work unmodified, pointed at the Rust
  backend via nginx or `VITE_BACKEND_URL`.
- Porting the ML models to Rust.
- Supporting the mobile app, SQLite, Windows standalone, or Django admin
  workflows.
- Production readiness. Hardening is only needed if the experiment graduates.

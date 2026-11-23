# 07 — Roadmap, Risks, Open Questions

Estimates are **focused weeks for one maintainer with agents** and are rough.
M1 is designed to produce real numbers early, so the rest can be re-planned
(or dropped) with data.

## M0 — Foundations (~1 week)

1. **Workspace and CI.**
   - `apps/backend-rs` workspace, `rust-toolchain.toml`, `clippy.toml`
     (`disallowed-methods`), `cargo-deny`.
   - CI: build, clippy, tests.
2. **Schema:** `migrations/0000_baseline.sql` from Django at api.0142, plus
   `librephotos-rs migrate` / `adopt`. Additive migrations for
   `site_settings`, `refresh_token` and `job_queue`.
3. **Config and serving:** config from the existing env vars; `SECRET_KEY`
   loading; axum skeleton with trailing-slash normalization, the error
   envelope and `/api/healthz`.
4. **`lp-auth`:** obtain, refresh, blacklist, with Django-compatible JWTs, the
   `jwt` cookie, and Django password verification.
5. **Fixtures and harnesses:** `seed_fixture` + the fixture pack; skeletons of
   the contract harness and twin runner.
6. **Benchmark harness**, run against **Django first**:
   - datasets `real-m` and `synth-50k`
   - `django-shipped` and `django-tuned` baselines
   - Playwright journeys J1–J6 recorded to HAR, then k6

**Optional dev fallback.** `LP_DEV_FALLBACK=http://localhost:8009` proxies
unported routes to a local Django, so the real UI is clickable from M1 on.
It's dev-only, off by default, and never built into the image. Benchmarks
always run with it off.

## M1 — The speed slice (~2 weeks), then the first report

Port the ~25 operations that make up J1–J4 and J6:

| Area | Operations |
| --- | --- |
| Timeline | `/albums/date/list/`, `/albums/date/{id}` with all filters |
| Lightbox | `/photos/{h}/`, `/photo/share/list` |
| Media | every `/media/<kind>/…` (x-accel and direct), incl. HEAD and ranges |
| Spotlight + page chrome | `/user/{id}/`, `/user/`, `/sitesettings` GET, `/storagestats/`, `/imagetag/`, `/searchtermexamples/`, place/thing/user album lists, `/persons/?page_size=1000`, `/tags/` |
| Search | `/photos/searchlist/`: `icontains` over `PhotoSearch`, OCR full-text search, semantic search via the CLIP and similarity sidecars |
| Jobs polling | `/rqavailable/`, `/jobs/` |
| People journey | person-filtered date list/pages (same handlers) |

All of these must pass contract, twin and authz. Then run W1–W3 and W5 and
**publish the first benchmark report**.

### Checkpoint — keep going?

The report answers the question the experiment exists for:

- How much faster at the endpoint level?
- How much faster at the journey level?
- How much cheaper in CPU and memory?
- How much of it is runtime vs query vs payload?

**Continue** if the gains look worth a full backend and M1's pace suggests
M2–M5 is realistic. **Otherwise stop here.** The report is the result, and the
query and payload wins can be applied to Django directly.

## M2 — Rest of the read surface (~2–3 weeks)

About 45 operations:

- All album kinds: detail pages, auto albums, `locclust`, folders, tags
  detail.
- Faces pages (`/faces/`, `/faces/incomplete/`).
- Sharing lists and public pages (anonymous).
- `recentlyadded`, `notimestamp`, memories.
- Photo sidebar: albums of a photo, metadata GET, media diagnostics.
- Stats and dataviz. `socialgraph` needs the spring layout ported from numpy.
- Server stats and logs.
- Stacks and duplicates reads.
- `timezones` and the predefined-rules endpoints.

**Adds journey J5** (albums browse).

## M3 — Mutations (~3 weeks)

About 45 operations through `lp-db::write` with the side-effect list (02 §5):

- **Photo edits:** photosedit ×10, `PATCH /photos/edit/`, metadata PATCH,
  rotate. Rotate means a thumbnail re-render, so it needs `lp-ingest`'s
  thumbnailer early.
- **Albums and tags:** album CRUD and sharing, photo share links, tags CRUD,
  add, remove and merge.
- **People:** faces label, delete and add; person rename, cover and delete.
- **Users and settings:** user and profile PATCH (incl. avatar multipart),
  manage-user, user delete, site settings POST, email config.
- **Stacks and duplicates actions.**

Each mutation is done when its DB/file state diff against Django is clean
(06 §5).

## M4 — Worker and ingest (~4–5 weeks)

Order within the milestone:

1. **Queue and job surface:** `job_queue`, `LongRunningJob` progress, the
   scheduler, the sidecar supervisor, job detail/cancel/delete.
2. **Zip:** build, poll, download, delete. The simplest job, used to prove
   the machinery.
3. **Scan:** `lp-exif` pool, then the scan pipeline (walk → hash → EXIF →
   dates → libvips thumbnails → pHash → video → motion photos → search text).
   Covers scanphotos, fullscanphotos and deletemissingphotos.
4. **Follow-ups:** tags, geocode, CLIP + similarity build, faces, OCR through
   the sidecars. Plus the `face_cluster` sidecar (trainfaces, clusterfaces,
   scanfaces) and captions (`generateim2txt`).
5. **Background features:** duplicate detection (popcount), stack detection,
   auto albums.
6. **Upload:** exists, chunked, complete. Then live transcode.

**Then run W4**, the scan and background benchmarks.

**Early spike, in parallel with M1 if convenient:** the libvips FFI thumbnail
plus the Pillow-exact pHash, measured on the corpus. These are the two
biggest ingest risks, and they're cheap to measure alone.

## M5 — Completion (~1–2 weeks)

- **Accounts:** password reset (lettre), first-time setup, signup.
- **Services admin:** list, status, start/stop, mapped onto the supervisor.
- **Optional:** Nextcloud listdir and scan; SSO via `openidconnect`.
- **Packaging and final checks:**
  - `deploy/docker/backend-rs/Dockerfile` and `docker-compose.rs.yml`
    (amd64 + arm64)
  - Playwright smoke green against the Rust stack
- **Final benchmark report:** API, journeys, resources and scan, on x86 and
  arm64.

**Total: ~13–16 weeks.** The first real numbers come after ~3.

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| **The speedup is mostly "better SQL"**, which Django could also do | Medium | Attribution is built into the report (05 §6), with a `django-optimized` follow-up. It's still a useful outcome. |
| Authz bug leaks private photos | Medium, severe | Authz matrix seeded from the 249 media tests + sharing tests. Runs in CI from M1. |
| 142 ops is a lot of surface | High | Most are small. M1 proves the pattern. Handlers follow one template (extract → scope → query → DTO). Agents parallelize by area. |
| Side effects missed on writes | Medium | 02 §5 list; state diffs gate each mutation |
| Frontend moves on `dev` during the experiment | Medium | Pin the frontend commit used for contract and journeys; bump it deliberately; the harness shows the delta |
| pHash / thumbnail equivalence | Medium | Early spike; fallback `rehash` job after `adopt` |
| libvips FFI builds on Windows dev boxes | Medium | Prebuilt libvips (build-win64-mxe) for Windows, or develop ingest in WSL/Docker. The API crates don't need libvips. |
| Benchmark noise hides real differences | Medium | Pinned CPUs, template DBs, alternating runs, 5 reps, spread reported |
| Scope creep into "fixing" the frontend | Medium | The frontend stays untouched; bugs are listed (03 §8) for separate PRs |

## Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Headline comparison against Django shipped or tuned? | **Tuned** as the headline; shipped shown alongside |
| 2 | Emit only frontend-read fields (e.g. drop `exif_json` from photo detail)? | Yes. Report payload bytes, and measure photo detail both ways once to show the payload share. |
| 3 | SSO and Nextcloud in scope? | Optional, last (M5) |
| 4 | Benchmark machines? | Your x86 dev box + an arm64 Hetzner VM (matches prod) |
| 5 | Do the 301/double-fetch frontend fixes land on `dev` during the experiment? | Not before the M1 report. Otherwise the Django baseline shifts mid-experiment. |
| 6 | Push `experiment/rust-backend` to origin? | Yes, so CI runs (the workflow is path-filtered) |

## Issues found while planning (independent of the port)

**Backend:**
- **Stack detection runs as a "Scan Photos" job**, which shifts the scan
  baseline (`stack_detection.py:339-343`).
- **Possible path traversal in direct-mode media serving.** Windows `\..\` in
  `fname` normalizes lexically. It affects the standalone build and the
  unified image. **Security: verify and fix via a private advisory.**
- **Dashed photo UUIDs on SQLite installs upgraded through 0099**, while
  Django writes and looks up hex.
- `token_blacklist_outstandingtoken` is never pruned.
- The password-reset throttle is per-process.

**Frontend:** the issues listed in 03 §8.

# Teardown benchmark

This benchmark runs LibrePhotos (the 1.3.0 release and the dev image that becomes 1.4.0), Immich
and PhotoPrism on the same public dataset, on the same kind of machine, with each project's own
defaults. It records what a newcomer would see:

- how long until the library is indexed;
- how much RAM and CPU the stack uses, idle and at peak;
- how many photos each app finds compared with the dataset;
- **interop**: what curation from digiKam, Lightroom, darktable and Windows Photo Gallery shows up
  after indexing (people names and face boxes, flat and hierarchical keywords, ratings, captions);
- **write-back**: whether a rating, a description and a keyword set in the app reach the file. This
  is measured with the defaults, then again with each write-back switch the app has;
- whether an export carries those edits;
- **file safety**: whether anything in the library was moved, renamed, rewritten or created
  without being asked, and whether deleting in the app removes the original and its sidecar;
- how many setup steps each project's install guide asks for.

Each app runs twice: with the library mounted read-write and again read-only. Anyone with Docker
can rerun it and should get the same tables, within the noise of the runner.

> **Status: not run yet.** The harness was written and checked without containers (see
> [What is verified](#what-is-verified)). The first real run is the GitHub Actions workflow in
> `.github/workflows/teardown.yml`. Until that has passed, treat every adapter endpoint as unverified.

## Fairness rules

1. **Same dataset.** Each run gets its own fresh copy of one library. The library holds the files
   listed in `dataset/manifest.json` (every one CC0, sha256-checked), plus HEIC/MP4 derivatives and
   the messy and interop sets generated from them with a fixed seed. `meta/dataset.lock.json`
   records the hash of every file a run used.
2. **Same hardware.** In CI, every tool and mount mode runs in its own job on a fresh
   `ubuntu-latest` runner, with nothing else on it. Locally, run them one after another on the same
   idle machine. The runner's CPU count, RAM and Docker version are saved next to each result.
3. **Defaults only.** Each app starts from its release's own compose file, copied verbatim to
   `compose/<tool>/docker-compose.upstream.yml`. The `docker-compose.bench.yml` overlay only pins
   image digests, points the volumes at the dataset and sets the mount mode. The `.env` is the
   upstream template, with only the keys the install guide tells a user to edit: paths, version,
   admin login. No feature flag, worker count, model or ML setting is changed. Write-back switches
   that are off by default are tested only after the defaults, in their own labelled round-trip:
   LibrePhotos' `save_metadata_to_disk` set to `SIDECAR_FILE`, then `MEDIA_FILE`, each with
   `save_face_tags_to_disk`. Immich always writes sidecars and has no switch. PhotoPrism has no XMP
   write-back to switch on.
4. **Versions pinned.** Every image is pinned by tag and digest. `tools.json` records the release,
   its source commit and the date. Upstream LibrePhotos 1.3.0 names `pgautoupgrade:latest`; the
   overlay pins what that resolved to on 2026-10-16. The LibrePhotos dev image is pinned to the
   build pushed on 2026-10-16. That image carries no source revision label; `tools.json` gives the
   commit range. Image pulls happen before the clock starts and are reported separately
   (`pull_seconds`).
5. **Throughput, not soak.** Each run gets 10 minutes from `docker compose up` to the end of the
   delete test (`BENCH_BUDGET`). The index window is whatever remains after the later phases have
   their time reserved. An app still indexing when that window closes is reported as "not
   complete", with how far it got. The run is not extended.
6. **First run counts.** Model downloads on first start (LibrePhotos at startup, Immich's ML container
   on the first job) are part of startup or index time, because a new user waits for them too.
   PhotoPrism ships its models inside the image, so for PhotoPrism this cost shows up in the pull
   instead.
7. **Same indexing path.** The benchmark indexes an existing folder in every app: LibrePhotos' scan
   directory, Immich's external library and PhotoPrism's originals folder. It never uploads. The
   `rw` run mounts that folder read-write, so write-back and deletes can be observed. The `ro` run
   mounts it `:ro` and repeats every test, keeping every other setting at its default (for example
   `PHOTOPRISM_READONLY` stays `false`).
8. **Published as is.** `results.json` keeps every number, poll and error. A broken run is a row
   with errors, never a missing row.

## Test order inside one run

1. Snapshot the library: path and sha256 of every file, before the app starts.
2. Startup, bootstrap (admin, library path), 20 s idle sample.
3. Index until idle (see below), then a 20 s idle sample and the app's photo count.
4. **Interop**, read-only: every fixture's API detail is searched for the values its files carry.
5. **Round-trips**: defaults on photo A, then each write-back switch on its own photo. With
   LibrePhotos' face-tag switch on, the run also triggers "Write metadata to files" for face tags
   and checks the people photos for MWG regions on disk.
6. **Export** of the edited photos.
7. **File safety**: a second snapshot, compared with the first (moved or renamed by hash, deleted,
   rewritten, created). Writes the benchmark asked for (the round-trip photos and their sidecars)
   are listed separately from unasked ones.
8. **Delete**: trash a JPEG that has an Adobe-style `.xmp` sidecar, delete it permanently (Delete
   permanently / Empty trash / PhotoPrism archive + delete), and see whether the original and its
   sidecar leave the disk. The app's automatic trash expiry setting is read from its config API. The
   benchmark does not wait for expiry, since that takes days.

## What each number means

| Column | How it is measured |
| --- | --- |
| Documented setup steps | Hand-counted from each project's install guide (`tools.json`, with sources). |
| Startup | Seconds from `docker compose up -d` until the app's health or ping endpoint answers. |
| Index | Seconds from triggering the scan until the app's own job API reports no queued or active work, the stack's summed CPU has stayed under 15 % of one core for three `docker stats` rounds, and both conditions held for three polls 5 s apart. For PhotoPrism, whose index request returns only when indexing is done, "no work" means that request has returned. `api_idle_seconds` records the moment the queues emptied, even when the CPU never settled. |
| Found / expected | The app's own photo + video count, compared with `media_files` in the lock file. The lock counts every valid media file, duplicates included; `media_unique_bytes` is also stored. Corrupt files, non-media and `.hidden`/`@eaDir` folders are not counted. |
| Idle / peak RAM, CPU | Sum over all containers of the project, from `docker stats --no-stream` (about one round every 2 s): mean over 20 s after indexing, and peak during indexing. CPU is in % of one core. |
| Interop | Per convention, the share of fixtures (0 to 1) whose value the app's API shows: people names, face boxes with the right name, flat keywords, hierarchical keywords (`leaf` or full path), hierarchy kept (full path), rating, caption. Values are searched in the photo's API detail and the app-wide tag and people lists, so the field name does not matter. |
| Write-back | The benchmark sets rating 4, a description with a random nonce and a keyword with a nonce through the app's API. It then searches the original and its `.xmp` / `.ext.xmp` sidecars with ExifTool by value, not tag name, and also the app's own sidecar format (PhotoPrism YAML). `file` = written into the original, `xmp` = XMP sidecar, `app` = the app's own sidecar, `-` = not written. A value the file already had before the edit does not count. |
| Face regions on disk | After the face-tag write: of the people photos where the app found faces, how many now carry `XMP-mwg-rs:RegionInfo` in the file or sidecar. |
| Edits in export | The edited photos are downloaded through the app's export or zip download. The benchmark checks whether the zip contains the edits, either embedded or as sidecar files. |
| File safety | Counts from the before/after snapshot. In a `ro` run every count should be 0; in an `rw` run, anything "unasked" is the app's own doing. |
| Delete | Whether the original left the disk after a permanent delete in the app, which sidecars left with it, and the automatic trash expiry as configured by default. |

## Running it

Requirements: Linux (or macOS with Docker Desktop), Docker with Compose v2.20+, Python 3.10+,
ExifTool, ffmpeg, `heif-enc` (Ubuntu: `libimage-exiftool-perl ffmpeg libheif-examples
libheif-plugin-x265`), about 15 GB free disk for the small profile and 30 GB for full, and 16 GB
RAM. Everything else is the Python standard library.

```bash
cd benchmarks/teardown
bash bench/prepare_dataset.sh /tmp/teardown-data small        # or: full
for tool in librephotos librephotos-dev immich photoprism; do
  for mode in rw ro; do
    bash bench/run_tool.sh "$tool" /tmp/teardown-data results "$mode"
  done
done
(cd bench && python3 -m teardown_bench.report --results ../results --tools ../tools.json)
cat results/results.md
```

`BENCH_KEEP=1` leaves a stack running for inspection (`docker compose -p teardown-<tool>-<mode> ...`).
Ports 3000, 2283 and 2342 must be free.

In GitHub Actions: `.github/workflows/teardown.yml`. It never runs on its own. Once the file is on
`dev`, start it from "Run workflow" (choose a profile and budget). Before that, GitHub can't dispatch
it, so push a commit whose message contains `[run teardown]` to `docs/positioning-research` or a `bench/**` branch
(`git commit --allow-empty -m "bench: [run teardown]"`); push runs use the `small` profile and 600 s. The matrix is 4 tools × 2 mount modes = 8 jobs. The report job
uploads `teardown-results` (`results.json` + `results.md`) and writes the tables to the job summary.

### Profiles

| Profile | Clean files | Derived | Messy | Interop | Fits 10 min? |
| --- | --- | --- | --- | --- | --- |
| `small` (CI default) | 272 (fixed, evenly spread subset of each stratum) | 20 HEIC, 2 MP4 | about 80 | 19 fixtures, 11 sidecars | expected, not yet measured |
| `full` | 975 JPEG/PNG/WebM/RAW (2.16 GB) | 60 HEIC, 4 MP4 | 226 | 19 fixtures, 11 sidecars | probably not on CPU for ML-heavy defaults; reported as incomplete with progress |

## Dataset

- `dataset/build_manifest.py` (maintainer only) queries Wikimedia Commons and raw.pixls.us for CC0
  files and writes `manifest.json`. `fetch_dataset.py --fill-sha256` then locks every file's sha256.
- `dataset/fetch_dataset.py` downloads the manifest's files and verifies each hash. Wikimedia
  throttles bursts (HTTP 429), so it downloads one file at a time with a short delay. `--mirror URL`
  takes the same files from another host (for example a release asset); the hashes are still
  checked. CI caches the downloads by manifest hash.
- `dataset/derive_formats.py` re-encodes some JPEGs to HEIC with their EXIF copied over, and generates
  synthetic MP4s.
- `dataset/make_messy.py` adds the messy set: duplicates, stripped/zero/future/null-island/conflicting
  EXIF, `IMG.xmp` and `IMG.jpg.xmp` sidecars, wrong and upper-case extensions, truncated and empty
  files, non-media files, hidden folders, and folder names with Unicode, emoji, `#&%`, brackets,
  double spaces, deep nesting and 180 characters.
- `dataset/make_interop.py` adds the interop set (3 per convention). Each copy first has its existing
  rating, keywords, captions and regions cleared:
  - digiKam: MWG-RS face regions with names, `digiKam:TagsList` hierarchy, `xmp:Rating`,
    `dc:description`;
  - Lightroom Classic: a CC0 RAW with an `IMG.xmp` sidecar holding `lr:hierarchicalSubject`, plus a
    JPEG with the same fields embedded;
  - darktable `IMG.jpg.xmp` vs Adobe `IMG.xmp` sidecars;
  - one JPEG with both sidecar names and conflicting ratings (reported, not scored);
  - Windows Photo Gallery `MP:RegionInfo` people rectangles with `MicrosoftPhoto:LastKeywordXMP` and
    `RatingPercent`.

  Flat keywords and hierarchy leaves carry different values, so each import path is scored on its
  own. Face boxes are fixed, centred rectangles, not detected faces.
- `dataset/lock_dataset.py` hashes the final library and writes the expected counts, the round-trip,
  people and delete targets. It fails on any file it cannot account for.

Licences: [dataset/LICENSES.md](dataset/LICENSES.md).

## What is verified

Checked on the author's machine (Windows, no working Docker):

- Every Python file compiles (`python -m py_compile`). Every shell script passes `bash -n`.
  `.github/workflows/teardown.yml` passes actionlint 1.7.12 (downloaded from its GitHub release, checksum
  verified). Every compose file parses as YAML. Every `${VAR}` without a default in each
  upstream + overlay pair is set by the `.env` the harness writes. shellcheck was not available.
- `build_manifest.py` ran against the live APIs and produced `manifest.json`: 975 files, all CC0,
  2.16 GB. `fetch_dataset.py --fill-sha256` downloaded every file (25 minutes, with Wikimedia's 429
  throttling) and locked its sha256. A second run verified all 975 from cache in 13 s.
- On the full real download: `derive_formats.py` produced 4 MP4s, `make_messy.py` 226 files,
  `make_interop.py` 19 fixtures with 11 sidecars, and `lock_dataset.py` locked 1,235 files
  (1,173 media). The fixtures were read back with ExifTool: MWG and MP regions, TagsList,
  hierarchicalSubject and ratings are where they should be. HEIC derivation was skipped there: the
  local ImageMagick cannot write HEIC, so `heif-enc` on Ubuntu has not been exercised.
- Harness logic was exercised with fake in-process apps and real ExifTool. That covered: the round-trip
  search (an app that writes `.xmp` scores `xmp` three times; one that writes nothing scores `-`);
  export inspection; interop scoring (an app that imports every tag scores 1.0 on every field, a
  blind one 0); the tree diff (a rename, an asked-for sidecar and an unasked file are each
  classified correctly); the delete test; the face-region check; the index polling loop (quiet vs
  busy CPU); the `docker stats` parser; the `.env` renderer; and the report tables.
- The compose files are verbatim copies from each release's tag (dev: commit 9f71dd425). Image digests
  were read from Docker Hub and GHCR on 2026-10-16. `docker compose config` has **not** been run.

**Not verified** (needs Docker; the first CI run will show it):

- every adapter request: paths, payloads and response fields were read from each release's source
  code or OpenAPI spec, never sent to a live server;
- LibrePhotos: `/api/photos/` listing `image_path`, the user-settings PATCH for
  `save_metadata_to_disk` / `save_face_tags_to_disk`, `POST /api/savemetadata/` for face tags, the
  `/media/zip/<id>` download with a Bearer header, `setdeleted` + `DELETE photosedit/delete`, and
  whether the dev image keeps 1.3.0's request shapes (its OpenAPI says yes for the ones used);
- Immich: the bulk `PUT /api/assets` with `rating`/`description`, `/api/queues` as the idle signal,
  `search/metadata` paging by `libraryId`, `/api/faces?id=`, `DELETE /api/assets` + `POST
  /api/trash/empty`, and `/api/admin/config` for the trash setting;
- PhotoPrism: the photo list's `FileName`/`Files`, `Details.Keywords` through `PUT /photos/:uid`,
  `Files[].Markers` for faces, `batch/photos/archive` + `batch/photos/delete`, the zip download token,
  and whether `PHOTOPRISM_DEFAULT_TLS` makes it answer HTTPS on 2342;
- how each app behaves on the `:ro` mount (errors are recorded, not assumed);
- whether the small profile fits the 10-minute budget on `ubuntu-latest` (4 vCPU, 16 GB) for each app;
- `docker compose images --format json` and `--quiet-pull` on the runner's Compose version.

## Known limits

- Setup steps are counted by hand from the docs, not measured. The harness's own API calls are listed
  in each result (`setup.harness_steps`) for comparison.
- "Found" uses each app's own counter. Apps treat byte-identical duplicates and RAW+JPEG pairs
  differently (stacked, merged or separate), so a lower count is not automatically a miss. The
  per-category files in the lock let a reader check the details.
- Interop scoring searches API responses by value. It can credit a value the app stores but never
  shows in its UI, and it cannot tell a face box drawn in the wrong place from the right one.
- Automatic trash expiry is read from configuration, not simulated. A run would have to wait days, or
  change the clock or the setting, which would break "defaults only".
- Metadata import from the messy set's XMP sidecars is generated but not scored. The interop set
  covers sidecar import.
- Renovate may open PRs for the image pins in `compose/*/docker-compose.bench.yml`. Bump a version
  together with `tools.json`, never alone.

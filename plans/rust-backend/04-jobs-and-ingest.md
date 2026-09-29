# 04 — Jobs and the Ingest Pipeline

With no Django there's no django-q2: no pickled payloads, no ORM broker, no
`qcluster` process. The worker lives inside `librephotos-rs` (or runs as
`librephotos-rs worker`).

## 1. Job queue (`lp-jobs`)

A Rust migration adds `job_queue`:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | bigserial | |
| `kind` | text | e.g. `scan.user`, `scan.file_group`, `faces.scan`, `zip.build` |
| `payload` | jsonb | ids and options only, never serialized objects |
| `status` | text | `queued` / `running` / `done` / `failed` / `cancelled` |
| `lrj_id` | varchar(36) null | → `api_longrunningjob.job_id`, for the UI |
| `group_id` | text null | fan-out groups (a scan = thousands of file groups) |
| `run_after`, `attempts`, `max_attempts` | | delays, retries |
| `locked_by`, `heartbeat_at` | | crash recovery: stale heartbeats are re-queued |
| `last_error` | text | |

- **Claiming:** `UPDATE … WHERE id = (SELECT id FROM job_queue WHERE
  status='queued' AND run_after <= now() ORDER BY run_after FOR UPDATE SKIP
  LOCKED LIMIT 1) RETURNING *`.
- **Wake-ups:** `LISTEN job_queue`, with a 1 s poll as backup.
- **Concurrency:** `WORKER_CONCURRENCY` job slots on tokio. CPU-heavy steps go
  through a bounded `spawn_blocking` pool. External resources get their own
  semaphores: the ExifTool pool, an ffmpeg budget, and per-sidecar in-flight
  limits.
- **Schedules** (code-defined, with a `schedule_state` table so restarts don't
  double-run):

| Schedule | Interval |
| --- | --- |
| `cleanup_deleted_photos` | daily |
| `cleanup_stuck_jobs` | hourly |
| `cleanup_old_jobs` | daily |
| Zip file expiry | 1 day after creation |
| Prune expired refresh tokens | daily |

The sidecar watchdog isn't a job; it's a supervisor task (§4).

## 2. `LongRunningJob` stays the UI contract

The jobs page and the worker indicator poll `api_longrunningjob` every 2 s.
Rust keeps the table and the frontend-visible semantics:

- **Start:** `started_at`, then `progress_target`.
- **Progress:** `progress_current`, with increments batched and flushed
  every 250 ms instead of one UPDATE per file.
- **Errors in `result`:** `error_count`, `errors` (deduped, max 100), `error`
  (the first one), `status` (`failed` / `partial_failure`); `failed` only
  above `max(10, 5%)` errors.
  - Duplicate/stack jobs report `current` / `total` / `stage` in `result`.
- **Finish exactly once:** a guarded UPDATE. For scans, the winner runs the
  follow-ups.
- **Cancel:** cooperative, checked every 100 items. The cancel endpoint also
  marks the `job_queue` rows.
- **Baselines:** the last finished job per (user, type) is the incremental
  baseline, so these timestamps must be accurate.
  - Stack detection gets its own job type. Today it records itself as
    "Scan Photos" and shifts the scan baseline, a Django bug not carried
    over.

## 3. Job inventory

| Kind | Triggered by | Implementation |
| --- | --- | --- |
| `scan.user` (full / incremental / uploaded / missing) | scan buttons, upload | Rust (§5) |
| `scan.file_group` | fan-out from `scan.user` | Rust (§5) |
| `repair.file_variants`, `delete.missing_photos` | scan follow-up / button | Rust (DB only) |
| `tags.generate` | scan follow-up / button | Rust → tags sidecar (8011) |
| `geo.locate` | scan follow-up / button | Rust → geocoding providers (reqwest) |
| `clip.embed` | scan follow-up / button | Rust → CLIP sidecar (8006), batches of 64 |
| `similarity.build` | after CLIP, and at startup | Rust → similarity sidecar (8002) `/build` in 5000-embedding pages |
| `faces.scan` (+ `faces.embed`) | scan follow-up / button | Rust → face sidecar (8005); XMP RegionInfo faces first |
| `faces.cluster`, `faces.train` | after faces, "train" button | Rust → **new `face_cluster` sidecar** (8013) |
| `ocr.generate`, `media.classify` | buttons | Rust → OCR sidecar (8012) + rules |
| `captions.generate` | per photo (the frontend calls it synchronously today) | Rust → captioning sidecar (8007) |
| `albums.auto_generate`, `albums.auto_titles` | buttons | Rust (1.5-day gap rule, GPS mean, title rules) |
| `dupes.detect` | button | Rust: u64 popcount over a BK-tree or multi-index. Today it's a pure-Python O(n²) cross-batch pass. |
| `stacks.detect` | button | Rust (burst rules; EXIF from the pool, cached) |
| `zip.build` | download button | Rust, streaming `zip` crate |
| `models.download` | site settings | Rust: sha256-pinned, `.part` then rename, same `data_models/` layout |
| `metadata.write_ratings` | bulk rating edits | Rust → ExifTool pool (S16) |

## 4. Sidecars

**Supervisor** (port of `api/services.py` + `check_services`):

- start the enabled sidecars (feature flags, OCR site setting) as
  `python service/<name>/main.py` with `BASE_DATA`, `BASE_LOGS`,
  `LOG_LEVEL`, `ONNX_*`
- probe `/health` every 60 s and restart dead ones
- `POST /unload-model` after 120 s idle, where a 409 means busy

The contracts stay exactly as today: file paths in, JSON out.

**Clients** in `lp-sidecars` are typed, with today's timeouts:

| Sidecar | Timeout |
| --- | --- |
| exif | gone (in-process now) |
| face, similarity, tags | 60 s |
| thumbnail, clip | 120 s |
| caption, ocr | 180 s |

Retry twice on connect errors or 503, never on a read timeout.

**`face_cluster` (new, Python).** `api/face_classify.py` minus the ORM:

| Endpoint | Input → output |
| --- | --- |
| `POST /cluster` | `{faces: [{id, encoding_hex}], min_cluster_size}` → `{labels}` (HDBSCAN, size scaled by face count, as today) |
| `POST /train` | `{labeled: [{id, person_id, encoding_hex}], unknown: [...]}` → `{predictions: [{id, person_id, probability}]}` (MLPClassifier ×2) |
| `POST /pca` | `{encodings}` → 3-D coordinates for the scatter plot |

Rust does all the DB work around it.

**Exif** isn't a sidecar anymore: `lp-exif` is an in-process pool of
`exiftool -stay_open True -@ -` processes (plain + `-struct`).
- It carries over the batching and attribution logic from
  `service/exif/main.py` (later files override earlier, group-family and
  lang-alt matching).
- `-execute{N}` sentinels guard against cross-talk; wedged processes are
  killed and respawned.
- One merged tag request per photo per scan, **cached for the follow-ups**.
  Today the same file gets up to 5 ExifTool round trips: 2 in scan, +1
  geocode, +1 faces, +1 per burst run.

## 5. Scan pipeline (`lp-ingest`)

**Correctness bar:**

- **Consistent within a library.** The results of a Rust-scanned file must
  equal a Django-scanned one wherever a later comparison depends on it.
- **Django-readable.** Everything written stays readable by Django (02).
- **Equal work.** Pixel-identical thumbnails are *not* required, but the
  work has to be comparable for the benchmark: same sizes, formats and
  quality settings.

| Stage | Rust | Notes |
| --- | --- | --- |
| Walk + group | `jwalk`; follows symlinks with (dev, inode) loop detection; substring skip patterns; group by (dir, lowercase stem) incl. both XMP naming forms | Port the rules exactly: they decide what becomes one photo |
| Known-file check | one query per ~10k groups | |
| Sniff + decodability | `infer` + the hand-written MPEG-TS check; RAW/XMP extension lists; libvips header load | libvips in the Rust image must have the HEIC/JXL/RAW loaders, or the set of indexed files changes |
| Hash | MD5 of the whole file + `str(user_id)` | Byte-identical string. It's the join key for everything. |
| Replaced-file check | MD5 changed → re-render and compare pHash | Needs pHash consistency (below) |
| Motion photos | `memchr` for `ftypmp42/isom/iso2` / `MotionPhoto_Data`, copy the tail to `embedded_media/<file.hash>_motion.mp4` | |
| EXIF | `lp-exif` pool, one request per photo, cached | Same tags and values: same ExifTool |
| Dates | port of `date_time_extractor.py`: fancy-regex for user rules, chrono-tz, tzf-rs **loaded once** (Python builds a `TimezoneFinder` per call) | Golden vectors from the Python functions (06) |
| Thumbnails | libvips `thumbnail` (autorotate, `Size::Down`) → big ≤1080 h, then 500 / 250 resized in memory; WebP Q95 effort 2; `local_orientation` applied | Same files and names. RAW: embedded preview via libvips/LibRaw, else the Python thumbnail sidecar (8003) as today. |
| Video | ffprobe HDR detect → zscale/hable tone-map; big = first frame; squares = 5 s libx264 CRF 20 at `-2:500` / `-2:250` | Same ffmpeg args (golden: generated command lines) |
| pHash | hand-port of `imagehash.phash(hash_size=8)`: Pillow fixed-point luma, Pillow's two-pass LANCZOS to 32×32, DCT-II, numpy-median, 16 hex | Must match Python bit-for-bit, or duplicate detection degrades in mixed libraries. The `image_hasher` crate does **not** match. Fallback: a `rehash` job that recomputes every pHash with the Rust implementation after `adopt`. |
| Aspect ratio | Python's correctly-rounded `round(w/h, 2)` | Not `(x*100).round()/100` |
| Dominant color | median-cut to 16 colors on the small thumbnail → `"[r, g, b]"` | Cosmetic; format must match |
| Screenshot / document flags, search text | port the rules | |
| Follow-ups | tags, geocode, CLIP, faces, OCR as queued jobs (§3) | Geocoding rate limits become in-process (one process now), no `diskcache` |

**On-disk layout** (unchanged, under `MEDIA_ROOT = $BASE_DATA/protected_media`):

| Path | Content |
| --- | --- |
| `thumbnails_big/<image_hash>.webp` | Big thumbnail |
| `square_thumbnails[_small]/<image_hash>.webp\|.mp4` | Aspect kept despite the name |
| `faces/<image_hash>_<idx>.jpg` | Always read the name from the DB, never build it |
| `embedded_media/<file.hash>_motion.mp4` | Motion-photo video |
| `transcoded/<image_hash>.mp4` | Transcode cache |
| `zip/<uuid><user_id>.zip` | nginx serves it at `/api/downloads/…` |
| `data_models/…` | Downloaded models |

## 6. Upload, zip, transcode

- **Chunked upload:** the frontend's protocol.
  - `POST /api/upload/` takes multipart `file`, `Content-Range`, and an
    optional `upload_id`; it returns `{upload_id, offset, expires}`.
  - `POST /api/upload/complete/` takes `upload_id`, `md5`, `filename` and the
    device timestamps.
  - Stage files under `MEDIA_ROOT/chunked_uploads`, write to
    `<scan_directory>/uploads/web/`, then enqueue a `scan.file_group` plus
    the upload follow-ups.
- **Zip:** `POST /api/photos/download` → `{job_id, url}`; poll with
  `?job_id=` (200/202/500); `DELETE /api/delete/zip/<uuid>`. Build it by
  streaming the `zip` crate to disk (507 if the disk is full); nginx serves
  the result.
- **Live transcode** (user has "always transcode" on and there's no cache
  hit): ffmpeg writes fragmented mp4 to stdout, streamed as the body with
  `Cache-Control: no-store`. Kill ffmpeg when the client disconnects, and
  fill `transcoded/` in the background.

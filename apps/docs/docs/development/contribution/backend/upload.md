---
title: " 📁 Upload"
description: "How to uploading photos works as a developer"
sidebar_position: 3
---

## Endpoints:

### `GET /api/exists/<hash>`

Checks if a file exists on the server.
The hash is calculated by `md5 + user_id`

Answers `{"exists": true, "photo_id": "<uuid>"}` for a file you already have, and `{"exists": false, "photo_id": null}` otherwise; only your own photos count. The `photo_id` lets a client add a file it already has to the album it is uploading into. <Since version="1.4.0" /> Older servers send only `exists`.

#### Headers:

- `Authorization` - `Bearer <token>`

### `POST /api/upload/`

Uploads a file in chunks.
On the first chunk leave `upload_id` empty, you will get a response with the `upload_id` in the body, which you need to send with the next chunk

#### Form Data:

- `file` - The chunk of the file, name is blob
- `upload_id` - The id of the upload
- `offset` - The byte offset of the chunk (sent by the web client, but ignored by the server — see the note below)
- `md5` - The md5 hash of the chunk (not used yet, you can leave it empty)

#### Headers:

- `Content-Type` - `multipart/form-data`
- `Authorization` - `Bearer <access token>` (or `Cookie` - `jwt=<access token>` as a fallback)
- `Content-Range` - `bytes <start>-<end>/<total>`

The server derives the chunk position from the `Content-Range` header only, not from the `offset` form field. If the header is omitted it assumes the chunk starts at byte 0, so any upload of more than one chunk must send `Content-Range` or the second chunk fails with `400 "Offsets do not match"`. The response body returns the server's authoritative `offset` (alongside `upload_id` and `expires`); use it as the start of the next chunk.

### `POST /api/upload/complete/`

Assembles the uploaded chunks into a single file and imports it.

#### Form Data:

- `upload_id` - The id of the upload
- `md5` - Just the md5 hash of whole file
- `filename` - The original filename
- `device_created_at` (optional) - When the device says the photo was taken, used as its date only when the file carries none (screenshots, images saved from messengers). Epoch milliseconds (an integer of at least 11 digits) or ISO 8601. An ISO value keeps its wall-clock time: `2025-10-11T21:30:00-07:00` is stored as 21:30 on 11 October, like a camera's local `DateTimeOriginal`.
- `device_modified_at` (optional) - The same, used when `device_created_at` is missing or unusable.
- `album_id` (optional) - <Since version="1.4.0" /> One of your own albums to add the photo to. It is checked before the file is saved: an id that is not one of your albums (someone else's, or deleted) answers `400` with code `album_not_found`, a locked album `400` with code `album_locked`, and a value that is not an id `400` with code `invalid`, in the API's [error format](../../../user-guide/api-authentication.md#error-responses) (`field` is `album_id`). The staged upload is kept after such a refusal, so the same `upload_id` can be completed again without `album_id` to put the file in the library only.
- `device_tz_offset` (optional) - The device's UTC offset in minutes east of UTC at that moment (`-420` for UTC-7; the opposite sign of JavaScript's `getTimezoneOffset()`). Epoch milliseconds carry no time zone: they are shown at this offset, or in the owner's default time zone when it is not sent.

A shorter number or a value that does not parse is ignored. <Since version="1.4.0" /> Up to 1.3.0, epoch milliseconds were stored as UTC time and ISO values as their UTC instant, so these photos could land on the wrong day.

#### Headers:

- `Content-Type` - `multipart/form-data`
- `Authorization` - `Bearer <access token>` (or `Cookie` - `jwt=<access token>` as a fallback)

#### On completion:

On success the server:

- Writes the assembled file to `<upload root>/web/<sanitized filename>`. The upload root is the user's upload folder when an admin set one, otherwise `<scan_directory>/uploads` (`User.upload_root()`). The `web/` subfolder is created if missing; `web` is currently hardcoded as the origin device, so mobile backups land there too.
- Creates the photo (`create_new_image`) and queues one background task (django-q), `import_uploaded_photo` in `api/jobs/upload_import.py`, that processes it: thumbnails and metadata, then `add_photo_to_user_album` when `album_id` was sent (it checks again that the album is still yours and unlocked, and skips it otherwise), the device date fallback, tags, geolocation with the day album's place, and face extraction. A step that fails does not stop the others. Because of this, **clients do not need to call `/api/scanuploadedphotos/` afterwards**; the upload is already imported.
- <Since version="1.5.0" /> Counts the upload in your **Import Uploads** job (job type 20), opening one when you have none. You have at most one open import job: every upload adds one to its `progress_target`, and the task adds one to its `progress_current` once all its steps ran. The job finishes when it is sealed (see `POST /api/upload/seal/` below) and every counted upload was processed. A file that makes no photo (a sidecar, embedded media) is not counted, and neither is a duplicate.
- When the import job finishes, requests your upload follow-ups (`api/jobs/upload_followups.py`). <Since version="1.5.0" /> They run the library-level steps a scan's follow-ups run: search embeddings for photos that have none (with tagging off the per-photo steps store none), a rebuild of the similarity index so new photos show up in semantic and similar-photo search, and encodings for faces that have none (faces read from XMP regions). Requests are debounced per user: the run starts at most two minutes after the first request, so several import jobs in a row get one run, and a request during a run makes it go round once more. The run takes a per-user lease (`UploadFollowupState`), so two workers never run it at once. Up to 1.4.0, uploaded photos stayed out of semantic search until the next scan or restart.
- Deduplicates by hash: if a `Photo` with the same hash already exists, or a same-named file in the upload folder has the same hash, the file is not copied and no new import is performed (the endpoint still returns `200`); with `album_id`, the photo you already have is added to that album. If a same-named file exists with a *different* hash, the image hash is appended to the basename.

#### Response:

<Since version="1.5.0" /> `{"job_id": "<uuid>", "photo_id": "<uuid>"}`: the import job counting the upload and the photo it made, both `null` when the file made no photo. A duplicate answers `{"detail": "Photo duplicated. No new import performed.", "photo_id": "<uuid>"}`, with the photo you already have (`null` when the identical file is in the upload folder but not in your library yet). Up to 1.4.0, every completion answered `{}`.

The job is a normal job row (`GET /api/jobs/`), so a client can follow the processing:

- `progress_target`: the uploads counted so far, `progress_current`: those processed, done or failed. Show at most the target: a task that runs after the job was finished as lost can count past it.
- `result.stages`: per step (`media`, `album`, `date`, `tags`, `places`, `faces`), how many photos went through it without an error; a step with nothing to do counts as done.
- `result.failed_files`: the last 100 photos with an error, `{"photo_id", "file", "stage", "error"}`, where `stage` is the first step that failed and `photo_id` is what this endpoint answered.
- `result.error_count`, `result.errors`, `result.status`: as for every job.
- `result.lost`: uploads that were never processed, when the job was finished as lost (below).
- `result.followups_requested`: `true` once the job finished and requested the follow-ups.

The job counts every upload of the user, from the web app, the mobile app or another client, so a client shows it as "your uploads", not as its own files. It does not mark the job queue busy (`GET /api/rqavailable/` ignores it), and it cannot be cancelled or removed while it runs (`409`, code `upload_import_running`).

Error responses:

- `400` if the user has no configured scan directory, or the configured directory does not exist on disk.
- `400 "File type not allowed"` if the file fails the media-type check (`is_valid_media`); the chunked-upload record is deleted.

:::note Authentication for the upload endpoints
Unlike the other endpoints, `/api/upload/` and `/api/upload/complete/` are plain Django views rather than DRF views, so DRF's authentication never runs. They call `JWTCookieAuthentication.authenticate_strict` themselves (`authenticate_upload_request`), which reads an `Authorization: Bearer <access token>` header first and falls back to the `jwt` cookie, whose value is the access token set on the response of `POST /api/auth/token/obtain/` and `POST /api/auth/token/refresh/`. Browser clients send the cookie automatically with `credentials: "include"`; other clients should send the header. A request without credentials returns `403 {"detail": "Authentication credentials were not provided"}`, and one with an expired or otherwise invalid token `403 {"detail": "Authentication credentials were invalid"}`. A malformed header, or a token for an account that is gone or deactivated, also answers `403 {"detail": "Authentication credentials were not provided"}`. Uploads must also be enabled: the endpoints check the `ALLOW_UPLOAD` site setting first and return `403 "Uploading is not allowed"` when it is off, so that 403 is not always an authentication problem.
:::

### `POST /api/upload/seal/`

<Since version="1.5.0" /> Tells the server an upload run is over: the import jobs it names take no more files, and finish once their uploads are processed. A file uploaded after that opens a new job.

#### Body (JSON):

- `job_ids` - The `job_id` values `POST /api/upload/complete/` answered during the run (at most 100).

Answers `{"sealed_job_ids": ["<uuid>"]}`, the jobs this call sealed. A job that was sealed already, has finished or is not yours is left out, not refused.

#### Headers:

- `Authorization` - `Bearer <access token>`

A client does not have to call it: a job that takes no file for 3 minutes is sealed by a sweeper that runs every minute, the path of the mobile app's backup, which uploads one file at a time with no end. The sweeper also finishes a sealed job whose uploads made no progress for 30 minutes while the job queue is empty (a worker stopped while it held them): the missing uploads count as failed (`result.lost`) and the follow-ups still run.

### `POST /api/scanuploadedphotos/`

Alias of `POST /api/fullscanphotos/` — both are handled by the same view (`FullScanPhotosView`). Despite the name it is **not** restricted to the upload folder: it queues a **full rescan of the user's entire scan directory**, reprocessing every file rather than only new or modified ones.

Returns `{"status": true, "job_id": "<uuid>", "job_ids": ["<uuid>"]}` on success; the job's row exists from that moment. Without a usable scan directory it answers 400, while a scan of the user is still queued or running 409 (code `job_already_running`, with that scan's `job_id` in the entry), and when the job cannot be queued 500 (code `job_start_failed`), all in the API's [error format](../../../user-guide/api-authentication.md#error-responses).

`GET` is still accepted but is marked deprecated in the OpenAPI schema (`deprecated=True`, "Use POST method instead"); new clients should use `POST`.

You normally do not need to call this after an upload — `POST /api/upload/complete/` already imports the file, including the caption, geolocation and face-extraction steps.

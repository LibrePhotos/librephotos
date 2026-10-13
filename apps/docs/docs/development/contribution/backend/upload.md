---
title: " 📁 Upload"
description: "How to uploading photos works as a developer"
sidebar_position: 3
---

## Endpoints:

### `GET /api/exists/<hash>`

Checks if a file exists on the server.
The hash is calculated by `md5 + user_id`

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
- `device_tz_offset` (optional) - The device's UTC offset in minutes east of UTC at that moment (`-420` for UTC-7; the opposite sign of JavaScript's `getTimezoneOffset()`). Epoch milliseconds carry no time zone: they are shown at this offset, or in the owner's default time zone when it is not sent.

A shorter number or a value that does not parse is ignored. _Not released yet:_ before this, epoch milliseconds were stored as UTC time and ISO values as their UTC instant, so these photos could land on the wrong day.

#### Headers:

- `Content-Type` - `multipart/form-data`
- `Authorization` - `Bearer <access token>` (or `Cookie` - `jwt=<access token>` as a fallback)

#### On completion:

On success the server:

- Writes the assembled file to `<upload root>/web/<sanitized filename>`. The upload root is the user's upload folder when an admin set one, otherwise `<scan_directory>/uploads` (`User.upload_root()`). The `web/` subfolder is created if missing; `web` is currently hardcoded as the origin device, so mobile backups land there too.
- Queues a background task chain (django-q) that imports the photo — `create_new_image` + `handle_new_image`, caption generation, geolocation, album-date location and face extraction. Because of this, **clients do not need to call `/api/scanuploadedphotos/` afterwards**; the upload is already imported.
- Deduplicates by hash: if a `Photo` with the same hash already exists, or a same-named file in the upload folder has the same hash, the file is not copied and no new import is performed (the endpoint still returns `200`). If a same-named file exists with a *different* hash, the image hash is appended to the basename.

Error responses:

- `400` if the user has no configured scan directory, or the configured directory does not exist on disk.
- `400 "File type not allowed"` if the file fails the media-type check (`is_valid_media`); the chunked-upload record is deleted.

:::note Authentication for the upload endpoints
Unlike the other endpoints, `/api/upload/` and `/api/upload/complete/` are plain Django views rather than DRF views, so DRF's authentication never runs. They call `JWTCookieAuthentication.authenticate_strict` themselves (`authenticate_upload_request`), which reads an `Authorization: Bearer <access token>` header first and falls back to the `jwt` cookie, whose value is the access token set on the response of `POST /api/auth/token/obtain/` and `POST /api/auth/token/refresh/`. Browser clients send the cookie automatically with `credentials: "include"`; other clients should send the header. A request without credentials returns `403 {"detail": "Authentication credentials were not provided"}`, and one with an expired or otherwise invalid token `403 {"detail": "Authentication credentials were invalid"}`. A malformed header, or a token for an account that is gone or deactivated, also answers `403 {"detail": "Authentication credentials were not provided"}`. Uploads must also be enabled: the endpoints check the `ALLOW_UPLOAD` site setting first and return `403 "Uploading is not allowed"` when it is off, so that 403 is not always an authentication problem.
:::

### `POST /api/scanuploadedphotos/`

Alias of `POST /api/fullscanphotos/` — both are handled by the same view (`FullScanPhotosView`). Despite the name it is **not** restricted to the upload folder: it queues a **full rescan of the user's entire scan directory**, reprocessing every file rather than only new or modified ones.

Returns `{"status": true, "job_id": "<uuid>", "job_ids": ["<uuid>"]}` on success; the job's row exists from that moment. Without a usable scan directory it answers 400, while a scan of the user is still queued or running 409 (code `job_already_running`, with that scan's `job_id` in the entry), and when the job cannot be queued 500 (code `job_start_failed`), all in the API's [error format](../../../user-guide/api-authentication.md#error-responses).

`GET` is still accepted but is marked deprecated in the OpenAPI schema (`deprecated=True`, "Use POST method instead"); new clients should use `POST`.

You normally do not need to call this after an upload — `POST /api/upload/complete/` already imports the file, including the caption, geolocation and face-extraction steps.

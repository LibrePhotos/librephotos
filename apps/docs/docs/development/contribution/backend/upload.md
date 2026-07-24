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
- `Cookie` - `jwt=<access token>`
- `Content-Range` - `bytes <start>-<end>/<total>`

The server derives the chunk position from the `Content-Range` header only, not from the `offset` form field. If the header is omitted it assumes the chunk starts at byte 0, so any upload of more than one chunk must send `Content-Range` or the second chunk fails with `400 "Offsets do not match"`. The response body returns the server's authoritative `offset` (alongside `upload_id` and `expires`); use it as the start of the next chunk.

### `POST /api/upload/complete/`

Assembles the uploaded chunks into a single file and imports it.

#### Form Data:

- `upload_id` - The id of the upload
- `md5` - Just the md5 hash of whole file
- `filename` - The original filename

#### Headers:

- `Content-Type` - `multipart/form-data`
- `Cookie` - `jwt=<access token>`

#### On completion:

On success the server:

- Writes the assembled file to `<scan_directory>/uploads/web/<sanitized filename>` (the `uploads/` and `uploads/web/` directories are created if missing; `web` is currently hardcoded as the origin device).
- Queues a background task chain (django-q) that imports the photo — `create_new_image` + `handle_new_image`, caption generation, geolocation, album-date location and face extraction. Because of this, **clients do not need to call `/api/scanuploadedphotos/` afterwards**; the upload is already imported.
- Deduplicates by hash: if a `Photo` with the same hash already exists, or a same-named file in the upload folder has the same hash, the file is not copied and no new import is performed (the endpoint still returns `200`). If a same-named file exists with a *different* hash, the image hash is appended to the basename.

Error responses:

- `400` if the user has no configured scan directory, or the configured directory does not exist on disk.
- `400 "File type not allowed"` if the file fails the media-type check (`is_valid_media`); the chunked-upload record is deleted.

:::note Authentication for the upload endpoints
Unlike the other endpoints, `/api/upload/` and `/api/upload/complete/` are plain Django views rather than DRF views, so DRF's JWT authentication never runs and the `Authorization` header is ignored. They authenticate solely from the `jwt` cookie, whose value is the access token set on the response of `POST /api/auth/token/obtain/` and `POST /api/auth/token/refresh/`. Browser clients send it automatically with `credentials: "include"`; other clients must send it explicitly (e.g. `curl --cookie "jwt=<access token>"`). A request without a valid cookie returns `403 {"detail": "Authentication credentials were not provided"}`. Uploads must also be enabled: the endpoints check the `ALLOW_UPLOAD` site setting first and return `403 "Uploading is not allowed"` when it is off, so that 403 is not always an authentication problem.
:::

### `POST /api/scanuploadedphotos/`

Alias of `POST /api/fullscanphotos/` — both are handled by the same view (`FullScanPhotosView`). Despite the name it is **not** restricted to the upload folder: it queues a **full rescan of the user's entire scan directory**, reprocessing every file rather than only new or modified ones.

Returns `{"status": true, "job_id": "<uuid>"}` on success and `{"status": false}` on failure.

`GET` is still accepted but is marked deprecated in the OpenAPI schema (`deprecated=True`, "Use POST method instead"); new clients should use `POST`.

You normally do not need to call this after an upload — `POST /api/upload/complete/` already imports the file, including the caption, geolocation and face-extraction steps.

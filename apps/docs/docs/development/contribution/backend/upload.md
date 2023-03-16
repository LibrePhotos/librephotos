---
title: " 📁 Upload"
excerpt: "How to uploading photos works as a developer"
sidebar_position: 5
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
- `user` - The user id
- `offset` - The offset of the chunk
- `md5` - The md5 hash of the chunk (not used yet, you can leave it empty)

#### Headers:

- `Content-Type` - `multipart/form-data`
- `Authorization` - `Bearer <token>`
- `X-CSRFToken` - `<token>`
- `Content-Range` - `bytes <start>-<end>/<total>`

### `POST /api/upload/complete/`

Combines the chunks of a file into a single file and moves it to the upload folder

#### Form Data:

- `upload_id` - The id of the upload
- `user` - The user id
- `md5` - Just the md5 hash of whole file
- `filename` - The original filename

#### Headers:

- `Content-Type` - `multipart/form-data`
- `Authorization` - `Bearer <token>`
- `X-CSRFToken` - `<token>`

### `GET /api/scanuploadedphotos/`

Start a new job to scan all photos in the upload folder

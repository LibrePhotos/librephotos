---
title: " 📁 Upload"
description: "How to uploading photos works as a developer"
sidebar_position: 1
---

### How does it work?

It uses the [endpoints](/docs/development/contribution/backend/upload) of the backend to upload the files in chunks. The steps are:

- Only show button if upload is enabled in admin area
- Even then, the button and the dropzone stay disabled (greyed out, with a "Scan directory not configured - contact administrator" tooltip) if the logged in user has no scan directory. The backend enforces the same rule and answers `complete` with a 400 when the user's scan directory is unset or does not exist on disk
- Check if file is on the server by using the `exists` endpoint.
- If it is, don't upload it
- If it isn't, upload it with the `upload` endpoint
- If the upload is complete, call the `complete` endpoint

The frontend never triggers a scan itself. While the backend handles `complete`, it queues a django-q `Chain` for that one file: `handle_new_image`, caption generation, geolocation, adding the location to the album dates and face extraction. Duplicates are skipped — the endpoint answers with "Photo duplicated. No new import performed." and no chain is queued. Once the last file is done, the client only invalidates its cached queries (recently added photos, date albums, the "Not in an album" list, count stats, photo month count and storage stats).

An upload can go into one of the user's albums (#612, not released yet). `useUploadQueue().start(files, album)` gives every queued item that album: the album page's **Upload to this album…** item and its empty state call it through `useAlbumUpload`, and the album page names its album to the window-wide `UploadDropTarget` through `useRegisterDropAlbum`, so a drop there goes into the album too (a locked album's page only says the files go to the library). The queue sends `album_id` with `complete`; when the server refuses the album (`album_locked`, `album_not_found`), it completes the same upload again without it and marks the row *library only*. A file `exists` already knows is added with one `PATCH /api/albums/user/edit/<id>/` per album once the queue drains, using the `photo_id` that `exists` answered. The card names the album and links to it, and the album's grid, its card and the "Not in an album" list are refreshed at the end and once more a little later, after the server's import chain has filed the last files.

:::note
`GET /api/scanuploadedphotos` still exists on the backend, but it is only an alias of the same view as `/api/fullscanphotos` and nothing in the web frontend calls it.
:::

This is implemented in the `ChunkedUploadButton` component in the frontend. The progress is saved within the state of the component.

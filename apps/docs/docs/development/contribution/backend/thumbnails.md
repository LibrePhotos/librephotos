---
title: "🎞 Thumbnails"
description: "How do thumbnails work in LibrePhotos?"
sidebar_position: 2
---

We process media files with different libraries to convert them to a widely compatible format and to speed up previewing files.

## Thumbnail engines

### libvips (images)

By leveraging libvips' lightning-fast image processing capabilities and memory-efficient design, the conversion process becomes remarkably fast, ensuring optimal performance even with numerous images.
Moreover, the utilization of pyvips as a Python interface facilitates seamless integration with the project

### ImageMagick (RAW images)

ImageMagick's robust suite of tools empowers us to perform conversion of raw images on a wide array of file types. When coupled with the wand library, which provides a Pythonic interface to interact with ImageMagick, it's easy to maintain and extend.

Because there are some compatibility issues between ImageMagick and PyTorch, this runs on a separate microservice.

### FFmpeg (video)

As a powerful and versatile multimedia framework, FFmpeg equips users with a comprehensive suite of tools to seamlessly convert videos in various formats. The open-source nature of FFmpeg results in continuous updates and improvements that keep pace with evolving industry standards.

### Source of truth for processing

Big thumbnails act as a source of truth for all subsequent processing like finding faces, calculating similarity, finding objects etc. The reason for that is twofold: First, we know that all files will be compatible with the machine learning pipelines, because it's only one format, second all file dimensions are limited to a certain format, which will prevent a possible explosion of resource use.

### Other thumbnails

We also create thumbnails for previewing faces: during face extraction the face region is cropped out of the big thumbnail and stored as a JPEG under `protected_media/faces`, so a lot of them can be displayed quickly. User avatars are not thumbnailed by the backend — the frontend scales the chosen image to a 150x150 PNG in the browser before upload, and the backend stores that file as-is under `protected_media/avatars`.

## Endpoints:

:::note Authentication

These `/media/...` endpoints are all served by `UnifiedMediaAccessView`, which is declared `AllowAny` and authenticates from the **`jwt` cookie**, not from an `Authorization` header. Obtain the cookie with `POST /api/auth/token/obtain/` and refresh it with `POST /api/auth/token/refresh/`; both responses set the `jwt` cookie automatically. Send your request with cookies enabled — an `Authorization: Bearer <token>` header on its own is ignored, and the request is rejected with `403 Forbidden`.

The exception is media belonging to an active public album share, which is served without any authentication. See [API authentication](../../../user-guide/api-authentication.md) for the full flow.

:::

### `GET /media/thumbnails_big/<hash>`

Gives you a large preview of the actual file. It is also an image for videos. If you want to display the video file use `media/photos/<hash>` instead.

### `GET /media/square_thumbnails/<hash>`

Gives you a normal preview of the actual file. Can be an image or a video.

### `GET /media/square_thumbnails_small/<hash>`

Gives you a small preview. Usually only usable with a blur to indicate loading. Could be replaced by blur hash.

### `GET /media/photos/<hash>`

Return the actual image or video from the server.

### `GET /media/faces/<filename>`

Returns the cropped face image for a photo. The file is created as `<hash>_<face_number>.jpg`, but Django's default storage appends a random uniqueness suffix when that name is already taken (for example `bb6685821c52c994cf7bbe9ebfd5eb7e1_2_fpZqB0S.jpg`), so do not construct the name yourself — use the `face_url` value returned by the faces or persons endpoints.

### `GET /media/avatars/<filename>`

Returns the avatar for a given user. The frontend uploads it as `<first_name>avatar.png` (there is no hash component on the first upload); the same random uniqueness suffix is appended on re-upload. Use the `avatar_url` field from the user endpoints rather than building the name.

### `GET /media/embedded_media/<hash>`

Returns the embedded video track of a motion photo (Samsung or Google) as `video/mp4`. The path segment accepts either the photo UUID (36 characters with 4 hyphens) or the legacy image hash, and returns 404 if the photo has no embedded media file. Used by the frontend lightbox to play the motion-photo clip. Unlike the other endpoints this one does not hard-require the cookie: an unauthenticated request is limited to public photos, and it narrows to the owner's photos when a session user or valid `jwt` cookie is present.

### `GET /media/zip/<prefix>`

Serves a bulk-download archive as `application/x-zip-compressed`. The path segment is a filename prefix, not the full filename — the backend appends the requesting user's id and `.zip`, so a user can only retrieve their own archive. Requires a valid `jwt` cookie; returns `403 Forbidden` otherwise.

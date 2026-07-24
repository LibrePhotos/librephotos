---
title: " 📁 Upload"
description: "How to uploading photos works as a developer"
sidebar_position: 1
---

### How does it work?

It uses the [endpoints](/docs/development/contribution/backend/upload) of the backend to upload the files in chunks. The steps are:

- Only show button if upload is enabled in admin area
- Check if file is on the server by using the `exists` endpoint.
- If it is, don't upload it
- If it isn't, upload it with the `upload` endpoint
- If the upload is complete, call the `complete` endpoint
- When the `complete` endpoint returns, mark the local image as synced with `markSynced`. No separate scan call is needed, because the backend's `complete` handler queues the import chain for the uploaded file itself.

This is implemented in `apps/mobile/src/stores/uploadActions.ts`, where you can call `uploadImages(files)` to upload the images. Progress and status are stored in the zustand store `useUploadStore` (`apps/mobile/src/stores/uploadStore.ts`) as `total`, `current` and `isUploading`.

### Differences to the frontend

To continue using blobs, we need to use `react-native-blob-util` to convert the file to a blob and chunk it. The library is not well documented, so it took some time to figure out how to use it. The types are mostly wrong, which is the reason for a lot of `any` types.
Blobs get created asynchronously via a callback, so `calculateChunks` wraps each `blob.slice(start, end).onCreated(cb)` call in a `Promise` and awaits them one chunk at a time. The chunk size is set by `chunkSize` (1,000,000 bytes) in `apps/mobile/src/stores/uploadActions.ts`.

All upload requests go through the shared fetch wrapper `fetchClient` (`apps/mobile/src/api_client/api.ts`), the same client used for the rest of the mobile API. The Android-specific pitfall is `Content-Type`: it must not be set manually on the multipart request, otherwise React Native's `FormData` cannot generate the multipart boundary and the upload fails. `FetchClient.request` handles this by only applying its default `application/json` header when the request body is not a `FormData` instance.

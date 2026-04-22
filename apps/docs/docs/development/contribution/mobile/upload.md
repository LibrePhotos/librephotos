---
title: " 📁 Upload"
excerpt: "How to uploading photos works as a developer"
sidebar_position: 5
---

### How does it work?

It uses the [endpoints](/docs/development/contribution/backend/upload) of the backend to upload the files in chunks. The steps are:

- Only show button if upload is enabled in admin area
- Check if file is on the server by using the `exists` endpoint.
- If it is, don't upload it
- If it isn't, upload it with the `upload` endpoint
- If the upload is complete, call the `complete` endpoint
- If all files are uploaded, call the `scanuploadedphotos` endpoint

This is implemented in the `UploadSlice`, where you can call the action `uploadImages` to upload the images. The progress is saved wihtin the slice as `total` and `current`.

### Differences to the frontend

To continue using blobs, we need to use `react-native-blob-util` to convert the file to a blob and chunk it. The library is not well documented, so it took some time to figure out how to use it. The types are mostly wrong, which is the reason for a lot of `any` types.
Blobs get created asynchronously, so we need to wrap chunking in a `Promise.all` to get the actual blobs.

We cannot use redux-query when using the `upload` endpoint, because it is based on fetch. Fetch isn't correctly implemented yet on androids okhttp library. When we use it, we will get a `Network error`. So we use axios instead.

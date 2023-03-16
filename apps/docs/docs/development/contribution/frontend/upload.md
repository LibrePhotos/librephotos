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

This is implemented in the `ChunkedUploadButton` component in the frontend. The progress is saved wihtin the state of the component.

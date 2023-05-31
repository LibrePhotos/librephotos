---
title: " ⬆ Upload"
excerpt: "How to upload photos to LibrePhotos"
sidebar_position: 5
---

![](../../static/img/upload-image.png)
In the top right corner of the web interface, there is an upload button. Clicking it will open a file picker. You can select multiple files and upload them.

### What kinds of files are supported?

We accept all files that have a mime type of image or video.

### How does it work?

The upload process works in the following way:

- Check if file is on the server by comparing the hash `md5 + user_id`
- If it is, don't upload it
- If it isn't, upload it
- We upload files in 1MB chunks
- If all files are uploaded, we scan the your `scan folder + /upload/web`

### Where are the files saved?

- If all the chunks are uploaded, we combine them into a single file and put them in your `scan folder + /upload/web`

### Activate / Deactivate the upload feature

![](../../static/img/allow-uploading.png)

You can activate / deactivate by navigating as an admin to the admin area and clicking on the `Allow uploads` switch. You can also set this by setting the environment variable `ALLOW_UPLOADS` to `true` or `false`.

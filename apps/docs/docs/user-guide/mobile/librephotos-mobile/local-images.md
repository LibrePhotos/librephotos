---
title: "☁️ Local Images"
excerpt: "How do local images work?"
sidebar_position: 5
---

## Sync status

- ✅ Synced: The image is synced with the server and exists on your phone
- 🔄 Syncing: The image is currently syncing with the server
- ❌ Local: The image is not synced with the server and only exists on your phone
- ☁️ Remote: The image is only on the server and not on your phone

On the first load of the app, it will check for new local images. These will be shown together with the images from the server.
When you upload images to the server, they will be marked as "Syncing" and will be synced with the server.
When the upload is complete, the image will be marked as "Synced". If it finds a local image on the server with the same hash, it will be not uploaded, but still changed to synced.

## Permissions

The app needs the following permissions:

- Read external storage (Android <12)
- Write external storage (Android <12)
- Read media images (Android >12)
- Read media video (Android >12)
- Manage external storage (Android >12)

The app will ask for these permissions on the first start. Most of these permissions are required to be able to read the images from your phone.

You have to grant "Manage external storage" permission manually by navigating to the app settings. This is required to be able to delete images from your phone.

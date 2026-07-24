---
title: "☁️ Local Images"
description: "How do local images work?"
sidebar_position: 2
---

## Sync status

- ✅ Synced: The image is synced with the server and exists on your phone
- ❌ Local: The image is not synced with the server and only exists on your phone
- ☁️ Remote: The image is only on the server and not on your phone

Whenever you open the timeline (the "With Timestamp" tab), the app scans your camera roll for images that are newer than the previous scan and shows them together with the images from the server. Because the scan is incremental, images that reach your phone with an older date — restored backups, files copied from a computer, or imports that keep their original EXIF date — are not picked up. Use "Reset Local Images" in the settings to clear the local index and force a full rescan.
When you upload images to the server, the Settings screen shows an "Uploading X%" progress indicator while the transfer runs. The image stays marked as "Local" until the upload finishes.
When the upload is complete, the image will be marked as "Synced". If it finds a local image on the server with the same hash, it will be not uploaded, but still changed to synced.

## Permissions

The app needs the following permissions:

- Read external storage (Android 12 and below, API ≤ 32)
- Write external storage (Android 10 and below, API ≤ 29)
- Read media images (Android 13+)
- Read media video (Android 13+)
- Manage external storage (Android 11+)

The app will ask for these permissions on the first start. Most of these permissions are required to be able to read the images from your phone.

You have to grant "Manage external storage" permission manually by navigating to the app settings. This is required to be able to delete images from your phone.

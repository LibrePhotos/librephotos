---
title: "☁️ Local Images"
excerpt: "How do local images work?"
sidebar_position: 5
---

## Local Image Slice

- ✅ Synced: The image is synced with the server and exists on your phone
- 🔄 Syncing: The image is currently syncing with the server
- ❌ Local: The image is not synced with the server and only exists on your phone
- ☁️ Remote: The image is only on the server and not on your phone

On the first load of the app, it will check for new local images. We use `react-native-camera-roll` to get the images from the phone. This is a async action in LocalImagesSlice called `loadLocalImages`. It will get the images from the phone and save them in the store. We use the `react-native-file-access` library to get the md5 hash of the image, which we combine with `user_id` to get the server hash. This is used to check if the image is already on the server.

The slice is persisted with `redux-persist` and `async-storage`, so the images will be loaded from the store on the next start of the app.

### Limitations

- `fromTime` and `toTime` do not work, so we save the timestamp of the last check and compare by that with each loaded image.

## Showing local images, together with the images from the server

We implemented a new selector, which merges local images and albumByDate images. When we find the same hash in both, we set the `synced` property to `true` for the local image and remove the image from the albumByDate images.

## Deleting backed up images

The business logic is in `removeBackedUpImages` action to delete the backed up images. We use `react-native-camera-roll` to delete images from the phone, which need the `Manage extern storage` permission.

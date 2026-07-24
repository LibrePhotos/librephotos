---
title: "☁️ Local Images"
description: "How do local images work?"
sidebar_position: 2
---

## Local Images Store

- ✅ Synced: The image is synced with the server and exists on your phone
- 🔄 Syncing: The image is currently syncing with the server
- ❌ Local: The image is not synced with the server and only exists on your phone
- ☁️ Remote: The image is only on the server and not on your phone

On the first load of the app, it will check for new local images. We use `react-native-camera-roll` to get the images from the phone. This is an async action called `loadLocalImages` in `src/stores/localImagesActions.ts`, which gets the images from the phone and saves them in the zustand store `useLocalImagesStore` (`src/stores/localImagesStore.ts`). On Android, `loadLocalImages` first requests a runtime read permission — `READ_MEDIA_IMAGES` on API level 33+, `READ_EXTERNAL_STORAGE` below that. If it is not granted, the action returns immediately, before the loading flag is set and without logging anything, so the timeline simply stays empty (iOS skips this check). We use the `react-native-file-access` library to get the md5 hash of the image, which we combine with `user_id` to get the server hash. This is used to check if the image is already on the server.

The store is persisted with zustand's `persist` middleware backed by `@react-native-async-storage/async-storage` (storage key `localImages-storage`), so the images are rehydrated on the next start of the app.

### Limitations

- `fromTime` and `toTime` do not work, so we save the timestamp of the last check and compare by that with each loaded image.

## Showing local images, together with the images from the server

The merge happens in the `timelineData` `useMemo` in `src/Containers/Gallery/Index.js`, which folds the local images from `useLocalImagesStore` into the date albums returned by `useFetchDateAlbumsQuery`. It only runs for the `With Timestamp` category. Each local image has an `id` of `md5(file) + user_id`, so when the same id appears in both, the server entry with that id is dropped from the date album and replaced by the local image, and one `isTemp` placeholder tile is removed per synced photo in that date group.

Sync state is not decided by this merge. `checkIfLocalImagesAreSynced()` (`src/stores/localImagesActions.ts`) asks the server `GET /exists/<id>/` for every local image and calls `markSynced` / `markNotSynced` on the store, which set the image's `syncStatus` field. `syncStatus` is the `SyncStatus` enum from `src/stores/types/localImages.zod.ts` (`synced` / `syncing` / `local`); there is no boolean `synced` property.

## Deleting backed up images

The business logic is in `removeBackedUpImages` action to delete the backed up images. We use `react-native-camera-roll` to delete images from the phone, which need the `Manage extern storage` permission.

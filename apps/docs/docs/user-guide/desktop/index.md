---
title: "Desktop app"
description: "The LibrePhotos desktop app (preview): a fast picture viewer for Windows, a library of your own folders, local search, and backup to your LibrePhotos server."
sidebar_position: 26
---

:::note Preview
The desktop app is a prototype and has not been released. There is no installer to download yet: it is built from the source code in `apps/desktop`. What it does and how it looks can still change.
:::

The **LibrePhotos desktop app** (its window is called *LibrePhotos Viewer*) is two things in one:

- a **picture viewer** that opens JPEG, HEIC, AVIF, JPEG XL, PNG, WebP, TIFF and camera RAW files at once when you double-click them in Explorer, and lets you rate, caption and tag them, and
- a **library** of the folders you choose, with search, that can back them up to your LibrePhotos server.

It works without a server. Everything you do to your own pictures stays on your computer and in the pictures' own files, so other photo apps (and the LibrePhotos server, if it scans the same folders) see it too. When you connect a server, the app also shows what the server knows about a picture, such as the people in it and its albums.

| Page | What it covers |
| --- | --- |
| [Viewing pictures](./viewer.md) | Opening pictures, moving through a folder, zoom, rotate, delete, slideshow, the info panel, keyboard shortcuts |
| [Editing a picture's details](./editing.md) | Favourites, star ratings, captions, keywords and the date taken, and where those changes are saved |
| [Library and search](./library.md) | Adding folders, the timeline, searching your pictures |
| [Connecting a server and backup](./server.md) | Signing in, backing up folders, uploading one picture, what the server adds to the viewer |
| [Settings](./settings.md) | Where edits are saved, maps, changes waiting for the server |

## Trying it

The app is built with [Tauri](https://tauri.app/) from `apps/desktop` in the LibrePhotos repository. Building it needs Node.js and Rust (`npm ci` and `npx tauri build` in `apps/desktop`); how the app is put together is in `apps/desktop/CONTRACT.md`. Started without a picture, it opens the library. Started with a file (or with a picture double-clicked once the app is your default viewer), it opens that picture.

To make it the viewer Windows opens pictures with, choose **Set as default photo viewer** in the **⋮** menu of the viewer: it opens Windows' **Default apps** settings at the app's page.

## Where the app keeps its data

| What | Where |
| --- | --- |
| The library, search index and settings | `%LOCALAPPDATA%\LibrePhotos Viewer\local.db` |
| Thumbnails and zoom tiles | `%LOCALAPPDATA%\LibrePhotos Viewer\cache1` and `tiles` |
| Your server sign-in | the server address and user in `settings.json` next to the database; the sign-in token in the Windows Credential Manager |
| Ratings, captions, keywords and dates you edit | next to each picture in an XMP sidecar by default, see [Where edits are saved](./editing.md#where-edits-are-saved) |

On macOS the folder is `~/Library/Application Support/LibrePhotos Viewer`, on Linux `$XDG_DATA_HOME/librephotos-viewer`. Deleting the folder resets the app; your pictures and their sidecars are not in it.

---
title: "Library and search"
description: "The desktop app's library: adding folders, the timeline that keeps up with changes, and searching by name, folder, date, camera, caption and keyword."
sidebar_position: 3
---

:::note Preview
The [desktop app](./index.md) is not released yet.
:::

The library shows the pictures and videos in the folders you add, newest first, grouped by day. Files stay where they are: nothing is copied or moved, and the library keeps up when you add, change, rename or delete files in those folders.

## Adding folders

Click **Add a folder** in the sidebar (or on **Folders**) and pick a folder. Its subfolders are part of it. A folder inside one you already added is not added twice, and adding a folder that contains folders you added before merges them into it.

**Folders** lists your folders with how many pictures each has. **Remove from library** takes a folder's pictures out of the library and its search; the files themselves stay.

While the app reads a new folder, the pictures appear as they are found, then their dates, sizes, cameras, ratings, captions and keywords fill in. A picture without a date taken sorts by the time the file was last changed.

From a picture in the viewer, **Add this folder to library** in the **⋮** menu adds the folder it is in.

## The timeline

**Photos** shows every library picture; a folder in the sidebar shows only that folder. Click a picture to open it in the [viewer](./viewer.md), where `←` and `→` move through the same list.

## Searching

Type in **Search the library** at the top. Every word must match the start of a word the picture is known by:

- its file name and extension (`IMG_2041`, `cr3`),
- its kind (`raw`, `video`, `photo`),
- the folder words below the folder you added (`holiday 2019`),
- the date taken (`2023`, `march`, `mar`, `2023-03`, `2023-03-15`), or `undated`,
- the format, camera and lens (`heic`, `canon`, `r5`, `24-105`),
- the caption and keywords you or another app gave it (see [Editing a picture's details](./editing.md)).

So `march 2023 canon` finds the pictures taken in March 2023 with a Canon camera, and `birthday` finds the ones whose caption or keywords say so.

When a server is connected, the server's search runs as well, which finds people, things, places and captions the server knows about. **All**, **This computer** and **LibrePhotos** choose which results to show; a picture that is only on the server opens in a large preview.

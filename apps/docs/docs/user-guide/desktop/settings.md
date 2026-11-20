---
title: "Settings"
description: "The desktop app's settings: where edits are saved (XMP sidecar, the file, or the app only), the OpenStreetMap map, and changes waiting for the server."
sidebar_position: 5
---

:::note Preview
The [desktop app](./index.md) is not released yet.
:::

Open **Settings** in the library's sidebar. Settings are saved in the app's database on this computer.

## Where edits are saved

Where favourites, ratings, captions, keywords and dates you change in the viewer are saved:

- **Next to the photo (XMP sidecar)**, the default: in a small `.xmp` file next to the picture. The picture is never changed, and LibrePhotos, digiKam, darktable and Lightroom read the same file.
- **Into the photo file**: inside the picture itself, without re-compressing it. Only JPEG files can be changed this way; for other formats saving is refused. A sidecar the picture already has is updated as well, since apps read the sidecar first. A changed file is a new file to a backup: a backed-up library uploads it again.
- **Only in this app**: in the app's database only. Files and other apps never see these changes.

The details are in [Where edits are saved](./editing.md#where-edits-are-saved).

## Maps

**Show a map from OpenStreetMap** adds a small map to the location of a picture in the info panel. It is off at first: the map is loaded from `tile.openstreetmap.org`, which then learns roughly where your pictures were taken. When it is off, the panel shows the coordinates and **Open in map**, which opens the place in your browser.

## Changes for the server

How many of your edits wait to be sent to your LibrePhotos server, for pictures that are on it (see [Pictures on your LibrePhotos server](./editing.md#pictures-on-your-librephotos-server)). **Everything is sent** when none wait. Changes the server refused stay here; **Try again** sends them once more.

---
title: "Privacy policy"
description: "What the LibrePhotos Viewer desktop app stores, what it sends and to whom: no telemetry, no analytics, no account; pictures go only to the LibrePhotos server you choose."
sidebar_position: 6
---

This policy covers the LibrePhotos Viewer, the [desktop app](./index.md), in every form it is distributed: the Windows installer and the Mac disk image from GitHub, the Microsoft Store package and the Mac App Store app. Last updated on 26 November 2026.

## In short

- The app has no telemetry, no analytics, no advertising and no account with us.
- Your pictures, your library and your edits stay on your computer.
- The app only connects to the internet for two things you turn on yourself: a LibrePhotos server you sign in to, and the OpenStreetMap map.
- The LibrePhotos project receives no data from the app.

## What stays on your computer

- **Your pictures** are read where they are. The app never moves them to another place unless you ask it to, for example by deleting a picture, which moves it to the Recycle Bin (on a Mac, the Trash).
- **The library**, the list of your library folders with what the app learned about each picture (dates, sizes, metadata, thumbnails), is a database in the app's data folder.
- **Your edits** (favourites, ratings, captions, keywords, dates) are saved where you choose in [Settings](./settings.md#where-edits-are-saved): in XMP sidecar files next to the pictures, inside JPEG files, or only in the app's database.
- **Settings** are saved in the app's data folder.

Uninstalling the Microsoft Store package deletes its data folder. Uninstalling the installer version keeps it. Sidecar files and changed pictures stay next to your pictures in both cases.

## When you connect a LibrePhotos server

Signing in to a [LibrePhotos server](./server.md) is optional. A LibrePhotos server is software you or someone you trust runs; the LibrePhotos project does not run servers for you.

- **Sign-in:** your username and password are sent only to the server address you enter. The app keeps the sign-in token in the Windows Credential Manager (on a Mac, in the login Keychain). **Sign out** deletes it.
- **Backup and uploads:** pictures and videos you choose to back up or upload are sent to that server. To skip files the server already has, the app sends it a checksum of each file.
- **Edits:** changes to pictures that are also on the server are sent to it.
- **Server information:** the app loads people, albums, places and search results for your pictures from that server.

What the server does with this data is up to whoever runs it. On a server you run yourself, that is you.

## When you turn on the map

The map in the info panel is off until you turn on **Show a map from OpenStreetMap** in [Settings](./settings.md#maps). When it is on, the app loads map tiles from `tile.openstreetmap.org`. The OpenStreetMap Foundation then sees your IP address and, from the tiles requested, roughly where the pictures you look at were taken. Its [privacy policy](https://osmfoundation.org/wiki/Privacy_Policy) applies.

With the map off, **Open in map** opens the place in your web browser only when you click it.

## Microsoft and Windows

The app runs in Microsoft Edge WebView2, a part of Windows. If you install the app from the Microsoft Store, Microsoft handles the download and its updates. Microsoft may collect diagnostic data under its own [privacy statement](https://privacy.microsoft.com/privacystatement) and your Windows privacy settings. Through Partner Center, Microsoft gives app publishers aggregated statistics, such as install counts and crash reports, that do not identify you.

## Apple and macOS

On a Mac the app runs in WebKit, a part of macOS. If you install the app from the Mac App Store, Apple handles the download and its updates, and macOS keeps the app in a sandbox that lets it read only the pictures and folders you open or choose, and your Pictures folder. Apple may collect diagnostic data under its own [privacy policy](https://www.apple.com/legal/privacy/) and your macOS privacy settings. Through App Store Connect, Apple gives app publishers aggregated statistics, such as install counts and crash reports from users who agreed to share them, that do not identify you.

## Children

The app does not collect personal data from anyone, including children.

## Changes and contact

Changes to this policy are published on this page with a new date. The policy's history is in the [LibrePhotos repository](https://github.com/LibrePhotos/librephotos/commits/dev/apps/docs/docs/user-guide/desktop/privacy.md).

Questions go to the [LibrePhotos issue tracker](https://github.com/LibrePhotos/librephotos/issues). Report security problems privately through [GitHub security advisories](https://github.com/LibrePhotos/librephotos/security/advisories/new).

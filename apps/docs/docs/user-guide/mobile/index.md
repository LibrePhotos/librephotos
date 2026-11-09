---
title: "📱  Mobile Apps"
description: "Which apps does Librephotos have?"
sidebar_position: 25
---

## UhuruPhotos

[UhuruPhotos](https://uhuru.photos/) is a native Android client for LibrePhotos, written using the latest Android technologies. It is the most feature complete app for LibrePhotos.

It aims to become a full-featured photo album replacement, including features like offline support, backup and sync etc.

:::tip Uploads stay "Queued"
UhuruPhotos only uploads, even the photos you pick yourself, while **Cloud backup & sync** is on in its account menu and it has every permission it asks for (full photo access, not selected photos only). Check its network and charging requirements for sync too. With sync on, it also uploads every photo of its feed that is not on the server yet. Uploading must also be allowed on the server (**Allow uploads** in the admin settings), and your user needs a scan directory.
:::

The app is currently in [open beta on the Google Play Store](https://play.google.com/apps/testing/com.savvasdalkitsis.uhuruphotos). You can contact [the author](https://github.com/savvasdalkitsis/) on [gitter](https://app.gitter.im/#/room/#uhuruphotos:gitter.im) or [discord](https://discord.gg/xwRvtSDGWb) for information.

## LibrePhotos Mobile

[LibrePhotos Mobile](./librephotos-mobile.md) is the official app: an offline-first app for **Android and iOS** that keeps a local copy of your library for offline browsing and can back up your camera roll to your server.

*Not released yet: LibrePhotos Mobile is not on the Google Play Store, the App Store, F-Droid, or TestFlight yet. You can try it by running it from the source code.* See the [LibrePhotos Mobile guide](./librephotos-mobile.md) for how to try it, first login, offline mode, backup, and sync.

It is meant to replace the original React Native app. That app's `.apk` builds on the [releases page](https://github.com/LibrePhotos/librephotos-mobile/releases) are no longer updated.

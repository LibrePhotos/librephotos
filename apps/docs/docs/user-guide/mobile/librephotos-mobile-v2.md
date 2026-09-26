---
title: "📱 LibrePhotos Mobile v2"
description: "Install and use the rebuilt offline-first LibrePhotos mobile app: first login, offline browsing, camera-roll backup, sync status, memories, and the share target."
sidebar_position: 3
---

**LibrePhotos Mobile v2** is the rebuilt official app. It stores a local copy of
your library on the device, so you can browse your photos, albums, and people
with no connection at all — the network is used only to catch the app up with
the server and to back up new photos from your phone.

It runs on Android and iOS.

## Installing the app

Install a build for your platform:

- **Android** — from the Google Play Store, or the FOSS build on **F-Droid**.
  The F-Droid build contains no Google services and never downloads code
  updates over the air.
- **iOS** — from the App Store (or TestFlight during beta).

If you self-host and prefer to build from source, follow the developer
[README in the repository](https://github.com/LibrePhotos/librephotos/tree/dev/apps/mobile-v2).

## First login

When you first open the app you are asked for your **server address** before
anything else — this is a self-hosted app, so it needs to know where your
LibrePhotos lives.

1. In the **Server** field, enter the same address you use to reach LibrePhotos
   in a browser, for example `photos.example.com` or `192.168.1.10:3000`. The
   protocol is optional.
2. Wait for the connection check to succeed.
3. Sign in with your LibrePhotos **username and password**.

Your login is stored securely on the device. After the first sign-in the app
begins downloading a copy of your library in the background (see
[Offline mode](#offline-mode)).

## Offline mode

After the first sync, the app keeps a **local mirror** of your library —
photos, albums, people, and shared items — together with grid thumbnails. That
means you can open the app in airplane mode and still:

- browse the full timeline and scroll through every photo's thumbnail,
- open albums, people, places, things, and tags,
- favorite, hide, trash/restore, rate, caption, and add or remove photos from
  albums.

Changes you make offline are saved immediately and **queued**. The next time the
app is online it sends them to the server automatically. Full-resolution
originals are fetched on demand when you open a photo, so viewing an original
still needs a connection unless it is a photo already on your device.

## Backup setup

The app can back up new photos and videos from your phone's camera roll to your
LibrePhotos server.

1. Open the **Backup** tab.
2. Grant photo-library access when prompted. On iOS you can grant access to all
   photos or a limited selection — the app backs up whatever it is allowed to
   see.
3. Choose **which albums** to back up (for example only your Camera roll).
4. Set the conditions: back up **on Wi-Fi only** and/or **only while charging**.

The Backup tab shows progress and a per-item queue. Photos already on the server
(matched by content, so duplicates are never re-uploaded) are skipped. A backed-
up photo's badge flips from *pending* to *synced* once the server confirms it.
Backup continues in the background within the limits your phone's operating
system allows; keeping the app in the foreground is the fastest way to clear a
large backlog.

## Sync status and repair

Open **Sync status** (from Settings) to see what the app is doing:

- the last sync time and result,
- how many items were added, updated, or removed,
- a running log you can **export** to attach to a bug report.

Because the local copy is disposable, the app can always recover from a bad
state by **re-syncing from scratch**. If counts ever drift from the server the
app schedules this automatically, and you can trigger it yourself from the Sync
status screen. A re-sync never loses server data — it just rebuilds the local
mirror.

## Memories reminder

The app can remind you about your **memories** — photos from this day in
previous years. Enable the reminder in Settings to get a local notification;
tapping it opens that day's memories. The reminder uses a local notification
scheduled on the device, so it works without any push service.

## Share target

LibrePhotos Mobile v2 registers as a **share target**. From another app —
Photos, a browser, a messaging app — use the system **Share** sheet and pick
LibrePhotos to send images into your library. On Android this works out of the
box; on iOS the share extension is being finalized.

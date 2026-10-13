---
title: "📖 Words used in release notes"
description: "Plain explanations of the words that LibrePhotos release notes and update steps use, with where to find each thing in the app."
sidebar_position: 28
---

Release notes and update steps use a few words that are not obvious if you do not run servers for a living. This page explains them in plain words and says where to find each thing in the app. Release notes link a word to its entry here the first time they use it.

This page is for people who use LibrePhotos. If you write code for LibrePhotos, the [developer glossary](../development/glossary.md) lists the names used in the code and the API.

## Account menu {#account-menu}

The menu behind your profile picture in the top right corner. It opens **Library**, **Profile**, **Settings**, **My Jobs** and, for administrators, the **Admin Area**. Update steps write a path through the app like this: **Account menu > Library**.

## Admin Area {#admin-area}

The page where administrators change settings for the whole server: **Site settings**, **Users**, **Admin Tools**, the **Services** and the **Server Logs**. Open it with **Account menu > Admin Area**. Only administrators see it. A step that starts with "Admins:" is done here, and other users can skip it. See [Settings](./settings/index.md#admin-area).

## Backup {#backup}

A copy of your LibrePhotos database, taken before an update so you can go back if something goes wrong. The database holds your albums, people, captions and settings. Your photo files are not in it and are never changed by an update.

- **Docker:** see [Upgrading](../installation/upgrading.md) for the one command that writes the backup.
- **Windows app:** quit LibrePhotos from its tray icon, then copy the folder `%LOCALAPPDATA%\LibrePhotos` (or the folder you pass with `--data-dir`) somewhere safe.

## Container {#container}

LibrePhotos on Docker runs in containers: small, separate environments that hold the program and everything it needs. The standard setup runs several containers (the app, the database, the web server), and the [single container deployment](../installation/unified-deployment.md) runs all of it in one. Update steps for Docker run their commands in the folder that holds your `docker-compose.yml`. If you use the Windows app, you have no containers and can skip these steps.

## Database update {#database-update}

A new version sometimes changes how LibrePhotos stores its data. Developers call these changes migrations. LibrePhotos applies them by itself the first time the new version starts, so you do not have to do anything. The first start after an update can take longer because of this. Very old installs sometimes have to update in two steps, which the release notes then say. See [Upgrading](../installation/upgrading.md).

## EXIF and XMP {#exif-and-xmp}

Two common kinds of [metadata](#metadata). **EXIF** is written by the camera or phone into the photo file: the date and time, the camera and lens, the settings, and often the GPS position where the photo was taken. **XMP** holds details that people and programs add later, such as keywords, ratings, people and captions. It is stored in the photo file or in a separate `.xmp` file next to it. See [Exif Data](./exif-data.md).

## Job {#job}

Work that LibrePhotos does in the background, such as a [scan](#scan), finding faces, or reading the text on photos. You can keep using the app while a job runs. Follow your jobs under **Account menu > My Jobs**. While a job runs, a progress ring is shown around your profile picture. Administrators see every user's jobs in the **Worker Logs** of the Admin Area. See [Job System](./job-system.md).

## Metadata {#metadata}

Information about a photo, as opposed to the picture itself: when and where it was taken, with which camera, who is in it, its keywords and its rating. LibrePhotos reads it from your files and can write changes back to them. See [EXIF and XMP](#exif-and-xmp).

## Model {#model}

A file that lets LibrePhotos recognise things in photos: faces, the things and scenes in a photo, the text in a photo, or a caption. Models run on your own server, so your photos are never sent anywhere to be analysed. LibrePhotos downloads the models it needs by itself, which shows up as a **Download Models** [job](#job). Administrators pick some of them in **Site settings**.

## Public link {#public-link}

A web address that shows an album or a photo to anyone who has it, without an account. You create one from the album's **Sharing** dialog, or with the share link button in the photo viewer. A public link can be turned off again at any time. See [Sharing](./sharing.md#public-album-sharing-via-link).

## Rescan {#rescan}

A [scan](#scan) that reads every photo again, not only the new and changed ones. It takes much longer than a normal scan. Start it with **Account menu > Library**, then the arrow next to **Scan** > **Rescan**. Release notes ask for a rescan when a fix only applies to photos once they are read again. See [Library Management](./library.md#library-actions).

## Scan {#scan}

LibrePhotos looking through your photo folders for new and changed files, and adding them to your library with thumbnails, dates, places, faces and things. Start it with **Account menu > Library** > **Scan**. Many installs also scan by themselves on a schedule, see [Auto Scan](./auto-scan.md).

## Semantic search {#semantic-search}

Search by what a photo shows rather than by the words stored with it. Searching "dog on a beach" finds such photos even when no caption or keyword says so. A model compares your words with the photos, so after an update that changes this model, LibrePhotos reads all photos again in the background, and search slowly finds more photos while that runs. See [Semantic Search](./search.md#semantic-search).

## Service {#service}

A helper program that runs next to LibrePhotos and does one kind of work, for example making thumbnails or finding faces. LibrePhotos starts and restarts its services by itself. Administrators can see them under **Services** in the Admin Area. See [Service Management](./library.md#service-management).

## Thumbnail {#thumbnail}

A smaller copy of a photo that LibrePhotos makes during a [scan](#scan), so the grids and the photo viewer load quickly. Thumbnails are stored by LibrePhotos, apart from your photos. Changing or removing a thumbnail never changes your original photo file.

## Version {#version}

The release you are running, for example 1.3.0. After you log in, it is shown at the bottom of the sidebar as **Version: 1.3.0**. It says **dev** when you run a development build.

## Windows app {#windows-app}

LibrePhotos as a program for one Windows PC, without Docker: you unzip a folder and double-click `librephotos.exe`. The docs call it the [Windows standalone](../installation/windows-standalone.md) build. Release notes have separate update steps for it under "Windows app".

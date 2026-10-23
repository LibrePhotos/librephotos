---
title: 📂 Internal files
description: "Which folders and files LibrePhotos creates on disk"
sidebar_position: 19
---

## /logs

There are a lot of log files in this folder. The most important one is `librephotos.log`, with its older parts in `librephotos.log.1`, `librephotos.log.2` and so on. Here should be possible error traces you can report to the GitHub repository.

LibrePhotos 1.3.0 and older call it `ownphotos.log`. The first start of a newer release renames it and its older parts; see [Upgrading](../installation/upgrading.md#log-file-renamed).

LibrePhotos 1.3.0 and older also keep `secret.key` here, so do not zip this whole folder for a bug report; see [secret.key](#secretkey) below.

## /protected_media

### secret.key

⚠ Do not delete this file, and do not share it.

Django signs every session, login token and password-reset link with a secret key, and encrypts the SMTP password stored in the `Admin Area` with it. On the first start LibrePhotos generates the key and keeps it in this file, which is then used every time you start it: `/protected_media/secret.key` inside the backend container, which the shipped Docker Compose file maps to `${data}/protected_media/secret.key` on the host (`%LOCALAPPDATA%\LibrePhotos\protected_media\secret.key` for the [Windows standalone build](../installation/windows-standalone.md)). Back it up together with the rest of this folder.

If you delete it, a new key is generated: every user is logged out and the SMTP password has to be entered again. Anyone who has a copy of the file can forge a login to your instance.

If you set `shhhhKey` in your `.env` file (`SECRET_KEY` for the backend container), that value is used as the secret key instead and this file is never created or read.

LibrePhotos 1.3.0 and older keep the file in `/logs` instead. The first start of a newer release moves it here and logs a warning saying so. If both files exist, the one in `/protected_media` is used. An old file holding the same key is the rest of an unfinished move and is removed; one holding a different key is left untouched with a warning in the log: delete it once you have checked that you can log in.

### /avatars

When you upload an avatar for a user, you can find it in this folder.

### /square_thumbnails_small

Very small thumbnails and not actually square. Can be static or animated. These are used to show a blurred preview or the pictures while loading the bigger ones.

### /square_thumbnails

The thumbnails and not actually square. You see them in the overview, when you scroll through your timeline. Can be animated or static.

### /thumbnails_big

In order to make all files viewable, we create thumbnails for them. These are only static, as they are also used for all ML algorithms and face recognition to have a consistent format. These are the files you actually see in the lightbox.

### /chunked_uploads

When you upload a file, it gets uploaded in chunks. While the upload is incomplete, the files are saved in that folder.

### /faces

Here we save the thumbnails of all the faces, so that viewing them is faster.

### /data_models

All the machine learning models live here: the LFM2.5-VL captioning model, OpenCLIP ViT-B/32 for tags and semantic search, and the InsightFace face recognition models. Rather than being baked into the image, they are downloaded by the "Download Models" job, or when you pick a new model in the `Admin Area` (for example the `Captioning Model` setting). Because of that, this folder only grows as you enable features, but it is usually by far the largest folder in `/protected_media` — several GB in total.

Deleting it is safe: the models are simply downloaded again the next time they are needed. If your server has no Internet access, see [Offline Usage](./offline-setup.md) for how to place the files by hand.

### /embedded_media

Some phones store a short video inside the JPEG of a motion photo (Google and Samsung both do this). When such a file is scanned, LibrePhotos extracts that video and saves it here as `<hash>_motion.mp4` — this is what plays when you view the motion photo, while the original JPEG still keeps its embedded copy. This is controlled by the `FEATURE_PROCESS_EMBEDDED_MEDIA` setting, which is on by default.

### /zip

When you download several photos at once, LibrePhotos builds the archive here and serves it back to you. Each archive is deleted automatically about a day after it is created, so this folder normally stays small and needs no manual cleanup.

### /matplotlib

<Since version="1.5.0" /> No longer used: it held a font cache for matplotlib, which came along with the face recognition code up to 1.4.0. Safe to delete.

## /db

This is the folder of the Postgres database. You should not move it, if you want to migrate, but login into the database and do a pgdump instead and imported it when mounting to a different location. Postgres does not like moving folders.

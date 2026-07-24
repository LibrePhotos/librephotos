---
title: 📂 Internal files
description: "Which folders and files LibrePhotos creates on disk"
sidebar_position: 18
---

## /logs

There are a lot of log files in this folder. The most important one is "ownphotos.log". Here should be possible error traces you can report to the GitHub repository.

## ⚠ DO NOT DELETE "secret.key"

The `secret.key` file lives in the `/logs` folder described above: it is `/logs/secret.key` inside the backend container, which the shipped Docker Compose file maps to `${data}/logs/secret.key` on the host.

In order to encrypt passwords in the database, Django uses a secret key. On the first boot, we create this file, which will then get used every time you start it. If you delete this file, you cannot log in anymore, and you have to reset the passwords of your users.

If you set `shhhhKey` in your `.env` file, that value is used as the secret key instead and this file is never created or read.

## /protected_media

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

All the machine learning models live here: image captioning (im2txt, Blip, Moondream 2), the CLIP embeddings used for semantic search, scene and tag recognition (places365, SigLIP 2), the optional LLM (Mistral) and the InsightFace face recognition models. Rather than being baked into the image, they are downloaded by the "Download Models" job, or when you pick a new model in the `Admin Area` (for example the `Captioning Model` setting). Because of that, this folder only grows as you enable features, but it is usually by far the largest folder in `/protected_media` — several GB in total.

Deleting it is safe: the models are simply downloaded again the next time they are needed. If your server has no Internet access, see [Offline Usage](./offline-setup.md) for how to place the files by hand.

### /embedded_media

Some phones store a short video inside the JPEG of a motion photo (Google and Samsung both do this). When such a file is scanned, LibrePhotos extracts that video and saves it here as `<hash>_motion.mp4` — this is what plays when you view the motion photo, while the original JPEG still keeps its embedded copy. This is controlled by the `FEATURE_PROCESS_EMBEDDED_MEDIA` setting, which is on by default.

### /zip

When you download several photos at once, LibrePhotos builds the archive here and serves it back to you. Each archive is deleted automatically about a day after it is created, so this folder normally stays small and needs no manual cleanup.

### /matplotlib

A font cache for matplotlib, which comes along as a dependency of the face recognition code. The backend points the cache here so it does not have to be rebuilt every time a process starts. Safe to delete; it is recreated automatically.

## /db

This is the folder of the Postgres database. You should not move it, if you want to migrate, but login into the database and do a pgdump instead and imported it when mounting to a different location. Postgres does not like moving folders.

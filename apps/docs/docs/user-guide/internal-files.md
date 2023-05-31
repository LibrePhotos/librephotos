---
title: 📂 Internal files
excerpt: "How to auto scan all folders"
sidebar_position: 2
---

## /logs

There are a lot of log files in this folder. The most important one is "ownphotos.log". Here should be possible error traces you can report to the GitHub repository.

## ⚠ DO NOT DELETE "secret.key"

In order to encrypt passwords in the database, Django uses a secret key. On the first boot, we create this file, which will then get used every time you start it. If you delete this file, you cannot log in anymore, and you have to reset the passwords of your users.

## /protected_media

### /avatars

When you upload an avatar for a user, you can find it in this folder.

### /square_thumbnails_small

Very small thumbnails and not actually square. Can be static or animated. These are used to show a blurred preview or the pictures while loading the bigger ones.

### /square_thumbnails

The thumbnails and not actually square. You see them in the overview, when you scroll through your timeline. Can be animated or static.

### /thumbnails_big

In order to make all files viewable, we create thumbnails for them. These are only static, as they are also used for all ML algorithms and face recognition to have a consistent format. These are the files you actually see in the lightbox.

### /chunked_upload

When you upload a file, it gets uploaded in chunks. While the upload is incomplete, the files be saved in that folder.

### /faces

Here we save the thumbnails of all the faces, so that viewing them is faster.

## /db

This is the folder of the Postgres database. You should not move it, if you want to migrate, but login into the database and do a pgdump instead and imported it when mounting to a different location. Postgres does not like moving folders.

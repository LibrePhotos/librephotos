---
title: "❓ FAQ"
description: "Scan always fails after importing few images"
sidebar_position: 27
---

## Is LibrePhotos still maintained?

Yes. Version 1.0.0 came out in June 2026, and new versions have followed every few weeks since. Each release is described in the [blog](/blog) and on the [GitHub releases page](https://github.com/LibrePhotos/librephotos/releases). Reviews and comparison articles written before 2026 often describe an older LibrePhotos; the [feature comparison](features.md) shows what it does today.

## Is there a mobile app?

Not an official one yet. The official app, [LibrePhotos Mobile](mobile/librephotos-mobile.md), is being developed and can be tried by running it from the source code. Until it is released, [UhuruPhotos](https://uhuru.photos/) is a third-party Android app for LibrePhotos. See [Mobile Apps](mobile/index.md).

## Proxmox - Scan always fails after importing few images

### Symptom

Your scan crashes with a `Fatal Python error: Illegal instruction` on a Proxmox guest, usually after only a few images have been imported.

The traceback below is an example from an older LibrePhotos release, which used dlib / `face_recognition` on Python 3.9. On current builds the frames differ - face detection runs in a separate process now - so what identifies this problem is the `Illegal instruction` crash during a scan, not the specific frames shown here.

```
Thread 0x00007fc8dcf3f640 (most recent call first):
  File "/usr/lib/python3.9/threading.py", line 316 in wait
  File "/usr/lib/python3.9/threading.py", line 574 in wait
  File "/usr/local/lib/python3.9/dist-packages/tqdm/_monitor.py", line 59 in run
  File "/usr/lib/python3.9/threading.py", line 954 in _bootstrap_inner
  File "/usr/lib/python3.9/threading.py", line 912 in _bootstrap

Current thread 0x00007fc998cf8640 (most recent call first):
  File "/usr/local/lib/python3.9/dist-packages/face_recognition/api.py", line 162 in <listcomp>
  File "/usr/local/lib/python3.9/dist-packages/face_recognition/api.py", line 162 in _raw_face_landmarks
  File "/usr/local/lib/python3.9/dist-packages/face_recognition/api.py", line 209 in face_encodings
  File "/code/api/models/photo.py", line 507 in _extract_faces
  File "/code/api/directory_watcher.py", line 168 in handle_new_image
  File "/code/api/directory_watcher.py", line 261 in photo_scanner
  File "/usr/lib/python3.9/multiprocessing/pool.py", line 51 in starmapstar
  File "/usr/lib/python3.9/multiprocessing/pool.py", line 125 in worker
  File "/usr/lib/python3.9/multiprocessing/process.py", line 108 in run
  File "/usr/lib/python3.9/multiprocessing/process.py", line 315 in _bootstrap
  File "/usr/lib/python3.9/multiprocessing/popen_fork.py", line 71 in _launch
  File "/usr/lib/python3.9/multiprocessing/popen_fork.py", line 19 in __init__
  File "/usr/lib/python3.9/multiprocessing/context.py", line 277 in _Popen
  File "/usr/lib/python3.9/multiprocessing/process.py", line 121 in start
  File "/usr/lib/python3.9/multiprocessing/pool.py", line 326 in _repopulate_pool_static
  File "/usr/lib/python3.9/multiprocessing/pool.py", line 337 in _maintain_pool
  File "/usr/lib/python3.9/multiprocessing/pool.py", line 513 in _handle_workers
  File "/usr/lib/python3.9/threading.py", line 892 in run
  File "/usr/lib/python3.9/threading.py", line 954 in _bootstrap_inner
  File "/usr/lib/python3.9/threading.py", line 912 in _bootstrap
```

### Solution:

This is a problem with proxmox, More specifically with the way the CPU was emulated. By default, QEMU in Proxmox uses its own CPU type kvm64, which has a reduced CPU flags set, to guaranteed that it works everywhere. This means that necessary flags like SSE and AVX are absent, which causes the Fatal Python error: Illegal instruction error.

To fix this, one must either manually edit the .conf file and add the flags needed to the kvm64 CPU type, or pick a different method of CPU emulation.

To add the flags, edit the xxx.conf file located in /etc/pve/qemu-server/ where xxx is the ID of the VM. The manual can be found here: https://pve.proxmox.com/wiki/Manual:_qm.conf

If you don't care about live migration and moving VMs between nodes, the much easier option is to just change the CPU type to Host. With the Host option, the VM will match the CPU type of the host machine.

### Steps for Proxmox 6.4:

Select your VM and then Hardware tab.

![Select your VM and then Hardware tab](../../static/img/135711616-14903f44-2bdc-4830-82e9-a29562f75762.png)

Then double-click on Processors or select it and click Edit:

![Then double-click on Processors or select it and click Edit](../../static/img/135711657-3cdc2600-2368-440c-af75-00313c8c8997.png)

## error decoding 'Volumes[0]': invalid spec: :/data: empty section between colons / "The "scanDirectory" variable is not set. Defaulting to a blank string."

This error usually means, that you forgot to rename the librephotos.env to .env

## Why is the scan directory not mounted read-only?

You can set the scan directory as read-only, but then a couple of features will not be available. List of impacted features are:

- Writing back metadata to media files
- Uploading images
- Deleting images

This is not yet handled gracefully for uploads and deletions, which means, you will probably just get non-descriptive errors there. A metadata write that fails keeps your edit in LibrePhotos and is reported instead: see [Writes that fail](exif-data.md#writes-that-fail).

## Can two users share one photo folder?

No. Every photo belongs to exactly one user, so LibrePhotos refuses a scan directory that overlaps another user's. To share photos within a household, keep them in one library and share albums or photos from there, or let each person [share their whole library](sharing.md#sharing-your-whole-library) read-only with the others; [Sharing photos in a family](sharing.md#sharing-photos-in-a-family) compares the setups.

## "could not resize shared memory segment ... No space left on device"

A page fails now and then with "Something went wrong on the server", most often the Admin Area, the statistics or the Things and Places lists, and the backend log shows:

```
psycopg.errors.DiskFull: could not resize shared memory segment "/PostgreSQL.…" to … bytes: No space left on device
```

Your disk is not full. Postgres keeps the shared memory of parallel queries in `/dev/shm`, and Docker gives every container only 64 MB there. On a large library a few such queries at once need more, and the one that asks last fails. The same page usually works again a moment later.

<Since version="1.5.0" /> The bundled Compose files give the `db` service `shm_size: 256mb`, and the Kubernetes manifest mounts a memory-backed `emptyDir` at `/dev/shm`. Both are ceilings: memory is used only for what Postgres actually allocates, so a small library pays nothing. 1.5.0 also stopped the pages above from needing that much shared memory in the first place.

If you run your own Compose file, or a release up to 1.4.0, add the setting to the `db` service and recreate it with `docker compose up -d db`:

```yaml
services:
  db:
    shm_size: 256mb
```

To check it took effect, `docker exec db df -h /dev/shm` should show 256M.

## Videos are not playing and showing a 404 error

### Reason 1:
The video may be in a format your browser cannot decode, most often H.265 (HEVC) in Firefox, or in Chrome on a machine without a hardware decoder for it. LibrePhotos converts such a video for your browser as it plays, without any setting (see [Videos your browser cannot play](viewing-photos.md#videos-your-browser-cannot-play)). On 1.2.1 and older, enable "Always transcode videos" under Experimental Settings instead; it converts every video, so it is quite CPU heavy.

### Reason 2:
The issue could be caused by incorrect file permissions. You can resolve this by adjusting the permissions using the following commands:

```
find . -type d -exec chmod 755 {} +
find . -type f -exec chmod 644 {} +
```

These commands will ensure that directories have permissions set to 755 and files have permissions set to 644, which should resolve any permission-related issues causing the 404 error.







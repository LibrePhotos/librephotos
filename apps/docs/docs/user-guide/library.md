---
title: "📚 Library Management"
description: "Scanning, Nextcloud integration, services, and server management"
sidebar_position: 11
---

The **Library** page is your central hub for managing your photo library. Access it by clicking on your avatar (top right) and selecting **Library**, or via the spotlight search (`Ctrl+K` → "Library").

## Overview Stats

At the top of the Library page, you'll see quick stats about your library:

- **Photos** — Total number of photos and the number of distinct days they were taken on (undated photos are grouped into a single extra bucket)
- **People** — Number of recognized people, with a breakdown of inferred, labeled, and unknown faces
- **Faces** — Total faces detected
- **Events** — Number of events (photos grouped by when they were taken)

## Scanning

### Scan Photos (File System)

In the **Scan Library** row, click **Scan** to scan your configured scan directory for new photos. The scan process:

1. Discovers new image and video files
2. Groups related files (RAW+JPEG pairs, Live Photos) as [file variants](./stacks-and-file-variants.md). A RAW and a JPEG with the same name in the same folder become one photo with a RAW variant; there is no setting for this.
3. Creates thumbnails, and for a video a short animated preview for the grid (which can be [turned off](./feature-toggles.md#animated-video-previews))
4. Extracts EXIF metadata
5. Runs face detection
6. Detects the things in each photo with OpenCLIP, which also gives each photo its semantic-search embedding
7. Performs reverse geocoding
8. Calculates the search embeddings the thing detection could not

The scan imports images, videos, RAW files and XMP sidecars. Any other file in your folders, such as an editor sidecar (`.pp3`, `.aae`) or `Thumbs.db`, is skipped and does not count as an error. The `.json` files of a Google Takeout export are read for the date, location and description of their photo and are not photos themselves (see [Importing a Google Takeout export](./google-takeout.md)). <Since version="1.4.0" /> Up to 1.3.0 they were skipped too. A file that looks like a photo or video but cannot be read, such as an empty `.jpg` or one whose header is damaged, is still listed in the scan job's errors (see [Job System](./job-system.md)).

A **Scan** processes new and changed files, and also every photo whose metadata could not be read last time (for example because the exif service was restarting or timed out): such a photo is listed in the job's errors, and the next scan reads it again, even though the file has not changed. _Not released yet:_ before this, only a **Rescan** read those photos again; after the update, the first **Scan** also reads the photos earlier scans left without metadata.

A folder LibrePhotos is not allowed to read, such as a `lost+found` folder owned by root or a NAS recycle bin, is skipped and the rest of the library is still scanned (not released yet). The scan then finishes as a partial failure and its job lists the folder with the reason. Because the photos in that folder were not looked at, that scan does not check for [missing photos](./missing-photos.md). If the scan directory itself cannot be read, the scan fails.

To re-process all existing photos, open the dropdown next to **Scan** (the chevron) and choose **Rescan**.

Only one job runs at a time, for all users together. While one runs, the job buttons on this page are greyed out and a note above them says so: it names the job and links to the job list when it is yours (or you are an admin), and says "Another user's job is running" otherwise. Point at or tab to a greyed-out button to see why it is unavailable (not released yet).

:::note
AI *captions* are not generated during a scan — they are created per photo on demand. Open a photo, show the details panel, and use the wand icon in the **Caption** section. See [Image Captioning](./image-captioning.md).
:::

### Files replaced in place

If you overwrite a file with a different picture but keep the same name, the next scan picks the change up and re-indexes it: the thumbnails are rebuilt from the new picture and the photo goes back into the queue for face detection, things and geocoding. It keeps its album membership, its sharing and its link, so anything pointing at it still works.

A file whose bytes changed while its picture stayed the same is only re-keyed internally. That covers a rating or a face tag LibrePhotos wrote into the original, and metadata another tool edited in place: nothing is regenerated and nothing you corrected by hand is lost.

For a video, and for a photo you have rotated inside LibrePhotos, the two cannot be told apart. The scan takes the careful path there: the thumbnails are rebuilt once and the cached video conversion is dropped, but the faces you have named are kept and the photo stays where it is in the timeline.

:::note
The first scan after upgrading may re-key files LibrePhotos had previously written metadata into. That is bookkeeping with no visible change to your library, and it happens only once per file.
:::

### Rescan some photos

<Since version="1.4.0" />

When one photo is wrong (a bad thumbnail, a date that does not match the file after another app edited it, a file replaced with one that kept the old modification time), you can read just its files again instead of rescanning the whole library:

- **Several photos**: select them, open the **⋮** (Photo Actions) and choose **Rescan files** in the **Files** group. Up to 1,000 photos at a time; after **Select all**, pick the photos one by one instead.
- **One photo**: in the photo viewer, open the **⋮** after the rotate buttons (on a phone, the **⋮** menu) and choose **Rescan file**. On the photo's page it is under **More**.

A rescan reads every file of the photo again, also when it did not change: the main file, its [variants](./stacks-and-file-variants.md) and its sidecars. It renders the thumbnails again (the old ones stay if that fails), reads the metadata and the date, and checks the file's hash. What you changed in LibrePhotos stays: a date you set by hand, a location you set, captions and albums (see [How a rescan treats your edits](./exif-data.md#how-a-rescan-treats-your-edits) for every field). The things, places and faces jobs that follow only look at what is new, as after a **Scan**, so a rescan does not detect faces again: use **Detect faces again** next to it for that (see [Face recognition](./face-recognition.md#detect-faces-again-in-some-photos-or-a-folder)).

The items are only shown for your own photos, not for photos someone shared with you. Like every job, a rescan waits while another job runs. It is never what the next **Scan** compares the library against, so a file changed elsewhere in the library is still picked up then.

### Scan Progress

Scan progress is shown in the [Job System](./job-system.md). The scan is split into smaller tasks, prioritizing thumbnail creation so photos appear in the UI quickly while heavier processing (faces, things) happens in the background.

## Moving photos to another folder

<Since version="1.4.0" />

You can move your own photos to another folder of your library without leaving LibrePhotos. Select the photos and choose **Move to folder…** in the photo actions menu (⋮), or open a photo and choose **More → Move to folder…**.

The dialog shows the folders of your library: your scan directory and, when it is set elsewhere, your upload folder. Folders the scan skips (hidden folders and the ones matching the skip patterns) are not listed, and you cannot move photos outside your library. Pick a folder in the tree or type its full path. **New folder** names a folder inside the one you picked; it is made when the photos move.

Before you move, the dialog says how many photos and files move and which photos stay where they are:

- photos already in that folder;
- local copies of Nextcloud files, which the next Nextcloud scan would download again to the old place;
- photos that share a file with another photo;
- photos whose files are missing on disk.

A photo moves with all its files: the main file, its RAW or JPEG variant, a Live Photo's video and its XMP sidecars (both `IMG_1.xmp` and `IMG_1.jpg.xmp`). It moves completely or not at all: if one file cannot be moved, the others are put back. A Motion Photo video that LibrePhotos extracted into its own data folder stays there.

If a file with the same name is already in the folder, a second dialog lists the names and lets you choose:

- **Rename, keep both**: the moved photo gets a free name, such as `IMG_1 (1).jpg`, for all its files, so they still belong together.
- **Skip**: those photos stay where they are.

A file in the folder is never overwritten.

Albums, faces, tags, ratings and sharing stay with the photo, and the folder views show it in its new folder right away. The next scan does not read a moved photo again. A selection of more than 100 photos moves in the background as a **Move Photos** job (see [Job System](./job-system.md)); a move cannot start while a scan of your library runs.

## Nextcloud Integration

If you have a Nextcloud instance, you can scan photos directly from it without manually transferring files.

### Enabling the integration

The integration is off by default, and the **Nextcloud** section is hidden on the Library page until an admin turns it on. Click on your avatar (top right) → `Admin Area` → `Site Settings` and enable the `Enable Nextcloud integration` switch. On a fresh install you can also pre-enable it by setting `nextcloudEnabled=true` in `librephotos.env` before the first start.

### Setup

1. On the Library page, find the **Nextcloud** section
2. Enter your Nextcloud server URL, username, and password
3. Save your changes when the **Save Changes** dialog appears (click **Update**). The **Status** row at the top of the Nextcloud section then shows a green **Connected** badge. It reads **Missing credentials**, **Connecting**, or **Disconnected** while the connection is unset, in progress, or failing.
4. Click **Browse** (folder icon) to select your Nextcloud photo directory

### Nextcloud with a self-signed certificate

LibrePhotos checks the certificate of an `https://` Nextcloud server, and refuses a server whose certificate it does not trust. A Nextcloud with a self-signed certificate (for example the default certificate of TrueNAS) or one from your own certificate authority then shows **Disconnected**. LibrePhotos has no switch that turns this check off. Instead, an admin tells it which certificate to trust (not released yet):

1. Save the certificate as a PEM file, a text file that starts with `-----BEGIN CERTIFICATE-----`. Use the certificate of the authority that signed the Nextcloud certificate, or for a self-signed certificate the certificate itself. Export it from where it was made; in TrueNAS that is **Credentials** → **Certificates**.
2. Give LibrePhotos the file and set `NEXTCLOUD_CA_BUNDLE` to its path, as below.
3. Open the Library page again. The Nextcloud section now shows **Connected**.

**Docker:** put the file next to `docker-compose.yml`, for example as `certs/nextcloud-ca.pem`, mount it into the `backend` service by adding a line to its `volumes`:

```yaml
  backend:
    volumes:
      - ./certs/nextcloud-ca.pem:/certs/nextcloud-ca.pem:ro
```

then set the path inside the container in `librephotos.env` and restart with `docker compose up -d`:

```bash
nextcloudCaBundle=/certs/nextcloud-ca.pem
```

**Windows standalone:** save the file anywhere on the PC, for example `C:\LibrePhotos\nextcloud-ca.pem`, and start LibrePhotos from a small `.cmd` file next to `librephotos.exe` that sets the variable (the same way [Using another port](../installation/windows-standalone.md#using-another-port) moves a service):

```bat
@echo off
set NEXTCLOUD_CA_BUNDLE=C:\LibrePhotos\nextcloud-ca.pem
start "" "%~dp0librephotos.exe"
```

Things to know:

- The server address you enter has to be a name the certificate was made for. A certificate for `nextcloud.lan` is not accepted when you connect to `https://192.168.1.10`.
- With `NEXTCLOUD_CA_BUNDLE` set, every Nextcloud server is checked against that file only, not against the public certificate authorities. If other users of your LibrePhotos connect to a Nextcloud with a public certificate (for example from Let's Encrypt), make the file a copy of a public bundle such as `/etc/ssl/certs/ca-certificates.crt` with your certificate added at the end.
- If the file is missing or holds no PEM certificate, LibrePhotos does not connect at all: the Nextcloud section shows **Disconnected**, and **Scan** answers with a message that names `NEXTCLOUD_CA_BUNDLE`.

### Scanning from Nextcloud

In the **Nextcloud** section, click **Scan** to download and scan photos from your configured Nextcloud directory. Files are copied to the local filesystem under `nextcloud_media/<username>/` before being processed.

A repeat scan keeps the local copies in step with the server (not released yet):

- A file that is new on the server is downloaded and imported.
- A file that changed on the server (it is newer or has another size) is downloaded again and processed again. An XMP sidecar that changed has its photo processed again, so ratings and keywords edited in another app arrive.
- A file that is unchanged is neither downloaded nor processed again.
- A file deleted on the server is flagged missing, as a file deleted from a local library is: it shows up under **Remove missing photos**, and the photo and the local copy stay until you remove them. If the file comes back, the next scan attaches it again.

A downloaded copy keeps the file's modification time on the server, so the "File modified time" [date rules](./settings/date-rules.md) date it by the server's time, not by the day of the download. Copies downloaded by an older version get that time on the next scan, which processes them once more to read their date again.

"Write edits to files" does not write into Nextcloud photos; see [Settings](./settings/index.md).

:::note
Nextcloud scanning indexes the same media as a local scan: images, videos, RAW files and XMP sidecars.
:::

:::info Duplicate photos from earlier Nextcloud scans
Up to version 1.3.0, every Nextcloud scan added another copy of each photo it had already imported. The first start after upgrading merges those copies into one photo per file (not released yet). The merged photo keeps the albums, tags, faces, shares and edit history of every copy and the highest rating among them; its caption, date and location come from a single copy: one that is not in the trash, preferring the copy you edited most, then the oldest.
:::

## Library Actions

The Library page provides quick access to common maintenance actions:

| Row | Button | Description |
|-----|--------|-------------|
| **Scan Library** | **Scan** | Scan for new photos in the file system |
| **Scan Library** (dropdown) | **Rescan** | Re-process all existing photos |
| **Generate Event Albums** | **Generate** | Group photos into events by when they were taken |
| **Regenerate Event Titles** | **Generate** | Regenerate the titles of existing events |
| **Train faces** | **Train** | Run face clustering and classification |
| **Rescan Faces** | **Rescan** | Re-detect faces in all photos; for some photos or one folder see [Detect faces again](./face-recognition.md#detect-faces-again-in-some-photos-or-a-folder) |
| **Nextcloud** | **Scan** | Scan photos from a connected Nextcloud instance |
| **Extract Text** | **Extract** | Read the text on photos that have not been read yet (see [Text Recognition](./text-recognition.md#extracting-text)) |
| **Extract Text** (dropdown) | **Extract text again for all photos** | Read the text on every photo again |
| **Apply date rules to existing photos** | **Apply** | Read the date of every photo again with your current [date rules](./settings/date-rules.md#applying-the-rules); a date you set by hand stays. Not released yet |

If LibrePhotos detects photos that are no longer on disk, a red **N Missing Photos** badge appears next to the **Photos** heading. Click it to open the **Remove missing photos** dialog and confirm removal of those database entries. The badge is hidden when nothing is missing.

## Service Management

LibrePhotos runs several background ML services. Administrators can monitor and control them from the **Admin Area**:

| Service | Description |
|---------|-------------|
| **image_similarity** | CLIP-based image similarity index |
| **thumbnail** | Thumbnail generation |
| **face_recognition** | Face detection and recognition |
| **image_captioning** | Image caption generation |
| **exif** | EXIF metadata extraction |
| **tags** | Things and semantic-search embeddings (OpenCLIP); always runs, because search needs it |
| **ocr** | [Text recognition](./text-recognition.md); only started while a Text Recognition (OCR) Model is selected in Site Settings |

For each service, you can:

- View **health status**
- **Start** or **stop** the service; stopping asks first, because the service stops for every user of the server
- Services are automatically started with Django and monitored by a cron job

## Server Information

### Server Stats

Administrators can download a server-stats report from the Admin Area (**Admin Tools** → **Download Server Stats**), which saves a `serverstats.json` file containing:

- **CPU** — Model, core count, architecture, and instruction-set flags
- **RAM** — Total system memory
- **GPU** — GPU model and memory (only populated when a CUDA GPU is available)
- **Storage** — Total, used, and free disk space
- **Per-user stats** — Detailed counts per user (photos, videos, albums, faces, and more)

The stats are not rendered in the UI — download the JSON to inspect them. Per-user photo counts are also shown directly in the Admin Area's user table.

### Storage Display

The sidebar shows a storage bar for the disk holding your LibrePhotos data directory (`/data` in the default Docker setup). It reports how full that whole volume is — hover for `<used> of <total> used` — so it includes the operating system and anything else on the same disk, not just your photos.

### Server Logs

The Admin Area shows a **Server Logs** panel with the most recent log lines (1–1000, default 100) and a **Refresh** button. The download icon saves the full `librephotos.log` file (`ownphotos.log` in 1.3.0 and older).

### Image Version

The sidebar shows the backend image tag (`dev` when `IMAGE_TAG` is unset). Hover over it to see the backend git hash.

## Management Commands

For advanced users with shell access, LibrePhotos provides several management commands:

```bash
# Scan all users' photo directories (users without a scan directory are skipped)
python manage.py scan

# Full rescan (re-process all photos)
python manage.py scan -f

# Scan specific files, given by full path; each file goes to every user whose
# scan directory contains it (normally exactly one; /data/alice2/x.jpg is not
# in /data/alice), and a file outside every scan directory is ignored
python manage.py scan -s /path/to/file.jpg

# Scan Nextcloud directories for every user that has one configured
# (users without a Nextcloud scan directory are skipped; -n cannot be combined with -f or -s)
python manage.py scan -n

# Build similarity index for all users
python manage.py build_similarity_index

# Write the edits already in LibrePhotos to XMP sidecars or image files, as each
# owner's "Write edits to files" setting says (users with it Off are skipped;
# --sidecar or --media-file overrides it for the one user named with --user;
# --types limits what is written, --dry-run only counts). The same writes as
# Settings > Metadata Options > Write now.
python manage.py save_metadata

# Start all ML services (individual services are managed from the Admin Area)
python manage.py start_service all

# Clear site-wide cache
python manage.py clear_cache

# Back up an SQLite database into db/backups next to it and keep the newest 3
# (--keep N, or DB_BACKUP_KEEP); --if-pending-migrations only does it when
# migrate has work to do. On PostgreSQL it does nothing: use pg_dump.
python manage.py backup_database

# Remove the original's metadata (EXIF incl. GPS, XMP, a video's location) from
# thumbnails created by 1.2.1 and older; pixels and colour profiles are kept,
# clean files are not touched, so it is safe to run again (--dry-run only counts)
python manage.py strip_thumbnail_metadata

# Read the exposure time again where 1.3.0 and older stored the shutter speed
# wrongly ("0" for anything faster than about 1/2000 s, "1/1000" for 1/1250 to
# 1/2000 s, "5/2" for 2.5 s); only that tag is read (--dry-run only counts)
python manage.py refresh_exposure_time

# Queue the automatic tasks an update left (the Admin Area's Finish the
# upgrade card), each once; the Docker image and the Windows app run it at start
python manage.py start_upgrade_tasks

# Create a new user (username and email are required; the password is
# autogenerated unless --password is given, and --admin grants admin rights)
python manage.py createuser <username> <email>

# Create an admin user; the password is read from the ADMIN_PASSWORD
# environment variable, otherwise a random one is generated and not printed
ADMIN_PASSWORD=... python manage.py createadmin <username> <email>
```

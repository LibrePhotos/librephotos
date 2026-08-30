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
- **Events** — Number of auto-generated event albums

## Library Settings

- **Stack RAW+JPEG pairs** — When enabled, RAW files are automatically grouped with their JPEG counterparts as [file variants](./stacks-and-file-variants.md) during scans. Both files remain in your library. This is a per-user setting and is **on by default**. It is also offered during first-time setup, when you configure your scan directory.

## Scanning

### Scan Photos (File System)

In the **Scan Library** row, click **Scan** to scan your configured scan directory for new photos. The scan process:

1. Discovers new image and video files
2. Groups related files (RAW+JPEG pairs, Live Photos) as [file variants](./stacks-and-file-variants.md)
3. Creates thumbnails
4. Extracts EXIF metadata
5. Runs face detection
6. Generates AI tags (Places365 or SigLIP 2, depending on your Tagging Model setting)
7. Performs reverse geocoding
8. Calculates CLIP embeddings for semantic search

To re-process all existing photos, open the dropdown next to **Scan** (the chevron) and choose **Rescan**.

:::note
AI *captions* are not generated during a scan — they are created per photo on demand. Open a photo, show the details panel, and use the wand icon in the **Caption** section. See [Image Captioning](./image-captioning.md).
:::

### Scan Progress

Scan progress is shown in the [Job System](./job-system.md). The scan is split into smaller tasks, prioritizing thumbnail creation so photos appear in the UI quickly while heavier processing (faces, tags) happens in the background.

## Nextcloud Integration

If you have a Nextcloud instance, you can scan photos directly from it without manually transferring files.

### Enabling the integration

The integration is off by default, and the **Nextcloud** section is hidden on the Library page until an admin turns it on. Click on your avatar (top right) → `Admin Area` → `Site Settings` and enable the `Enable Nextcloud integration` switch. On a fresh install you can also pre-enable it by setting `nextcloudEnabled=true` in `librephotos.env` before the first start.

### Setup

1. On the Library page, find the **Nextcloud** section
2. Enter your Nextcloud server URL, username, and password
3. Save your changes when the **Save Changes** dialog appears (click **Update**). The **Status** row at the top of the Nextcloud section then shows a green **Connected** badge. It reads **Missing credentials**, **Connecting**, or **Disconnected** while the connection is unset, in progress, or failing.
4. Click **Browse** (folder icon) to select your Nextcloud photo directory

### Scanning from Nextcloud

In the **Nextcloud** section, click **Scan** to download and scan photos from your configured Nextcloud directory. Files are copied to the local filesystem under `nextcloud_media/<username>/` before being processed.

:::note
Nextcloud scanning indexes the same media as a local scan: images, videos, RAW files and XMP sidecars.
:::

## Library Actions

The Library page provides quick access to common maintenance actions:

| Row | Button | Description |
|-----|--------|-------------|
| **Scan Library** | **Scan** | Scan for new photos in the file system |
| **Scan Library** (dropdown) | **Rescan** | Re-process all existing photos |
| **Generate Event Albums** | **Generate** | Create auto albums grouped by time |
| **Regenerate Event Titles** | **Generate** | Regenerate titles for existing event albums |
| **Train faces** | **Train** | Run face clustering and classification |
| **Rescan Faces** | **Rescan** | Re-detect faces in all photos |
| **Nextcloud** | **Scan** | Scan photos from a connected Nextcloud instance |

If LibrePhotos detects photos that are no longer on disk, a red **N Missing Photos** badge appears next to the **Photos** heading. Click it to open the **Remove missing photos** dialog and confirm removal of those database entries. The badge is hidden when nothing is missing.

## Service Management

LibrePhotos runs several background ML services. Administrators can monitor and control them from the **Admin Area**:

| Service | Description |
|---------|-------------|
| **image_similarity** | CLIP-based image similarity index |
| **thumbnail** | Thumbnail generation |
| **face_recognition** | Face detection and recognition |
| **clip_embeddings** | CLIP embedding computation |
| **llm** | Large language model for captioning |
| **image_captioning** | Image caption generation |
| **exif** | EXIF metadata extraction |
| **tags** | Photo tag generation (Places365 or SigLIP 2 depending on your Tagging Model setting) |

For each service, you can:

- View **health status**
- **Start** or **stop** the service
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

The Admin Area shows a **Server Logs** panel with the most recent log lines (1–1000, default 100) and a **Refresh** button. The download icon saves the full `ownphotos.log` file.

### Image Version

The sidebar shows the backend image tag (`dev` when `IMAGE_TAG` is unset). Hover over it to see the backend git hash.

## Management Commands

For advanced users with shell access, LibrePhotos provides several management commands:

```bash
# Scan all users' photo directories
python manage.py scan

# Full rescan (re-process all photos)
python manage.py scan -f

# Scan specific files
python manage.py scan -s /path/to/file.jpg

# Scan Nextcloud directories for every user that has one configured
# (users without a Nextcloud scan directory are skipped; -n cannot be combined with -f or -s)
python manage.py scan -n

# Build similarity index for all users
python manage.py build_similarity_index

# Save metadata to image files or XMP sidecars
python manage.py save_metadata

# Start all ML services (individual services are managed from the Admin Area)
python manage.py start_service all

# Clear site-wide cache
python manage.py clear_cache

# Create a new user (username and email are required; the password is
# autogenerated unless --password is given, and --admin grants admin rights)
python manage.py createuser <username> <email>

# Create an admin user; the password is read from the ADMIN_PASSWORD
# environment variable, otherwise a random one is generated and not printed
ADMIN_PASSWORD=... python manage.py createadmin <username> <email>
```

---
title: "📚 Library Management"
excerpt: "Scanning, Nextcloud integration, services, and server management"
sidebar_position: 12
---

The **Library** page is your central hub for managing your photo library. Access it by clicking on your avatar (top right) and selecting **Library**, or via the spotlight search (`Ctrl+K` → "Library").

## Overview Stats

At the top of the Library page, you'll see quick stats about your library:

- **Photos** — Total number of photos and the number of days they span
- **People** — Number of recognized people, with a breakdown of inferred, labeled, and unknown faces
- **Faces** — Total faces detected
- **Events** — Number of auto-generated event albums

## Scanning

### Scan Photos (File System)

Click **"Scan photos"** to scan your configured scan directory for new photos. The scan process:

1. Discovers new image and video files
2. Groups related files (RAW+JPEG pairs, Live Photos) as [file variants](./stacks-and-file-variants.md)
3. Creates thumbnails
4. Extracts EXIF metadata
5. Runs face detection
6. Generates AI captions and tags
7. Performs reverse geocoding
8. Calculates CLIP embeddings for semantic search

You can also **rescan** to re-process all existing photos.

### Scan Progress

Scan progress is shown in the [Job System](./job-system.md). The scan is split into smaller tasks, prioritizing thumbnail creation so photos appear in the UI quickly while heavier processing (faces, tags) happens in the background.

## Nextcloud Integration

If you have a Nextcloud instance, you can scan photos directly from it without manually transferring files.

### Setup

1. On the Library page, find the **Nextcloud** section
2. Enter your Nextcloud server URL, username, and password
3. A green indicator will appear next to "Nextcloud Scan Directory" once connected
4. Click the folder icon to browse and select your Nextcloud photo directory

### Scanning from Nextcloud

Click **"Scan photos (Nextcloud)"** to download and scan photos from your configured Nextcloud directory. Files are copied to the local filesystem under `nextcloud_media/<username>/` before being processed.

:::note
Video files are currently not supported for Nextcloud scanning ([#278](https://github.com/LibrePhotos/librephotos/issues/278)).
:::

## Library Actions

The Library page provides quick access to common maintenance actions:

| Action | Description |
|--------|-------------|
| **Scan photos** | Scan for new photos in the file system |
| **Rescan photos** | Re-process all existing photos |
| **Train faces** | Run face clustering and classification |
| **Rescan faces** | Re-detect faces in all photos |
| **Generate events** | Create or regenerate auto albums |
| **Delete missing photos** | Remove database entries for photos no longer on disk |
| **Scan photos (Nextcloud)** | Scan photos from a connected Nextcloud instance |

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

Administrators can view system information in the Admin Area:

- **CPU** — Model, core count, usage
- **RAM** — Total and used memory
- **GPU** — GPU model and memory (if available)
- **Storage** — Total, used, and free disk space
- **Per-user stats** — Photo counts per user

### Storage Display

The sidebar shows a storage usage bar indicating how much disk space your photo library is using relative to the total available space.

### Server Logs

Administrators can download the server log file (`ownphotos.log`) directly from the Admin Area for debugging purposes.

### Image Version

The sidebar shows the current backend Docker image version. Hover over it to see the full version tag and git hash.

## Management Commands

For advanced users with shell access, LibrePhotos provides several management commands:

```bash
# Scan all users' photo directories
python manage.py scan

# Full rescan (re-process all photos)
python manage.py scan -f

# Scan specific files
python manage.py scan -s /path/to/file.jpg

# Build similarity index for all users
python manage.py build_similarity_index

# Save metadata to image files or XMP sidecars
python manage.py save_metadata

# Start ML services
python manage.py start_service

# Clear site-wide cache
python manage.py clear_cache

# Create a new user
python manage.py createuser

# Create an admin user
python manage.py createadmin
```

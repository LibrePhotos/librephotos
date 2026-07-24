---
title: "💼 Job System"
description: "A overview of what the worker logs mean"
sidebar_position: 23
---

## How does it work

The job system gives you information about the long-running jobs, including which job is running, in a queue, how far it progressed and when it started and stopped. Here are the available long-running jobs:

### Scan Photos

Scan photos will look at all media files in your scan directory and will add them to the library.

### Generate Event Albums

This job will look at all media files that already exist. It tries to find common events by looking at the timestamp and grouping the images. If the media files are in a 1 day and 12 hour interval, they will appear in the same event album.

### Regenerate Event Titles

This will create a title for the event album based on the information of the media files in the event album.

### Train Faces

This will look at all faces and its groups and will give us a certainty value for the image in the group.

### Delete Missing Photos

Finds all missing media files and removes them from the database.

### Scan Missing Photos

Goes through every photo in the database and flags the ones whose file can no longer be found on disk. It does not delete anything — use **Delete Missing Photos** for that. It runs automatically after a full scan and after any scan of your configured scan directory; it is skipped when you scan a different directory or only a specific list of files. See [Missing Photos](./missing-photos.md).

### Calculate Clip Embeddings

Calculates the CLIP value for all images. This is used for semantic search and for finding similar images.

### Generate Tags

Runs the configured tagging model over your photos to produce the scene and content tags used for search. It runs automatically after each scan; a normal scan only tags photos added since the last successful run, while a full scan re-tags everything.

### Add Geolocation

Looks up place names for each photo's GPS coordinates (reverse geocoding) so they appear in the places view and location search. It runs automatically after each scan; a normal scan only processes photos added since the last successful run, while a full scan reprocesses everything.

### Scan Faces

Looks for faces in the images and save them to the database

### Generate Face Embeddings

Computes the numeric encoding for faces that have been detected but not yet encoded, so they can be grouped and matched. It runs automatically as part of **Scan Faces**. If no faces are waiting to be encoded it finishes immediately, so you may not always see a row for it.

### Find Similar Faces

Clusters the faces into known and unknown groups.

### Download Models

This downloads the needed machine learning models to data/protected_media/data_models/.

### Download Selected Photos

Packs a multi-photo download into a zip file in the background. It starts when you select several photos and choose to download them, and the app offers you the file once the job finishes.

### Repair File Variants

Runs after each scan to fix RAW files that were scanned as their own photos. For each photo whose main file is a RAW file, it either merges it into the matching image photo (such as a JPEG or HEIC) in the same folder and removes the leftover RAW-only entry, or — if an image file is already attached — promotes that image to be the main file. It does not re-pair Live Photo videos that were scanned separately; those are only paired during a scan. See [Stacks & File Variants](./stacks-and-file-variants.md) for more details.

### Detect Duplicate Photos

Finds duplicate photos in your library using perceptual hashing. It detects both exact copies (via hash comparison) and visual duplicates (via a two-pass algorithm). Results are shown in the Organizing page, where you can review and manage them; the button that starts this job there is called **Detect Duplicates**. See [Duplicate Detection](./duplicate-detection.md) for more details.

## Where to get information about previous run jobs

When you are logged in as an admin, click on the profile picture in the top right corner and then navigate to `Admin Area`. You should see the jobs at the bottom of the page in a table called `Worker Logs`.

Click a row in the `Worker Logs` table to open that job's detail page. It shows the job's ID and status, when it was queued, started and finished, how long it ran, who started it, and the current progress step. If the job failed, an `Error Details` section shows the captured error message and the full result data.

## What to do when a job gets stuck

If a job is still running and you want to stop it, use the **Cancel** button in its `Worker Logs` row. Cancelling marks the job as cancelled and finished and removes any of its steps that are still waiting in the queue. Jobs that work through a list of photos check for cancellation as they go and stop at the next checkpoint, so it can take a moment before a running job actually stops. A few jobs have no such checkpoint yet — cancelling marks them finished right away, but any work already in progress runs to completion. Either way, cancelling frees the queue for a new job, so you do not need to remove the entry afterwards.

The **Remove** button only deletes the log entry from the database — it does **not** stop a running job. Use it for a job that has genuinely crashed (nothing is progressing and the logs show an ungraceful failure) so that the queue will accept new jobs again.

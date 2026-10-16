---
title: "💼 Job System"
description: "A overview of what the worker logs mean"
sidebar_position: 23
---

## How does it work

The job system gives you information about the long-running jobs, including which job is running, in a queue, how far it progressed and when it started and stopped. Here are the available long-running jobs:

### Scan Photos

Scan photos will look at all media files in your scan directory and will add them to the library.

A normal scan only reads the files that are new or changed (the file or one of its sidecars) since the last successful scan of the whole scan directory started. A scan that was cancelled or failed before it reached every file does not count, and neither does a scan of a few selected files or a Nextcloud scan. A full scan reads every file again. Not released yet: up to 1.3.0, any finished scan counted, including cancelled ones and **Detect Stacks** runs, and a file edited while the last scan ran could be skipped. The first normal scan after the upgrade therefore checks every file once.

### Generate Event Albums

This job will look at all media files that already exist. It tries to find common events by looking at the timestamp and grouping the images. If the media files are in a 1 day and 12 hour interval, they will appear in the same event album.

### Regenerate Event Titles

This will create a title for the event album based on the information of the media files in the event album. Since 1.3.0, titles leave out faces in "Unknown - Other" and no longer contain a double space where a part is missing. Run this job once to fix the titles of albums made by an older version. It also stores what each title is made of, so the web app can show it in your language (not released yet; until then titles are English).

### Train Faces

This will look at all faces and its groups and will give us a certainty value for the image in the group.

### Delete Missing Photos

Finds all missing media files and removes them from the database.

### Scan Missing Photos

Goes through every photo in the database and flags the ones whose file can no longer be found on disk. It does not delete anything — use **Delete Missing Photos** for that. It runs automatically after a full scan and after any scan of your configured scan directory; it is skipped when you scan a different directory or only a specific list of files, and when the scan had to skip a folder it could not read. It checks every photo before it changes anything, and fails without changing anything when the scan directory looks unmounted or more than the **Missing photos limit** of your photos would be marked missing (not released yet). See [Missing Photos](./missing-photos.md).

### Calculate Clip Embeddings

Calculates the OpenCLIP search embedding of every photo that has none, then rebuilds the similarity index. This is used for semantic search and for finding similar images. **Generate Tags** stores the embeddings as it tags, so with tagging on this job only fills the gaps. After an upgrade from a release with another model, it re-embeds those photos in place and gives them their tags from the same run.

### Generate Tags

Runs the configured tagging model over your photos to produce the scene and content tags used for search. It runs automatically after each scan and tags every photo that has no tags yet, including the ones an earlier run did not reach because it was cancelled or failed. Not released yet: up to 1.3.0, a normal scan only tagged photos added since the last run, so photos a cancelled run left behind stayed untagged until a full scan.

### Add Geolocation

Looks up place names for each photo's GPS coordinates (reverse geocoding) so they appear in the places view and location search. It runs automatically after each scan; a normal scan processes photos added since the last successful run started, plus every photo whose position has no place name looked up for it yet (its GPS changed in the file, or an earlier lookup failed; a position where the provider found no place, such as open sea, is not asked again until it changes), while a full scan goes over every photo. A photo whose place was already looked up for its position is skipped either way, so switching the Map Provider renames nothing; [Look Up Place Names](#look-up-place-names) does. It looks up the position LibrePhotos has stored, which the scan keeps in line with the file unless you set the location yourself. A run that was cancelled or failed before it reached every photo does not count as successful.

### Scan Faces

Looks for faces in your photos and saves them. It runs automatically after each scan and looks at every photo whose faces have not been looked for yet: new photos, photos whose file was replaced, and photos the face recognition service failed on last time, for example because it was restarting or ran out of memory. Each such failure is listed in the job's errors, and the photo is tried again on the next run. A picture the service cannot read at all is listed once and not tried again. When the service cannot be reached for 20 photos in a row, the job stops with the error "Face service unreachable" and the remaining photos wait for the next run. **Rescan Faces** looks at every photo again.

Not released yet: up to 1.3.0, a face recognition error counted as "no faces in this photo", the job reported no error, and only **Rescan Faces** found those faces later. If the face recognition service had trouble while your library was scanned, run **Rescan Faces** once after updating.

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

### Probe Videos

Checks the videos that were added to your library before LibrePhotos recorded each video's colour, codec and pixel format during the scan. It runs by itself after a scan, only while such videos are left, so most scans never show it. It rebuilds the thumbnails of every HDR video, which an older version made washed out (see [HDR Videos](./viewing-photos.md#hdr-videos)). It does the same for every video not stored as ordinary 8-bit 4:2:0, such as 10-bit clips or the 4:2:2 Motion JPEG files older cameras record, whose animated thumbnails an older version made in a form no browser plays. For each of these videos it also drops any converted copy kept from before, so the next playback converts it again. If a rebuild fails, the old thumbnail is kept. A video whose file cannot be read at the time — for example on a drive that is not mounted — is simply tried again after the next scan. Since 1.3.0.

<Since version="1.4.0" /> After an update, an admin can also start it for every user's older videos with **Start** on the [Finish the upgrade card](../installation/upgrading.md#finish-the-upgrade).

### Extract Text (OCR)

Reads the text on your photos so that search can find it, and uses it to detect documents. It only runs when you click **Extract** (or **Extract text again for all photos**) on the Library page, never after a scan by itself, and only while an administrator has selected a text recognition model. See [Text Recognition](./text-recognition.md).

### Generate Captions

_Not released yet._ Started with **Generate** (or **Generate captions again for all photos**) under **Captions** on the Library page. Writes a generated caption for each of your photos that has none, or for every photo again; a caption you wrote yourself is never changed. It never runs by itself after a scan. See [Captioning the whole library](./image-captioning.md#captioning-the-whole-library).

### Detect Stacks

Groups burst sequences into stacks, using your [burst detection rules](./settings/index.md#set-burst-detection-rules). It starts when you click **Detect Stacks** on the Organizing → Stacks page. See [Stacks & File Variants](./stacks-and-file-variants.md). Not released yet: up to 1.3.0, it was listed as **Scan Photos**.

### Detect Duplicate Photos

Finds duplicate photos in your library using perceptual hashing. It detects both exact copies (via hash comparison) and visual duplicates (via a two-pass algorithm). Results are shown in the Organizing page, where you can review and manage them; the button that starts this job there is called **Detect Duplicates**. See [Duplicate Detection](./duplicate-detection.md) for more details.

### Remove Photo Details from Thumbnails

Removes the photo's EXIF and XMP (GPS position, camera serial number, keywords) and a video's location from the thumbnails LibrePhotos 1.2.1 and older wrote, across every user's library. An admin starts it with **Remove photo details from old thumbnails** under **Admin Area > Admin Tools**; see [After upgrading from 1.2.1 or older](../installation/upgrading.md#strip-thumbnail-metadata). It only rewrites thumbnails that still carry metadata, so running it again is quick and safe. Not released yet: up to 1.3.0, this was only the `strip_thumbnail_metadata` command.

### Read Shutter Speeds Again

<Since version="1.4.0" /> Reads the exposure time again for the photos whose shutter speed 1.3.0 or older stored wrongly, across every user's library. It runs by itself once after updating from such a release, and shows on the [Finish the upgrade card](../installation/upgrading.md#finish-the-upgrade). Only that one value is read from each photo; nothing is written to your files. See [After upgrading from 1.3.0 or older](../installation/upgrading.md#refresh-exposure-time).

### Empty Trash

_Not released yet._ Started with the **Empty trash** button on the Trash page. Permanently deletes every photo in your trash, including the original files on disk. It only touches your own photos, and a photo it cannot delete is skipped and makes the job end as failed. See [Emptying the trash](./trash.md#emptying-the-trash).

### Apply Date Rules

_Not released yet._ Started with **Apply** under **Dates** on the Library page, or with **Apply to existing photos** on the date rules card after you saved changed rules. Reads the date of every photo of yours again with your current date rules and moves the photos whose date changed to their new day; a date you set by hand stays, and nothing is written to your files. A photo whose date cannot be read keeps its date and is listed in the job. See [Applying the rules](./settings/date-rules.md#applying-the-rules).

### Write Metadata to Files

_Not released yet._ Started with **Write now** under **Write edits to files** in Settings → Metadata Options. Writes the edits that are only in LibrePhotos (ratings, dates and locations you set, rotations, captions, tags and face tags) to your sidecars or media files, as that setting says; a photo with nothing to write is left alone. It ends with how many photos it wrote, and lists the photos it could not write. See [Writing the edits of a whole library](./exif-data.md#writing-the-edits-of-a-whole-library).

### Look Up Place Names

<Since version="1.4.0" /> Asks the Map Provider set in Site Settings again for the place of every photo with a location, across every user's library, for example after switching to ExifTool. An admin starts it with **Look up place names again** under **Admin Area > Admin Tools**, after a confirmation. Photos move to the Places albums of their new names, and the day albums name their places again; a photo whose lookup fails keeps its old place. See [Switching the provider](./places.md#switching-the-provider).

### Move Photos

<Since version="1.4.0" /> Started with **Move to folder…** for a selection of more than 100 photos. Moves your photos, with all their files, to another folder of your library, one photo after the other; a photo whose name is taken there is renamed or skipped as you chose. A cancel stops after the photo it is on, and the photos moved until then stay moved. It ends with how many photos moved and how many stayed where they were. See [Moving photos to another folder](./library.md#moving-photos-to-another-folder).

## Where to get information about previous run jobs

When you are logged in as an admin, click on the profile picture in the top right corner and then navigate to `Admin Area`. You should see the jobs at the bottom of the page in a table called `Worker Logs`.

Click a row in the `Worker Logs` table to open that job's detail page. It shows the job's ID and status, when it was queued, started and finished, how long it ran, who started it, and the current progress step. If the job failed, an `Error Details` section shows the captured error message and the full result data. The page has the same **Cancel** (while the job is unfinished) and **Remove** buttons as its row, with the same confirmation; after **Remove** it goes back to the list. Not released yet: up to 1.3.0, the detail page had neither button.

## What to do when a job gets stuck

LibrePhotos checks every hour for jobs that have made no progress for a day and marks them failed, with the error "Job made no progress for 24 hours"; the job keeps the errors it had recorded. A job that runs for days but keeps making progress, such as the first scan of a large library, is left alone. The threshold is the `STUCK_JOB_HOURS` variable (see [Environment variables](../installation/environment-variables.md#stuck-jobs)). Not released yet: up to 1.3.0, every job was marked failed 24 hours after it started, even while it was still working.

If a job is still running and you want to stop it, use the **Cancel** button in its `Worker Logs` row or on its detail page, or the one under the progress bar in the account menu. A dialog asks first; **Keep running** leaves the job alone. Cancelling marks the job as cancelled and finished and removes any of its steps that are still waiting in the queue. Jobs check for cancellation as they go and stop at their next checkpoint, so it can take a few seconds before a running job actually stops; photos a scan already took off the queue are skipped. A model download or a download of selected photos still runs to the end. **Find Similar Faces** is the one exception while it rebuilds the face clusters: it finishes the rebuild, so you are not left without clusters, but it does not start **Train Faces** afterwards. Cancelling frees the queue for a new job at once, so you do not need to remove the entry afterwards. Not released yet: up to 1.3.0, a cancelled scan kept importing the photos it had queued, and duplicate and stack detection, face training, search embeddings, file variant repair and event albums ran to the end. The next scan picks up what a cancelled or failed scan, tagging, geolocation or face scan left behind.

The **Remove** button only deletes the log entry from the database — it does **not** stop a running job. Use it for a job that has genuinely crashed (nothing is progressing and the logs show an ungraceful failure) so that the queue will accept new jobs again.

Removing a finished job deletes its record and result; nothing in your library changes. Two runs are different, because a later run starts from them:

- The newest scan of the whole scan directory that reached every file is the reference for the next normal scan, which only rereads the files changed since then (see [Scan Photos](#scan-photos)). Without it, the next normal scan reads every file of your library again, as a full scan does. So its **Remove** button is greyed out, and pointing at it says "This scan is the reference for the next incremental scan"; LibrePhotos refuses to remove it in any other way too, also for an admin. It can be removed once a newer scan of the whole library has finished. A cancelled scan, a scan of a few selected files or a Nextcloud scan does not replace it. This scan is kept by the automatic cleanup of old jobs as well.
- The newest complete **Add Geolocation** run: the next one looks up the photos added since it started. Remove it and the next run looks up the places of every photo added since the run before it, or of all your photos if none is left. The confirmation dialog warns about it.

<Since version="1.4.0" /> Up to 1.3.0, the reference scan could be removed, and the next scan then read the whole library again. The confirmation dialog could not tell which scan was the reference, and it also warned about **Scan Faces**, which picks the photos whose faces have not been looked for whatever ran before.

*Not released yet: up to 1.3.0, **Cancel** and **Remove** acted on the first click, without asking.*

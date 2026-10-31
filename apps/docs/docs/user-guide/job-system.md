---
title: "💼 Job System"
description: "A overview of what the worker logs mean"
sidebar_position: 23
---

## How does it work

The job system gives you information about the long-running jobs, including which job is running, in a queue, how far it progressed and when it started and stopped. Here are the available long-running jobs:

### Scan Photos

Scan photos will look at all media files in your scan directory and will add them to the library.

A normal scan only reads the files that are new or changed (the file or one of its sidecars) since the last successful scan of the whole scan directory started. A scan that was cancelled or failed before it reached every file does not count, and neither does a scan of a few selected files or a Nextcloud scan. A full scan reads every file again. <Since version="1.4.0" /> Up to 1.3.0, any finished scan counted, including cancelled ones and **Detect Stacks** runs, and a file edited while the last scan ran could be skipped. The first normal scan after the upgrade therefore checks every file once.

### Generate Event Albums

This job will look at all media files that already exist. It tries to find common events by looking at the timestamp and grouping the images. If the media files are in a 1 day and 12 hour interval, they will appear in the same event album.

### Regenerate Event Titles

This will create a title for the event album based on the information of the media files in the event album. Since 1.3.0, titles leave out faces in "Unknown - Other" and no longer contain a double space where a part is missing. Run this job once to fix the titles of albums made by an older version. It also stores what each title is made of, so the web app can show it in your language. <Since version="1.4.0" /> Up to 1.3.0, titles were always English.

### Train Faces

This will look at all faces and its groups and will give us a certainty value for the image in the group.

### Delete Missing Photos

Finds all missing media files and removes them from the database.

### Scan Missing Photos

Goes through every photo in the database and flags the ones whose file can no longer be found on disk. It does not delete anything — use **Delete Missing Photos** for that. It runs automatically after a full scan and after any scan of your configured scan directory; it is skipped when you scan a different directory or only a specific list of files, and when the scan had to skip a folder it could not read. It checks every photo before it changes anything. <Since version="1.4.0" /> It fails without changing anything when the scan directory looks unmounted or more than the **Missing photos limit** of your photos would be marked missing. See [Missing Photos](./missing-photos.md).

### Calculate Clip Embeddings

Calculates the OpenCLIP search embedding of every photo that has none, then rebuilds the similarity index. This is used for semantic search and for finding similar images. **Find Things** stores the embeddings as it tags, so with tagging on this job only fills the gaps. After an upgrade from a release with another model, it re-embeds those photos in place and gives them their tags from the same run.

<Since version="1.5.0" /> Uploads start it too: a few minutes after your last upload, LibrePhotos embeds the uploaded photos that have no embedding yet and rebuilds the similarity index, then runs **Generate Face Embeddings** for faces without one. A burst of uploads gets one run. Up to 1.4.0, uploaded photos only appeared in semantic search after the next scan or restart. The first start after the upgrade does this once for every user with photos.

### Find Things

Finds the things in your photos (beach, dog, sunset, ...) with OpenCLIP, for the Things albums and for search. It runs automatically after each scan and covers every photo that has no things yet, including the ones an earlier run did not reach because it was cancelled or failed. <Since version="1.4.0" /> Up to 1.3.0, a normal scan only covered photos added since the last run, so photos a cancelled run left behind stayed without things until a full scan.

<Since version="1.5.0" /> You can also start it from **Account menu > Library**, under the **Things** heading: **Find** covers the photos without things, and **Find things again for all photos** (the arrow next to it) labels every photo again with the current list of things, replacing the things it found before. Your own tags and keywords are never changed. See [Things Albums](./albums.md#things-albums). Up to 1.4.0 this job was called **Generate Tags**.

### Add Geolocation

Looks up place names for each photo's GPS coordinates (reverse geocoding) so they appear in the places view and location search. It runs automatically after each scan; a normal scan processes photos added since the last successful run started, plus every photo whose position has no place name looked up for it yet (its GPS changed in the file, or an earlier lookup failed; a position where the provider found no place, such as open sea, is not asked again until it changes), while a full scan goes over every photo. A photo whose place was already looked up for its position is skipped either way, so switching the Map Provider renames nothing; [Look Up Place Names](#look-up-place-names) does. It looks up the position LibrePhotos has stored, which the scan keeps in line with the file unless you set the location yourself. A run that was cancelled or failed before it reached every photo does not count as successful.

### Scan Faces

Looks for faces in your photos and saves them. It runs automatically after each scan and looks at every photo whose faces have not been looked for yet: new photos, photos whose file was replaced, and photos the face recognition service failed on last time, for example because it was restarting or ran out of memory. Each such failure is listed in the job's errors, and the photo is tried again on the next run. A picture the service cannot read at all is listed once and not tried again. When the service cannot be reached for 20 photos in a row, the job stops with the error "Face service unreachable" and the remaining photos wait for the next run. **Rescan Faces** looks at every photo again.

<Since version="1.4.0" /> Up to 1.3.0, a face recognition error counted as "no faces in this photo", the job reported no error, and only **Rescan Faces** found those faces later. If the face recognition service had trouble while your library was scanned, run **Rescan Faces** once after updating.

### Generate Face Embeddings

Computes the numeric encoding for faces that have been detected but not yet encoded, so they can be grouped and matched. It runs automatically as part of **Scan Faces**. If no faces are waiting to be encoded it finishes immediately, so you may not always see a row for it.

### Find Similar Faces

Clusters the faces into known and unknown groups.

<Since version="1.5.0" /> Uploads start it too, once enough new faces came in: at least 20, and at least 2% of all your faces. So that it does not renumber the "Unknown" groups while you work through them, it waits until 30 minutes after your last upload and 15 minutes after you last labelled, deleted or restored a face, runs at most once an hour, and waits while a scan, a face scan, **Train Faces** or an upload of yours is still running. Any run, also one a scan or the **Train** button started, counts as the last one. Up to 1.4.0, faces of uploaded photos stayed among the unknown faces until you trained by hand.

### Download Models

This downloads the needed machine learning models to data/protected_media/data_models/.

### Download Selected Photos

Packs a multi-photo download into a zip file in the background. It starts when you select several photos and choose to download them, and the app offers you the file once the job finishes.

### Repair File Variants

Runs after each scan to fix RAW files that were scanned as their own photos. For each photo whose main file is a RAW file, it either merges it into the matching image photo (such as a JPEG or HEIC) in the same folder and removes the leftover RAW-only entry, or — if an image file is already attached — promotes that image to be the main file. It does not re-pair Live Photo videos that were scanned separately; those are only paired during a scan. See [Stacks & File Variants](./stacks-and-file-variants.md) for more details.

### Import Uploads

<Since version="1.5.0" /> Shows the photos and videos you uploaded, from the web app, the mobile app or another client, while LibrePhotos processes them: thumbnails, dates, tags, places and faces. Uploads made close together count in one job, so its progress reads "12 of 40" for all of them. It ends a few minutes after your last upload, once every upload is processed, and then starts the search and face steps described under **Calculate Clip Embeddings**. A photo whose processing failed is listed in the job with the file name and the step that failed. It runs next to other jobs and never keeps you from starting a scan, and it cannot be cancelled or removed while it runs. Up to 1.4.0, uploads showed no job at all.

### Probe Videos

Checks the videos that were added to your library before LibrePhotos recorded each video's colour, codec and pixel format during the scan. It runs by itself after a scan, only while such videos are left, so most scans never show it. It rebuilds the thumbnails of every HDR video, which an older version made washed out (see [HDR Videos](./viewing-photos.md#hdr-videos)). It does the same for every video not stored as ordinary 8-bit 4:2:0, such as 10-bit clips or the 4:2:2 Motion JPEG files older cameras record, whose animated thumbnails an older version made in a form no browser plays. For each of these videos it also drops any converted copy kept from before, so the next playback converts it again. If a rebuild fails, the old thumbnail is kept. A video whose file cannot be read at the time — for example on a drive that is not mounted — is simply tried again after the next scan. Since 1.3.0.

<Since version="1.4.0" /> After an update, an admin can also start it for every user's older videos with **Start** on the [Finish the upgrade card](../installation/upgrading.md#finish-the-upgrade).

### Extract Text (OCR)

Reads the text on your photos so that search can find it, and uses it to detect documents. It runs only while an administrator has selected a text recognition model: when you click **Extract** (or **Extract text again for all photos**) on the Library page, and <Since version="1.5.0" /> by itself after a scan or an upload, for the photos still without text. Up to 1.4.0 it never ran by itself. See [Text Recognition](./text-recognition.md).

### Generate Captions

<Since version="1.4.0" /> Started with **Generate** (or **Generate captions again for all photos**) under **Captions** on the Library page. Writes a generated caption for each of your photos that has none, or for every photo again; a caption you wrote yourself is never changed. It never runs by itself after a scan. See [Captioning the whole library](./image-captioning.md#captioning-the-whole-library).

### Detect Stacks

Groups burst sequences into stacks, using your [burst detection rules](./settings/index.md#set-burst-detection-rules). It starts when you click **Detect Stacks** on the Organizing → Stacks page. See [Stacks & File Variants](./stacks-and-file-variants.md). <Since version="1.4.0" /> Up to 1.3.0, it was listed as **Scan Photos**.

### Detect Duplicate Photos

Finds duplicate photos in your library using perceptual hashing. It detects both exact copies (via hash comparison) and visual duplicates (via a two-pass algorithm). Results are shown in the Organizing page, where you can review and manage them; the button that starts this job there is called **Detect Duplicates**. See [Duplicate Detection](./duplicate-detection.md) for more details.

### Remove Photo Details from Thumbnails

Removes the photo's EXIF and XMP (GPS position, camera serial number, keywords) and a video's location from the thumbnails LibrePhotos 1.2.1 and older wrote, across every user's library. An admin starts it with **Remove photo details from old thumbnails** under **Admin Area > Admin Tools**; see [After upgrading from 1.2.1 or older](../installation/upgrading.md#strip-thumbnail-metadata). It only rewrites thumbnails that still carry metadata, so running it again is quick and safe. <Since version="1.4.0" /> Up to 1.3.0, this was only the `strip_thumbnail_metadata` command.

### Read Shutter Speeds Again

<Since version="1.4.0" /> Reads the exposure time again for the photos whose shutter speed 1.3.0 or older stored wrongly, across every user's library. It runs by itself once after updating from such a release, and shows on the [Finish the upgrade card](../installation/upgrading.md#finish-the-upgrade). Only that one value is read from each photo; nothing is written to your files. See [After upgrading from 1.3.0 or older](../installation/upgrading.md#refresh-exposure-time).

### Empty Trash

<Since version="1.4.0" /> Started with the **Empty trash** button on the Trash page. Permanently deletes every photo in your trash, including the original files on disk. It only touches your own photos, and a photo it cannot delete is skipped and makes the job end as failed. See [Emptying the trash](./trash.md#emptying-the-trash).

### Apply Date Rules

<Since version="1.4.0" /> Started with **Apply** under **Dates** on the Library page, or with **Apply to existing photos** on the date rules card after you saved changed rules. Reads the date of every photo of yours again with your current date rules and moves the photos whose date changed to their new day; a date you set by hand stays, and nothing is written to your files. A photo whose date cannot be read keeps its date and is listed in the job. See [Applying the rules](./settings/date-rules.md#applying-the-rules).

### Write Metadata to Files

<Since version="1.4.0" /> Started with **Write now** under **Write edits to files** in Settings → Metadata Options. Writes the edits that are only in LibrePhotos (ratings, dates and locations you set, rotations, captions, tags and face tags) to your sidecars or media files, as that setting says; a photo with nothing to write is left alone. It ends with how many photos it wrote, and lists the photos it could not write. See [Writing the edits of a whole library](./exif-data.md#writing-the-edits-of-a-whole-library).

### Look Up Place Names

<Since version="1.4.0" /> Asks the Map Provider set in Site Settings again for the place of every photo with a location, across every user's library, for example after switching to ExifTool. An admin starts it with **Look up place names again** under **Admin Area > Admin Tools**, after a confirmation. Photos move to the Places albums of their new names, and the day albums name their places again; a photo whose lookup fails keeps its old place. See [Switching the provider](./places.md#switching-the-provider).

### Move Photos

<Since version="1.4.0" /> Started with **Move to folder…** for a selection of more than 100 photos. Moves your photos, with all their files, to another folder of your library, one photo after the other; a photo whose name is taken there is renamed or skipped as you chose. A cancel stops after the photo it is on, and the photos moved until then stay moved. It ends with how many photos moved and how many stayed where they were. See [Moving photos to another folder](./library.md#moving-photos-to-another-folder).

<Since version="1.5.0" /> With **Sort into folders by date** each photo goes into the folder of its capture date, and photos without a date are counted as staying.

### Remove duplicate faces

<Since version="1.5.0" /> Deletes the faces that were saved twice on the same photo, across every user's library: where two faces of a photo overlap, the one with a name stays (the older one, when both or neither have a name). An admin starts it with **Remove duplicate faces** under **Admin Area > Admin Tools**, after a confirmation; the deleted duplicates do not go to the Deleted tab and cannot be restored. It ends with how many photos it checked and how many faces it deleted. The same work runs from the command line, for every user or one:

```bash
docker compose exec backend python manage.py deduplicate_faces
docker compose exec backend python manage.py deduplicate_faces --user anna --chunk-size 200
```

`--chunk-size` (default 500) is how many photos are compared at a time. Up to 1.4.0, only the **Deduplicate faces** action on selected photos in the Django admin did this.

### Make Video Posters

<Since version="1.5.0" /> Gives the videos added before 1.5.0 the still picture the photo grid shows until you point at a video, across every user's library. It runs by itself once after the update and shows on the [Finish the upgrade card](../installation/upgrading.md#finish-the-upgrade). Each picture is made from the video's big thumbnail, so it is quick and no video is decoded or changed. A video without a big thumbnail is skipped, and one whose picture cannot be made is listed in the job; both keep playing their clip in the grid as before. See [Video previews in the grid](./feature-toggles.md#animated-video-previews).

### Check File Contents

<Since version="1.5.0" /> Reads every file of every user's library again and compares it with what LibrePhotos has, to find files that were replaced while keeping their old modification date (`cp -p`, `rsync --times`, some sync apps), which a scan does not notice. An admin starts it with **Check file contents** under **Admin Area > Admin Tools**, for all users or one user and, optionally, one folder of that user's library; the `rehash_files` command does the same. A changed file is imported again as a scan would (see [Files replaced in place](./library.md#files-replaced-in-place)), and the photos holding it are then read again by a scan of their owner's. The job's page shows how many files were read, what became of the changed ones, per user, and the files that could not be read. It reads every byte, so it takes hours on a large library, and other jobs wait until it finishes.

### Rename Photos

<Since version="1.5.0" /> Started with **Rename files…** for a selection of more than 100 photos. Gives your photos, with all their files, the name made from their capture date, one photo after the other; a taken name gets ` (1)`, ` (2)`. A cancel stops after the photo it is on, and the photos renamed until then keep their new names. It ends with how many photos were renamed, how many kept their names, and how many could not be renamed (their files keep their old names). See [Renaming photos by their date](./library.md#renaming-photos-by-their-date).

### Repair Turned Faces

<Since version="1.5.1" /> Some apps turn a photo's pixels when they export it but keep the face tags they wrote for the picture before the turn. Up to 1.5.0, LibrePhotos put such a face a quarter turn away from the face: it never got an encoding, and **Scan Faces** found the face again as a second face without a name. This job moves those faces onto the face, across every user's library. An admin starts it from the [Finish the upgrade card](../installation/upgrading.md#finish-the-upgrade).

A face is moved only when exactly one of the two quarter turns lands on a face LibrePhotos found on the photo, and that face has no name or the same name. The face then takes that face's place and encoding, and the copy is deleted; it does not go to the Deleted tab. Anything else stays as it is, for example a face found there that you named as someone else. Your files are not changed, and the photo's faces are not looked for again. It ends with how many faces it repaired and how many it left. The same work runs from the command line; `--dry-run` only counts the faces:

```bash
docker compose exec backend python manage.py repair_turned_faces --dry-run
docker compose exec backend python manage.py repair_turned_faces
```

## Where to get information about previous run jobs

When you are logged in as an admin, click on the profile picture in the top right corner and then navigate to `Admin Area`. You should see the jobs at the bottom of the page in a table called `Worker Logs`.

Click a row in the `Worker Logs` table to open that job's detail page. It shows the job's ID and status, when it was queued, started and finished, how long it ran, who started it, and the current progress step. If the job failed, an `Error Details` section shows the captured error message and the full result data. The page has the same **Cancel** (while the job is unfinished) and **Remove** buttons as its row, with the same confirmation; after **Remove** it goes back to the list. <Since version="1.4.0" /> Up to 1.3.0, the detail page had neither button.

## What to do when a job gets stuck

LibrePhotos checks every hour for jobs that have made no progress for a day and marks them failed, with the error "Job made no progress for 24 hours"; the job keeps the errors it had recorded. A job that runs for days but keeps making progress, such as the first scan of a large library, is left alone. The threshold is the `STUCK_JOB_HOURS` variable (see [Environment variables](../installation/environment-variables.md#stuck-jobs)). <Since version="1.4.0" /> Up to 1.3.0, every job was marked failed 24 hours after it started, even while it was still working.

<Since version="1.5.0" /> A job that a running worker is still busy with is left alone too, however long it goes without progress: **Find Similar Faces** reports none while it groups the faces of a large library. Up to 1.4.0, such a job could be marked failed while it worked, and still showed as failed after it succeeded.

<Since version="1.5.0" /> When LibrePhotos restarts while jobs run (an update, a changed compose file, a reboot, a worker killed for using too much memory), the work the old backend had already taken from the queue runs again about 10 minutes after the restart. A scan interrupted that way still reaches 100 % and starts its follow-up jobs. Up to 1.4.0, that work stayed in the queue for months: the scan stopped just short of 100 %, was marked failed a day later and never started its follow-ups.

If a job is still running and you want to stop it, use the **Cancel** button in its `Worker Logs` row or on its detail page, or the one under the progress bar in the account menu. A dialog asks first; **Keep running** leaves the job alone. Cancelling marks the job as cancelled and finished and removes any of its steps that are still waiting in the queue. Jobs check for cancellation as they go and stop at their next checkpoint, so it can take a few seconds before a running job actually stops; photos a scan already took off the queue are skipped. A model download or a download of selected photos still runs to the end. **Find Similar Faces** is the one exception while it rebuilds the face clusters: it finishes the rebuild, so you are not left without clusters, but it does not start **Train Faces** afterwards. Cancelling frees the queue for a new job at once, so you do not need to remove the entry afterwards. <Since version="1.4.0" /> Up to 1.3.0, a cancelled scan kept importing the photos it had queued, and duplicate and stack detection, face training, search embeddings, file variant repair and event albums ran to the end. The next scan picks up what a cancelled or failed scan, tagging, geolocation or face scan left behind.

The **Remove** button only deletes the log entry from the database — it does **not** stop a running job. Use it for a job that has genuinely crashed (nothing is progressing and the logs show an ungraceful failure) so that the queue will accept new jobs again.

Removing a finished job deletes its record and result; nothing in your library changes. Two runs are different, because a later run starts from them:

- The newest scan of the whole scan directory that reached every file is the reference for the next normal scan, which only rereads the files changed since then (see [Scan Photos](#scan-photos)). Without it, the next normal scan reads every file of your library again, as a full scan does. So its **Remove** button is greyed out, and pointing at it says "This scan is the reference for the next incremental scan"; LibrePhotos refuses to remove it in any other way too, also for an admin. It can be removed once a newer scan of the whole library has finished. A cancelled scan, a scan of a few selected files or a Nextcloud scan does not replace it. This scan is kept by the automatic cleanup of old jobs as well.
- The newest complete **Add Geolocation** run: the next one looks up the photos added since it started. Remove it and the next run looks up the places of every photo added since the run before it, or of all your photos if none is left. The confirmation dialog warns about it.

<Since version="1.4.0" /> Up to 1.3.0, the reference scan could be removed, and the next scan then read the whole library again. The confirmation dialog could not tell which scan was the reference, and it also warned about **Scan Faces**, which picks the photos whose faces have not been looked for whatever ran before.

<Since version="1.4.0" /> Up to 1.3.0, **Cancel** and **Remove** acted on the first click, without asking.

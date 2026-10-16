---
title: "🔧 Settings"
description: "Short explainer where the settings are"
sidebar_position: 19
---

There are three kinds of settings at the moment.

## Profile

You can find your profile settings by clicking in the top right corner and click on `Profile`.

Here you can change your name, photo, e-mail address, password and language. You can also set whether you want your profile to be accessible globally or not.

- `Avatar`, `First name`, `Last name` will be shown if you share pictures with other users or when your profile is publically accessible
- `E-mail` is the address your password-reset link is sent to. The **Forgot your password?** link only appears on the login page once an administrator has configured outgoing e-mail (Admin Area → Site Settings → Email (SMTP)), and resetting your own password only works if your account has an e-mail address set. If it does not, an administrator can still reset your password for you under Admin Area → Users.
- `Change password` is for changing your password
- `Language` will change the settings
- `Public Sharing` will set if you can be found globally

## Settings

These settings are user specific and will affect how scanning and saving works. At the bottom, you can also find experimental settings.

### Finding a section

Both the Settings page and the Admin Area have an **On this page** list (not released yet). On a wide screen it sits to the right of the cards; on a phone or a narrow window it is a row of buttons under the top bar that scrolls sideways. The entry of the card you are looking at is highlighted, and picking one scrolls to its card.

Every card also has its own link. Hover over a card's title and click the **#** next to it to copy the link, for example `https://photos.example.com/settings#settings-faces` or `/admin#admin-services`. Opening such a link scrolls straight to that card and outlines it for a moment, which is handy when you point someone to a setting.

### Scan Confidence

This setting affect how much certainty is needed for a tag to be added to a picture. Default `Standard`

### Semantic Search

If you set this to `Top 100`,`Top 50`, `Top 10` you will get semantic search results instead of just looking at the EXIF data. It is disabled as default, because the first search takes a minute to get a response. After that it is fast. Default `Disabled`. For more information, see [Search](../search.md).

### Metadata Options

- `Write edits to files` copies some of your edits into your files, so other apps see them. Each option says what it writes. Default `Off`.
  - `Off`: edits stay in LibrePhotos. Your files are never changed.
  - `Save to sidecar`: ratings, dates, rotations, captions, tags and locations are written to an `.xmp` file next to the photo (an existing one, else a new `IMG.jpg.xmp`, see [Which sidecar is written](../exif-data.md#which-sidecar-is-written)). The photo itself is not changed.
  - `Save to media file`: ratings, dates, rotations, captions, tags and locations are written into the photo file itself. This changes your originals, so keep a backup. Rotations are only written into JPEG, PNG, TIFF and WebP files; other formats, such as HEIC, AVIF and RAW, keep their rotation in LibrePhotos.

  Tags are written as the file's keywords. Titles, creators and copyright notices are not written. Face names are written only with `Write face tags to image files` (see [Face Options](#face-options)). The tags each edit writes are listed in [EXIF Data](../exif-data.md#what-librephotos-writes), and [Undoing write-back](../exif-data.md#undoing-write-back) says how to take them back. While you edit a date, caption, tags or location in the [photo details sidebar](../viewing-photos.md#photo-details-sidebar), a line under the editor says whether that edit reaches the file. Photos imported from [Nextcloud](../library.md#nextcloud-integration) are never written to: LibrePhotos works on a local copy, which the next scan replaces when the file changes on the server, and nothing is uploaded back. Their edits stay in LibrePhotos. _Not released yet: up to 1.3.0, this setting was called `Synchronize metadata to disk`, it wrote no captions, tags or locations, and it did write into the local copies of Nextcloud photos._
- <Since version="1.4.0" /> `Write existing edits to files`, under the choice above, writes the edits you made before turning it on, which are only in LibrePhotos, with **Write now**. It writes what your photos carry: ratings above 0, dates and locations you set by hand, rotations, captions you wrote, tags (as keywords) and, with `Write face tags to image files` on, face tags. A photo without any of these gets no write and no new sidecar. The sentence above the button names the kinds and the number of photos; the dialog before it starts lists each kind with its count. Into sidecars it is a plain confirm; into media files it asks in red, because your originals change. It runs as a **Write Metadata to Files** job: the row shows how far it got, and the job list has the photos that could not be written. The button waits while `Write edits to files` is `Off` or has a change you have not saved. See [Writing the edits of a whole library](../exif-data.md#writing-the-edits-of-a-whole-library).
- `Rating style` (not released yet) picks how you rate photos on the web. Default `Favorites`.
  - `Favorites`: one star toggle. Adding a favorite sets the photo's rating to the minimum rating below; removing a favorite sets the rating to 0. That also clears a star rating the photo had, for example a 5-star rating from Lightroom or digiKam, and with `Write edits to files` on, the 0 is written to the file too.
  - `Stars`: rate photos with 1 to 5 stars in the photo viewer (keys `0` to `5`) and on the photo page, see their stars on the grid, and set them for a selection with **Set rating**. The favorite toggle is gone in this mode, so a rating only changes when you set it. See [Rating photos with stars](../viewing-photos.md#rating-photos-with-stars).
- `Minimum image rating to interpret as favorite` will change how favorites are read and saved. EXIF only supports the rating field and does not have a favorite field. In `Stars` mode it still decides which photos the Favorites page and the timeline's favorites filter show. Default `4`
- `Default timezone` is used by the [date rules](./date-rules) that say "in user default timezone" (for example video creation times, which cameras store in UTC, and file times), and to decide which day [Memories](../memories.md) counts as today. It does not change how dates are displayed, and LibrePhotos never writes it to your files. Changing it does not re-date photos already in your library: click **Apply** under **Dates** on the Library page afterwards ([Applying the rules](./date-rules.md#applying-the-rules); not released yet), or run **Rescan**. Default `UTC`

### Set date & time parsing rules

Here you can set how timestamps are parsed. You can find more information [here](./date-rules)

### Set burst detection rules

Below the date and time rules is a **Burst Detection Rules** editor. It defines the ordered list of rules used when [stack detection](../stacks-and-file-variants.md) looks for burst sequences — photos taken in rapid succession.

Rules fall into two categories, shown as a **Hard** or **Soft** badge:

- **Hard** rules are deterministic and enabled by default: `EXIF Burst Mode Tag`, `EXIF Sequence Number` and `Filename Burst Pattern` (for names such as `IMG_001_BURST001` or `photo (1)`).
- **Soft** rules are estimates and are present but disabled by default: `Timestamp Proximity` (photos within about two seconds from the same camera) and `Visual Similarity` (visually similar consecutive photos).

For each rule you can toggle it on or off, delete it, or drag it to reorder the list. **Add Rule** opens a searchable catalogue of further rules — including `Filename Burst Suffix Only`, `Custom Filename Pattern` and a looser `Timestamp Proximity (Loose)` (about five seconds, any camera). **Reset to Defaults** restores the default set. Each rule's parameters are fixed and shown for reference only; there is no parameter editor here.

### Experimental options

Always transcode videos converts every video to H.264 as you play it, including the ones your browser could have played as they are. You rarely need it: a video your browser cannot play is converted anyway, without this switch (see [Videos your browser cannot play](../viewing-photos.md#videos-your-browser-cannot-play)). Conversions are capped at 720 lines, so turning this on also means watching a 4K video at 720p.

The first time you play a video that is being converted, it is converted as it plays. A conversion happening live has no known length, so that first play has no duration and cannot be sought — the scrub bar and the seek shortcuts do nothing, and the player says so. Once you are done watching, that same conversion is written to a file in the background — afterwards rather than at the same time, so it never slows down the video you are watching — and every later play of that video is served from it: an ordinary video with a duration, a working scrub bar and working seek keys.

Converted copies are kept under `protected_media/transcoded/` and cost somewhere between 10 and 20 MB per minute of video, depending on how much movement there is in it. The store is capped and prunes the videos you have not watched for longest; an administrator can change the ceiling, or turn the whole thing off, with [`TRANSCODE_CACHE_MAX_GB`](../../installation/environment-variables.md#cached-video-conversions).

### Caption Context

These switches tell the captioning model what LibrePhotos already knows about a photo, so the caption can say who is in it and where it was taken. All are on by default.

- `Tell the captioning model what LibrePhotos knows about a photo` turns the context on. Default `On`
- `Use the names of recognised people in captions` includes the name of a recognised person in the prompt so it can appear in the caption. Only available while the switch above is on. Default `On`
- `Mention where the photo was taken in captions` includes the photo's geocoded location in the prompt. Only available while the switch above is on. Default `On`

See [Image Captioning](../image-captioning.md) for the captioning model itself.

### Slideshow Options

- `Slideshow interval` sets the time in seconds between photos when using slideshow mode in the lightbox.

### Face Options

Most of these settings control how [face clustering](../face-recognition.md) groups the faces in your library, which is what you work with when labelling people. How sure a suggested match must be is set on the face dashboard with its **% confident** filter, not here.

- `Minimum Cluster Size` changes how clusters form; a smaller value results in more clusters. Options are `Auto`, `2`, `4`, `8` and `16`. Default `Auto`, which lets LibrePhotos choose for you.
- `Minimum Samples` changes how conservative clustering is; a smaller value is less conservative. Options are `1`, `2`, `4`, `8` and `16`. Default `1`
- `Cluster Selection Epsilon` merges clusters whose faces are this close; a higher value merges more of one person's clusters, and `Very High` can also join look-alikes such as siblings. Options are `Off` (0), `Small` (0.9), `Normal` (0.95), `High` (1.0) and `Very High` (1.05), distances between face encodings scaled to length 1 (two photos of one person are about 0.9 apart). Default `Normal`. (Not released yet: up to 1.3.0 the options were 0.025 to 0.2, too small to merge anything at all. A saved choice keeps its name when you update.)
- `Write face tags to image files` when enabled, a photo's faces are written as XMP MWG-RS region tags to a sidecar file or to your image files, as chosen under `Write edits to files`, whenever you label, add, delete or restore a face (with that setting `Off` the switch is disabled and nothing is written), so face data stays portable across apps like Lightroom, digiKam and XnView. The names of the people are added to the photo's keywords. See [Face regions](../exif-data.md#face-regions). Default `Off`

### Public Sharing Defaults

These switches decide what public links show. Photo links always use them, including links you already created, so turning one off hides that detail on every public photo link at once. Album links use them unless the album's own link settings override them. All are off by default.

- `Share photo timestamps`: show when photos were taken.
- `Share location information`: show where photos were taken.
- `Share camera information`: show the camera make, model and settings.
- `Share captions`: show photo descriptions.
- `Share detected faces`: show the people recognised in photos.

### Duplicate Detection

These are your personal defaults for the **Detection Options** dropdown on the Duplicates page — they pre-fill that dropdown before you click **Detect Duplicates**, rather than running anything on their own. See [Duplicate Detection](../duplicate-detection.md) for the review workflow.

- The **Visual sensitivity** default controls how aggressively visual duplicates are matched: `Strict` (fewest matches, highest confidence), `Normal` (the balanced default) or `Loose` (most matches, but may include false positives). Default `Normal`
- The **Clear pending duplicates** default determines whether previously pending duplicate results are cleared before a new detection run starts. Default `Off`

## Admin Area

These are settings that apply to the whole instance. Besides the panels below, the Admin Area also hosts the **Services** and **Server Logs** panels, documented in [Library Management](../library.md).

## Site Settings

- `Allow user registration` will enable a sign up button on the login page.
- `Allow uploads` sets if uploading should be possible or not
- `Skip patterns` Comma delimited list of patterns to ignore (e.g. '@eaDir,#recycle' for synology devices)
- `Missing photos limit` (not released yet) The largest share of one user's photos that a scan may mark missing at once. Default `50%`. When more than this share of the photos, and more than 100 photos, would lose all their files, the scan changes nothing and its job fails with "... photos would be marked missing. Nothing was changed. Is the library mounted?". This protects the library when a disk or share is not mounted (see [Missing Photos](../missing-photos.md#when-a-scan-asks-is-the-library-mounted)). If you really removed most of a library, set it to `100%` (off), scan, and set it back.
- `Scan libraries automatically` (not released yet) Scans every user's library for new and changed files on a schedule: `Off` (the default), `Every hour`, `Every day` at a time, or `Custom` days at a time, in the server's time zone. A user whose scan is still running is skipped, so scans never pile up. A line under the setting says what the last run did and when the next one is. See [Auto scan](../auto-scan.md#scan-on-a-schedule).
- `Delete photos from the trash after` (not released yet) Days a photo stays in a user's trash before a daily task deletes it for good, together with its original files on disk. Default `0`, which never deletes anything on its own. Turning it on or shortening it first asks, with the number of photos the next cleanup would delete. See [Trash](../trash.md#deleting-photos-from-the-trash-automatically).
- `Map Provider` Select which geocoding service converts GPS coordinates into place names. Options are Nominatim (free, no key required), Mapbox, MapTiler, OpenCage, and TomTom.
- `API key for Map Provider` Only shown after you select a commercial provider (Mapbox, MapTiler, OpenCage, or TomTom), where it is required. It is not shown for Nominatim, which needs no key.
- `Map Tiles` Where the map background is loaded from. Options are PhotoPrism (the default), OpenStreetMap, or None to hide maps entirely. Opening a map reveals the approximate location of your photos to the selected provider. This is separate from the map **provider** above, which only affects reverse geocoding.
- `Captioning Model` `LFM2.5-VL` (the default) or `None` to turn automatic captioning off. See [Image Captioning](../image-captioning.md).
- `Text Recognition (OCR) Model` `None` (the default) keeps text recognition off. `PP-OCRv6 Tiny`, `PP-OCRv6 Small` or `PP-OCRv6 Medium` turn it on, after a confirmation, because all readable text of every photo is then stored in the database. See [Text Recognition (OCR)](../text-recognition.md).
- `Face Recognition Model` Select which [InsightFace](https://github.com/deepinsight/insightface) model is used to detect and recognise faces. Options:
  - **buffalo_sc** — Lightweight model (default). Fastest and smallest, a good fit for most setups.
  - **buffalo_s** / **buffalo_m** / **buffalo_l** — Progressively larger and more accurate, at the cost of more memory and compute.
  - **antelopev2** — High-accuracy model for the best recognition quality.

  Saving a new model queues a **Download models** job immediately (if the model pack is not already present). Only faces encoded *after* the switch use the new model — existing faces keep the embeddings they were created with. **Train faces** does not re-encode them; it only generates embeddings for faces that have none yet and then re-clusters. For this reason, choose a model before your first face scan: switching later leaves your library comparing embeddings produced by two different models. See [Face recognition](../face-recognition.md).

### Features

_Not released yet._ Below the Site Settings card, the **Features** card has one switch per optional feature: Face detection, Face clustering, Image captioning, Things, Place names and Videos. Switch off what you do not need to make scans faster; what a feature already made (faces, names, captions, Things, place names) stays. A switch saves at once. A switch that the server's `FEATURE_*` environment variable turned off is disabled and marked **Locked**. For a feature that runs on a model, a line under the switch says whether the model is ready or shows its download. See [Feature Toggles](../feature-toggles.md#site-settings-switches).

### Email (SMTP)

Below the Features card is an **Email (SMTP)** card that configures outgoing e-mail. Outgoing e-mail must be set up here, or the **Forgot your password?** flow silently does nothing (the server logs the failure but never reveals whether an address exists).

- `Provider` chooses how mail is sent: `Disabled`, `Custom SMTP server`, `SendGrid`, `Mailgun`, `Postmark`, `Brevo`, `SMTP2GO` or `Amazon SES`. The hosted providers use built-in server presets, so you only supply a `From address`, `Username` and API key. `Custom SMTP server` (and `Amazon SES`, for the host) additionally shows the `SMTP host`; `Custom SMTP server` also shows `Port`, `Use STARTTLS` and `Use implicit SSL`.
- `From address` is the address mail is sent from.
- `Username` is the login for the provider. For SendGrid, leave this blank — it uses the literal username `apikey`.
- `Password / API key` is write-only: it is encrypted before it is stored and never returned by the API. Leaving the field blank keeps the existing credential unchanged; use **Remove the stored credential** to delete it (it asks first, since most providers refuse to send mail, password reset links included, until a credential is entered again).
- **Send test email** sends a test message to your own account's e-mail address to check the configuration end to end. It stays disabled until the configuration is valid.

## Admin Tools

- **Delete all auto created albums** removes every automatically generated event album in one step. Your photos are not affected.
- **Download Server Stats** saves a `serverstats.json` report — see [Server Stats](../library.md#server-stats) for what it contains.
- **Remove photo details from old thumbnails** starts a job that removes the location and other photo details from thumbnails made by LibrePhotos 1.2.1 or older. Your photos are not changed. While it runs, the row shows how far it got and links to the job. See [After upgrading from 1.2.1 or older](../../installation/upgrading.md#strip-thumbnail-metadata). Not released yet: up to 1.3.0, this tool is not in the Admin Area.
- **Look up place names again** asks the current Map Provider for the place of every photo with a location, for every user, after a confirmation, for example after switching to ExifTool. Places albums under the old names end up empty. With an online provider it can take hours. See [Switching the provider](../places.md#switching-the-provider). <Since version="1.4.0" /> Up to 1.3.0, switching the provider never renamed photos already named.

## Users

The admin can change here the scan directory, upload folder and password for users, or add new users to the system. Deleting a user keeps their photos and albums under a placeholder account, turns off their public links and removes nothing from disk. See [Managing users](../managing-users.md#deleting-a-user).

### Worker Logs

Shows how far jobs are progressed. For more information, go [here](../job-system)

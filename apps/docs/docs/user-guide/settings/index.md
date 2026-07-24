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

### Scan Confidence

This setting affect how much certainty is needed for a tag to be added to a picture. Default `Standard`

### Semantic Search

If you set this to `Top 100`,`Top 50`, `Top 10` you will get semantic search results instead of just looking at the EXIF data. It is disabled as default, because the first search takes a minute to get a response. After that it is fast. Default `Disabled`. For more information, see [Search](../search.md).

### Metadata Options

- `Synchronize metadata to disk` can enable the saving of the metadata to file or an xmp file. Default `Off`
- `Minimum image rating to interpret as favorite` will change how favorites are read and saved. EXIF only supports the rating field and does not have a favorite field. Default `4`
- `Default timezone` sets how the exif timestamps should be read and written. Default `UTC`

### Set date & time parsing rules

Here you can set how timestamps are parsed. You can find more information [here](./date-rules)

### Set burst detection rules

Below the date and time rules is a **Burst Detection Rules** editor. It defines the ordered list of rules used when [stack detection](../stacks-and-file-variants.md) looks for burst sequences — photos taken in rapid succession.

Rules fall into two categories, shown as a **Hard** or **Soft** badge:

- **Hard** rules are deterministic and enabled by default: `EXIF Burst Mode Tag`, `EXIF Sequence Number` and `Filename Burst Pattern` (for names such as `IMG_001_BURST001` or `photo (1)`).
- **Soft** rules are estimates and are present but disabled by default: `Timestamp Proximity` (photos within about two seconds from the same camera) and `Visual Similarity` (visually similar consecutive photos).

For each rule you can toggle it on or off, delete it, or drag it to reorder the list. **Add Rule** opens a searchable catalogue of further rules — including `Filename Burst Suffix Only`, `Custom Filename Pattern` and a looser `Timestamp Proximity (Loose)` (about five seconds, any camera). **Reset to Defaults** restores the default set. Each rule's parameters are fixed and shown for reference only; there is no parameter editor here.

### Experimental options

Always transcode videos will transcode all videos on demand to h264 to improve compatibility. This is not yet well optimized.

### Large Language Model Settings

These switches enhance generated captions with the large language model an administrator selects in the Admin Area (`Large Language Model`). If that is set to `None`, the switches have no effect. All are off by default.

- `Enable Large Language Model For Captions` turns on LLM post-processing of image captions. Default `Off`
- `Add Persons to the Captions` includes the name of a recognised person in the prompt so it can appear in the caption. Only available while the switch above is on. Default `Off`
- `Add Locations to the Captions` includes the photo's location in the prompt. Only available while the switch above is on. Default `Off`

See [Image Captioning](../image-captioning.md) for the captioning model itself.

### Slideshow Options

- `Slideshow interval` sets the time in seconds between photos when using slideshow mode in the lightbox.

### Album Options

- `Inferred faces confidence` set the value, which inferred faces need to have to be shown in person albums.

### Face Options

Most of these settings control how [face clustering](../face-recognition.md) groups the faces in your library, which is what you work with when labelling people.

- `Minimum Cluster Size` changes how clusters form; a smaller value results in more clusters. Options are `Auto`, `2`, `4`, `8` and `16`. Default `Auto`, which lets LibrePhotos choose for you.
- `Minimum Samples` changes how conservative clustering is; a smaller value is less conservative. Options are `1`, `2`, `4`, `8` and `16`. Default `1`
- `Cluster Selection Epsilon` determines which clusters get merged; a higher value merges more clusters. Options are `Off` (0), `Small` (0.025), `Normal` (0.05), `High` (0.1) and `Very High` (0.2). Default `Normal`
- `Confidence when Matching Unknown - Other Faces` a confidence level between 0 and 1. Faces in the "Unknown - Other" group are matched to a named person only when the confidence is higher than this value; `0` disables the feature. Default `0.50`
- `Write face tags to image files` when enabled, face labels are written as XMP MWG-RS region tags to your image files (or to a sidecar file, depending on `Synchronize metadata to disk`) whenever you label a face, so face data stays portable across apps like Lightroom, digiKam and XnView. Default `Off`

### Public Sharing Defaults

Configure default visibility settings for publicly shared albums. These defaults apply to all new public album shares but can be overridden per-album:

- `Show location` - Whether to display photo location data
- `Show camera info` - Whether to display camera/lens information
- `Show timestamps` - Whether to display photo timestamps
- `Show captions` - Whether to display photo captions
- `Show faces` - Whether to display recognized faces

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
- `Map Provider` Select which geocoding service converts GPS coordinates into place names. Options are Nominatim (free, no key required), Mapbox, MapTiler, OpenCage, and TomTom.
- `API key for Map Provider` Only shown after you select a commercial provider (Mapbox, MapTiler, OpenCage, or TomTom), where it is required. It is not shown for Nominatim, which needs no key.
- `Map Tiles` Where the map background is loaded from. Options are PhotoPrism (the default), OpenStreetMap, or None to hide maps entirely. Opening a map reveals the approximate location of your photos to the selected provider. This is separate from the map **provider** above, which only affects reverse geocoding.
- `Captioning Model` Select which AI model to use for image captioning. See [Image Captioning](../image-captioning.md).
- `Large Language Model` Select which LLM to use for enhanced captioning (None, Mistral, Moondream). When set to "None", no LLM models will be downloaded.
- `Tagging Model` Select which AI model to use for auto-tagging photos. Options:
  - **Places365** — Scene recognition (default). Classifies photos into scene categories like "kitchen", "beach", "forest".
  - **SigLIP 2** — Google's vision-language model using zero-shot classification against a curated vocabulary of 900+ real-world photo tags. Returns the top 10 most relevant tags.
  
  Switching models does not delete previously generated tags. Each model's tags are stored independently, so you can switch back and forth without rescanning.
- `Face Recognition Model` Select which [InsightFace](https://github.com/deepinsight/insightface) model is used to detect and recognise faces. Options:
  - **buffalo_sc** — Lightweight model (default). Fastest and smallest, a good fit for most setups.
  - **buffalo_s** / **buffalo_m** / **buffalo_l** — Progressively larger and more accurate, at the cost of more memory and compute.
  - **antelopev2** — High-accuracy model for the best recognition quality.

  Saving a new model queues a **Download models** job immediately (if the model pack is not already present). Only faces encoded *after* the switch use the new model — existing faces keep the embeddings they were created with. **Train faces** does not re-encode them; it only generates embeddings for faces that have none yet and then re-clusters. For this reason, choose a model before your first face scan: switching later leaves your library comparing embeddings produced by two different models. See [Face recognition](../face-recognition.md).

### Email (SMTP)

Directly below the Site Settings card is an **Email (SMTP)** card that configures outgoing e-mail. Outgoing e-mail must be set up here, or the **Forgot your password?** flow silently does nothing (the server logs the failure but never reveals whether an address exists).

- `Provider` chooses how mail is sent: `Disabled`, `Custom SMTP server`, `SendGrid`, `Mailgun`, `Postmark`, `Brevo`, `SMTP2GO` or `Amazon SES`. The hosted providers use built-in server presets, so you only supply a `From address`, `Username` and API key. `Custom SMTP server` (and `Amazon SES`, for the host) additionally shows the `SMTP host`; `Custom SMTP server` also shows `Port`, `Use STARTTLS` and `Use implicit SSL`.
- `From address` is the address mail is sent from.
- `Username` is the login for the provider. For SendGrid, leave this blank — it uses the literal username `apikey`.
- `Password / API key` is write-only: it is encrypted before it is stored and never returned by the API. Leaving the field blank keeps the existing credential unchanged; use **Remove the stored credential** to delete it.
- **Send test email** sends a test message to your own account's e-mail address to check the configuration end to end. It stays disabled until the configuration is valid.

## Admin Tools

- **Delete all auto created albums** removes every automatically generated event album in one step. Your photos are not affected.
- **Download Server Stats** saves a `serverstats.json` report — see [Server Stats](../library.md#server-stats) for what it contains.

## Users

The admin can change here the scan directory and password for users, or add new users to the system.

### Worker Logs

Shows how far jobs are progressed. For more information, go [here](../job-system)

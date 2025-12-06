---
title: "🔧 Settings"
excerpt: "Short explainer where the settings are"
sidebar_position: 4
---

There are three kinds of settings at the moment.

## Profile

You can find your profile settings by clicking in the top right corner and click on `Profile`.

Here you can change your name, photo, e-mail address and preferences regarding thumbnail size, dark mode and language. You can also set if you want your profile to be accessible globally or not.

- `Avatar`, `First name`, `Last name` will be shown if you share pictures with other users or when your profile is publically accessible
- `E-mail` is not used at the moment.
- `Change password` is for changing your password
- `Thumbnail size` will change the size of the pictures in the timeline view
- `Dark mode` will change the theme from light to dark
- `Language` will change the settings
- `Public Sharing` will set if you can be found globally

## Settings

These settings are user specific and will affect how scanning and saving works. At the bottom, you can also find experimental settings.

### Scan Confidence

This setting affect how much certainty is needed for a tag to be added to a picture. Default `Standard`

### Semantic Search

If you set this to `Top 100`,`Top 50`, `Top 10` you will get semantic search results instead of just looking at the EXIF data. It is disabled as default, because the first search takes a minute to get a response. After that it is fast. Default `Disabled`

### Metadata Options

- `Synchronize metadata to disk` can enable the saving of the metadata to file or an xmp file. Default `Off`
- `Minimum image rating to interpret as favorite` will change how favorites are read and saved. EXIF only supports the rating field and does not have a favorite field. Default `4`
- `Default timezone` sets how the exif timestamps should be read and written. Default `UTC`

### Set date & time parsing rules

Here you can set how timestamps are parsed. You can find more information [here](./date-rules)

### Experimental options

Always transcode videos will transcode all videos on demand to h264 to improve compatibility. This is not yet well optimized.

### Album Options

- `Inferred faces confidence` set the value, which inferred faces need to have to be shown in person albums.

## Admin Area

These are settings that apply to the whole instance.

## Site Settings

- `Allow user registration` will enable a sign up button on the login page.
- `Allow uploads` sets if uploading should be possible or not
- `Skip patterns` Comma delimited list of patterns to ignore (e.g. '@eaDir,#recycle' for synology devices)
- `Map API Provider` Select which geocoding service to use for converting GPS coordinates to place names. Options include Nominatim (free, no key required), Mapbox, MapTiler, OpenCage, and TomTom.
- `Map API Key` Required only if using a commercial geocoding provider (Mapbox, MapTiler, OpenCage, or TomTom). Not needed for Nominatim.

## Users

The admin can change here the scan directory and password for users, or add new users to the system.

### Worker Logs

Shows how far jobs are progressed. For more information, go [here](../job-system)

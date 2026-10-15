---
title: "📦 Importing a Google Takeout export"
description: "Bring your Google Photos library into LibrePhotos with its dates, locations and descriptions"
sidebar_position: 13.5
---

<Since version="1.4.0" /> Up to version 1.3.0 LibrePhotos skipped the JSON files of a Google Takeout
export, so photos whose own metadata was missing ended up without a date, location or description.

[Google Takeout](https://takeout.google.com) exports your Google Photos library as zip files. Next
to each photo or video it puts a small JSON file with what Google Photos knew about it: when it
was taken, where, and the description you gave it there. Many exported files lack some of that in
their own metadata: screenshots and images saved from other apps never had it, and a location or
date you changed in Google Photos lives only in the JSON.

LibrePhotos reads these JSON files during the scan. It never changes your photos: the JSON is one
more, lowest-priority source next to the file's own metadata.

## Importing an export

1. Export **Google Photos** from [Google Takeout](https://takeout.google.com) and download every zip
   file of the export.
2. Unzip them all into one folder inside your library (your user's scan directory, see
   [Library Management](./library.md)), for example `Takeout`. Keep each JSON file next to its
   photo: LibrePhotos finds the JSON by its name and its folder.
3. Run a **Scan** on the **Library** page.

You do not need to run a tool that copies the JSON values into the files first.

## What is read

| In LibrePhotos | From the JSON | When |
| --- | --- | --- |
| Date and time | `photoTakenTime` | When none of the file's own tags has a date. The JSON's time is in UTC and is shown in the time zone of the photo's position, or in your **Default timezone** when it has none (see [Date rules](#the-date-rules)). It wins over a date in the file name. |
| Location | `geoData`, else `geoDataExif` | When the file has no GPS position. A position of `0, 0`, which Google writes for "no location", is ignored. The place name is then looked up as for any photo. |
| Altitude | the altitude of the same position | With the location from the JSON. |
| Caption | `description` | When the file has no description of its own (XMP, IPTC and EXIF come first). It becomes the caption as a description in the file does, see [How a rescan treats your edits](./exif-data.md#how-a-rescan-treats-your-edits). |

A location or caption you set in LibrePhotos is kept, as for any photo. Albums, people, favorites
and the other fields of the JSON are not read. A JSON file larger than 512 KB or one that is not
valid JSON is skipped with a warning in the logs, and the scan goes on. A JSON without
`photoTakenTime`, such as an album's `metadata.json`, is not a photo's JSON and is ignored.

## How the JSON is found

Google names the JSON after the file, and LibrePhotos follows its naming:

- `IMG_1234.jpg.json`, or `IMG_1234.jpg.supplemental-metadata.json` in newer exports;
- for a long file name, the name before `.json` is cut to 46 characters, for example
  `IMG_20180214_171835513.jpg.supplemental-metada.json` or `PXL_20230715_181512345.PORTRAIT.ORIGINAL-01.jp.json`;
- for a second file of the same name, `IMG_1234(1).jpg`, the number moves to the end:
  `IMG_1234.jpg(1).json`;
- an edited copy, `IMG_1234-edited.jpg`, uses the JSON of the original, `IMG_1234.jpg.json`.

A file whose JSON cannot be told apart from another file's (two long names that Google cut to the
same text) gets none, so no photo takes the date of another.

## Changing the JSON later

A scan reads a photo again when its JSON was changed or added after the last scan (by its
modified time), as it does for an XMP sidecar. Unzipping keeps the times the files had in the
export, so a JSON unzipped later can look older than that scan. To read every JSON again, use **Rescan** (the arrow next to **Scan**). The JSON
files are not photos: they do not show in your library and do not count as errors.

## The date rules

The JSON's date is read by two [date rules](./settings/date-rules.md#the-different-rule-types),
right before the file name rule:

- "Google Takeout JSON capture time in UTC + figure out timezone using GPS coordinates" (ID 20);
- "Google Takeout JSON capture time in user default timezone (can't find out actual timezone)" (ID 21).

New accounts have them. After the update, an account whose rule list is still the default one of
its LibrePhotos version gets them too; a list you changed (rules added, removed or moved) is left
as you set it: add the two rules with **Add Rule**, or use **Reset To Defaults**. For photos you
scanned before, use [Apply date rules to existing photos](./settings/date-rules.md#applying-the-rules)
for the dates, or **Rescan** for dates, locations and captions.

---
title: "© Copyright and licenses"
description: "Give your photos a copyright notice, a creator and a license, and tell visitors what they may do with them"
sidebar_position: 6.5
---

<Since version="1.5.0" /> Every photo has **rights**: a copyright notice, a creator and a license. They
say who made the photo and what others may do with it. LibrePhotos reads them from your files, lets
you set them for one photo or many, and can give new photos your own default.

## The licenses

A license is one of this fixed list. Each Creative Commons license links to its official deed on
creativecommons.org, which explains it in full.

| License | What others may do |
| --- | --- |
| **All rights reserved** | Look at the photo, but not reuse it without your permission. |
| **CC BY 4.0** | Share and adapt it, also commercially, if they credit you. |
| **CC BY-SA 4.0** | Share and adapt it, also commercially, if they credit you and share their adaptation under the same license. |
| **CC BY-NC 4.0** | Share and adapt it for non-commercial use, if they credit you. |
| **CC BY-NC-SA 4.0** | Share and adapt it for non-commercial use, if they credit you and share their adaptation under the same license. |
| **CC BY-ND 4.0** | Share it unchanged, also commercially, if they credit you. |
| **CC BY-NC-ND 4.0** | Share it unchanged for non-commercial use, if they credit you. |
| **CC0 1.0** | Anything, without asking or crediting: you give up your rights. |
| **Public domain** (Public Domain Mark 1.0) | Anything: the photo is free of known copyright, for example because it is very old. |

There is no free-text license and no field for your own license link: a link to a license always
goes to the deed above.

## The rights of one photo

Open a photo and the info panel (**i**) has a **Rights** section below the tags; the photo page has a
**Rights** card. It shows the license with its marks and a link to its deed (**What … allows**), the
copyright notice and the creator. A value marked **From file** is the one the photo's file states;
the others were set in LibrePhotos.

Click the pencil to edit them: **Copyright** (for example `© 2026 Anna Berger`), **Creator** and
**License**, then the check mark to save. Leaving a field empty removes it. Each change is recorded in
the photo's edit history and, with [Write edits to files](./exif-data.md#what-librephotos-writes) on,
written to the file or its sidecar.

A photo without any rights says so. If you set [default rights](#default-rights-for-your-photos),
the section offers **Use my default**, which fills in the photo's empty fields from it.

## The rights of many photos

Select photos, open **Photo actions** and pick **Set rights…**. The dialog shows the license, creator
and copyright the selected photos share. Where they differ, the field says
**Mixed: keep each photo's**. Only the fields you change are set; the others stay as each photo has
them, and a field you empty is removed from every photo.

`{year}` in the copyright becomes the year each photo was taken, so `© {year} Anna Berger` gives a
photo from 2019 `© 2019 Anna Berger` (a photo without a date gets the year it was added).

Values a photo's file states are kept, so a photo that came with someone else's copyright keeps it.
When some of the selected photos have rights from their files, the dialog offers
**Also change N photos whose rights come from their files** to replace those too.

## Default rights for your photos

**Settings > Metadata > Rights for your photos** holds a creator, a copyright notice (with
`{year}`) and a license, saved with your other settings.

- **New photos** get them when they are scanned, for each field their file does not state. This is
  recorded as your edit, but a scan never writes to your files: use
  [Write existing edits to files](./exif-data.md#writing-the-edits-of-a-whole-library) to put them
  there.
- **Photos you already have** keep their rights until you click **Apply to my photos…**. The dialog
  says how many photos it reaches and asks whether to **Only fill in what is missing** (a copyright,
  creator or license a photo already has stays) or change **Every photo**. Changing the default later
  does not change photos that already have it, so a published photo is never relicensed behind your
  back.

## In your files

LibrePhotos reads the rights from these tags, the first one a photo has:

| Field | Tags, best first |
| --- | --- |
| Copyright | `XMP:Rights`, `IPTC:CopyrightNotice`, `EXIF:Copyright` |
| Creator | `XMP:Creator`, `IPTC:By-line`, `EXIF:Artist` |
| License | `XMP-cc:License`, then `XMP-xmpRights:WebStatement` when it is a Creative Commons deed; `XMP-xmpRights:Marked` set to true without either is **All rights reserved** (Lightroom's "Copyrighted") |

A `WebStatement` that links to anything else, such as your own rights page, is not a license and is
left alone.

With [Write edits to files](./exif-data.md#what-librephotos-writes) on, a change is written back:

| Field | `Save to sidecar` | `Save to media file` |
| --- | --- | --- |
| Copyright | `XMP-dc:Rights` | `XMP-dc:Rights` and `EXIF:Copyright`, and `IPTC:CopyrightNotice` if the file already has IPTC data |
| Creator | `XMP-dc:Creator` | `XMP-dc:Creator` and `EXIF:Artist`, and `IPTC:By-line` if the file already has IPTC data |
| License | `XMP-cc:License` and `XMP-xmpRights:WebStatement` (the deed), `XMP-xmpRights:UsageTerms` (the license's name and deed), `XMP-xmpRights:Marked` (true, false for CC0 and the Public Domain Mark) | the same |

Lightroom, digiKam and other apps read these tags, so the license travels with the photo. A copyright
or creator is written on one line: line breaks become spaces.

A rescan keeps the rights you set in LibrePhotos, like your other edits, and **Restore from file**
takes them from the file again (see [How a rescan treats your edits](./exif-data.md#how-a-rescan-treats-your-edits)).

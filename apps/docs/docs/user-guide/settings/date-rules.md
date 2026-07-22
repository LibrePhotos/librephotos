---
title: "📅 Using date rules"
excerpt: "How to use the date rules"
sidebar_position: 4
---

## Background information

### Goal of the date rules

Most images have metadata for dates, but these are split in multiple places and around 10-20% of "real world" photos have incomplete data metadata. The configurable date time parser allows us to get these dates and display them nicely as the user wants it too.

### How does it work?

The logic for extracting local time is described as a list of rules that should be applied
one after another until one rule is able to extract date time (or until all rules are tried
without success).

If a rule can't fetch the time (e.g. the EXIF tag value is not present or the path doesn't match
the rule) then that rule is considered to be not applicable.

### Figuring out the timezone

Some sources of data might give us very rich information, e.g. timestamp + timezone,
but others only allow getting local time (without knowing real timestamp).

For historical reasons, it is expected to have a timestamp and a timezone.

In some cases, it is known that the local time the rule would obtain is not in the desired
timezone. E.g. video date time tag QuickTime:CreateDate is by standard written in UTC rather than local time. For such cases, each rule can optionally have setting "transform_tz" set to "1" - in that case this rule should also specify "source_tz" and "report_tz" settings where
"source_tz" is describing the timezone that the rule is getting and "report_tz" is describing
the timezone of the location where the photo/video was taken. Both "source_tz" and "report_tz"
should be one of the following:

- "utc" - UTC timezone
- "gps_timezonefinder" - the timezone of the GPS location associated with the photo/video - "name:<timezone_name>"
- the timezone with the name <timezone_name>

If either "source_tz" or "report_tz" could not be obtained, the rule is considered to be not applicable.

### What gets stored, and why times are not converted for you

Once a rule succeeds, LibrePhotos stores the **local time the camera recorded** — the time you would have read off the camera when you took the shot.

This is deliberate. A photo taken at 14:00 in Tokyo and one taken at 14:00 in Berlin are both shown as 14:00, because that is the time each one was actually taken. LibrePhotos does **not** re-cast your library into the timezone you happen to be browsing from; if it did, every photo would shift whenever you travelled, and photos from a holiday abroad would no longer line up with the day you remember them on.

:::note
Under the hood the local time is tagged as UTC before it is saved. That is an internal storage detail, not a claim that the photo was taken in UTC — it is what keeps the wall-clock time stable for every viewer. If you query the database directly, read the timestamps as-is and do not convert them.
:::

### The different rule types

Currently, supported rule types:

- "exif" - local time is taken using exif tag params["exif_tag"] as obtained with exiftool
- "path" - time is taken from the filename using a regular expression matching
- "fs" - time is taken from file property. Since these are UNIX timestamps without timezones
  they are always translated to local time using UTC.
- "user defined" - the date time defined by the user from the frontend

## How to use it

### Adding optional rules

To add a new rule, go to settings and navigate to the date time parsing rules. Click on the button "Add rule". You can now add optional rules like using the modified time or to create time from the file.

### Changing the order

The top rules will be applied first, and the bottom rules be applied last. To change the order, drag and drop one of the cards and save them by clicking on update.

### Applying the rules

The date rules are applied on each scan. If you changed the rules to your liking, click on "Rescan all Photos" and then the new rules will be applied.

Use **"Rescan all Photos"** specifically. An ordinary scan only looks at files that are new or whose contents changed since the last scan, so it will walk straight past a library that is already indexed and nothing will appear to happen. "Rescan all Photos" re-reads every file and re-runs the rules over all of them.

### Troubleshooting

**Every photo is off by the same number of hours.**

If your whole library is shifted by a constant amount — and that amount happens to match your own UTC offset — no date rule will fix it, because the rules are not what is wrong. This was a display bug: the times were stored correctly, but the web interface converted them into the timezone of the browser you were viewing from, so a viewer at UTC+3 saw every photo three hours late. It is fixed in current versions; update and reload the page, and the stored times will show as they always were. No rescan is needed.

**A rule change had no effect at all.**

Check that you used "Rescan all Photos" rather than a normal scan (see above), and that the rule you expect to win is above the one currently matching — the first rule that can produce a time is the one that is used. A rule that names an EXIF tag your files do not carry is silently skipped, so it is worth confirming the tag actually exists in your photos.

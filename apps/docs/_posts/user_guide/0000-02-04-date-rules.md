---
title: "📅 Using date rules"
excerpt: "How to use the date rules"
last_modified_at: 2022-03-23
category: 2
---

## Background information

### Goal of the date rules

Most images have metadata for dates, but these are split in multiple places and around 10-20% of "real world" photos have incomplete data metadata. The configurable date time parser allows us to get these dates and display them nicely as the user wants it too.

### How does it work?

The logic for extracting local time is described as a list of rules that should be applied
one after another until one rule is able to extract date time (or until all rules are tried
without success).

If a rule can't fetch the time (e.g. the exif tag value is not present or path doesn't match
the rule) then that rule is considered to be not applicable.

### Figuring out the timezone

Some sources of data might give us very rich information, e.g. timestamp + timezone,
but others only allow to get local time (without knowing real timestamp).

For historical reason it is expected to have a timestamp and a timezone.

In some cases it is known that the local time the rule would obtain is not in the desired
timezone. E.g. video datetime tag QuickTime:CreateDate is by standard written in UTC rather
than local time. For such cases each rule can optionally have setting "transform_tz" set to "1" - in that case this rule should also specify "source_tz" and "report_tz" settings where
"source_tz" is describing the timezone that the rule is getting and "report_tz" is describing
the timezone of the location where the photo/video was taken. Both "source_tz" and "report_tz"
should be one of the follwing:

- "utc" - UTC timezone
- "gps_timezonefinder" - the timezone of the GPS location associated with the photo/video - "name:<timezone_name>"
- the timezone with the name <timezone_name>

If either "source_tz" or "report_tz" could not be obtained the rule is considered to be not applicable.

### The different rule types

Currently supported rule types:

- "exif" - local time is taken using exif tag params["exif_tag"] as obtained with exiftool
- "path" - time is taken from the filename using a regular expression matching
- "fs" - time is taken from file property. Since these are unix timestamps without timezones
  they are always translated to local time using UTC.
- "user defined" - the date time defined by the user from the frontend

## How to use it

### Adding optional rules

To add a new rule, go to settings and navigate to the datetime parsing rules. Click on the button "Add rule". You can now add optional rules like using the modified time or the create time from the file.

### Changing the order

The top rules gets applied first and the bottom rules gets applied last. To change the order drag and drop one of the cards and save them by clicking on update.

### Applying the rules

The date rules are applied on each scan. If you changed the rules to your liking, click on "Rescan all Photos" and then the new rules will be applied

---
title: "📅 Using date rules"
description: "How to use the date rules"
sidebar_position: 1
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

### Dates you set by hand

A date you set by hand in a photo's info panel is not a rule: it always wins over every rule in
the list, on every scan and rescan, however you order or edit your rules. The info panel says
**Set by you** under such a date. To hand the photo back to the rules, open it, edit its date and
click **Remove timestamp**; the rules then decide its date again, so the photo keeps a date read
from its file if it has one. _Not released yet._ Up to version 1.3.0 a hand-set date only applied
through a rule called *Timestamp set by user*, and it stopped sticking once that rule was deleted
or moved below another; that rule is gone from every saved list after the update.

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
- "gps_timezonefinder" - the timezone of the GPS location associated with the photo/video
- "user_default" - the **Default timezone** set in your user settings; several of the built-in rules rely on this, including "Video creation datetime in user default timezone"
- "server_local" - the local timezone of the machine running LibrePhotos (in Docker this is normally UTC unless you set a `TZ` for the container)
- "name:&lt;timezone_name&gt;" - the timezone with the name &lt;timezone_name&gt;, e.g. "name:Europe/Berlin"

The settings UI only offers "gps_timezonefinder" and "user_default" for "report_tz"; the other values are accepted by the backend when a rule is edited directly.

If either "source_tz" or "report_tz" could not be obtained, the rule is considered to be not applicable.

### Videos

Videos keep their date in other tags than photos, and the default rules read three of them:

- **Phone videos** (iPhone, many Android phones) state the local time they were recorded at, with its UTC offset, in `QuickTime:CreationDate`. The rule "Local time from the video's QuickTime:CreationDate tag (phones)" uses that time as is, so no time zone has to be guessed. It is ranked above the rules that convert the UTC `QuickTime:CreateDate`.
- **Other MP4 and MOV files** only have the UTC `QuickTime:CreateDate`, converted with the time zone of the video's position or, without one, your default time zone.
- **MKV and WebM files** have a UTC `Matroska:DateTimeOriginal`, converted the same way by the two "MKV/WebM creation date" rules.

_Not released yet._ After the update, accounts whose rules still contain both "Get Video creation tag in UTC + figure out timezone using GPS coordinates" (ID 2) and "Video creation datetime in user default timezone" (ID 4) get the three new rules (IDs 17, 18 and 19) next to them; a list without either of those two is left as you set it, and **Reset To Defaults** adds them. Videos already in your library get the new dates with a **Rescan**.

### What gets stored, and why times are not converted for you

Once a rule succeeds, LibrePhotos stores the **local time the camera recorded** — the time you would have read off the camera when you took the shot.

This is deliberate. A photo taken at 14:00 in Tokyo and one taken at 14:00 in Berlin are both shown as 14:00, because that is the time each one was actually taken. LibrePhotos does **not** re-cast your library into the timezone you happen to be browsing from; if it did, every photo would shift whenever you travelled, and photos from a holiday abroad would no longer line up with the day you remember them on.

:::note
Under the hood the local time is tagged as UTC before it is saved. That is an internal storage detail, not a claim that the photo was taken in UTC — it is what keeps the wall-clock time stable for every viewer. If you query the database directly, read the timestamps as-is and do not convert them.
:::

### The different rule types

Currently, supported rule types:

- "exif" - local time is taken using exif tag params["exif_tag"] as obtained with exiftool.
  An XMP sidecar next to the photo wins over the file. For `EXIF:DateTimeOriginal` and
  `Composite:GPSDateTime` the sidecar is also read under its XMP name (`exif:DateTimeOriginal`,
  `exif:GPSTimeStamp`); any other EXIF tag in a rule is not looked up in the sidecar, so to use
  a property that only a sidecar holds, name its XMP tag directly (for example `XMP:<tag>`).
  _Not released yet._
- "path" - time is taken from the filename using a regular expression matching
- "filesystem" - time is taken from a file property. params["file_property"] must be "mtime"
  (file modified time) or "ctime" (file created time). Since these are UNIX timestamps without
  timezones they are always translated to local time using UTC.
- "user_defined" - the old *Timestamp set by user* rule. It no longer matches anything, since a
  date you set by hand always wins (see above), and the settings page no longer offers it.

## How to use it

### Adding optional rules

To add a new rule, go to settings and navigate to the date time parsing rules. Click on the **Add Rule** button. You can now add optional rules, such as using the file's modified or created time.

To remove a rule again, click the X (**Delete rule**) at the right-hand end of its row. The **Reset To Defaults** button next to **Add Rule** puts the list back to the rules LibrePhotos ships with; it is greyed out while your list already matches the default rules in their default order.

### Changing the order

The top rules are applied first and the bottom rules last. To change the order, drag and drop the rules. Adding, deleting, reordering and resetting rules only take effect once you save your settings — LibrePhotos prompts you with **Save changes?** and you confirm by clicking **Update**.

### Applying the rules

The date rules are applied on each scan. Once your rules are how you want them, open the **Library** page (from the profile menu in the top-right corner, choose **Library**; or press Ctrl+K and search for "Library"). In the **Scan Library** section, click the arrow next to the **Scan** button and choose **Rescan**. The same action is available from the command palette (Ctrl+K) as **Rescan All Photos**.

Use **Rescan** specifically, not a plain **Scan**. An ordinary scan only looks at files that are new or whose contents changed since the last scan, so it will walk straight past a library that is already indexed and nothing will appear to happen. **Rescan** re-reads every file and re-runs the rules over all of them.

### Troubleshooting

**Every photo is off by the same number of hours.**

If your whole library is shifted by a constant amount — and that amount happens to match your own UTC offset — no date rule will fix it, because the rules are not what is wrong. This was a display bug: the times were stored correctly, but the web interface converted them into the timezone of the browser you were viewing from, so a viewer at UTC+3 saw every photo three hours late. It is fixed in current versions; update and reload the page, and the stored times will show as they always were. No rescan is needed.

**A rule change had no effect at all.**

Check that you used **Rescan** rather than a normal scan (see above), and that the rule you expect to win is above the one currently matching — the first rule that can produce a time is the one that is used. A rule that names an EXIF tag your files do not carry is silently skipped, so it is worth confirming the tag actually exists in your photos.

**One particular photo ignores every rule.**

If you once corrected that photo's date by hand, LibrePhotos remembered it, and a date set by hand wins over every rule (the info panel shows **Set by you** under it). To hand the photo back to the rules, open it, edit its date and click **Remove timestamp**.

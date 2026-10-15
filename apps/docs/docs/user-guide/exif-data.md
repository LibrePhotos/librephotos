---
title: "📇 Exif Data"
description: "Which metadata LibrePhotos reads from your photos and their XMP sidecars, and what it writes back"
sidebar_position: 18
---

LibrePhotos reads a photo's metadata with [ExifTool](https://exiftool.org) when it scans the
photo: from the file itself and from the XMP sidecars next to it. What you change in LibrePhotos
(a date, a caption, tags, a location, a rating, a rotation, the people on a photo) is stored in
LibrePhotos' database. With **Settings → Metadata Options → Write edits to files** set to
`Save to sidecar` or `Save to media file`, some of these edits are also written back, so other
apps see them.

The tag names on this page are ExifTool's. A family 0 group such as `XMP:` matches every XMP
namespace, a family 1 group such as `XMP-dc:` one of them. To see what a file holds, run
`exiftool -G1 -a -s photo.jpg`. Some names differ from the EXIF standard: ExifTool calls ISO
`EXIF:ISO` (not `ISOSpeedRatings`), the 35 mm focal length `EXIF:FocalLengthIn35mmFormat` (not
`FocalLengthIn35mmFilm`) and the EXIF `DateTime` tag `EXIF:ModifyDate`.

:::info
<Since version="1.4.0" /> Much of this page is new. Up to 1.3.0:

- the setting was called **Synchronize metadata to disk**. It wrote ratings, dates, face regions
  and rotations, but never captions, locations or tags, and rotations never reached a sidecar.
  In a HEIC, AVIF or RAW original it wrote a wrong orientation, often the opposite turn;
- a scan wrote a rating it found in a file back to disk, which in sidecar mode created an `.xmp`
  holding just that rating (harmless, unless the rating is later changed in the original by
  another app);
- a write always went to `IMG.xmp`, even next to an existing `IMG.jpg.xmp`, and a failed write
  looked like a success;
- face regions of rotated photos were written in the wrong place, adding person names replaced the
  photo's keywords, and deleting a face left its region in the file;
- a sidecar's date, position and camera (its `exif:`, `tiff:` and `exifEX:` properties) and the
  sidecar of a photo's RAW or video file were not read, nor were the IPTC and EXIF captions, the
  title, creator and copyright, the `PersonInImage` and `HierarchicalSubject` keywords, the camera
  and lens maker, the serial number and the other exposure fields, the altitude, and the date and
  camera of MKV, WebM and phone videos;
- shutter speeds faster than about 1/2000 s were stored as `0`, and photos and videos turned a
  quarter by their orientation were stored at their unturned size (the update fixes the size);
- a photo with a sidecar was stored with the file size of the sidecar, shown in Info.

After the update, a **Rescan** from the Library page reads the new fields of the photos already in
your library. `python manage.py save_metadata --types face_tags` rewrites the face regions of
photos written by an older version, and `python manage.py refresh_exposure_time` reads just their
shutter speeds again.
:::

## What LibrePhotos reads

Where a field lists several tags, the first one the photo has is used.

| In LibrePhotos | Tags, best first | Notes |
| --- | --- | --- |
| Date and time | `XMP:DateCreated`, `EXIF:DateTimeOriginal`, `EXIF:ModifyDate`, `QuickTime:CreationDate`, `QuickTime:CreateDate`, `Matroska:DateTimeOriginal`, `Composite:GPSDateTime`, then the file name | Decided by your [date rules](./settings/date-rules.md), in the order of your list; this is the default order. A date you set by hand wins over every rule. `QuickTime:CreationDate` is the local time a phone recorded a video at; `QuickTime:CreateDate` (MP4, MOV), `Matroska:DateTimeOriginal` (MKV, WebM) and `Composite:GPSDateTime` are UTC and are converted with the time zone of the photo's position, or else your default time zone. `XMP:DateCreated` is where LibrePhotos writes dates. Accounts created before 1.1.0 do not have its rule unless they add it with **Add Rule** or **Reset To Defaults**. <Since version="1.4.0" /> Between the tags and the file name, a [Google Takeout JSON](./google-takeout.md) next to the file gives the date. |
| Location | `Composite:GPSLatitude`, `Composite:GPSLongitude` | ExifTool builds them from the EXIF GPS block, the embedded XMP or a video's `GPSCoordinates`. The place name (city, country) is looked up from the position. <Since version="1.4.0" /> A file without a position takes the one in its [Google Takeout JSON](./google-takeout.md), if it has one. |
| Altitude | `Composite:GPSAltitude` | In metres, negative below sea level, stored in the photo's metadata. |
| Rating, favorite | `Rating` | Without a group ExifTool answers with `XMP-xmp:Rating` or the EXIF `Rating`. A photo rated at least **Minimum image rating to interpret as favorite** is a favorite. |
| Tags | `XMP:Subject`, `IPTC:Keywords`, `XMP:PersonInImage`, `XMP:HierarchicalSubject` | All four are merged, and each keyword becomes a tag with a small file icon. Of a hierarchical keyword (Lightroom, digiKam, darktable) the last level counts: `Places\|USA\|San Francisco` adds `San Francisco`. The `XMP-iptcExt:PersonInImage` names become tags, not people: people come from face regions. |
| Caption | `XMP:Description`, `XMP:Description-*`, `IPTC:Caption-Abstract`, `EXIF:ImageDescription` | The description's default-language entry first, else any language entry, then the IPTC caption (older Photoshop and Lightroom, Picasa, newsroom tools), then the EXIF one. Text cameras put there, such as `OLYMPUS DIGITAL CAMERA` or `SONY DSC`, and a description that only repeats the camera model are skipped. <Since version="1.4.0" /> Without any of them, the `description` of a [Google Takeout JSON](./google-takeout.md) next to the file. |
| Title | `XMP:Title`, `XMP:Headline`, `IPTC:ObjectName` | Stored in the photo's metadata (`/api/photos/{id}/metadata/`). |
| Creator | `XMP:Creator`, `IPTC:By-line`, `EXIF:Artist` | The first name when there are several. Stored in the photo's metadata. |
| Copyright | `XMP:Rights`, `IPTC:CopyrightNotice`, `EXIF:Copyright` | Stored in the photo's metadata. |
| Faces and people | `XMP:RegionInfo` | MWG face regions (`XMP-mwg-rs:RegionInfo`) with normalized areas. A region with a name becomes a face of the person of that name. LibrePhotos' own face detection runs as well; a detected face that overlaps a region is the same face. |
| Orientation | `EXIF:Orientation`; for HEIC and AVIF `QuickTime:Rotation` and `QuickTime:Mirroring` | An orientation of 5 to 8 turns the photo a quarter, so its width and height are swapped. A HEIC or AVIF photo is shown under its `irot` and `imir` properties, which ExifTool reports as `QuickTime:Rotation` and `QuickTime:Mirroring`, whatever its EXIF orientation says. Face regions are placed with the same orientation. |
| Width, height | `ImageWidth`, `ImageHeight`; for videos also `Composite:Rotation` | The size the photo is shown at, used for its aspect ratio. A video recorded upright on a phone is stored landscape with a rotation of 90 or 270 degrees; its width and height are swapped. |
| Video length | `QuickTime:Duration`, `Matroska:Duration` | MKV and WebM files carry no `QuickTime:Duration`. |
| Camera | `EXIF:Make`, `EXIF:Model`; for videos `QuickTime:Make`, `QuickTime:Model` | Info shows the maker in front of the model ("Fujifilm X-T5"), unless the model already starts with it ("NIKON D850", not "NIKON CORPORATION NIKON D850"). Corporate words at the end of a maker's name are left out there ("OLYMPUS IMAGING CORP." shows as "OLYMPUS"). |
| Lens | `EXIF:LensMake`, `EXIF:LensModel` | Shown like the camera. |
| Exposure | `EXIF:FNumber`, `EXIF:ExposureTime`, `EXIF:ISO`, `EXIF:FocalLength`, `EXIF:FocalLengthIn35mmFormat` | Shown in Info. The shutter speed is shown the way ExifTool prints it: `1/4000` up to a quarter second, then seconds (`0.3 s`, `2.5 s`, `30 s`). |
| More exposure details | `EXIF:ExposureCompensation`, `EXIF:Flash`, `EXIF:MeteringMode`, `EXIF:WhiteBalance`, `EXIF:SubjectDistance`, `EXIF:DigitalZoomRatio` | Stored in the photo's metadata; metering mode and white balance under the names ExifTool prints (Multi-segment, Auto, ...). Subject distance and digital zoom are shown under **Show more** in Info; 0, which EXIF uses for "unknown" and "not used", is left empty. |
| Camera serial number | `EXIF:SerialNumber` | Stored in the photo's metadata, not shown in Info. |
| Colour space, bit depth | `EXIF:ColorSpace`, `File:BitsPerSample` | Stored in the photo's metadata. The bit depth is read from JPEG files only. |
| File size | `File:FileSize` | Shown in Info. Read from the photo file, never from a sidecar. |
| Bursts | `EXIF:SubSecTimeOriginal`, `EXIF:ImageNumber`; `MakerNotes:BurstMode`, `MakerNotes:ContinuousDrive`, `MakerNotes:SequenceNumber` | Used by [stack detection](./stacks-and-file-variants.md) to find burst sequences. The `MakerNotes` tags are only read while the matching burst detection rule is on in your settings. |

## XMP sidecars

### Which sidecars are read

A sidecar is an `.xmp` file next to the photo. LibrePhotos reads both naming conventions, in lower
or upper case. For a photo `IMG_2.jpg`, from the highest priority down:

1. `IMG_2.xmp`, then `IMG_2.XMP` (Lightroom, LibrePhotos up to 1.3.0);
2. `IMG_2.jpg.xmp`, then `IMG_2.jpg.XMP` (digiKam, darktable, Immich, LibrePhotos from the next
   release);
3. the sidecars named after the photo's other files, such as `IMG_2.CR2.xmp` for the RAW file of a
   RAW+JPEG pair, or the video of a Live Photo;
4. other `.xmp` files the scan grouped with the photo;
5. the photo file itself.

Each tag is taken from the highest one that has it, so one field can come from the sidecar and
the next from the photo. A keyword list in a sidecar replaces the photo's own `XMP:Subject`, for
example, while the photo's `IPTC:Keywords`, which a sidecar cannot hold, are still added to the
tags. On a file system that ignores case (Windows, macOS), `IMG_2.xmp` and `IMG_2.XMP` are the same
file and it is read once.

Apps that leave the original untouched (geotaggers, digiKam, darktable, Lightroom) store the EXIF
properties of a photo in the sidecar under XMP names. LibrePhotos reads these there:

| Field | Read from the sidecar as |
| --- | --- |
| `EXIF:DateTimeOriginal` | `exif:DateTimeOriginal` |
| `Composite:GPSLatitude`, `Composite:GPSLongitude` | `exif:GPSLatitude`, `exif:GPSLongitude` |
| `Composite:GPSDateTime` | `exif:GPSTimeStamp` |
| `EXIF:Make`, `EXIF:Model` | `tiff:Make`, `tiff:Model` |
| `EXIF:LensMake`, `EXIF:LensModel` | `exifEX:LensMake`, `exifEX:LensModel` |
| `EXIF:FNumber`, `EXIF:ExposureTime`, `EXIF:ISO`, `EXIF:FocalLength`, `EXIF:FocalLengthIn35mmFormat` | `exif:FNumber`, `exif:ExposureTime`, `exif:ISOSpeedRatings`, `exif:FocalLength`, `exif:FocalLengthIn35mmFilm` |
| `EXIF:ExposureCompensation`, `EXIF:MeteringMode`, `EXIF:WhiteBalance`, `EXIF:SubjectDistance`, `EXIF:DigitalZoomRatio` | `exif:ExposureBiasValue`, `exif:MeteringMode`, `exif:WhiteBalance`, `exif:SubjectDistance`, `exif:DigitalZoomRatio` |

The right column is how the properties are named inside the `.xmp` file; ExifTool shows them as
`XMP:DateTimeOriginal`, `XMP:GPSDateTime`, `XMP:ISO` and so on. The XMP fields (rating, keywords,
description, title, creator, copyright, `XMP:DateCreated`, face regions) are read from a sidecar
under their own names. A sidecar's modify date and orientation are never read: they describe the
last edit, not the photo, and a sidecar orientation must not turn LibrePhotos' thumbnails. Its
flash, colour space and serial number are not read either. Nor are the tags that describe a file
rather than the photo: the file size and bit depth (`File:` tags), and the width and height. Those
always come from the photo file, even when a RAW editor's sidecar holds the size of the RAW
(`tiff:ImageWidth`, `tiff:ImageLength`).

### Which sidecar is written

With **Write edits to files** set to `Save to sidecar`, an edit goes to the sidecar of the photo
file that already exists, so a digiKam or darktable sidecar is updated in place and keeps its other
tags. When both `IMG_2.xmp` and `IMG_2.jpg.xmp` exist, the edit goes to `IMG_2.xmp`, the one that is
read first (the backend log warns about it). When there is none, LibrePhotos creates
`IMG_2.jpg.xmp`, which other apps also read and which cannot be mistaken for the sidecar of a RAW
file next to the JPEG (`IMG_2.CR2`). The sidecar of a photo's RAW file (`IMG_2.CR2.xmp`) is read but
not written: the edit goes to the sidecar of the photo's main file, the JPEG.

A photo that up to 1.3.0 got an `IMG_2.xmp` next to an existing `IMG_2.jpg.xmp` keeps both:
LibrePhotos reads and writes `IMG_2.xmp`, and the other app keeps its own file.

## All metadata

_Not released yet._ To see every tag a photo's file carries, not just the fields above, open
**All metadata**: in the lightbox's info panel it is the link in the file row (next to the size),
on the photo page the button at the end of the **File** card. Only the photo's owner sees it.

The dialog asks ExifTool for every tag of the media file and of each XMP sidecar the scan reads
(see [Which sidecars are read](#which-sidecars-are-read)), one tab per file: the media file, then
the sidecars, highest priority first. Tags are grouped as ExifTool groups them (`IFD0`, `ExifIFD`,
`GPS`, the camera's maker notes, `XMP-dc`, `QuickTime`, ...), sorted by name within a group, and
their values read as in ExifTool's own output (`1/250`, `Horizontal (normal)`); embedded images and
other binary data show as `(Binary data N bytes)`. The maker notes start collapsed, since they can
be hundreds of tags.

- **Filter tags and values** narrows the list to the tags whose group, name or value contain the
  text, and says how many match.
- **Copy as JSON** copies the open tab's tags in the shape of `exiftool -json -G1`, ready to paste
  into an issue or a forum post.

The tags are read from the files when the dialog opens and are never stored; the file system
details (the server's folder, file permissions) are left out, and the file is named by its path
below your library folder. If the file is no longer on disk, the dialog says so: rescan its folder
or put the file back. This is the quickest way to find out why a date rule picked a tag, why a
sidecar value was or was not used, or which tag a camera writes a setting to.

For API clients: the photo detail response no longer carries the `exif_json` field, which was
always empty. The tags come from `GET /api/photos/{photo_id}/metadata/raw/` instead.

## What LibrePhotos writes

With `Off`, the default, LibrePhotos never writes to your files. A scan never writes either: it
only reads. With `Save to sidecar` or `Save to media file`, these edits are written after they are
saved in LibrePhotos. An edit of many photos at once (a rating, **Change date and time…**, a
location for a selection, renaming a tag) is written by a background job, so the files can lag the
library by a moment.

| Edit | `Save to sidecar` | `Save to media file` |
| --- | --- | --- |
| Rating and favorite, also from the mobile app | `XMP-xmp:Rating` | `XMP-xmp:Rating`, and the EXIF `Rating` if the file has one |
| Date and time | `XMP-photoshop:DateCreated` | `XMP-photoshop:DateCreated`; the camera's EXIF dates stay as they are |
| Rotation | `XMP-tiff:Orientation`, for every image format | `EXIF:Orientation`, into JPEG, PNG, TIFF and WebP files only |
| Caption you type | `XMP-dc:Description` | `XMP-dc:Description` and `EXIF:ImageDescription`, and `IPTC:Caption-Abstract` if the file already has IPTC data |
| Location | `XMP-exif:GPSLatitude`, `XMP-exif:GPSLongitude` | In an image `GPS:GPSLatitude`, `GPS:GPSLatitudeRef`, `GPS:GPSLongitude`, `GPS:GPSLongitudeRef`; in an MP4 or MOV `Keys:GPSCoordinates` |
| Tags | `XMP-dc:Subject` | `XMP-dc:Subject`, and `IPTC:Keywords` if the file already has IPTC data |
| Faces and their names, only with **Write face tags to image files** | `XMP-mwg-rs:RegionInfo`, names added to `XMP-dc:Subject` | the same, in the file |
| Title, creator, copyright | not written | not written |

Never written: the place name (city, country), which is looked up from the position again; a
generated caption; albums, hidden and archived photos; and every other tag on this page. The
**Write edits to files** options in the settings list the same edits, and the date editor, the
caption and tags editors and the **Pick location** dialog say in a line under the editor whether
the edit reaches the file, with a link to the setting.

Photos imported from [Nextcloud](./library.md#nextcloud-integration) are never written to:
LibrePhotos works on a local copy, which the next scan replaces when the file changes on the
server, and nothing is uploaded back. Their edits stay in LibrePhotos.

### Formats

`Save to sidecar` works for every format, since the photo itself is never opened for writing.

`Save to media file` needs a format ExifTool can write: JPEG, PNG, TIFF, WebP, HEIC, AVIF, JPEG XL,
GIF, MP4, MOV and most RAW formats (CR2, CR3, NEF, ARW, DNG, ORF, RAF, RW2, ...). BMP, MKV, WebM,
AVI and a few RAW formats cannot be written, and an edit of such a file stays in LibrePhotos (see
[Writes that fail](#writes-that-fail)). A rotation reaches only JPEG, PNG, TIFF and WebP files,
whose viewers apply an EXIF orientation. HEIC, AVIF, RAW, GIF and the other formats are not
rewritten for a rotation and keep it in LibrePhotos: libheif shows a HEIC or AVIF under its `irot`
and `imir` properties, and a RAW decoder ignores the tag, so a written tag would only replace the
camera's own value.

### Dates, rotations, captions and locations

A date is written as the local time LibrePhotos shows, without a UTC offset. Removing a date you
set by hand (**Remove timestamp** in the date editor) removes `XMP-photoshop:DateCreated` again; in
a media file that also removes one another app had written there.

A rotation in a sidecar is the orientation that shows the original the way LibrePhotos shows it
now; for a HEIC or AVIF it starts from the file's `irot` and `imir`, not from its EXIF orientation,
which can disagree. Apps that take the orientation from a sidecar, such as digiKam, show the photo
turned the same way. In a media file the rotation is folded into the file's own orientation, and
LibrePhotos' own rotation goes back to none, so it is not applied twice. See
[Rotating Photos](./viewing-photos.md#rotating-photos).

A caption keeps its line breaks. Clearing the caption removes the description, and removing a
location removes the position tags. Setting a location in an image file also removes the file's old
altitude (`GPS:GPSAltitude`, `GPS:GPSAltitudeRef`), which belonged to the old position, and an
embedded `XMP-exif:GPSLatitude`/`GPSLongitude` that would disagree with the new one. In an MP4 or
MOV the older copies `UserData:GPSCoordinates` and `ItemList:GPSCoordinates` go.

### Tags and keywords

Tags are written as keywords, one change at a time: adding a tag adds that keyword (once, never
twice), removing it removes that keyword, and the file's other keywords stay. Renaming, merging or
deleting a tag on the Albums page changes the keyword in the files of every photo that carries the
tag, in one background job.

`XMP:PersonInImage` and `XMP:HierarchicalSubject` are never written. A tag that came from one of
them is not written as a keyword unless you add it yourself, and removing such a tag leaves the
name or the keyword path in the file. The names of people that the face write-back added stay,
even when you remove a tag of the same name.

A new sidecar starts from the photo's own keywords (`XMP:Subject` and `IPTC:Keywords`), so it does
not hide them. In sidecar mode a removal only reaches the sidecar: a description, position or
keyword stored in the photo file itself stays there, and an app that reads the file (or a new import
into LibrePhotos) sees it again. Removing the last keyword leaves the sidecar without a keyword
list, so the photo file's keywords show again. Inside LibrePhotos the removal stays.

### Face regions

Writing faces needs both **Write face tags to image files** (Settings → Face Options, off by
default) and a sidecar or media file chosen under **Write edits to files**. Then labelling, adding,
deleting or restoring a face writes the photo's regions again, as MWG regions in
`XMP-mwg-rs:RegionInfo` with `AppliedToDimensions` and normalized areas. The areas are in the
coordinates of the stored image, as the standard asks, so on a rotated photo (most phone
portraits, and photos you turned in LibrePhotos) other apps show them on the faces.

Only faces of people you named get a name; the other faces are written as regions without one. The
names are added to the keywords (`XMP-dc:Subject`) for Lightroom and digiKam, which show people as
keywords. The photo's other keywords stay, and the name of a person no longer on the photo leaves
the keywords, unless the photo has a tag of that name.

Deleting the last face removes `XMP-mwg-rs:RegionInfo` from the photo file; in sidecar mode the
sidecar gets an empty `RegionInfo` instead, so the regions another app wrote into the original stay
hidden. A photo that has no faces in LibrePhotos at all (not scanned for faces yet) keeps the
regions of its file. `XMP-MP:RegionInfoMP` (Windows Photo Gallery) and `XMP-digiKam:TagsList` are
never changed.

### Writing the edits of a whole library

<Since version="1.4.0" /> `Write edits to files` writes an edit when you make it. The edits you made
before turning it on are only in LibrePhotos; **Write now** under the setting (Settings → Metadata
Options, see [Settings](./settings/index.md#metadata-options)) writes them as a **Write Metadata to
Files** job, with the same writes a live edit makes. Only a value that says something is written:

| Kind (`types`) | Photos it writes |
| --- | --- |
| `ratings` | Rated 1 to 5 stars; a rating of 0 is not written. |
| `dates` | A date you set by hand. |
| `rotations` | Turned in LibrePhotos. |
| `captions` | A caption you wrote; a generated caption is never written. |
| `locations` | A position you set; a position read from the file is already there. |
| `keywords` | With tags: each tag is added to the keywords. |
| `face_tags` | With faces that are not deleted, named or not. Only with **Write face tags to image files** on. |

A photo with none of them is not touched, so an unrated library does not get a sidecar per photo. The
job writes in batches of 200 photos, each through one ExifTool process; it shows its progress in the job
list, can be cancelled there, and ends with how many photos it wrote (`written`), left alone (`skipped`:
a local copy of a Nextcloud photo, or the setting changed while it ran) and could not write (`errors`,
the first 100 listed with the file and ExifTool's reason). A write it makes is LibrePhotos' own, so
the next scan does not read those photos again for it (see
[How a rescan treats your edits](#how-a-rescan-treats-your-edits)).

`GET /api/savemetadata/` says what it would write now (the target and a count per kind), and
`POST /api/savemetadata/` starts the job: `{"types": [...]}` picks kinds, and leaving it out writes
everything your settings write. It answers 202 with the `job_id`, 400 while `Write edits to files` is
`Off` or for a kind it does not know, and 409 while the job runs. Up to 1.3.0 it wrote the ratings of
every photo, 0 included, inside the request.

`python manage.py save_metadata` makes the same writes for every user whose `Write edits to files` is
on (photos of users who have it `Off` are skipped), with the kinds each user's settings write.
`--types` limits the kinds, `--user` limits it to one user, `--sidecar` or `--media-file` overrides
the setting for that one user, and `--dry-run` only counts.

## How a rescan treats your edits

A **Rescan** reads every file again, and a scan reads a file again when it or its sidecar changed.

<Since version="1.4.0" /> A write LibrePhotos makes itself is not such a change. A scan remembers the
modification time of every file it reads and of its sidecars, and a write that ExifTool reports as
done updates what was remembered, so rating or re-dating a thousand photos does not make the next
scan read them all again. In media file mode the write still moves the file's modification time,
so backup and sync tools see that the file changed. A change another app makes is still picked up:
a file it edited, a sidecar it added or one that was deleted, before or after LibrePhotos' write.
A photo indexed by an earlier version gets its times remembered on the first scan that reads it or
finds it unchanged; until then, a write makes the next scan read the photo once more, as before.

What a scan does to a value you edited in LibrePhotos:

| Field | On a rescan |
| --- | --- |
| Date and time | A date you set by hand wins over every date rule and is kept. **Remove timestamp** in the date editor hands the photo back to the rules. |
| Location | A position you set is kept. A position that came from the file follows the file: it moves when the file's position changes and is cleared when the file has none any more. |
| Caption | Kept. A description in the file becomes the caption only when it is new or changed since it was last imported, and only while your caption is empty or still the one imported before. A caption you cleared stays cleared. |
| Title, creator, copyright | Kept once you edited them through the metadata API, until you restore the photo from its file. |
| Tags | With **Write edits to files** `Off`, every keyword of the file becomes a tag again, so a tag you removed comes back while the file still has the keyword. With a sidecar or the media file chosen, only a keyword the file did not have before becomes a tag, such as one another app added; a tag you removed stays removed, even where the file still carries the keyword. |
| Rating | Taken from the file whenever the file or its sidecar has a `Rating`, also 0. With write-back on, that is the rating you set. With `Off`, a rating you changed in LibrePhotos is replaced by the file's on a rescan ([#2250](https://github.com/LibrePhotos/librephotos/issues/2250)). |
| Rotation | Kept. A sidecar's orientation is never read. |
| Faces | The faces LibrePhotos has stay. A face region in the file that overlaps one of them is not added again. |

`POST /api/photos/{id}/metadata/revert-all/` restores a photo from its file: it reads the file and
its sidecars again and sets every field (date, location, rating, caption, tags, title, copyright,
creator) to what they say, or empties it where they say nothing. Nothing is written. In sidecar
mode the sidecar holds the edits LibrePhotos wrote, so those come back as they are there.

## Undoing write-back

Turning **Write edits to files** back to `Off` stops further writes; it does not change back what
was written. Your edits stay in LibrePhotos either way.

**Sidecar mode** never changes the photo files. To take LibrePhotos' writes back, delete the
sidecars it created: `IMG_2.jpg.xmp`, or `IMG_2.xmp` for writes up to 1.3.0. A sidecar that another
app made and LibrePhotos updated also holds that app's data, so do not delete those blindly;
remove single tags with ExifTool instead, for example `exiftool -XMP-tiff:Orientation= IMG_2.jpg.xmp`.

**Media file mode** changes your originals in place. ExifTool runs with `-overwrite_original`, so
no `IMG_2.jpg_original` backup is kept; the image data itself is not re-encoded. Keep a backup
before you turn it on. To see what LibrePhotos changed in a file, compare
`exiftool -G1 -a -s IMG_2.jpg` of the file and of its backup; LibrePhotos only touches the tags in
the table under [What LibrePhotos writes](#what-librephotos-writes).

## Writes that fail

A write ExifTool cannot make, for example into a read-only library, a damaged file or a format
that cannot hold the tag, never undoes your edit: the rating, date, caption, location, tags, face
label or rotation stays in LibrePhotos. The backend log names the photo and ExifTool's reason.
Labelling a face, drawing one and rotating a photo also return the reason as `write_error` in the
API response, and the **Write Metadata to Files** job and `manage.py save_metadata` list the photos
they could not write.

In the web app, a face label, a drawn face or a rotation that did not reach the file shows an
orange **Not written to the file** notice next to the usual confirmation: "Saved in LibrePhotos,
but not written to the file", followed by the reason. It stays until you close it. Changing a
date, a rating, a caption, tags or a location writes the file after the edit is saved, so a
failure there is only in the backend log.

---
title: "📇 Exif Data"
description: "What exif data can we read, write and filter for"
sidebar_position: 18
---

## Compatibility

<table>
    <tr>
        <th>Exif Field</th>
        <th>Representation</th>
        <th>Read</th>
        <th>Write</th>
        <th>Explanation</th>
    </tr>
    <tr>
        <td>Rating</td>
        <td>Favorites</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>Settable via "Minimum image rating to interpret as favorite". Written back when you change a rating or favorite a photo, but only if "Write edits to files" is enabled. Favoriting a selection writes the ratings in the background, so the files can lag the library by a moment. A scan only reads the rating and never writes it back. <em>Not released yet: up to 1.3.0, a scan wrote a rating it found in the file back to disk, which in sidecar mode created an <code>.xmp</code> holding just that rating; such sidecars are harmless unless the rating is later changed in the original by another app.</em></td>
    </tr>
    <tr>
        <td>ImageHeight</td>
        <td>Height</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used for aspect ratio calculation</td>
    </tr>
    <tr>
        <td>ImageWidth</td>
        <td>Width</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used for aspect ratio calculation</td>
    </tr>
    <tr>
        <td>Composite:Rotation</td>
        <td>Width and height</td>
        <td>✔️</td>
        <td>❌</td>
        <td>A video recorded upright on a phone is stored landscape with a rotation of 90 or 270 degrees; its width and height are then swapped, so Info shows the size it plays at. <em>Not released yet; the update fixes the size of videos scanned before.</em></td>
    </tr>
    <tr>
        <td>EXIF:DateTimeOriginal</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Parsing rules settable in settings. Dates you edit are written back to XMP:DateCreated, never to an EXIF date tag.</td>
    </tr>
    <tr>
        <td>XMP:DateCreated</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>The only tag LibrePhotos writes dates to. It is used instead of an EXIF date tag because EXIF tags cannot be written into an XMP sidecar, and because writing it leaves the camera's original EXIF:DateTimeOriginal untouched. Highest-priority date parsing rule.</td>
    </tr>
    <tr>
        <td>EXIF:ModifyDate</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Read-only. Parsing rules settable in settings; dates you edit are written back to XMP:DateCreated.</td>
    </tr>
    <tr>
        <td>QuickTime:CreateDate</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Parsing rules settable in settings. Dates you edit are written back to XMP:DateCreated, never to an EXIF date tag.</td>
    </tr>
    <tr>
        <td>QuickTime:CreationDate</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>❌</td>
        <td>The local time a phone (iPhone, many Android phones) recorded a video at, with its UTC offset. Used as is by the date rule "Local time from the video's QuickTime:CreationDate tag (phones)", ranked above the UTC QuickTime:CreateDate. <em>Not released yet.</em></td>
    </tr>
    <tr>
        <td>Matroska:DateTimeOriginal</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>❌</td>
        <td>The creation date of MKV and WebM files, in UTC. Converted to local time with the time zone of the video's position, or else your default time zone. <em>Not released yet; before, only a date in the file name could date these files.</em></td>
    </tr>
    <tr>
        <td>QuickTime:Duration</td>
        <td>Video length</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used for video length on video tiles</td>
    </tr>
    <tr>
        <td>Matroska:Duration</td>
        <td>Video length</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Video length of MKV and WebM files, which carry no QuickTime:Duration. Since 1.3.0; videos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>Composite:GPSLatitude</td>
        <td>GPS_lat</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used for photo label on map</td>
    </tr>
    <tr>
        <td>Composite:GPSLongitude</td>
        <td>GPS_lon</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used for photo label on map</td>
    </tr>
    <tr>
        <td>Composite:GPSDateTime</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used by the GPS-based timestamp parsing rules.</td>
    </tr>
    <tr>
        <td>EXIF:Model</td>
        <td>Camera Model</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Camera model in Info</td>
    </tr>
    <tr>
        <td>QuickTime:Make, QuickTime:Model</td>
        <td>Camera</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Camera maker and model of a video, which carries no EXIF:Make or EXIF:Model. <em>Not released yet; videos scanned before get them with a Rescan from the Library page.</em></td>
    </tr>
    <tr>
        <td>EXIF:LensModel</td>
        <td>Lens</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Lens in Info</td>
    </tr>
    <tr>
        <td>EXIF:Make, EXIF:LensMake</td>
        <td>Camera and lens maker</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Shown in front of the camera model and lens in Info ("Fujifilm X-T5"), unless the model already starts with it ("NIKON D850", not "NIKON CORPORATION NIKON D850"). Corporate words at the end of a maker's name are left out there ("OLYMPUS IMAGING CORP." shows as "OLYMPUS"). <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>EXIF:SerialNumber</td>
        <td>Camera serial number</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Stored in the photo's metadata (<code>{"/api/photos/{id}/metadata/"}</code>), not shown in Info and not sent with every photo. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>EXIF:ExposureCompensation, EXIF:Flash, EXIF:MeteringMode, EXIF:WhiteBalance</td>
        <td>Exposure compensation, flash fired, metering mode, white balance</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Stored in the photo's metadata; metering mode and white balance under the names ExifTool prints (Multi-segment, Auto, ...). <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>EXIF:ColorSpace, File:BitsPerSample</td>
        <td>Colour space, bit depth</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Stored in the photo's metadata. Bit depth is read from JPEG files only. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>Composite:GPSAltitude</td>
        <td>Altitude</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Altitude in metres, negative below sea level, stored in the photo's metadata. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>EXIF:SubjectDistance, EXIF:DigitalZoomRatio</td>
        <td>Subject distance, digital zoom</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Shown under "Show more" in Info. 0, which EXIF uses for "unknown" and "not used", is left empty. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>File:FileSize</td>
        <td>File Size</td>
        <td>✔️</td>
        <td>❌</td>
        <td>File Size in Info</td>
    </tr>
    <tr>
        <td>EXIF:FNumber</td>
        <td>F Stop</td>
        <td>✔️</td>
        <td>❌</td>
        <td>F Stop in Info</td>
    </tr>
    <tr>
        <td>EXIF:ExposureTime</td>
        <td>Shutter Speed</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Shown as Shutter Speed in Info the way ExifTool prints it: <code>1/4000</code> up to a quarter second, then seconds (<code>0.3 s</code>, <code>2.5 s</code>, <code>30 s</code>). <em>Not released yet: up to 1.3.0, anything faster than about 1/2000 s was stored as <code>0</code>, 1/1250 to 1/2000 s as <code>1/1000</code>, and long exposures as fractions such as <code>5/2</code>.</em> <code>python manage.py refresh_exposure_time</code> reads just the exposure time of those photos again; a Rescan from the Library page also fixes them.</td>
    </tr>
    <tr>
        <td>EXIF:ISOSpeedRatings</td>
        <td>ISO</td>
        <td>✔️</td>
        <td>❌</td>
        <td>ISO in Info</td>
    </tr>
    <tr>
        <td>EXIF:FocalLength</td>
        <td>Focal Length</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Focal Length in Info</td>
    </tr>
    <tr>
        <td>EXIF:FocalLengthIn35mmFilm</td>
        <td>Focal Length in 35mm </td>
        <td>✔️</td>
        <td>❌</td>
        <td>Focal Length in 35mm Film in Info</td>
    </tr>
    <tr>
        <td>XMP:RegionInfo</td>
        <td>Faces</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>Faces and people are read from XMP:RegionInfo. Writing is opt-in via the "Write face tags to image files" setting (off by default); when enabled and "Write edits to files" is set to a sidecar or the media file, labelling a face writes MWG regions as XMP-mwg-rs:RegionInfo (with AppliedToDimensions and normalized areas) to the image file or XMP sidecar. Only manually labelled people are given a name; auto-detected faces are written as unnamed regions. The areas are in the coordinates of the stored image, as the standard asks, so on a rotated photo (most phone portraits, and photos you turned in LibrePhotos) other apps show them on the faces. <em>Not released yet</em>: earlier versions wrote the regions of rotated photos in the wrong place, and read the regions of photos turned in LibrePhotos onto the wrong spot; <code>python manage.py save_metadata --types face_tags</code> rewrites them.</td>
    </tr>
    <tr>
        <td>XMP:Subject</td>
        <td>Keywords / People</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>Read and merged with IPTC:Keywords, XMP-iptcExt:PersonInImage and XMP-lr:HierarchicalSubject into the photo's keywords. Written alongside face regions: the names of manually labelled people are added as keywords for Lightroom compatibility. The photo's other keywords stay, and relabelling a face removes the previous name. A new XMP sidecar starts from the photo's own keywords (XMP:Subject and IPTC:Keywords), so they are not hidden behind it. <em>Not released yet</em>: earlier versions replaced the keywords with the names.</td>
    </tr>
    <tr>
        <td>IPTC:Keywords</td>
        <td>Keywords</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Merged with XMP:Subject into the photo's keywords.</td>
    </tr>
    <tr>
        <td>XMP-iptcExt:PersonInImage</td>
        <td>Keywords</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Names of the people shown (without face regions), added to the photo's keywords and so its tags. Not linked to people in LibrePhotos, which come from faces. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>XMP-lr:HierarchicalSubject</td>
        <td>Keywords</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Hierarchical keywords as written by Lightroom, digiKam and darktable. The last level of each path becomes a keyword: <code>Places|USA|San Francisco</code> adds <code>San Francisco</code>. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>XMP:Description</td>
        <td>Caption</td>
        <td>✔️</td>
        <td>❌</td>
        <td>The photo's description becomes its caption: the default-language entry first, else any language entry. A caption you typed is never replaced, and one you cleared stays cleared.</td>
    </tr>
    <tr>
        <td>IPTC:Caption-Abstract</td>
        <td>Caption</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Caption fallback when the file has no XMP description (older Photoshop and Lightroom, Picasa, newsroom tools). <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>EXIF:ImageDescription</td>
        <td>Caption</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Last caption fallback. Placeholders cameras write there, such as <code>OLYMPUS DIGITAL CAMERA</code> or <code>SONY DSC</code>, and a description that only repeats the camera model are skipped. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>XMP:Title, XMP:Headline, IPTC:ObjectName</td>
        <td>Title</td>
        <td>✔️</td>
        <td>❌</td>
        <td>The title, from the first of these tags that has one. A title you edit is kept on later scans until you restore the photo from its file. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>XMP:Creator, IPTC:By-line, EXIF:Artist</td>
        <td>Creator</td>
        <td>✔️</td>
        <td>❌</td>
        <td>The creator, from the first of these tags that has one (the first name when there are several). An edit of yours is kept on later scans. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>XMP:Rights, IPTC:CopyrightNotice, EXIF:Copyright</td>
        <td>Copyright</td>
        <td>✔️</td>
        <td>❌</td>
        <td>The copyright notice, from the first of these tags that has one. An edit of yours is kept on later scans. <em>Not released yet</em>; photos scanned by an older version get it with a Rescan from the Library page.</td>
    </tr>
    <tr>
        <td>EXIF:Orientation</td>
        <td>Orientation</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>Read to transform face-region coordinates, and to store the size a photo is shown at: an orientation of 5-8 turns the photo a quarter, so its width and height are swapped, as they are when you rotate it a quarter yourself. <em>Not released yet; the update fixes the size of photos scanned before.</em> Written back (composed with your rotation) when you rotate a photo, but only if "Write edits to files" is enabled: into the original for JPEG, PNG, TIFF and WebP, as XMP-tiff:Orientation into the sidecar for every format (for HEIC and AVIF composed with the file's irot/imir, which is what the photo is shown under). HEIC, AVIF and RAW originals are not rewritten. LibrePhotos does not read the sidecar's orientation back. <em>Not released yet</em>: earlier versions wrote no orientation into sidecars and a wrong one into HEIC, AVIF and RAW originals.</td>
    </tr>
    <tr>
        <td>EXIF:SubSecTimeOriginal</td>
        <td>Sub-second time</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Read on every metadata extract; used for burst/sequence detection.</td>
    </tr>
    <tr>
        <td>EXIF:ImageNumber</td>
        <td>Image sequence</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Read on every metadata extract; used for burst/sequence detection.</td>
    </tr>
</table>

## XMP sidecars

A sidecar (`photo.xmp` or `photo.jpg.xmp` next to `photo.jpg`) is read together with the
photo, and a value found in the sidecar wins over the one embedded in the file. Apps that
leave the original untouched (geotaggers, digiKam, darktable, Lightroom) store EXIF
properties in the sidecar under their XMP names, and LibrePhotos reads these there too:

| Field | Read from the sidecar as |
| --- | --- |
| `EXIF:DateTimeOriginal` | `exif:DateTimeOriginal` |
| `Composite:GPSLatitude`, `Composite:GPSLongitude` | `exif:GPSLatitude`, `exif:GPSLongitude` |
| `Composite:GPSDateTime` | `exif:GPSTimeStamp` |
| `EXIF:Model` | `tiff:Model` |
| `EXIF:LensModel` | `exifEX:LensModel` |
| `EXIF:FNumber`, `EXIF:ExposureTime`, `EXIF:ISO`, `EXIF:FocalLength`, `EXIF:FocalLengthIn35mmFormat` | `exif:FNumber`, `exif:ExposureTime`, `exif:ISOSpeedRatings`, `exif:FocalLength`, `exif:FocalLengthIn35mmFilm` |
| `EXIF:Make`, `EXIF:LensMake` | `tiff:Make`, `exifEX:LensMake` (_not released yet_) |
| `EXIF:ExposureCompensation`, `EXIF:MeteringMode`, `EXIF:WhiteBalance`, `EXIF:SubjectDistance`, `EXIF:DigitalZoomRatio` | `exif:ExposureBiasValue`, `exif:MeteringMode`, `exif:WhiteBalance`, `exif:SubjectDistance`, `exif:DigitalZoomRatio` (_not released yet_) |

_Not released yet:_ before this, only the XMP-native fields (rating, keywords, description,
`XMP:DateCreated`, face regions) were taken from a sidecar. Photos already in your library pick
up a sidecar's date and camera with a **Rescan** from the Library page; a position in the
sidecar of a photo that is already in the library does not reach the map yet ([#2264](https://github.com/LibrePhotos/librephotos/issues/2264)). A sidecar's
modify date and orientation are never read: they describe the last edit, not the photo.

## Rules

Some tags are only read when a matching rule is active. The burst/stacking detection
rules read `MakerNotes:BurstMode`, `MakerNotes:ContinuousDrive` and
`MakerNotes:SequenceNumber` only when the corresponding stack-detection rule is enabled
in your settings.

To back-fill an existing library with face tags, run
`python manage.py save_metadata --types face_tags`. Each photo is written where its owner's
"Write edits to files" setting says (XMP sidecar or media file), and photos of users
who have it Off are skipped. `--sidecar` or `--media-file` overrides the setting for the one
user named with `--user`.

## What LibrePhotos writes

With **Settings → Metadata Options → Write edits to files** set to `Save to sidecar` or `Save to
media file`, these edits are also written to the photo's `.xmp` sidecar or into the photo file
itself. With `Off`, the default, nothing is written. _Not released yet: up to 1.3.0, the setting
was called "Synchronize metadata to disk"._

| Edit | Written | Tag |
|---|---|---|
| Rating and favorite | yes | `Rating` |
| Date and time | yes | `XMP:DateCreated` |
| Rotation | yes, except into HEIC, AVIF and RAW originals | `XMP-tiff:Orientation` in the sidecar, `EXIF:Orientation` in the file |
| Face names and areas | only with "Write face tags to image files" | `XMP-mwg-rs:RegionInfo`, names added to `XMP:Subject` |
| Caption, tags, location | no, they stay in LibrePhotos | |

The date editor, the caption and tags editors and the **Pick location** dialog say the same in a
line under the editor, with a link to the setting.

## XMP sidecars

LibrePhotos reads both sidecar naming conventions next to a photo `IMG_2.jpg`, in lower or
upper case: `IMG_2.xmp` (Lightroom, older LibrePhotos versions) and `IMG_2.jpg.xmp`
(digiKam, darktable, Immich). A value in a sidecar overrides the same tag in the photo, and
when both sidecars exist, `IMG_2.xmp` wins.

With "Write edits to files" set to the sidecar, an edit is written to the sidecar
that already exists, so a digiKam or darktable sidecar is updated in place and keeps its other
tags. When both exist, the edit goes to `IMG_2.xmp`, the one that is read. When there is none,
LibrePhotos creates `IMG_2.jpg.xmp`, which other apps also read and which cannot be mistaken
for the sidecar of a RAW file next to the JPEG (`IMG_2.CR2`).

_Not released yet: up to 1.3.0, LibrePhotos always wrote to `IMG_2.xmp`, creating it next to
an existing `IMG_2.jpg.xmp`. A photo that already has both keeps both; LibrePhotos reads and
writes `IMG_2.xmp`, and the other app keeps its own file._

## Writes that fail

A write ExifTool cannot make, for example into a read-only library, a damaged file or a format
that cannot hold the tag, never undoes your edit: the rating, date, face label or rotation stays
in LibrePhotos. The backend log names the photo and ExifTool's reason. Labelling a face, drawing
one and rotating a photo also return the reason as `write_error` in the API response, and
`POST /api/savemetadata` and `manage.py save_metadata` count the photos they could not write
as errors.

In the web app, a face label, a drawn face or a rotation that did not reach the file shows an
orange **Not written to the file** notice next to the usual confirmation: "Saved in LibrePhotos,
but not written to the file", followed by the reason. It stays until you close it. Changing a
date or a rating writes the file after the edit is saved, so a failure there is only in the
backend log.

_Not released yet: up to 1.3.0, a failed write looked like a success and was not logged, and the
web app showed no notice._

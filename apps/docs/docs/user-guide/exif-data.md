---
title: "📇 Exif Data"
description: "What exif data can we read, write and filter for"
sidebar_position: 17
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
        <td>Settable via "Minimum image rating to interpret as favorite"</td>
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
        <td>QuickTime:Duration</td>
        <td>Video length</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used for video length on video tiles</td>
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
        <td>EXIF:LensModel</td>
        <td>Lens</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Lens in Info</td>
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
        <td>Shown as Shutter Speed in Info (stored as a fraction, e.g. 1/250)</td>
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
        <td>Faces and people are read from XMP:RegionInfo. Writing is opt-in via the "Write face tags to image files" setting (off by default); when enabled, labelling a face writes MWG regions as XMP-mwg-rs:RegionInfo (with AppliedToDimensions and normalized areas) to the image file or XMP sidecar. Only manually labelled people are given a name; auto-detected faces are written as unnamed regions.</td>
    </tr>
    <tr>
        <td>XMP:Subject</td>
        <td>Keywords / People</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>Read and merged with IPTC:Keywords into the photo's keywords. Written alongside face regions: the names of manually labelled people are added as keywords for Lightroom compatibility.</td>
    </tr>
    <tr>
        <td>IPTC:Keywords</td>
        <td>Keywords</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Merged with XMP:Subject into the photo's keywords.</td>
    </tr>
    <tr>
        <td>EXIF:Orientation</td>
        <td>Orientation</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>Read to transform face-region coordinates. Written back (composed with your rotation) when you rotate a photo, but only if "Synchronize metadata to disk" is enabled.</td>
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

Some tags are only read when a matching rule is active. The burst/stacking detection
rules read `MakerNotes:BurstMode`, `MakerNotes:ContinuousDrive` and
`MakerNotes:SequenceNumber` only when the corresponding stack-detection rule is enabled
in your settings.

To back-fill an existing library with face tags, run
`python manage.py save_metadata --types face_tags` (add `--media-file` to write into the
images instead of XMP sidecars).

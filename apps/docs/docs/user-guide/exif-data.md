---
title: "ℹ Exif Data"
excerpt: "What exif data can we read, write and filter for"
sidebar_position: 2
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
        <td>Parsing rules settable in settings. Date will only be saved in EXIF:DateTime</td>
    </tr>
     <tr>
        <td>EXIF:DateTime</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>✔️</td>
        <td>Parsing rules settable in settings. Date will only be saved in EXIF:DateTime</td>
    </tr>
    <tr>
        <td>QUICKTIME_CREATE_DATE</td>
        <td>Timestamp</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Parsing rules settable in settings. Date will only be saved in EXIF:DateTime</td>
    </tr>
    <tr>
        <td>QUICKTIME_DURATION</td>
        <td>Video length</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Used for videon length on video tiles</td>
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
        <td>Exposure Time</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Exposure Time in Info</td>
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
        <td>EXIF:ShutterSpeedValue</td>
        <td>Shutter Speed</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Shutter Speed in Info</td>
    </tr>
     <tr>
        <td>EXIF:SubjectDistance</td>
        <td>Subject Distance</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Subject Distance in Info</td>
    </tr>
    <tr>
        <td>EXIF:DigitalZoomRatio</td>
        <td>Digital Zoom Ratio</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Digital Zoom Ratio  in Info</td>
    </tr>
    <tr>
        <td>XMP:RegionInfo</td>
        <td>Faces</td>
        <td>✔️</td>
        <td>❌</td>
        <td>Faces and Person will be read from XMP</td>
    </tr>
</table>

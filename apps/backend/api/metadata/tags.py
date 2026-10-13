class Tags:
    RATING = "Rating"
    IMAGE_HEIGHT = "ImageHeight"
    IMAGE_WIDTH = "ImageWidth"
    DATE_TIME_ORIGINAL = "EXIF:DateTimeOriginal"
    # ExifTool names EXIF tag 0x0132 "ModifyDate" - "EXIF:DateTime" is not a
    # valid ExifTool tag and silently reads/writes nothing.
    DATE_TIME = "EXIF:ModifyDate"
    # XMP-photoshop:DateCreated. Unlike the EXIF date tags this one can be
    # written into an XMP sidecar, and writing it leaves the camera's
    # EXIF:DateTimeOriginal untouched.
    DATE_CREATED = "XMP:DateCreated"
    QUICKTIME_CREATE_DATE = "QuickTime:CreateDate"
    QUICKTIME_DURATION = "QuickTime:Duration"
    # MKV and WebM: ExifTool files their duration under Matroska, not QuickTime.
    MATROSKA_DURATION = "Matroska:Duration"
    LATITUDE = "Composite:GPSLatitude"
    LONGITUDE = "Composite:GPSLongitude"
    GPS_DATE_TIME = "Composite:GPSDateTime"
    FILE_SIZE = "File:FileSize"
    FSTOP = "EXIF:FNumber"
    EXPOSURE_TIME = "EXIF:ExposureTime"
    # EXIF tag 0x8827 is "ISO" to ExifTool; "EXIF:ISOSpeedRatings" (its EXIF
    # 2.2 name) reads nothing, so no photo ever had an ISO value.
    ISO = "EXIF:ISO"
    FOCAL_LENGTH = "EXIF:FocalLength"
    # "FocalLengthIn35mmFilm" is the EXIF spec's name; ExifTool's is "...Format",
    # and the old name read nothing.
    FOCAL_LENGTH_35MM = "EXIF:FocalLengthIn35mmFormat"
    SHUTTER_SPEED = "EXIF:ShutterSpeedValue"
    CAMERA = "EXIF:Model"
    LENS = "EXIF:LensModel"
    SUBJECT_DISTANCE = "EXIF:SubjectDistance"
    DIGITAL_ZOOM_RATIO = "EXIF:DigitalZoomRatio"
    REGION_INFO = "XMP:RegionInfo"
    REGION_INFO_WRITE = "XMP-mwg-rs:RegionInfo"
    SUBJECT = "XMP:Subject"
    IPTC_KEYWORDS = "IPTC:Keywords"
    # The x-default entry of the dc:description lang-alt, embedded or sidecar.
    DESCRIPTION = "XMP:Description"
    # Every language-tagged entry of the same lang-alt (XMP:Description-de,
    # -fr, ...). A lang-alt without an x-default entry reads back as nothing
    # under DESCRIPTION, so this is the fallback; get_tag keeps the first one.
    # The wildcard does not match the untagged x-default entry itself.
    DESCRIPTION_ANY_LANGUAGE = "XMP:Description-*"
    ROTATION = "QuickTime:Rotation"
    ORIENTATION = "EXIF:Orientation"

    # Burst/sequence detection tags
    SUBSEC_TIME_ORIGINAL = "EXIF:SubSecTimeOriginal"
    SUBSEC_TIME = "EXIF:SubSecTime"
    IMAGE_NUMBER = "EXIF:ImageNumber"
    IMAGE_UNIQUE_ID = "EXIF:ImageUniqueID"
    BURST_MODE = "MakerNotes:BurstMode"
    CONTINUOUS_DRIVE = "MakerNotes:ContinuousDrive"
    SEQUENCE_NUMBER = "MakerNotes:SequenceNumber"
    # Camera serial number (useful for grouping shots from same camera)
    SERIAL_NUMBER = "EXIF:SerialNumber"
    CAMERA_SERIAL = "MakerNotes:SerialNumber"


# The name of the same property in an XMP sidecar, for the EXIF and Composite
# names above (#2261). An app that may not rewrite the original (a geotagger,
# digiKam, darktable, Lightroom) stores these in the sidecar's exif:, tiff: and
# exifEX: namespaces, which ExifTool reports as XMP:<Name>; it builds no
# Composite:GPSLatitude/GPSLongitude from them either. The exif service asks a
# sidecar for the name on the right, so its value overrides the embedded one.
#
# Explicit on purpose, not a blanket EXIF: -> XMP: rewrite: xmp:ModifyDate in a
# sidecar is the time of the last edit, not a capture-related date, and a
# sidecar orientation must not start rotating photos as a side effect.
# Only sidecars are asked: inside a media file the EXIF block stays the source.
SIDECAR_EQUIVALENTS: dict[str, str] = {
    Tags.DATE_TIME_ORIGINAL: "XMP:DateTimeOriginal",
    Tags.LATITUDE: "XMP:GPSLatitude",
    Tags.LONGITUDE: "XMP:GPSLongitude",
    Tags.GPS_DATE_TIME: "XMP:GPSDateTime",
    Tags.FSTOP: "XMP:FNumber",
    Tags.EXPOSURE_TIME: "XMP:ExposureTime",
    Tags.ISO: "XMP:ISO",
    Tags.FOCAL_LENGTH: "XMP:FocalLength",
    Tags.FOCAL_LENGTH_35MM: "XMP:FocalLengthIn35mmFormat",
    Tags.CAMERA: "XMP:Model",
    Tags.LENS: "XMP:LensModel",
}

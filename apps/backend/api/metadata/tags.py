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
    # Phones (iPhone, many Android phones) store the local capture time with
    # its UTC offset in the QuickTime Keys atom; ExifTool reports Keys tags
    # under the family 0 group QuickTime. CreateDate above is UTC.
    QUICKTIME_CREATION_DATE = "QuickTime:CreationDate"
    # MKV and WebM: the creation date (UTC, "...Z"), from the Matroska DateUTC element.
    MATROSKA_DATE = "Matroska:DateTimeOriginal"
    # A video's camera, from the Keys or UserData atom: videos carry no EXIF.
    QUICKTIME_MAKE = "QuickTime:Make"
    QUICKTIME_MODEL = "QuickTime:Model"
    QUICKTIME_DURATION = "QuickTime:Duration"
    # MKV and WebM: ExifTool files their duration under Matroska, not QuickTime.
    MATROSKA_DURATION = "Matroska:Duration"
    LATITUDE = "Composite:GPSLatitude"
    LONGITUDE = "Composite:GPSLongitude"
    # Where a location edit is written (#2290). ExifTool builds the two
    # Composite tags above from each of these, except from the sidecar's,
    # which SIDECAR_EQUIVALENTS reads as XMP:GPSLatitude/GPSLongitude.
    # An XMP sidecar holds signed decimal degrees.
    GPS_LATITUDE_XMP = "XMP-exif:GPSLatitude"
    GPS_LONGITUDE_XMP = "XMP-exif:GPSLongitude"
    # An image's EXIF GPS block holds unsigned degrees and the hemisphere as a
    # letter. The writer runs with -n, under which ExifTool takes no signed
    # number for the Ref tags, so the letters are written explicitly.
    GPS_LATITUDE = "GPS:GPSLatitude"
    GPS_LATITUDE_REF = "GPS:GPSLatitudeRef"
    GPS_LONGITUDE = "GPS:GPSLongitude"
    GPS_LONGITUDE_REF = "GPS:GPSLongitudeRef"
    GPS_ALTITUDE_EXIF = "GPS:GPSAltitude"
    GPS_ALTITUDE_REF = "GPS:GPSAltitudeRef"
    # An MP4 or MOV: "<lat> <lon>" in the Keys atom, what phones write. The
    # UserData and ItemList atoms can hold an older copy.
    GPS_COORDINATES_KEYS = "Keys:GPSCoordinates"
    GPS_COORDINATES_USER_DATA = "UserData:GPSCoordinates"
    GPS_COORDINATES_ITEM_LIST = "ItemList:GPSCoordinates"
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
    MAKE = "EXIF:Make"
    LENS = "EXIF:LensModel"
    LENS_MAKE = "EXIF:LensMake"
    # In EV; 0 is a value, not "unset".
    EXPOSURE_COMPENSATION = "EXIF:ExposureCompensation"
    # The exif service reads with -n, so these four arrive as their EXIF
    # codes, mapped to names in api.models.photo_metadata.
    FLASH = "EXIF:Flash"
    METERING_MODE = "EXIF:MeteringMode"
    WHITE_BALANCE = "EXIF:WhiteBalance"
    COLOR_SPACE = "EXIF:ColorSpace"
    # A JPEG's bits per channel, from its SOF segment.
    BITS_PER_SAMPLE = "File:BitsPerSample"
    # Signed (below sea level is negative), built from GPSAltitudeRef, also
    # from a sidecar's XMP:GPSAltitude.
    GPS_ALTITUDE = "Composite:GPSAltitude"
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
    # Where a caption edit is written (#2289): the x-default entry in a
    # sidecar; in a media file the MWG composite, which also sets
    # EXIF:ImageDescription and an IPTC:Caption-Abstract the file already has
    # (written with WriteOption.MWG).
    DESCRIPTION_XMP = "XMP-dc:Description"
    DESCRIPTION_MWG = "MWG:Description"
    # Older captions: the IPTC record (Photoshop, Picasa, newsroom tools) and
    # the EXIF one, which some cameras fill with a placeholder.
    IPTC_CAPTION = "IPTC:Caption-Abstract"
    IMAGE_DESCRIPTION = "EXIF:ImageDescription"
    # Title, creator and copyright, each from XMP, IPTC and EXIF. These are
    # read one by one and the fallback is done in Python: ExifTool's MWG
    # composites would do it, but loading the MWG module makes the ungrouped
    # Rating come back under Composite too, which breaks the batched read.
    # IPTC:Headline is not read: Photoshop and Lightroom mirror it into XMP:Headline.
    TITLE = "XMP:Title"
    HEADLINE = "XMP:Headline"
    IPTC_OBJECT_NAME = "IPTC:ObjectName"
    XMP_CREATOR = "XMP:Creator"
    IPTC_BYLINE = "IPTC:By-line"
    ARTIST = "EXIF:Artist"
    XMP_RIGHTS = "XMP:Rights"
    IPTC_COPYRIGHT = "IPTC:CopyrightNotice"
    EXIF_COPYRIGHT = "EXIF:Copyright"
    # XMP-iptcExt:PersonInImage (names of people shown, no regions) and
    # XMP-lr:HierarchicalSubject ("Places|USA|San Francisco"), imported as keywords.
    PERSON_IN_IMAGE = "XMP:PersonInImage"
    HIERARCHICAL_SUBJECT = "XMP:HierarchicalSubject"
    # A video's rotation in degrees (0, 90, 180, 270), from its track matrix.
    # ExifTool returns it only as a Composite tag: "QuickTime:Rotation" reads nothing.
    ROTATION = "Composite:Rotation"
    ORIENTATION = "EXIF:Orientation"
    # A HEIF image's (HEIC, AVIF) irot and imir properties: the turn and the
    # mirror libheif shows it under, whatever its EXIF Orientation says (#2615).
    HEIF_ROTATION = "QuickTime:Rotation"
    HEIF_MIRRORING = "QuickTime:Mirroring"
    # The orientation an XMP sidecar can hold: ExifTool cannot store
    # EXIF:Orientation in an .xmp (#2297). Written, never read: a sidecar
    # orientation must not rotate LibrePhotos' own thumbnails (SIDECAR_EQUIVALENTS).
    ORIENTATION_XMP = "XMP-tiff:Orientation"

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
    Tags.MAKE: "XMP:Make",
    Tags.LENS_MAKE: "XMP:LensMake",
    Tags.EXPOSURE_COMPENSATION: "XMP:ExposureCompensation",
    Tags.METERING_MODE: "XMP:MeteringMode",
    Tags.WHITE_BALANCE: "XMP:WhiteBalance",
    Tags.SUBJECT_DISTANCE: "XMP:SubjectDistance",
    Tags.DIGITAL_ZOOM_RATIO: "XMP:DigitalZoomRatio",
    # Not Flash: in XMP it is a structure (Fired, Return, Mode, ...), not the
    # EXIF bit field. Not ColorSpace: a RAW editor's sidecar names the colour
    # space of its output, not of the file. Not SerialNumber: the struct reads
    # are ungrouped, so XMP:SerialNumber would also answer for
    # MakerNotes:SerialNumber.
}

"""Reading a photo's file metadata into ``Photo`` and ``PhotoMetadata``.

The scan's metadata step. Moved out of ``PhotoMetadata`` so the model does no
I/O (#2336): the values are read here, through the exif sidecar, and
``PhotoMetadata.apply_file_values`` stores them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from api.metadata.reader import get_metadata, sidecar_files_for_photo
from api.metadata.tags import Tags
from api.models.photo_metadata import PhotoMetadata

if TYPE_CHECKING:
    from api.models.photo import Photo

# Each value name with the tag it is read from. get_metadata returns one value
# per requested tag, in the order the tags were asked for, so both lists below
# are derived from this one and cannot drift apart.
EXIF_FIELDS: tuple[tuple[str, str], ...] = (
    ("size", Tags.FILE_SIZE),
    ("fstop", Tags.FSTOP),
    ("focal_length", Tags.FOCAL_LENGTH),
    ("iso", Tags.ISO),
    ("shutter_speed", Tags.EXPOSURE_TIME),
    ("camera", Tags.CAMERA),
    ("lens", Tags.LENS),
    ("width", Tags.IMAGE_WIDTH),
    ("height", Tags.IMAGE_HEIGHT),
    ("focal_length_35mm", Tags.FOCAL_LENGTH_35MM),
    ("subject_distance", Tags.SUBJECT_DISTANCE),
    ("digital_zoom_ratio", Tags.DIGITAL_ZOOM_RATIO),
    ("video_length", Tags.QUICKTIME_DURATION),
    ("rating", Tags.RATING),
    ("subsec_time_original", Tags.SUBSEC_TIME_ORIGINAL),
    ("image_number", Tags.IMAGE_NUMBER),
    ("xmp_subject", Tags.SUBJECT),
    ("iptc_keywords", Tags.IPTC_KEYWORDS),
    ("xmp_description", Tags.DESCRIPTION),
    ("xmp_description_any_language", Tags.DESCRIPTION_ANY_LANGUAGE),
    ("matroska_duration", Tags.MATROSKA_DURATION),
    ("iptc_caption", Tags.IPTC_CAPTION),
    ("image_description", Tags.IMAGE_DESCRIPTION),
    ("xmp_title", Tags.TITLE),
    ("xmp_headline", Tags.HEADLINE),
    ("iptc_object_name", Tags.IPTC_OBJECT_NAME),
    ("xmp_creator", Tags.XMP_CREATOR),
    ("iptc_byline", Tags.IPTC_BYLINE),
    ("exif_artist", Tags.ARTIST),
    ("xmp_rights", Tags.XMP_RIGHTS),
    ("iptc_copyright", Tags.IPTC_COPYRIGHT),
    ("exif_copyright", Tags.EXIF_COPYRIGHT),
    ("person_in_image", Tags.PERSON_IN_IMAGE),
    ("hierarchical_subject", Tags.HIERARCHICAL_SUBJECT),
    ("gps_latitude", Tags.LATITUDE),
    ("gps_longitude", Tags.LONGITUDE),
)

EXIF_VALUE_NAMES = tuple(name for name, _ in EXIF_FIELDS)
EXIF_TAGS = [tag for _, tag in EXIF_FIELDS]


def extract_exif_data(photo: Photo, commit: bool = True) -> PhotoMetadata | None:
    """Extract EXIF data from a photo's main file and update PhotoMetadata.

    This extracts metadata from the photo's main file and:
    1. Updates Photo fields (size, video_length, rating, exif_timestamp_subsec,
       image_sequence_number, and the GPS position of a photo that has none)
    2. Gets or creates PhotoMetadata and populates it with extracted data

    Args:
        photo: Photo instance to extract metadata from
        commit: Whether to save Photo and PhotoMetadata after extraction

    Returns:
        PhotoMetadata instance, or None for a photo without a main file
    """
    if not photo.main_file:
        return None
    return PhotoMetadata.apply_file_values(photo, read_file_values(photo), commit)


def read_file_values(photo: Photo) -> dict[str, object]:
    """The values of ``EXIF_TAGS`` in the photo's file or sidecar, by name."""
    assert photo.main_file is not None
    # Every name gets a key even if get_metadata comes back short, so the
    # appliers can index values[...] without a KeyError.
    values: dict[str, object] = dict.fromkeys(EXIF_VALUE_NAMES)
    values.update(
        zip(
            EXIF_VALUE_NAMES,
            get_metadata(
                photo.main_file.path,
                tags=EXIF_TAGS,
                sidecar_files=sidecar_files_for_photo(photo),
            ),
        )
    )
    return values

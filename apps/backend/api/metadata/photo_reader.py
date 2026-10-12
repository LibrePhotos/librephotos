"""Reading a photo's file metadata into ``Photo`` and ``PhotoMetadata``.

The scan's metadata step. Moved out of ``PhotoMetadata`` so the model does no
I/O (#2336): the values are read here, through the exif sidecar, and
``PhotoMetadata.apply_file_values`` stores them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from api.metadata.reader import get_metadata
from api.metadata.tags import Tags
from api.models.photo_metadata import PhotoMetadata

if TYPE_CHECKING:
    from api.models.photo import Photo

# The value names below line up positionally with EXIF_TAGS: get_metadata returns
# one value per requested tag, in the order the tags were asked for.
EXIF_VALUE_NAMES = (
    "size",
    "fstop",
    "focal_length",
    "iso",
    "shutter_speed",
    "camera",
    "lens",
    "width",
    "height",
    "focal_length_35mm",
    "subject_distance",
    "digital_zoom_ratio",
    "video_length",
    "rating",
    "subsec_time_original",
    "image_number",
    "xmp_subject",
    "iptc_keywords",
    "xmp_description",
    "xmp_description_any_language",
    "matroska_duration",
)

EXIF_TAGS = [
    Tags.FILE_SIZE,
    Tags.FSTOP,
    Tags.FOCAL_LENGTH,
    Tags.ISO,
    Tags.EXPOSURE_TIME,
    Tags.CAMERA,
    Tags.LENS,
    Tags.IMAGE_WIDTH,
    Tags.IMAGE_HEIGHT,
    Tags.FOCAL_LENGTH_35MM,
    Tags.SUBJECT_DISTANCE,
    Tags.DIGITAL_ZOOM_RATIO,
    Tags.QUICKTIME_DURATION,
    Tags.RATING,
    Tags.SUBSEC_TIME_ORIGINAL,
    Tags.IMAGE_NUMBER,
    Tags.SUBJECT,
    Tags.IPTC_KEYWORDS,
    Tags.DESCRIPTION,
    Tags.DESCRIPTION_ANY_LANGUAGE,
    Tags.MATROSKA_DURATION,
]


def extract_exif_data(photo: Photo, commit: bool = True) -> PhotoMetadata | None:
    """Extract EXIF data from a photo's main file and update PhotoMetadata.

    This extracts metadata from the photo's main file and:
    1. Updates Photo fields (size, video_length, rating, exif_timestamp_subsec, image_sequence_number)
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
            get_metadata(photo.main_file.path, tags=EXIF_TAGS, try_sidecar=True),
        )
    )
    return values

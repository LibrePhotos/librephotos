"""Reading a photo's file metadata into ``Photo`` and ``PhotoMetadata``.

The scan's metadata step. Moved out of ``PhotoMetadata`` so the model does no
I/O (#2336): the values are read here, through the exif sidecar, and
``PhotoMetadata.apply_file_values`` stores them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from django.db.models import Q, QuerySet

from api.geocode.photo_location import apply_file_position, usable_coordinates
from api.metadata.photo_writer import write_target
from api.metadata.reader import MetadataReadError, get_metadata, sidecar_files_for_photo
from api.metadata.tags import Tags
from api.metadata.takeout import TakeoutMetadata, takeout_metadata_of
from api.models.photo_metadata import PhotoMetadata, format_exposure_time

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
    ("camera_make", Tags.MAKE),
    ("lens_make", Tags.LENS_MAKE),
    ("serial_number", Tags.SERIAL_NUMBER),
    ("exposure_compensation", Tags.EXPOSURE_COMPENSATION),
    ("flash", Tags.FLASH),
    ("metering_mode", Tags.METERING_MODE),
    ("white_balance", Tags.WHITE_BALANCE),
    ("color_space", Tags.COLOR_SPACE),
    ("bits_per_sample", Tags.BITS_PER_SAMPLE),
    ("gps_altitude", Tags.GPS_ALTITUDE),
    # Videos: the camera from the QuickTime atoms (a fallback for EXIF:Make
    # and EXIF:Model) and the rotation, which turns the stored size into the shown one.
    ("quicktime_make", Tags.QUICKTIME_MAKE),
    ("quicktime_model", Tags.QUICKTIME_MODEL),
    ("rotation", Tags.ROTATION),
    # A photo's EXIF orientation, which turns its stored size into the shown one (#2568).
    ("orientation", Tags.ORIENTATION),
)

EXIF_VALUE_NAMES = tuple(name for name, _ in EXIF_FIELDS)
EXIF_TAGS = [tag for _, tag in EXIF_FIELDS]


def extract_exif_data(photo: Photo, commit: bool = True) -> PhotoMetadata | None:
    """Extract EXIF data from a photo's main file and update PhotoMetadata.

    This extracts metadata from the photo's main file and:
    1. Updates Photo fields (size, video_length, rating, exif_timestamp_subsec,
       image_sequence_number, and the GPS position unless the user set it)
    2. Gets or creates PhotoMetadata and populates it with extracted data

    Args:
        photo: Photo instance to extract metadata from
        commit: Whether to save Photo and PhotoMetadata after extraction

    Returns:
        PhotoMetadata instance, or None for a photo without a main file
    """
    if not photo.main_file:
        return None
    values = read_file_values(photo)
    apply_file_position(photo, values["gps_latitude"], values["gps_longitude"])
    return PhotoMetadata.apply_file_values(
        photo, values, commit, new_keywords_only=_tags_are_written(photo)
    )


def _tags_are_written(photo: Photo) -> bool:
    """Whether the owner's tag edits reach the files (``write_target``, #2289)."""
    return write_target(photo.owner) is not None


def read_file_values(photo: Photo) -> dict[str, object]:
    """The values of ``EXIF_TAGS`` in the photo's file or sidecar, by name,
    with what its Google Takeout JSON adds (``with_takeout_values``)."""
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
    return with_takeout_values(values, takeout_metadata_of(photo))


def with_takeout_values(
    values: dict[str, object], takeout: TakeoutMetadata | None
) -> dict[str, object]:
    """``values`` with the Takeout JSON's description as
    ``takeout_description`` (the last caption fallback, ``description_of``)
    and its position when the file has none (#2270)."""
    values["takeout_description"] = takeout.description if takeout else None
    position = takeout.position if takeout else None
    if position is None or usable_coordinates(
        values["gps_latitude"], values["gps_longitude"]
    ):
        return values
    assert takeout is not None
    values["gps_latitude"], values["gps_longitude"] = position
    values["gps_altitude"] = takeout.altitude
    return values


def misread_exposure_times() -> QuerySet[PhotoMetadata]:
    """The rows whose shutter speed an older version may have stored wrongly (#2275).

    It was ``Fraction(seconds).limit_denominator(1000)``: "0" for anything
    faster than about 1/2000 s, "1/1000" for 1/1250 to 1/2000 s, and a
    fraction like "5/2" or "3/10" from 0.3 s up. A real 1/1000 s is read
    again too, and stays "1/1000".
    """
    return (
        PhotoMetadata.objects.filter(
            Q(shutter_speed__in=("0", "1/1000"))
            | (Q(shutter_speed__contains="/") & ~Q(shutter_speed__startswith="1/"))
        )
        .select_related("photo__main_file")
        .order_by("pk")
    )


@dataclass
class ExposureTimeRefresh:
    checked: int = 0
    updated: int = 0
    unreadable: int = 0


#: Rows between two progress reports of ``refresh_exposure_times``.
EXPOSURE_PROGRESS_EVERY = 100


def _refresh_exposure_time(metadata: PhotoMetadata) -> bool | None:
    """Read one row's ExposureTime again: whether it changed, None if unreadable."""
    photo = metadata.photo
    if photo.main_file is None:
        return None
    try:
        (seconds,) = get_metadata(
            photo.main_file.path,
            tags=[Tags.EXPOSURE_TIME],
            sidecar_files=sidecar_files_for_photo(photo),
        )
    except MetadataReadError:
        return None
    shutter_speed = format_exposure_time(seconds)
    if shutter_speed is None or (shutter_speed, seconds) == (
        metadata.shutter_speed,
        metadata.shutter_speed_seconds,
    ):
        return False
    metadata.shutter_speed = shutter_speed
    metadata.shutter_speed_seconds = float(seconds)
    metadata.save(update_fields=["shutter_speed", "shutter_speed_seconds"])
    return True


def refresh_exposure_times(
    metadata_rows: QuerySet[PhotoMetadata],
    progress: Callable[[int, int], None] | None = None,
) -> ExposureTimeRefresh:
    """Read ExposureTime again for ``metadata_rows`` and store it as
    ``format_exposure_time`` prints it, and in seconds. Only that one tag is
    read and only the two shutter speed columns are written: no other field
    of the photo changes.

    ``progress(done, total)`` is called at the start, every
    ``EXPOSURE_PROGRESS_EVERY`` rows and at the end; what it raises (a
    cancelled job) stops the run.
    """
    result = ExposureTimeRefresh()
    total = metadata_rows.count() if progress else 0
    if progress:
        progress(0, total)
    for metadata in metadata_rows.iterator():
        result.checked += 1
        changed = _refresh_exposure_time(metadata)
        result.updated += changed is True
        result.unreadable += changed is None
        if progress and result.checked % EXPOSURE_PROGRESS_EVERY == 0:
            progress(result.checked, total)
    if progress:
        progress(result.checked, max(total, result.checked))
    return result

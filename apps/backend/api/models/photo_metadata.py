"""
PhotoMetadata and MetadataEdit: what a photo's file says, and the user's edits.

``PhotoMetadata`` holds the file's technical metadata (camera, lens, exposure,
size), its keywords and the free-text title, copyright and creator. The
fields a user sees and edits elsewhere live on ``Photo`` (capture date,
location, rating) and ``PhotoCaption`` (caption); ``api.metadata.edits`` is
the one write path for all of them and records each change as a
``MetadataEdit`` (#2252).
"""

from __future__ import annotations

import logging
import math
import numbers
import re
import uuid
from collections.abc import Iterable, Mapping
from typing import TYPE_CHECKING

from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from api.models.tag import link_tags_from_keywords, tag_names
from api.models.user import User, get_deleted_user

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)

# Key in PhotoCaption.captions_json remembering the description last imported
# from the file, so a rescan can tell "already imported" (and possibly edited
# or cleared by the user since) from "the file has a new description".
IMPORTED_DESCRIPTION_KEY = "imported_description"


def _assign_nonzero_number(target: object, field: str, value: object) -> None:
    if value and isinstance(value, numbers.Number):
        setattr(target, field, value)


def _assign_number(target: object, field: str, value: object) -> None:
    if value is not None and isinstance(value, numbers.Number):
        setattr(target, field, value)


def _assign_string(target: object, field: str, value: object) -> None:
    if value and isinstance(value, str):
        setattr(target, field, value)


def _turned_sideways(rotation: object) -> bool:
    """Whether a video's ``Composite:Rotation`` (degrees) swaps width and height."""
    return isinstance(rotation, int | float) and rotation % 180 == 90


# The EXIF orientations that turn the image a quarter (transpose, 90 CW,
# transverse, 270 CW): they swap its width and height.
_SIDEWAYS_ORIENTATIONS = frozenset({5, 6, 7, 8})


def _orientation_turns_sideways(orientation: object) -> bool:
    """Whether an EXIF ``Orientation`` (1-8) swaps width and height.

    The exif service reads with ``-n``, so the value arrives as a number.
    """
    return isinstance(orientation, int) and orientation in _SIDEWAYS_ORIENTATIONS


def _shown_sideways(
    values: Mapping[str, object],
    local_orientation: int,
    shown_aspect_ratio: float | None,
) -> bool:
    """Whether the photo is shown turned a quarter from its stored size.

    The big thumbnail is the photo as shown, so where its aspect ratio and
    the stored size disagree on landscape or portrait, the photo is shown
    turned. That covers what the tags cannot say for every format: a HEIC's
    own rotation, a RAW file turned by LibRaw. Without a ratio to go by (no
    thumbnail yet, or a square one) the tags decide: a video's rotation or a
    photo's orientation, with the user's rotation (``local_orientation``) on
    top; two quarter turns cancel out.
    """
    width, height = values["width"], values["height"]
    if (
        shown_aspect_ratio is not None
        and shown_aspect_ratio != 1
        and isinstance(width, int | float)
        and isinstance(height, int | float)
        and width != height
    ):
        return (width > height) != (shown_aspect_ratio > 1)
    by_file = _turned_sideways(values["rotation"]) or _orientation_turns_sideways(
        values["orientation"]
    )
    return by_file != _orientation_turns_sideways(local_orientation)


def _text_value(value: object) -> str | None:
    """A free-text tag value as a stripped string, or None when empty.

    ExifTool's JSON output turns a text value that looks like a number into a
    number (a description of "2024" comes back as the int 2024), so numbers are
    turned back into text rather than dropped. Anything else is ignored.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, numbers.Number):
        value = str(value)
    if not isinstance(value, str):
        return None
    return value.strip() or None


# EXIF 2.32 codes of the enums the exif service reads as numbers (-n), named
# as ExifTool prints them. A code not listed is stored as its number in text.
METERING_MODES = {
    0: "Unknown",
    1: "Average",
    2: "Center-weighted average",
    3: "Spot",
    4: "Multi-spot",
    5: "Multi-segment",
    6: "Partial",
    255: "Other",
}
WHITE_BALANCES = {0: "Auto", 1: "Manual"}
COLOR_SPACES = {
    1: "sRGB",
    2: "Adobe RGB",
    0xFFFD: "Wide Gamut RGB",
    0xFFFE: "ICC Profile",
    0xFFFF: "Uncalibrated",
}

# EXIF's SubjectDistance for "infinity"; 0 means "unknown".
_INFINITE_SUBJECT_DISTANCE = 0xFFFFFFFF

_MAKER_MAX_LENGTH = 100


def _code_name(value: object, names: Mapping[int, str]) -> str | None:
    """An EXIF enum code as its name, an unknown code as its number in text."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return names.get(value, str(value))


def _positive_number(value: object, below: float = math.inf) -> float | None:
    """A number greater than 0 (and below ``below``), else None.

    EXIF writes 0 for "unknown" or "not used" in the subject distance, the
    digital zoom ratio and the exposure time.
    """
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if 0 < value < below else None


# Words a maker's legal name ends with, left out where it is shown next to a
# model: "OLYMPUS IMAGING CORP." + "E-M5" shows as "OLYMPUS E-M5".
_CORPORATE_WORDS = frozenset(
    {
        "ag",
        "co",
        "company",
        "corp",
        "corporation",
        "electronics",
        "gmbh",
        "imaging",
        "inc",
        "limited",
        "ltd",
        "optical",
    }
)


def _maker_words(make: str) -> list[str]:
    """The words of a maker's name, without their dots ("CO.,LTD" -> CO, LTD)."""
    return [word for word in re.split(r"[\s,.]+", make) if word]


def _short_maker(make: str) -> str:
    """``make`` without the corporate words it ends with ("NIKON CORPORATION" -> "NIKON")."""
    words = _maker_words(make)
    while len(words) > 1 and words[-1].casefold() in _CORPORATE_WORDS:
        words.pop()
    return " ".join(words)


def _names_the_maker(name: str, make: str) -> bool:
    """Whether a model or lens name starts with a word of its maker's name:
    "NIKON D850" for "NIKON CORPORATION", "LG-H870" for "LG Electronics",
    but not "Leicaflex" for "Leica"."""
    folded = name.casefold()
    return any(
        re.match(rf"{re.escape(word)}(?![^\W_])", folded)
        for word in (word.casefold() for word in _maker_words(make))
        if word not in _CORPORATE_WORDS
    )


def with_maker(make: str | None, name: str | None) -> str | None:
    """A camera or lens name with its maker in front, unless it names it already."""
    if make and name:
        if _names_the_maker(name, make):
            return name
        return f"{_short_maker(make)} {name}"
    return name or make


def format_exposure_time(value: object) -> str | None:
    """An exposure time in seconds as ExifTool prints it: "1/4000" up to a
    quarter second, then seconds with at most one decimal ("0.3", "2.5", "30").

    The exif service reads ExposureTime with -n, so it arrives as seconds.
    None for anything that is not a positive number.
    """
    seconds = _positive_number(value)
    if seconds is None:
        return None
    # ExifTool's PrintExposureTime, including its rounding.
    if seconds < 0.25001:
        return f"1/{int(0.5 + 1 / seconds)}"
    text = f"{seconds:.1f}"
    return text.removesuffix(".0")


# The field name of the "restore from file" marker revert-all records; only
# edits after the latest one count as the user's (``_fields_edited_by_user``).
REVERT_ALL = "_all"

# Text cameras write into EXIF:ImageDescription when the user wrote nothing,
# and which some tools copy on into the XMP or IPTC caption. Never imported as
# a caption; compared case-insensitively, with runs of whitespace collapsed.
CAMERA_PLACEHOLDER_DESCRIPTIONS = frozenset(
    {
        "olympus digital camera",
        "sony dsc",
        "digital camera",
        "minolta digital camera",
        "konica minolta digital camera",
        "samsung camera pictures",
        "exif_jpeg_picture",
    }
)

# The file's caption candidates, best first: the XMP x-default entry, any XMP
# language entry, the IPTC caption, the EXIF one.
FILE_DESCRIPTION_SOURCES = (
    "xmp_description",
    "xmp_description_any_language",
    "iptc_caption",
    "image_description",
)
# Then the description in a Google Takeout JSON next to the file (#2270).
DESCRIPTION_SOURCES = (*FILE_DESCRIPTION_SOURCES, "takeout_description")

# The value names (``api.metadata.photo_reader.EXIF_FIELDS``) each free-text
# PhotoMetadata column is read from, best first.
TEXT_FIELD_SOURCES: dict[str, tuple[str, ...]] = {
    "title": ("xmp_title", "xmp_headline", "iptc_object_name"),
    "creator": ("xmp_creator", "iptc_byline", "exif_artist"),
    "copyright": ("xmp_rights", "iptc_copyright", "exif_copyright"),
}

TITLE_MAX_LENGTH = 500
CREATOR_MAX_LENGTH = 200
_TEXT_FIELD_MAX_LENGTH = {"title": TITLE_MAX_LENGTH, "creator": CREATOR_MAX_LENGTH}


def _texts(value: object) -> list[str]:
    """The non-empty texts of a tag value, which is a list for a repeated tag."""
    entries = value if isinstance(value, list) else [value]
    return [text for text in map(_text_value, entries) if text is not None]


def _folded(text: str) -> str:
    return " ".join(text.split()).casefold()


def _is_placeholder(text: str, camera: object) -> bool:
    """A camera's stock description, or one that only names the camera."""
    folded = _folded(text)
    if folded in CAMERA_PLACEHOLDER_DESCRIPTIONS:
        return True
    return isinstance(camera, str) and folded == _folded(camera)


def description_of(values: Mapping[str, object]) -> str | None:
    """The file's description: the first of ``DESCRIPTION_SOURCES`` that is
    not a camera placeholder."""
    camera = values.get("camera")
    for name in DESCRIPTION_SOURCES:
        for text in _texts(values.get(name)):
            if not _is_placeholder(text, camera):
                return text
    return None


def text_fields_of(values: Mapping[str, object]) -> dict[str, str | None]:
    """The file's title, creator and copyright, each from the first of its
    ``TEXT_FIELD_SOURCES`` that has one, cut to the column's length.

    A repeated tag (several XMP creators, say) gives its first entry.
    """
    found: dict[str, str | None] = {}
    for field, names in TEXT_FIELD_SOURCES.items():
        texts = [text for name in names for text in _texts(values.get(name))]
        text = texts[0] if texts else None
        limit = _TEXT_FIELD_MAX_LENGTH.get(field)
        found[field] = text[:limit] if text is not None and limit else text
    return found


def _merge_keywords(*values: object) -> list[str]:
    """Merge XMP:Subject / IPTC:Keywords entries as sorted, unique text."""
    merged = set()
    for value in values:
        if isinstance(value, list):
            entries = value
        elif isinstance(value, str) and not value:
            continue
        else:
            entries = [value]
        for entry in entries:
            text = entry if isinstance(entry, str) else _text_value(entry)
            if text is not None:
                merged.add(text)
    return sorted(merged)


def _hierarchy_leaves(value: object) -> list[str]:
    """The last level of each hierarchical keyword ("Places|USA|San Francisco")."""
    leaves = [text.rsplit("|", 1)[-1].strip() for text in _texts(value)]
    return [leaf for leaf in leaves if leaf]


def merged_keywords_of(values: Mapping[str, object]) -> list[str]:
    """The file's keywords: XMP:Subject, IPTC:Keywords, the XMP PersonInImage
    names and the leaf of each XMP HierarchicalSubject path, merged."""
    return _merge_keywords(
        values.get("xmp_subject"),
        values.get("iptc_keywords"),
        values.get("person_in_image"),
        _hierarchy_leaves(values.get("hierarchical_subject")),
    )


def keywords_to_import(
    keywords: list[str] | None, known: list[str] | None
) -> list[str] | None:
    """The ``keywords`` a scan turns into tags: all, or those not ``known`` yet."""
    if not known or not keywords:
        return keywords
    return sorted(tag_names(keywords) - tag_names(known))


class PhotoMetadata(models.Model):
    """
    What a photo's file says: technical metadata, keywords, title, copyright
    and creator.

    Capture date, location, rating and caption are not stored here: their one
    home is ``Photo`` / ``PhotoCaption`` (#2252). The metadata API still shows
    them, read from there. ``source`` is a row-level flag (``user_edit`` once
    any field of the photo was edited through ``api.metadata.edits``); which
    source wins per field on a rescan is #2250.
    """

    class Source(models.TextChoices):
        # Embedded in the file (EXIF, IPTC, embedded XMP)
        EMBEDDED = "embedded", "Embedded in File"
        # From XMP sidecar file
        SIDECAR = "sidecar", "XMP Sidecar"
        # User manually edited
        USER_EDIT = "user_edit", "User Edit"
        # Computed by LibrePhotos (AI, geocoding, etc.)
        COMPUTED = "computed", "Computed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    photo = models.OneToOneField(
        "Photo",
        on_delete=models.CASCADE,
        related_name="metadata",
    )

    # ==================== Camera Settings ====================
    # Aperture (f-stop), e.g., 2.8
    aperture = models.FloatField(null=True, blank=True, db_index=True)

    # Exposure time as ExifTool prints it: "1/250", "0.3", "2.5", "30"
    shutter_speed = models.CharField(max_length=20, null=True, blank=True)

    # Shutter speed in seconds (for queries), e.g., 0.004
    shutter_speed_seconds = models.FloatField(null=True, blank=True)

    # ISO sensitivity
    iso = models.IntegerField(null=True, blank=True, db_index=True)

    # Focal length in mm
    focal_length = models.FloatField(null=True, blank=True)

    # 35mm equivalent focal length
    focal_length_35mm = models.IntegerField(null=True, blank=True)

    # Exposure compensation in EV
    exposure_compensation = models.FloatField(null=True, blank=True)

    # Flash fired
    flash_fired = models.BooleanField(null=True, blank=True)

    # Metering mode
    metering_mode = models.CharField(max_length=50, null=True, blank=True)

    # White balance
    white_balance = models.CharField(max_length=50, null=True, blank=True)

    # Distance to the subject in metres
    subject_distance = models.FloatField(null=True, blank=True)

    # Digital zoom ratio; EXIF's 0 ("not used") is stored as NULL
    digital_zoom_ratio = models.FloatField(null=True, blank=True)

    # ==================== Camera/Lens Info ====================
    camera_make = models.CharField(max_length=100, null=True, blank=True, db_index=True)
    camera_model = models.CharField(
        max_length=100, null=True, blank=True, db_index=True
    )
    lens_make = models.CharField(max_length=100, null=True, blank=True)
    lens_model = models.CharField(max_length=100, null=True, blank=True, db_index=True)
    serial_number = models.CharField(max_length=100, null=True, blank=True)

    # ==================== Image Properties ====================
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    orientation = models.IntegerField(null=True, blank=True)
    color_space = models.CharField(max_length=50, null=True, blank=True)
    bit_depth = models.IntegerField(null=True, blank=True)

    # ==================== Timestamps ====================
    # The capture time itself is Photo.exif_timestamp.
    # Sub-second precision (from EXIF:SubSecTimeOriginal)
    date_taken_subsec = models.CharField(max_length=10, null=True, blank=True)

    # When the file was last modified
    date_modified = models.DateTimeField(null=True, blank=True)

    # Timezone offset if available
    timezone_offset = models.CharField(max_length=10, null=True, blank=True)

    # ==================== Location ====================
    # The coordinates are Photo.exif_gps_lat / exif_gps_lon, the place
    # Photo.geolocation_json.
    gps_altitude = models.FloatField(null=True, blank=True)

    # ==================== Content Description ====================
    # The caption is PhotoCaption.captions_json["user_caption"], the rating
    # Photo.rating.
    title = models.CharField(max_length=TITLE_MAX_LENGTH, null=True, blank=True)
    keywords = models.JSONField(null=True, blank=True)  # List of strings

    # Copyright info
    copyright = models.TextField(null=True, blank=True)
    creator = models.CharField(max_length=CREATOR_MAX_LENGTH, null=True, blank=True)

    # ==================== Tracking ====================
    # Which source this metadata came from
    source = models.CharField(
        max_length=20,
        choices=Source.choices,
        default=Source.EMBEDDED,
    )

    # Version tracking
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Photo Metadata"
        verbose_name_plural = "Photo Metadata"
        indexes = [
            models.Index(fields=["camera_make", "camera_model"]),
        ]

    def __str__(self) -> str:
        return f"Metadata for {self.photo_id}"

    @property
    def resolution(self) -> str | None:
        """Returns resolution as 'WxH' string."""
        if self.width and self.height:
            return f"{self.width}x{self.height}"
        return None

    @property
    def megapixels(self) -> float | None:
        """Returns megapixel count."""
        if self.width and self.height:
            return round((self.width * self.height) / 1_000_000, 1)
        return None

    @property
    def camera_display(self) -> str | None:
        """Returns a human-readable camera name."""
        return with_maker(self.camera_make, self.camera_model)

    @property
    def lens_display(self) -> str | None:
        """Returns a human-readable lens name."""
        return with_maker(self.lens_make, self.lens_model)

    @classmethod
    def apply_file_values(
        cls,
        photo: Photo,
        values: Mapping[str, object],
        commit: bool = True,
        new_keywords_only: bool = False,
    ) -> PhotoMetadata:
        """Update ``photo`` and its PhotoMetadata from the values read from its
        file (``api.metadata.photo_reader.read_file_values``).

        Each keyword becomes a tag. With ``new_keywords_only`` (the owner
        writes edits to files, #2289) only a keyword the file did not give
        before does: the tags are then the list the user edits and the file
        follows them, so a tag the user removed is not brought back by a
        keyword the file still has.
        """
        cls._apply_to_photo(photo, values)
        if commit:
            photo.save()

        metadata, created = cls.objects.get_or_create(
            photo=photo, defaults={"source": cls.Source.EMBEDDED}
        )
        known_keywords = metadata.keywords if new_keywords_only else None
        # The scan renders the thumbnails first: their aspect ratio is the
        # photo as shown. Read from the row, which the renderer saved.
        shown_aspect_ratio = (
            type(photo)
            .objects.filter(pk=photo.pk)
            .values_list("thumbnail__aspect_ratio", flat=True)
            .first()
        )
        cls._apply_to_metadata(
            metadata, values, photo.local_orientation, shown_aspect_ratio
        )

        if commit:
            metadata.save()
            # "Import tags from EXIF": the keywords read above also become Tag rows.
            link_tags_from_keywords(
                photo, keywords_to_import(metadata.keywords, known_keywords)
            )
            cls._import_description_to_caption(photo, description_of(values))

        return metadata

    @staticmethod
    def _apply_to_photo(photo: Photo, values: Mapping[str, object]) -> None:
        """Update the Photo fields that are still stored outside PhotoMetadata."""
        _assign_nonzero_number(photo, "size", values["size"])
        # MP4/MOV carry QuickTime:Duration, MKV/WebM Matroska:Duration.
        _assign_nonzero_number(
            photo,
            "video_length",
            values["video_length"] or values["matroska_duration"],
        )
        _assign_number(photo, "rating", values["rating"])

        # Burst/sequence detection fields
        subsec_time_original = values["subsec_time_original"]
        if subsec_time_original:
            # SubSecTimeOriginal is typically a string like "123" representing milliseconds
            photo.exif_timestamp_subsec = str(subsec_time_original)[:10]

        image_number = values["image_number"]
        # ExifTool's JSON holds only ints and floats here; the narrower check
        # is what lets int() below type-check.
        if image_number is not None and isinstance(image_number, int | float):
            photo.image_sequence_number = int(image_number)

    @staticmethod
    def _apply_to_metadata(
        metadata: PhotoMetadata,
        values: Mapping[str, object],
        local_orientation: int,
        shown_aspect_ratio: float | None,
    ) -> None:
        """Populate the PhotoMetadata columns from the extracted EXIF values.

        ``width`` and ``height`` are the size the photo is shown at, as its
        thumbnails, their aspect ratio and its face boxes are.
        """
        for field, name in (
            ("aperture", "fstop"),
            ("focal_length", "focal_length"),
            ("iso", "iso"),
            ("focal_length_35mm", "focal_length_35mm"),
        ):
            _assign_nonzero_number(metadata, field, values[name])

        width, height = values["width"], values["height"]
        if _shown_sideways(values, local_orientation, shown_aspect_ratio):
            # A portrait phone video is stored landscape with a rotation of 90
            # or 270 degrees, a portrait photo often with an EXIF orientation
            # of 5-8 (#2568): keep the size it is shown at.
            width, height = height, width
        _assign_nonzero_number(metadata, "width", width)
        _assign_nonzero_number(metadata, "height", height)
        _assign_number(metadata, "orientation", values["orientation"])

        # Videos carry no EXIF; their camera is in the QuickTime atoms.
        _assign_string(
            metadata, "camera_model", values["camera"] or values["quicktime_model"]
        )
        _assign_string(metadata, "lens_model", values["lens"])

        shutter_speed = format_exposure_time(values["shutter_speed"])
        if shutter_speed is not None:
            metadata.shutter_speed = shutter_speed

        PhotoMetadata._apply_camera_fields(metadata, values)

        subsec_time_original = values["subsec_time_original"]
        if subsec_time_original:
            metadata.date_taken_subsec = str(subsec_time_original)[:10]

        keywords = merged_keywords_of(values)
        if keywords:
            metadata.keywords = keywords

        PhotoMetadata._apply_text_fields(metadata, values)

    @staticmethod
    def _apply_camera_fields(
        metadata: PhotoMetadata, values: Mapping[str, object]
    ) -> None:
        """Maker, serial number and the exposure columns beyond the basics.

        A tag the file does not have leaves its column as it was: NULL on
        the first scan, never a 0 or "" placeholder.
        """
        for field, value in (
            # Videos carry no EXIF; their maker is in the QuickTime atoms.
            ("camera_make", values["camera_make"] or values["quicktime_make"]),
            ("lens_make", values["lens_make"]),
            ("serial_number", values["serial_number"]),
        ):
            # A serial number of digits only comes back from ExifTool as a number.
            text = _text_value(value)
            if text is not None:
                setattr(metadata, field, text[:_MAKER_MAX_LENGTH])

        # 0 EV and sea level are values.
        _assign_number(
            metadata, "exposure_compensation", values["exposure_compensation"]
        )
        _assign_number(metadata, "gps_altitude", values["gps_altitude"])

        for field, value in (
            ("shutter_speed_seconds", _positive_number(values["shutter_speed"])),
            (
                "subject_distance",
                _positive_number(
                    values["subject_distance"], below=_INFINITE_SUBJECT_DISTANCE
                ),
            ),
            ("digital_zoom_ratio", _positive_number(values["digital_zoom_ratio"])),
            ("metering_mode", _code_name(values["metering_mode"], METERING_MODES)),
            ("white_balance", _code_name(values["white_balance"], WHITE_BALANCES)),
            ("color_space", _code_name(values["color_space"], COLOR_SPACES)),
        ):
            if value is not None:
                setattr(metadata, field, value)

        flash = values["flash"]
        if isinstance(flash, int) and not isinstance(flash, bool):
            # Bit 0 of EXIF's Flash: whether it fired.
            metadata.flash_fired = bool(flash & 1)

        bits = values["bits_per_sample"]
        if isinstance(bits, int) and not isinstance(bits, bool) and bits > 0:
            metadata.bit_depth = bits

    @staticmethod
    def _apply_text_fields(
        metadata: PhotoMetadata, values: Mapping[str, object]
    ) -> None:
        """Fill title, creator and copyright from the file, except a field the
        user edited (and did not revert all) since: a rescan keeps theirs."""
        found = {field: text for field, text in text_fields_of(values).items() if text}
        if not found:
            return
        edited = _fields_edited_by_user(metadata, found)
        for field, text in found.items():
            if field not in edited:
                setattr(metadata, field, text)

    @staticmethod
    def _import_description_to_caption(photo: Photo, description: str | None) -> None:
        """Carry a newly found file description over to the lightbox caption.

        The caption a user sees and edits is ``captions_json["user_caption"]``.
        Metadata is re-extracted on every scan, so the description last
        imported is remembered under ``IMPORTED_DESCRIPTION_KEY`` and the
        lightbox caption is only touched when the file's description differs
        from it, i.e. on first import or after the file was edited. Even then
        it is only written when the lightbox caption is empty or still exactly
        the previously imported text: a caption the user typed over it is
        kept. A caption the user cleared stays cleared, because the unchanged
        description on the next scan matches the remembered one.

        It goes through ``PhotoCaption.apply_user_caption``, the same path as a
        typed caption, so it is indexed for search and its #hashtags become
        hashtag albums.
        """
        if not description:
            return

        from api.models.photo_caption import PhotoCaption

        caption_instance, _ = PhotoCaption.objects.get_or_create(photo=photo)
        captions = caption_instance.captions_json or {}
        previously_imported = captions.get(IMPORTED_DESCRIPTION_KEY)
        if description == previously_imported:
            return

        current = captions.get("user_caption") or ""
        caption_instance.captions_json = {
            **captions,
            IMPORTED_DESCRIPTION_KEY: description,
        }
        if current.strip() and current != previously_imported:
            caption_instance.save(update_fields=["captions_json"])
            return

        try:
            caption_instance.apply_user_caption(description, commit=True)
        except Exception:
            logger.exception(
                "could not import the description of photo %s as its caption",
                photo.image_hash,
            )


def _fields_edited_by_user(metadata: PhotoMetadata, fields: Iterable[str]) -> set[str]:
    """Which of ``fields`` the user edited after the latest revert-all.

    Every edit sets ``source`` to USER_EDIT and revert-all sets it back, so a
    photo never edited costs no query.
    """
    if metadata.source != PhotoMetadata.Source.USER_EDIT:
        return set()
    edits = (
        MetadataEdit.objects.filter(
            photo_id=metadata.photo_id,
            field_name__in=[*fields, REVERT_ALL],
        )
        .order_by("-created_at", "-id")
        .values_list("field_name", flat=True)
    )
    edited: set[str] = set()
    for field_name in edits:
        if field_name == REVERT_ALL:
            break
        edited.add(field_name)
    return edited


class MetadataEdit(models.Model):
    """
    Tracks user edits to photo metadata for history/undo functionality.

    Each edit records what field was changed, old value, new value,
    and who made the change.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    photo = models.ForeignKey(
        "Photo",
        on_delete=models.CASCADE,
        related_name="metadata_edits",
    )

    user = models.ForeignKey(
        User,
        on_delete=models.SET(get_deleted_user),
        related_name="metadata_edits",
    )

    # Which field was edited
    field_name = models.CharField(max_length=100)

    # JSON-serialized old and new values. DjangoJSONEncoder stores a
    # date_taken edit's datetime as an ISO string (plain json.dumps raises
    # TypeError); api.metadata.edits.revert_to parses it back.
    old_value = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)
    new_value = models.JSONField(null=True, blank=True, encoder=DjangoJSONEncoder)

    # Whether this edit has been written back to the file
    synced_to_file = models.BooleanField(default=False)
    synced_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # -id is a tiebreaker, not a second sort key: edits saved in the same
        # clock tick share a created_at, and without it the database is free to
        # return them in a different order per query, which lets a row repeat on
        # one page of the history endpoint and vanish from the next. id is a
        # random uuid4, so the order within a tick is arbitrary but stable.
        ordering = ["-created_at", "-id"]
        verbose_name = "Metadata Edit"
        verbose_name_plural = "Metadata Edits"
        indexes = [
            models.Index(fields=["photo", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"Edit {self.field_name} on {self.photo_id}"

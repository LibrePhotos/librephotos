from __future__ import annotations

import logging
import os
import unicodedata
from collections.abc import Sequence
from typing import TYPE_CHECKING, TypedDict

import PIL.Image

from api.metadata.orientation import normalize_orientation, region_to_stored
from api.metadata.reader import (
    get_metadata,
    sidecar_files_for_photo,
    sidecar_for_write,
)
from api.metadata.tags import Tags
from api.metadata.writer import TagValue, add_to, remove_from
from api.models.face import Face
from api.models.person import Person
from api.models.photo_metadata import merged_keywords_of

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)


class _FaceRegion(TypedDict):
    name: str
    x: float
    y: float
    w: float
    h: float


def thumbnail_coords_to_normalized(
    top: float,
    right: float,
    bottom: float,
    left: float,
    thumb_width: float,
    thumb_height: float,
) -> tuple[float, float, float, float]:
    """Convert Face model pixel coords (in big thumbnail space) to MWG-RS
    normalized center-based coords."""
    center_x = (left + right) / 2.0 / thumb_width
    center_y = (top + bottom) / 2.0 / thumb_height
    w = (right - left) / thumb_width
    h = (bottom - top) / thumb_height
    return center_x, center_y, w, h


def _escape_exiftool_value(value: str) -> str:
    """Escape special characters in a string value for exiftool structured data.

    ExifTool uses commas, equals, braces in its structured value syntax,
    so person names containing these characters need escaping.
    """
    # ExifTool expects special chars to be escaped with backslash
    for ch in ("\\", "{", "}", "=", ","):
        value = value.replace(ch, f"\\{ch}")
    return value


def _single_line(name: str) -> str:
    """The name with control characters (line breaks, tabs) turned into spaces.

    Names are user input, and ExifTool reads its arguments one per line: a
    line break in a name would start a new ExifTool argument.
    """
    return "".join(" " if unicodedata.category(ch) == "Cc" else ch for ch in name)


def build_face_region_exiftool_args(
    face_regions: list[_FaceRegion],
    image_width: int | None = None,
    image_height: int | None = None,
    previous_names: Sequence[str] = (),
    keywords: list[str] | None = None,
) -> dict[str, TagValue]:
    """Build exiftool args dict for writing XMP-mwg-rs:RegionInfo and XMP:Subject.

    Args:
        face_regions: list of dicts with keys: name, x, y, w, h
        image_width: original image width in pixels (for AppliedToDimensions)
        image_height: original image height in pixels (for AppliedToDimensions)
        previous_names: the names of the face regions the photo had before
        keywords: the keywords to start the target's XMP:Subject from, or
            None when the target has a keyword list of its own to change

    Returns:
        dict of tag -> value suitable for write_metadata()
    """
    region_parts: list[str] = []
    person_names: list[str] = []
    for region in face_regions:
        single_line = _single_line(region["name"])
        name = _escape_exiftool_value(single_line)
        x = f"{region['x']:.6f}"
        y = f"{region['y']:.6f}"
        w = f"{region['w']:.6f}"
        h = f"{region['h']:.6f}"
        region_parts.append(
            f"{{Area={{X={x},Y={y},W={w},H={h},Unit=normalized}}"
            f",Name={name},Type=Face}}"
        )
        if single_line:
            person_names.append(single_line)

    region_list = ",".join(region_parts)

    # Include AppliedToDimensions if image dimensions are available
    if image_width and image_height:
        applied_to = (
            f"AppliedToDimensions={{W={image_width},H={image_height},Unit=pixel}},"
        )
    else:
        applied_to = ""

    value = f"{{{applied_to}RegionList=[{region_list}]}}"

    tags: dict[str, TagValue] = {Tags.REGION_INFO_WRITE: value}
    tags.update(
        _person_keyword_tags(
            list(dict.fromkeys(person_names)), previous_names, keywords
        )
    )
    return tags


def _person_keyword_tags(
    names: list[str], previous_names: Sequence[str], keywords: list[str] | None
) -> dict[str, TagValue]:
    """XMP:Subject changes that put the people's ``names`` among the keywords.

    Lightroom and digiKam show people as keywords. The names are added to the
    photo's keywords, never assigned: an assignment replaced them (#2291).
    Each name is removed and added again, which adds it once, and a previous
    region name no longer on the photo (a relabelled face) is removed.
    ``keywords`` is the list to start from when the target has none yet.
    """
    removed = [name for name in dict.fromkeys(previous_names) if name not in names]
    if keywords is not None:
        kept = [keyword for keyword in keywords if keyword not in removed]
        merged = kept + [name for name in names if name not in kept]
        return {Tags.SUBJECT: merged} if merged else {}
    tags: dict[str, TagValue] = {}
    if removed or names:
        tags[remove_from(Tags.SUBJECT)] = [*removed, *names]
    if names:
        tags[add_to(Tags.SUBJECT)] = names
    return tags


def _region_names(region_info: object) -> list[str]:
    """The names of the face regions in a struct read of XMP:RegionInfo."""
    if not isinstance(region_info, dict):
        return []
    regions = region_info.get("RegionList")
    if not isinstance(regions, list):
        return []
    return [
        _single_line(str(region["Name"]))
        for region in regions
        if isinstance(region, dict)
        and region.get("Type") == "Face"
        and region.get("Name") not in (None, "")
    ]


def _keywords_to_start_from(photo: Photo, use_sidecar: bool) -> list[str] | None:
    """The keywords a sidecar's new XMP:Subject has to start from, or None.

    The scan reads a sidecar's XMP:Subject in place of the media file's, so a
    sidecar that gets its first keywords would hide the photo's own. It
    starts from them instead: XMP:Subject and IPTC:Keywords as the scan
    merges them. None when the target already has a keyword list (the media
    file, or a sidecar that has one), which is changed item by item.
    """
    if not use_sidecar:
        return None
    assert photo.main_file is not None
    main_path = photo.main_file.path
    target = sidecar_for_write(main_path)
    if os.path.exists(target):
        (own_subject,) = get_metadata(target, tags=[Tags.SUBJECT], try_sidecar=False)
        if own_subject is not None:
            return None
    (subject, iptc_keywords) = get_metadata(
        main_path,
        tags=[Tags.SUBJECT, Tags.IPTC_KEYWORDS],
        sidecar_files=sidecar_files_for_photo(photo),
    )
    return merged_keywords_of({"xmp_subject": subject, "iptc_keywords": iptc_keywords})


def get_face_region_tags(photo: Photo, use_sidecar: bool) -> dict[str, TagValue]:
    """Build face region exiftool tags dict for a photo.

    Returns a dict of tags suitable for merging into write_photo_metadata()'s
    tags_to_write, or an empty dict if no faces exist.

    Args:
        photo: Photo model instance
        use_sidecar: whether the tags go to the XMP sidecar or the media file

    Returns:
        dict: e.g. {"XMP-mwg-rs:RegionInfo": "{RegionList=[...]}"}  or {}
    """
    faces = Face.objects.filter(
        photo=photo,
        deleted=False,
    ).select_related("person")

    if not faces.exists():
        return {}

    # Get thumbnail dimensions
    try:
        thumb_path = photo.thumbnail.thumbnail_big.path
        thumb_image = PIL.Image.open(thumb_path)
        thumb_width, thumb_height = thumb_image.size
        thumb_image.close()
    except Exception:
        logger.error(
            "Cannot open thumbnail for photo %s, skipping face tags", photo.image_hash
        )
        return {}

    # Get EXIF orientation and original image dimensions. The face boxes are
    # in the displayed thumbnail, the regions go into the file as stored.
    assert photo.main_file is not None
    sidecar_files = sidecar_files_for_photo(photo)
    (orientation_value, image_width, image_height) = get_metadata(
        photo.main_file.path,
        tags=[Tags.ORIENTATION, Tags.IMAGE_WIDTH, Tags.IMAGE_HEIGHT],
        sidecar_files=sidecar_files,
    )
    # The face regions as the scan reads them, for the names they had.
    (region_info,) = get_metadata(
        photo.main_file.path,
        tags=[Tags.REGION_INFO],
        struct=True,
        sidecar_files=sidecar_files,
    )
    orientation = normalize_orientation(orientation_value)

    # Convert each face's coordinates
    face_regions: list[_FaceRegion] = []
    for face in faces:
        x, y, w, h = thumbnail_coords_to_normalized(
            face.location_top,
            face.location_right,
            face.location_bottom,
            face.location_left,
            thumb_width,
            thumb_height,
        )
        x, y, w, h = region_to_stored((x, y, w, h), orientation)
        # Only write person name for user-labeled faces
        if face.person and face.person.kind == Person.KIND_USER:
            name = face.person.name
        else:
            name = ""
        face_regions.append(
            {
                "name": name,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }
        )

    return build_face_region_exiftool_args(
        face_regions,
        image_width,
        image_height,
        previous_names=_region_names(region_info),
        keywords=_keywords_to_start_from(photo, use_sidecar),
    )

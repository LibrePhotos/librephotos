from __future__ import annotations

import logging
import os
import unicodedata
from collections.abc import Sequence
from typing import TYPE_CHECKING, TypedDict

import PIL.Image

from api.metadata.orientation import (
    SHOWN_ORIENTATION_TAGS,
    region_to_stored,
    shown_orientation,
)
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
from api.models.tag import Tag
from api.thumbnails.render import exif_orientation_showing

if TYPE_CHECKING:
    from django.db.models import QuerySet

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


def _face_regions(region_info: object) -> list[dict[str, object]]:
    """The face regions in a struct read of XMP:RegionInfo."""
    if not isinstance(region_info, dict):
        return []
    regions = region_info.get("RegionList")
    if not isinstance(regions, list):
        return []
    return [
        region
        for region in regions
        if isinstance(region, dict) and region.get("Type") == "Face"
    ]


def region_names(region_info: object) -> list[str]:
    """The names of the face regions in a struct read of XMP:RegionInfo."""
    return [
        _single_line(str(region["Name"]))
        for region in _face_regions(region_info)
        if region.get("Name") not in (None, "")
    ]


def _names_to_unlist(photo: Photo, region_info: object) -> list[str]:
    """The names of the file's face regions a write may take out of the keywords.

    Not a name the photo has as a tag: the keyword write-back (#2634) put
    that keyword there for the tag, and it stays while the tag does.
    """
    names = region_names(region_info)
    if not names:
        return []
    tagged = set(
        Tag.objects.owned_by(photo.owner)
        .filter(photos=photo, name__in=names)
        .values_list("name", flat=True)
    )
    return [name for name in names if name not in tagged]


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


#: What a sidecar says for "no face regions" (#1531): an empty
#: ``mwg-rs:Regions``. ExifTool reads it back as "", which the scan takes
#: over the original's regions; removing the tag from the sidecar instead
#: would let the regions of the original show through again.
NO_REGIONS = "{}"


def get_face_region_tags(photo: Photo, use_sidecar: bool) -> dict[str, TagValue]:
    """The tags that make the target's face regions the photo's live faces.

    Returns a dict of tags suitable for merging into write_photo_metadata()'s
    tags_to_write, or an empty dict when there is nothing to write. A photo
    whose faces were all deleted gets its regions cleared
    (``_cleared_region_tags``); one that never had a face is left alone.

    Args:
        photo: Photo model instance
        use_sidecar: whether the tags go to the XMP sidecar or the media file

    Returns:
        dict: e.g. {"XMP-mwg-rs:RegionInfo": "{RegionList=[...]}"}  or {}
    """
    faces = list(_region_faces(photo).filter(deleted=False).select_related("person"))
    if not faces:
        return _cleared_region_tags(photo, use_sidecar)

    thumbnail_size = _thumbnail_size(photo)
    if thumbnail_size is None:
        return {}

    # Get EXIF orientation and original image dimensions. The face boxes are
    # in the displayed thumbnail, the regions go into the file as stored.
    assert photo.main_file is not None
    sidecar_files = sidecar_files_for_photo(photo)
    (image_width, image_height, *orientation_values) = get_metadata(
        photo.main_file.path,
        tags=[Tags.IMAGE_WIDTH, Tags.IMAGE_HEIGHT, *SHOWN_ORIENTATION_TAGS],
        sidecar_files=sidecar_files,
    )
    region_info = _region_info(photo, sidecar_files)
    # The thumbnail shows the file under its own orientation (#2615) with the
    # user's LibrePhotos rotation on top (#2606).
    orientation = exif_orientation_showing(
        shown_orientation(photo.main_file.path, *orientation_values),
        photo.local_orientation,
    )

    return build_face_region_exiftool_args(
        [_face_region(face, thumbnail_size, orientation) for face in faces],
        image_width,
        image_height,
        previous_names=_names_to_unlist(photo, region_info),
        keywords=_keywords_to_start_from(photo, use_sidecar),
    )


def _region_faces(photo: Photo) -> QuerySet[Face]:
    """The faces that are regions of the file: a video's later frames' are not.

    Their boxes are in the pixels of a frame of the video (#2761), which no
    region of the file can say.
    """
    return Face.objects.filter(photo=photo, video_time__isnull=True)


def _cleared_region_tags(photo: Photo, use_sidecar: bool) -> dict[str, TagValue]:
    """The tags that take every face region out of the target (#1531), or none.

    Only for a photo whose faces were all deleted in LibrePhotos while its
    files still give face regions: a photo without any face (not scanned for
    faces yet) keeps the regions another app wrote. The media file loses
    ``RegionInfo``; a sidecar gets ``NO_REGIONS``. The names of the regions
    go from the keywords too, as on a relabel (``_person_keyword_tags``).
    """
    if not _region_faces(photo).filter(deleted=True).exists():
        return {}
    region_info = _region_info(photo, sidecar_files_for_photo(photo))
    if not _face_regions(region_info):
        return {}
    tags: dict[str, TagValue] = {
        Tags.REGION_INFO_WRITE: NO_REGIONS if use_sidecar else ""
    }
    names = _names_to_unlist(photo, region_info)
    if names:
        tags.update(
            _person_keyword_tags([], names, _keywords_to_start_from(photo, use_sidecar))
        )
    return tags


def _region_info(photo: Photo, sidecar_files: list[str]) -> object:
    """The face regions as the scan reads them (a struct), for the names they had."""
    assert photo.main_file is not None
    (region_info,) = get_metadata(
        photo.main_file.path,
        tags=[Tags.REGION_INFO],
        struct=True,
        sidecar_files=sidecar_files,
    )
    return region_info


def _thumbnail_size(photo: Photo) -> tuple[int, int] | None:
    """The width and height of the big thumbnail the face boxes are in, or None."""
    try:
        thumb_path = photo.thumbnail.thumbnail_big.path
        thumb_image = PIL.Image.open(thumb_path)
        width, height = thumb_image.size
        thumb_image.close()
    except Exception:
        logger.error(
            "Cannot open thumbnail for photo %s, skipping face tags", photo.image_hash
        )
        return None
    return width, height


def _face_region(
    face: Face, thumbnail_size: tuple[int, int], orientation: int
) -> _FaceRegion:
    """``face`` as a region of the stored image; only a user's label names it."""
    x, y, w, h = thumbnail_coords_to_normalized(
        face.location_top,
        face.location_right,
        face.location_bottom,
        face.location_left,
        *thumbnail_size,
    )
    x, y, w, h = region_to_stored((x, y, w, h), orientation)
    person = face.person
    name = person.name if person and person.kind == Person.KIND_USER else ""
    return {"name": name, "x": x, "y": y, "w": w, "h": h}

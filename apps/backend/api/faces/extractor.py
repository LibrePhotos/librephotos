from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import PIL.Image

from api.faces.recognition import detect_faces
from api.lazy_import import LazyModule
from api.metadata.orientation import normalize_orientation, region_to_display
from api.metadata.reader import get_metadata
from api.metadata.tags import Tags

if TYPE_CHECKING:
    from typing import TypeAlias, Unpack

    from api.models.user import User

    # (top, right, bottom, left, person name or None, *optional encoding).
    # Unpack[...] instead of `*tuple[...]`: a star expression in a subscript is
    # Python 3.11 syntax, and the backend-gpu image runs 3.10.
    FaceLocation: TypeAlias = tuple[
        int, int, int, int, str | None, Unpack[tuple[object, ...]]
    ]

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)


def _is_number(value: float | str | None) -> bool:
    """Whether ``float(value)`` works: a number or a numeric string, not None."""
    if value is None:
        return False
    try:
        float(value)
    except (TypeError, ValueError):
        # TypeError: a value of another type read from the file (a list).
        return False
    return True


def has_normalized_area(
    area: dict[str, Any] | None, applied_to_dimensions: dict[str, Any] | None
) -> bool:
    return bool(area and area.get("Unit") == "normalized") or bool(
        applied_to_dimensions and applied_to_dimensions.get("Unit") == "pixel"
    )


def to_face_box(
    area: dict[str, Any], orientation: int, image_width: int, image_height: int
) -> tuple[int, int, int, int] | None:
    """The face box (top, right, bottom, left) in the displayed thumbnail of
    an MWG-RS ``area``, which is in the stored image's coordinates."""
    # Values may be missing (None); the _is_number check below rules that out.
    values: list[Any] = [area.get(key) for key in ("X", "Y", "W", "H")]
    if not all(_is_number(value) for value in values):
        return None

    x, y, w, h = (float(value) for value in values)
    x, y, w, h = region_to_display((x, y, w, h), orientation)

    half_width = (w * image_width) / 2
    half_height = (h * image_height) / 2
    return (
        int((y * image_height) - half_height),
        int((x * image_width) + half_width),
        int((y * image_height) + half_height),
        int((x * image_width) - half_width),
    )


def extract_from_exif(
    image_path: str,
    big_thumbnail_image_path: str,
    sidecar_files: list[str] | None = None,
) -> list[FaceLocation] | None:
    """Face regions in the file or its sidecars; *sidecar_files* as in ``get_metadata``."""
    (region_info, orientation) = get_metadata(
        image_path,
        tags=[Tags.REGION_INFO, Tags.ORIENTATION],
        try_sidecar=True,
        struct=True,
        sidecar_files=sidecar_files,
    )
    if not region_info:
        return None
    logger.debug("Extracted region_info for %s", image_path)
    logger.debug("region_info: %s", region_info)
    face_locations: list[FaceLocation] = []
    for region in region_info["RegionList"]:
        if region.get("Type") != "Face":
            continue

        area = region.get("Area")
        big_thumbnail_image = np.array(PIL.Image.open(big_thumbnail_image_path))
        if not has_normalized_area(area, region.get("AppliedToDimensions")):
            continue

        box = to_face_box(
            area,
            normalize_orientation(orientation),
            big_thumbnail_image.shape[1],
            big_thumbnail_image.shape[0],
        )
        if box is None:
            logger.info(
                "Broken face area exif data! No numerical positional data. region_info: %s",
                region_info,
            )
            continue

        face_locations.append((*box, region.get("Name")))
    return face_locations


def extract_from_face_service(big_thumbnail_path: str) -> list[FaceLocation]:
    """Detected faces as (top, right, bottom, left, None, encoding).

    A face-service error propagates: answering "no faces" for it would mark
    the photo as scanned and it would never be scanned again (#2199).
    """
    face_locations: list[FaceLocation] = []
    for location, encoding in detect_faces(big_thumbnail_path):
        top, right, bottom, left = location
        face_locations.append((top, right, bottom, left, None, encoding))
    return face_locations


def extract(
    image_path: str,
    big_thumbnail_path: str,
    owner: User,
    sidecar_files: list[str] | None = None,
) -> list[FaceLocation]:
    exif = extract_from_exif(image_path, big_thumbnail_path, sidecar_files)
    if not exif:
        return extract_from_face_service(big_thumbnail_path)
    return exif

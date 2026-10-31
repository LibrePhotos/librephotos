from __future__ import annotations

import logging
import math
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

import PIL.Image

from api.faces.geometry import FACE_OVERLAP_IOU_THRESHOLD, Box, calculate_iou
from api.faces.recognition import detect_faces
from api.lazy_import import LazyModule
from api.metadata.orientation import (
    SHOWN_ORIENTATION_TAGS,
    Region,
    region_to_display,
    shown_orientation,
)
from api.metadata.reader import get_metadata
from api.metadata.tags import Tags
from api.thumbnails.render import exif_orientation_showing

if TYPE_CHECKING:
    # (top, right, bottom, left, person name or None, *optional encoding).
    type FaceLocation = tuple[int, int, int, int, str | None, *tuple[object, ...]]

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
    except TypeError, ValueError:
        # TypeError: a value of another type read from the file (a list).
        return False
    return True


def has_normalized_area(
    area: dict[str, Any] | None, applied_to_dimensions: dict[str, Any] | None
) -> bool:
    return bool(area and area.get("Unit") == "normalized") or bool(
        applied_to_dimensions and applied_to_dimensions.get("Unit") == "pixel"
    )


def _area_region(area: dict[str, Any]) -> Region | None:
    """The (x, y, w, h) of an MWG-RS ``area``; None when one is not a number."""
    # Values may be missing (None); the _is_number check rules that out.
    values: list[Any] = [area.get(key) for key in ("X", "Y", "W", "H")]
    if not all(_is_number(value) for value in values):
        return None
    x, y, w, h = (float(value) for value in values)
    return x, y, w, h


def to_face_box(
    area: dict[str, Any], orientation: int, image_width: int, image_height: int
) -> tuple[int, int, int, int] | None:
    """The face box (top, right, bottom, left) in the displayed thumbnail of
    an MWG-RS ``area``, which is in the stored image's coordinates."""
    region = _area_region(area)
    if region is None:
        return None
    return _display_box(region, orientation, image_width, image_height)


def _display_box(
    region: Region, orientation: int, image_width: int, image_height: int
) -> tuple[int, int, int, int]:
    """(top, right, bottom, left) of a stored ``region`` in the displayed thumbnail."""
    x, y, w, h = region_to_display(region, orientation)

    half_width = (w * image_width) / 2
    half_height = (h * image_height) / 2
    return (
        int((y * image_height) - half_height),
        int((x * image_width) + half_width),
        int((y * image_height) + half_height),
        int((x * image_width) - half_width),
    )


# How far two aspect ratios (width / height) may differ and still be the same
# picture at another size: rounding when it was resized.
_ASPECT_TOLERANCE = math.log(1.05)


def _stored_aspect(orientation: int, image_width: int, image_height: int) -> float:
    """Width / height of the stored picture the thumbnail shows under ``orientation``."""
    if orientation in (5, 6, 7, 8):
        image_width, image_height = image_height, image_width
    return image_width / image_height


def is_quarter_turn_off(
    applied_to_dimensions: dict[str, Any] | None, stored_aspect: float
) -> bool:
    """Whether MWG-RS ``AppliedToDimensions`` are of the picture turned a quarter (#2887).

    An exporter that turns the pixels (and resets Orientation) may keep the
    regions of the picture as it was, and their dimensions. Like the regions,
    the dimensions are of the stored pixels, before Orientation, so they are
    compared with the stored picture, not the one shown. They are a quarter
    turn off when they fit the stored picture turned (allowing for a resize)
    and do not fit it as it is.
    """
    if not applied_to_dimensions or applied_to_dimensions.get("Unit") != "pixel":
        return False
    values: list[Any] = [applied_to_dimensions.get(key) for key in ("W", "H")]
    if not all(_is_number(value) for value in values):
        return False
    width, height = (float(value) for value in values)
    if width <= 0 or height <= 0:
        return False
    log_aspect = math.log(width / height)
    return (
        abs(log_aspect + math.log(stored_aspect)) <= _ASPECT_TOLERANCE
        and abs(log_aspect - math.log(stored_aspect)) > _ASPECT_TOLERANCE
    )


def _on_a_face(box: Box, detected_boxes: Sequence[Box]) -> bool:
    """Whether ``box`` is a detected face (``FACE_OVERLAP_IOU_THRESHOLD``)."""
    return any(
        calculate_iou(box, detected) >= FACE_OVERLAP_IOU_THRESHOLD
        for detected in detected_boxes
    )


def _confirmed_quarter_turn(
    region: Region,
    orientation: int,
    image_size: tuple[int, int],
    detected_boxes: Sequence[Box],
) -> tuple[int, int, int, int] | None:
    """The box of ``region`` turned the one way a detected face confirms.

    The dimensions say the pixels were turned a quarter, not which way: both
    ways are tried, and the answer is the one a detected face is on, if it is
    the only one. None when neither or both are.
    """
    # 6 turns the stored pixels a quarter clockwise, 8 counter-clockwise; the
    # turned picture is then shown under the file's orientation.
    turned = (
        _display_box(region_to_display(region, turn), orientation, *image_size)
        for turn in (6, 8)
    )
    confirmed = [box for box in turned if _on_a_face(box, detected_boxes)]
    return confirmed[0] if len(confirmed) == 1 else None


def extract_from_exif(
    image_path: str,
    big_thumbnail_image_path: str,
    sidecar_files: list[str] | None = None,
    local_orientation: int = 1,
    detected_faces: Sequence[FaceLocation] | None = None,
) -> list[FaceLocation] | None:
    """Face regions in the file or its sidecars; *sidecar_files* as in ``get_metadata``.

    The boxes are in the big thumbnail, which shows the file under its own
    orientation (``shown_orientation``, #2615) with the photo's
    ``local_orientation`` on top (#2606).

    With the face service's ``detected_faces``, a region whose dimensions are
    a quarter turn off the picture (``is_quarter_turn_off``, #2887) and that
    is on no detected face is turned onto the detected face that confirms
    one of the two ways (``_confirmed_quarter_turn``). Every other region
    stays as written.
    """
    (region_info, *orientation_values) = get_metadata(
        image_path,
        tags=[Tags.REGION_INFO, *SHOWN_ORIENTATION_TAGS],
        try_sidecar=True,
        struct=True,
        sidecar_files=sidecar_files,
    )
    if not region_info:
        return None
    logger.debug("Extracted region_info for %s", image_path)
    logger.debug("region_info: %s", region_info)
    detected_boxes: list[Box] = [
        (face[0], face[1], face[2], face[3]) for face in detected_faces or []
    ]
    face_locations: list[FaceLocation] = []
    for region in region_info["RegionList"]:
        if region.get("Type") != "Face":
            continue

        area = region.get("Area")
        big_thumbnail_image = np.array(PIL.Image.open(big_thumbnail_image_path))
        if not has_normalized_area(area, region.get("AppliedToDimensions")):
            continue

        orientation = exif_orientation_showing(
            shown_orientation(image_path, *orientation_values), local_orientation
        )
        image_size = (big_thumbnail_image.shape[1], big_thumbnail_image.shape[0])
        box = to_face_box(area, orientation, *image_size)
        if box is None:
            logger.info(
                "Broken face area exif data! No numerical positional data. region_info: %s",
                region_info,
            )
            continue

        if (
            detected_faces is not None
            and is_quarter_turn_off(
                region.get("AppliedToDimensions")
                or region_info.get("AppliedToDimensions"),
                _stored_aspect(orientation, *image_size),
            )
            and not _on_a_face(box, detected_boxes)
        ):
            stored_region = _area_region(area)
            assert stored_region is not None  # to_face_box read it
            turned = _confirmed_quarter_turn(
                stored_region, orientation, image_size, detected_boxes
            )
            if turned is not None:
                logger.info(
                    "%s: the region of face %s is a quarter turn off the "
                    "picture; turned onto the detected face (#2887)",
                    image_path,
                    region.get("Name"),
                )
                box = turned

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

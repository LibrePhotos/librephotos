"""Finding the face inside a box drawn by hand (#1117).

The detector runs on the whole big thumbnail, where a small, turned or
blurred face is a few dozen pixels and below what it finds. When the user
draws a box around such a face, the user already did the hard part: saying
where it is. The face service gets that part of the photo alone (the box
with a margin, enlarged so the face is as large as the detector likes it)
and finds the face there. Its box replaces the rough one and its encoding
comes with it, so the face clusters like a detected one.

Only a face whose centre lies inside the drawn box is taken, and of those
the one that overlaps it most: someone next to the face the user meant is
not picked instead.
"""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass
from typing import TYPE_CHECKING

import PIL.Image
import requests

from api.faces.geometry import Box, calculate_iou
from api.faces.recognition import detect_faces
from api.lazy_import import LazyModule

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)

# The margin around the drawn box, as a share of its width and height on each
# side: a rough box may cut the face off.
MARGIN = 0.5
# The face service looks at a picture at about this size (DETECTION_SIZE in
# service/face_recognition/face_analysis.py); a smaller crop is enlarged to it.
DETECTION_SIZE = 640

# (top, right, bottom, left) in big-thumbnail pixels.
PixelBox = tuple[int, int, int, int]


class FaceServiceError(Exception):
    """The face service could not look at the box (down, off, or failing)."""


@dataclass(frozen=True)
class FoundFace:
    """The face found in a drawn box: where it is, and its encoding."""

    box: PixelBox
    encoding: npt.NDArray[float64] | None


@dataclass(frozen=True)
class _Crop:
    """The part of the thumbnail the face service looks at, and how it was cut."""

    image: PIL.Image.Image
    left: int
    top: int
    scale: float


def find_face_in_box(thumbnail: PIL.Image.Image, drawn: PixelBox) -> FoundFace | None:
    """The face inside ``drawn`` on ``thumbnail``, or None when there is none.

    Raises ``FaceServiceError`` when the face service cannot answer.
    """
    crop = _crop_around(thumbnail, drawn)
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "drawn_face.png")
        crop.image.save(path)
        try:
            detections = detect_faces(path)
        except (requests.RequestException, ValueError, KeyError) as error:
            raise FaceServiceError(str(error)) from error
    found = [
        FoundFace(_to_thumbnail(crop, location, thumbnail.size), encoding)
        for location, encoding in detections
    ]
    return _best_match(drawn, found)


def _crop_around(thumbnail: PIL.Image.Image, drawn: PixelBox) -> _Crop:
    """The drawn box with its margin, inside the thumbnail, enlarged up to ``DETECTION_SIZE``."""
    top, right, bottom, left = drawn
    margin_x = round((right - left) * MARGIN)
    margin_y = round((bottom - top) * MARGIN)
    width, height = thumbnail.size
    crop_left, crop_top = max(0, left - margin_x), max(0, top - margin_y)
    crop_right = min(width, right + margin_x)
    crop_bottom = min(height, bottom + margin_y)
    image = thumbnail.crop((crop_left, crop_top, crop_right, crop_bottom)).convert(
        "RGB"
    )
    scale = max(1.0, DETECTION_SIZE / max(image.size))
    if scale > 1:
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)),
            PIL.Image.Resampling.LANCZOS,
        )
    return _Crop(image, crop_left, crop_top, scale)


def _to_thumbnail(crop: _Crop, location: list[int], size: tuple[int, int]) -> PixelBox:
    """A box the face service found in ``crop``, in thumbnail pixels, inside the thumbnail."""
    top, right, bottom, left = (side / crop.scale for side in location)
    width, height = size
    return (
        max(0, round(top + crop.top)),
        min(width, round(right + crop.left)),
        min(height, round(bottom + crop.top)),
        max(0, round(left + crop.left)),
    )


def _best_match(drawn: PixelBox, found: list[FoundFace]) -> FoundFace | None:
    """The found face centred inside ``drawn`` that overlaps it most, if any."""
    top, right, bottom, left = drawn
    inside = [
        face
        for face in found
        if left <= (face.box[1] + face.box[3]) / 2 <= right
        and top <= (face.box[0] + face.box[2]) / 2 <= bottom
    ]
    drawn_box: Box = drawn
    return max(
        inside, key=lambda face: calculate_iou(drawn_box, face.box), default=None
    )

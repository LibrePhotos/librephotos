"""Finding the people of a video in its later frames, not only the first (#2761).

A video's big thumbnail is its first frame, and Scan Faces used to read only
that: whoever walked in later was never found. ``frame_faces`` reads up to
``MAX_FRAMES`` frames spread over the video, asks the face service for the
faces in each and keeps one face per person: a face whose encoding matches a
face the video has already (``SAME_PERSON_SIMILARITY``), or a bigger one from
another frame, is the same person seen again. The bigger face of a person is
the one kept, since it is the sharper crop and the better encoding.

The work per video is bounded: ``MAX_FRAMES`` frames, ``FRAME_TIMEOUT`` per
ffmpeg run and ``TIME_BUDGET_SECONDS`` for all of them. The frames go into a
temporary folder, deleted when the scan of the video is done.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING

import PIL.Image

from api.faces import extractor
from api.faces.geometry import min_face_height
from api.lazy_import import LazyModule
from api.models.cluster import unit_length
from api.video import frames

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

    from api.models import Photo

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)

# Frames read per video, on top of the first one the big thumbnail shows.
MAX_FRAMES = 8
# A shorter video is read on its first frame only, as before.
MIN_VIDEO_SECONDS = 2.0
# The frames are spread from 5 % to 95 % of the video: its very start is the
# big thumbnail, and its last frames are often a fade or a pocket.
FIRST_FRAME_SHARE = 0.05
LAST_FRAME_SHARE = 0.95
# Frames closer together than this show the same moment.
MIN_FRAME_GAP_SECONDS = 1.0
# Grabbing and reading the frames of one video stops after this; the faces
# found until then are kept.
TIME_BUDGET_SECONDS = 120.0
# Two faces whose encodings are at least this similar (cosine) are one
# person: the face recognition models give one person's faces 0.5 and more,
# two people's well below.
SAME_PERSON_SIMILARITY = 0.5


@dataclass
class FrameFace:
    """A face found in a video frame: when, its crop, its box and its encoding."""

    video_time: float
    image: PIL.Image.Image
    # (top, right, bottom, left) in the frame's pixels.
    location: tuple[int, int, int, int]
    encoding: npt.NDArray[float64]

    @property
    def height(self) -> int:
        return self.location[2] - self.location[0]


def video_seconds(video_length: str | None) -> float | None:
    """The length of a video in seconds from ``Photo.video_length``, or None.

    The scan stores what ExifTool read (a number of seconds); a video it
    could not read has none.
    """
    try:
        seconds = float(video_length or "")
    except ValueError:
        return None
    return seconds if seconds > 0 else None


def frame_times(seconds: float | None) -> list[float]:
    """The seconds of the frames to read, evenly spread over the video.

    None for a video shorter than ``MIN_VIDEO_SECONDS`` or of unknown length.
    At most ``MAX_FRAMES``, and no closer together than
    ``MIN_FRAME_GAP_SECONDS``.
    """
    if seconds is None or seconds < MIN_VIDEO_SECONDS:
        return []
    first = seconds * FIRST_FRAME_SHARE
    last = seconds * LAST_FRAME_SHARE
    # Two at least: MIN_VIDEO_SECONDS spreads them a gap apart or more.
    count = max(2, min(MAX_FRAMES, int((last - first) // MIN_FRAME_GAP_SECONDS) + 1))
    step = (last - first) / (count - 1)
    return [round(first + index * step, 3) for index in range(count)]


def frame_faces(
    photo: Photo, known_encodings: Iterable[npt.NDArray[float64]]
) -> list[FrameFace]:
    """One face per person found in the video's frames and not among ``known_encodings``.

    ``known_encodings`` are those of the faces the video has already (its
    first frame's, and those an earlier scan found in its frames). A
    face-service error is raised, as for a photo; a frame ffmpeg cannot
    grab is skipped.
    """
    times = frame_times(video_seconds(photo.video_length))
    if not times or photo.main_file is None:
        return []
    candidates = _faces_in_frames(photo, times)
    return distinct_people(candidates, [unit_length(e) for e in known_encodings])


def distinct_people(
    candidates: list[FrameFace], known: list[npt.NDArray[float64]]
) -> list[FrameFace]:
    """The candidates showing a person none of ``known`` (unit length) shows.

    Biggest first, so of one person's faces the biggest is kept; between
    faces of one size, the earlier frame's. The kept faces' encodings are
    added to ``known``.
    """
    kept: list[FrameFace] = []
    for candidate in sorted(candidates, key=lambda face: -face.height):
        encoding = unit_length(candidate.encoding)
        if _same_person_as_any(encoding, known):
            continue
        kept.append(candidate)
        known.append(encoding)
    return kept


def _same_person_as_any(
    encoding: npt.NDArray[float64], known: list[npt.NDArray[float64]]
) -> bool:
    """Whether ``encoding`` is close enough to one of ``known`` to be that person.

    An encoding of another length comes from another face model and is
    never a match.
    """
    return any(
        other.shape == encoding.shape
        and float(np.dot(encoding, other)) >= SAME_PERSON_SIMILARITY
        for other in known
    )


def _faces_in_frames(photo: Photo, times: list[float]) -> list[FrameFace]:
    """The faces of the frames at ``times``, until ``TIME_BUDGET_SECONDS`` is spent."""
    assert photo.main_file is not None
    deadline = time.monotonic() + TIME_BUDGET_SECONDS
    found: list[FrameFace] = []
    with tempfile.TemporaryDirectory(prefix="librephotos-frames-") as folder:
        for index, seconds in enumerate(times):
            if time.monotonic() > deadline:
                logger.warning(
                    "video %s: frame scan stopped after %d of %d frames",
                    photo.image_hash,
                    index,
                    len(times),
                )
                break
            frame_path = os.path.join(folder, f"{index}-frame.jpg")
            try:
                frames.grab_frame(
                    photo.main_file.path,
                    seconds,
                    frame_path,
                    photo.video_color_transfer,
                )
            except frames.FrameError as error:
                logger.warning(
                    "video %s: no frame at %.1f s: %s", photo.image_hash, seconds, error
                )
                continue
            found += _faces_in_frame(photo, seconds, frame_path)
    return found


def _faces_in_frame(photo: Photo, seconds: float, frame_path: str) -> list[FrameFace]:
    """The faces the face service finds in one frame, at least the owner's minimum size.

    A detection without an encoding (a sidecar from before encodings came
    with the detections) cannot be told apart from the others: skipped.
    """
    detected = extractor.extract_from_face_service(frame_path)
    if not detected:
        return []
    with PIL.Image.open(frame_path) as frame:
        picture = np.array(frame.convert("RGB"))
    min_height = min_face_height(picture.shape, photo.owner.min_face_size)
    found: list[FrameFace] = []
    for top, right, bottom, left, _name, *rest in detected:
        encoding = rest[0] if rest else None
        if not isinstance(encoding, np.ndarray) or bottom - top < min_height:
            continue
        found.append(
            FrameFace(
                seconds,
                PIL.Image.fromarray(picture[top:bottom, left:right]),
                (top, right, bottom, left),
                encoding,
            )
        )
    return found

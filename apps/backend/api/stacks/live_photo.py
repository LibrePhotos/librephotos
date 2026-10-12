"""Motion video embedded in a still: Google Pixel and Samsung Motion Photos.

- Google Pixel Motion Photos: an MP4 after the JPEG end-of-image marker
- Samsung Motion Photos: the video after a ``MotionPhoto_Data`` marker

The scan (``api/directory_watcher/file_handlers.py``) extracts the video and
keeps it as a file variant of the photo. Apple Live Photos are a still and a
``.mov`` with the same name, paired by the scan's file grouping.
"""

import logging
from mmap import ACCESS_READ, mmap
from pathlib import Path

from django.conf import settings

from api.mime import mime_type

logger = logging.getLogger(__name__)


# Markers for embedded motion video detection
JPEG_EOI_MARKER = b"\xff\xd9"
GOOGLE_PIXEL_MP4_SIGNATURES = [b"ftypmp42", b"ftypisom", b"ftypiso2"]
SAMSUNG_MOTION_MARKER = b"MotionPhoto_Data"


def _locate_google_embedded_video(data: bytes | mmap) -> int:
    """Find position of embedded MP4 in Google Motion Photo."""
    for signature in GOOGLE_PIXEL_MP4_SIGNATURES:
        position = data.find(signature)
        if position != -1:
            # MP4 header starts 4 bytes before ftyp
            return position - 4
    return -1


def _locate_samsung_embedded_video(data: bytes | mmap) -> int:
    """Find position of embedded video in Samsung Motion Photo."""
    position = data.find(SAMSUNG_MOTION_MARKER)
    if position != -1:
        # Video starts immediately after the marker
        return position + len(SAMSUNG_MOTION_MARKER)
    return -1


def has_embedded_motion_video(path: str) -> bool:
    """
    Check if a JPEG file contains an embedded motion video.

    Supports:
    - Google Pixel Motion Photos
    - Samsung Motion Photos

    Args:
        path: Path to the image file

    Returns:
        True if embedded video detected, False otherwise
    """
    try:
        if mime_type(path) != "image/jpeg":
            return False

        with open(path, "rb") as image:
            with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
                return (
                    _locate_google_embedded_video(mm) != -1
                    or _locate_samsung_embedded_video(mm) != -1
                )
    except Exception as e:
        logger.warning("Error checking for embedded video in %s: %s", path, e)
        return False


def extract_embedded_motion_video(path: str, output_hash: str) -> str | None:
    """
    Extract embedded motion video from a JPEG file.

    Args:
        path: Path to the source image file
        output_hash: Hash to use for output filename

    Returns:
        Path to extracted video file, or None if extraction failed
    """
    try:
        with open(str(path), "rb") as image:
            with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
                # Try Google format first, then Samsung
                position = _locate_google_embedded_video(mm)
                if position == -1:
                    position = _locate_samsung_embedded_video(mm)

                if position == -1:
                    return None

                # Create output directory
                output_dir = Path(settings.MEDIA_ROOT) / "embedded_media"
                output_dir.mkdir(parents=True, exist_ok=True)

                output_path = output_dir / f"{output_hash}_motion.mp4"

                with open(output_path, "wb") as video:
                    mm.seek(position)
                    data = mm.read(mm.size() - position)
                    video.write(data)

                logger.info("Extracted motion video to %s", output_path)
                return str(output_path)

    except Exception as e:
        logger.error("Error extracting embedded video from %s: %s", path, e)
        return None

"""Full-size copies without metadata, for a library shared without originals.

An original file carries its GPS position, camera serial, keywords and the
rest inside it, whatever the owner's Location switch says. When the owner of
a library does not share original files (#2731), the recipient downloads and
plays this copy instead: a still re-encoded as a JPEG at full size with only
its colour profile kept (as the thumbnails are), a video remuxed without its
container metadata (the recorded location lives there), its streams copied
as they are.

Copies are made on the first request and kept under
``MEDIA_ROOT/library_copies``, named by ``image_hash`` like the thumbnails,
and go when the thumbnails of that hash go (``api.photos.file_cleanup``).
"""

from __future__ import annotations

import glob
import logging
import os
import uuid

import pyvips
from django.conf import settings
from PIL import UnidentifiedImageError

from api.mime import JPEG_EXTENSION, MP4_EXTENSION, extension
from api.models import Photo
from api.runtime import binaries
from api.thumbnails import decoding
from api.video.no_metadata import NO_METADATA

logger = logging.getLogger(__name__)

COPIES_DIR = "library_copies"
JPEG_QUALITY = 92
# Larger than any camera: the still keeps its full size.
FULL_SIZE = 100_000
# Remuxing copies the streams, so it runs at disk speed; a video still being
# remuxed after this is stuck on the file.
REMUX_TIMEOUT = 600
# Without the container's metadata, and per stream too (a phone writes its
# handler and creation time there, a camera sometimes more).
VIDEO_NO_METADATA = (*NO_METADATA, "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1")

_DECODE_ERRORS = (pyvips.Error, OSError, ValueError, UnidentifiedImageError)


def copies_root() -> str:
    return os.path.join(settings.MEDIA_ROOT, COPIES_DIR)


def copy_name(photo: Photo, original: str) -> str:
    """The copy's file name: the hash, ``.jpg`` for a still, a video's own
    extension (its container is kept)."""
    if photo.video:
        return photo.image_hash + (extension(original) or MP4_EXTENSION)
    return photo.image_hash + JPEG_EXTENSION


def _part_path(final: str) -> str:
    """A unique file beside ``final`` with the same extension, so ffmpeg and
    libvips pick the format from it and two requests never share one."""
    stem, extension = os.path.splitext(final)
    return f"{stem}.{uuid.uuid4().hex}.part{extension}"


def _write_still(source: str, part: str) -> None:
    image = decoding.thumbnail(source, FULL_SIZE)
    image.write_to_file(part, Q=JPEG_QUALITY, keep="icc")


def _write_video(source: str, part: str) -> None:
    binaries.run_tool(
        "ffmpeg",
        [
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-i",
            source,
            "-map",
            "0:v",
            "-map",
            "0:a?",
            "-dn",
            "-sn",
            "-c",
            "copy",
            *VIDEO_NO_METADATA,
            part,
        ],
        timeout=REMUX_TIMEOUT,
    )


def ensure_copy(photo: Photo, original: str) -> str | None:
    """The path of ``photo``'s copy without metadata, made now if missing.

    None when it cannot be made (an unreadable file, a codec the container
    cannot carry): the caller refuses rather than handing out the original.
    """
    final = os.path.join(copies_root(), copy_name(photo, original))
    if os.path.exists(final):
        return final
    os.makedirs(copies_root(), exist_ok=True)
    part = _part_path(final)
    try:
        if photo.video:
            _write_video(original, part)
        else:
            _write_still(original, part)
        os.replace(part, final)
    except (binaries.ToolError, *_DECODE_ERRORS):
        logger.warning("Could not make a copy without metadata of %s", photo.image_hash)
        _remove(part)
        return None
    return final


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def delete_copies(image_hash: str) -> None:
    """Remove the copies of ``image_hash`` (when its thumbnails go)."""
    pattern = os.path.join(glob.escape(copies_root()), glob.escape(image_hash) + ".*")
    for path in glob.glob(pattern):
        _remove(path)

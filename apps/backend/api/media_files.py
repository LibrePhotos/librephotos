"""What a file on disk is: its ``File`` type, its content hash, whether the
scan can load it, and the ``File`` row for it.

Moved out of ``api.models.file`` so the model does no I/O (#2336): hashing
reads the whole file, the type comes from a content sniff, and
``is_valid_media`` loads libvips, Pillow and LibRaw. The extension sets these
answer from live in ``api.mime``.
"""

from __future__ import annotations

import hashlib
import logging
import os

from django.conf import settings

from api.mime import (
    IMAGE_EXTENSIONS,
    METADATA_EXTENSIONS,
    RAW_EXTENSIONS,
    VIDEO_EXTENSIONS,
    extension,
    sniffed_mime_type,
)
from api.models.file import File
from api.models.user import User

logger = logging.getLogger(__name__)

# Most optimal value for performance/memory. Found here:
# https://stackoverflow.com/questions/17731660/hashlib-optimal-size-of-chunks-to-be-used-in-md5-update
BUFFER_SIZE = 65536


def get_or_create_file(path: str, user: User, hash_value: str | None = None) -> File:
    """The File row for ``path``: the existing one, or a new one.

    An existing row is returned as it is, without hashing the file: if its
    content has changed, the rescan re-keys it (``File.rekey``). A row flagged
    missing whose file is back on disk (a network share or removable drive
    that was unmounted during a scan) is not missing anymore.

    Args:
        path: The file system path to the file
        user: The user who owns this file (used for hash calculation)
        hash_value: ``calculate_hash(user, path)`` when the caller already
            has it; hashing reads the whole file, so it is done only once.
    """
    existing = File.objects.filter(path=path).first()
    if existing:
        if existing.missing and os.path.exists(path):
            existing.missing = False
            existing.save(update_fields=["missing"])
        return existing
    return File.create(
        path, hash_value or calculate_hash(user, path), detect_file_type(path)
    )


def detect_file_type(path: str) -> int:
    file_type = File.IMAGE
    if is_raw(path):
        file_type = File.RAW_FILE
    if is_video(path):
        file_type = File.VIDEO
    if is_metadata(path):
        file_type = File.METADATA_FILE
    return file_type


def is_video(path: str) -> bool:
    try:
        # Sniffed only: a corrupt file with a video extension must not become a video.
        return (sniffed_mime_type(path) or "").find("video") != -1
    except Exception:
        logger.error("Error while checking if file is video: %s", path)
        return False


def is_raw(path: str) -> bool:
    return extension(path) in RAW_EXTENSIONS


def is_metadata(path: str) -> bool:
    return extension(path) in METADATA_EXTENSIONS


def looks_like_media(path: str) -> bool:
    """Whether ``path`` is meant to be a photo or video, loadable or not.

    True when the extension is a known image, video, RAW or XMP one, or when
    the content sniff says ``image/*`` or ``video/*``. A scan reports a file
    that looks like media but does not load (a corrupt JPEG) as a failure, and
    ignores everything else (``.pp3``, ``.aae``, ``.json``, ``Thumbs.db``).
    """
    if extension(path) in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
        return True
    if is_raw(path) or is_metadata(path):
        return True
    return (sniffed_mime_type(path) or "").startswith(("image/", "video/"))


def is_valid_media(path: str, user: User | None) -> bool:
    if is_video(path=path):
        if not settings.FEATURE_VIDEO:
            logger.info("Video support is disabled, skipping %s", path)
            return False
        return True
    if is_metadata(path=path):
        return True
    if is_raw(path=path):
        return True
    try:
        # Imported here: it loads libvips, Pillow's HEIC/JXL plugins and
        # LibRaw, which the API server never needs.
        from api import image_decoding

        if image_decoding.can_decode(path):
            return True
        logger.info("Could not handle %s: no loader recognises it", path)
        return False
    except Exception as e:
        logger.info("Could not handle %s, because %s", path, str(e))
        return False


def calculate_hash(user: User, path: str) -> str:
    try:
        hash_md5 = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(BUFFER_SIZE), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest() + str(user.id)
    except Exception as e:
        logger.error("Could not calculate hash for file %s", path)
        raise e

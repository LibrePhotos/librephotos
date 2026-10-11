"""
File grouping utilities for the two-phase scan architecture.

This module provides functions for grouping related files (RAW+JPEG pairs,
Live Photos, etc.) so they can be processed together as a single Photo.
"""

import os

from api.mime import LIVE_PHOTO_VIDEO_EXTENSIONS, RAW_PAIR_EXTENSIONS, extension
from api.models import File, Photo, User

# File type priority for main_file selection (lower number = higher priority)
# JPEG/processed images should be main_file, RAW/video variants are secondary
FILE_TYPE_PRIORITY = {
    File.IMAGE: 1,  # JPEG, HEIC, PNG - highest priority
    File.VIDEO: 2,  # Videos (standalone or Live Photo motion)
    File.RAW_FILE: 3,  # RAW files are variants, not main
    File.METADATA_FILE: 4,  # XMP sidecars - lowest priority
    File.UNKNOWN: 5,
}


def get_file_grouping_key(path: str) -> tuple[str, str]:
    """
    Get the grouping key for a file path.

    Files with the same (directory, basename) should be grouped together
    as variants of the same Photo (e.g., IMG_001.jpg + IMG_001.CR2 + IMG_001.xmp).

    Args:
        path: File path to get grouping key for

    Returns:
        Tuple of (directory, lowercase_basename_without_extension)
    """
    directory = os.path.dirname(path)
    basename = os.path.splitext(os.path.basename(path))[0].lower()
    return (directory, basename)


def get_sidecar_grouping_keys(path: str) -> list[tuple[str, str]]:
    """
    Grouping keys of the media file an XMP sidecar may describe, best first.

    Both sidecar naming conventions are supported (see
    ``get_sidecar_files_in_priority_order``): ``IMG_001.xmp`` and the
    extension-qualified ``IMG_001.jpg.xmp``. The full stem is tried first so
    ``my.photo.xmp`` belongs to ``my.photo.jpg`` rather than ``my.jpg``.
    """
    key = get_file_grouping_key(path)
    directory, stem = key
    inner_stem, inner_ext = os.path.splitext(stem)
    if inner_ext:
        return [key, (directory, inner_stem)]
    return [key]


def select_main_file(files: list[File]) -> File | None:
    """
    Select the best file to be the main_file for a Photo.

    Priority: IMAGE > VIDEO > RAW > METADATA
    Within same type, prefer the first one found (alphabetically by path).

    Args:
        files: List of File objects to choose from

    Returns:
        The File that should be main_file, or None if empty list
    """
    if not files:
        return None

    return min(files, key=lambda f: (FILE_TYPE_PRIORITY.get(f.type, 999), f.path))


def _find_image_sibling_photo(path: str, user: User) -> Photo | None:
    """The user's Photo whose main file is an image sibling of ``path``.

    A sibling sits in the same directory under exactly the same stem, with an
    extension from ``RAW_PAIR_EXTENSIONS`` in lower or upper case
    (``IMG_1.CR2`` pairs with ``IMG_1.jpg``, ``IMG_1.JPG`` and ``IMG_1.HIF``).
    The spellings are listed rather than matched case-insensitively so the
    lookup stays one indexed ``IN`` query: the repair job after every scan
    runs it for each RAW-only photo. When several match, the first by path
    wins, so the choice does not depend on set order.
    """
    base = os.path.splitext(path)[0]
    siblings = [
        base + spelling
        for ext in sorted(RAW_PAIR_EXTENSIONS)
        for spelling in (ext, ext.upper())
    ]
    return (
        Photo.objects.owned_by(user)
        .filter(main_file__path__in=siblings)
        .order_by("main_file__path")
        .first()
    )


def find_matching_jpeg_photo(raw_path: str, user: User) -> Photo | None:
    """
    Find an existing Photo with a matching JPEG/image file for a RAW file.

    Matches based on same base filename (without extension) in the same directory.
    This implements the PhotoPrism-like file variant model where RAW+JPEG are
    one Photo with multiple file variants, not separate Photos.

    Args:
        raw_path: Path to the RAW file
        user: Owner of the photos

    Returns:
        Matching Photo if found, None otherwise
    """
    return _find_image_sibling_photo(raw_path, user)


def find_matching_image_for_video(video_path: str, user: User) -> Photo | None:
    """
    Find an existing Photo with a matching image file for a Live Photo video.

    Apple Live Photos store the video as a separate .mov file with the same
    base name as the image. This allows attaching the video as a file variant.

    Args:
        video_path: Path to the video file
        user: Owner of the photos

    Returns:
        Matching Photo if found, None otherwise
    """
    if extension(video_path) not in LIVE_PHOTO_VIDEO_EXTENSIONS:
        return None
    return _find_image_sibling_photo(video_path, user)

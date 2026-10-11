import logging
import os
from collections.abc import Mapping

import exiftool

from api import binaries

from api.metadata.reader import get_sidecar_files_in_priority_order

logger = logging.getLogger(__name__)

# One tag's value: a list writes one argument per item.
TagValue = str | int | list[str]


def _argument(tag: str, value: str | int) -> bytes:
    """One ``-TAG=value`` argument for the ExifTool process.

    PyExifTool drives ``exiftool -stay_open True -@ -``, which reads one
    argument per line, so a line break inside a value would end this argument
    and start another one (``-if <perl>`` runs code). Callers pass single-line
    values (face_regions flattens person names); this is the backstop.
    """
    argument = f"-{tag}={value}"
    if "\n" in argument or "\r" in argument:
        raise ValueError(f"refusing to write {tag}: the value contains a line break")
    return os.fsencode(argument)


def write_metadata(
    media_file: str, tags: Mapping[str, TagValue], use_sidecar: bool = True
) -> None:
    et = exiftool.ExifTool(binaries.exiftool())
    terminate_et = False
    if not et.running:
        et.start()
        terminate_et = True
    # To-Do: Replace with new File Structure
    if use_sidecar:
        file_path = get_sidecar_files_in_priority_order(media_file)[0]
    else:
        file_path = media_file

    try:
        logger.info(f"Writing {tags} to {file_path}")
        params: list[bytes] = []
        for tag, value in tags.items():
            values: list[str | int] = (
                list(value) if isinstance(value, list) else [value]
            )
            params.extend(_argument(tag, item) for item in values)
        params.append(b"-overwrite_original")
        params.append(os.fsencode(file_path))
        et.execute(*params)
    finally:
        if terminate_et:
            et.terminate()


def read_orientation(media_file: str) -> int | None:
    """The EXIF Orientation stored in *media_file* itself.

    Reads the media file with exiftool directly, never a sidecar and never the
    exif service, so it tells what a write just left on disk. ``write_metadata``
    cannot: exiftool reports a failed write on stdout ("0 image files updated")
    and PyExifTool does not raise on it.

    A file without the tag is upright, so that reads as 1. Returns None when
    the file cannot be read at all.
    """
    try:
        with exiftool.ExifTool(binaries.exiftool()) as et:
            value = et.get_tag("EXIF:Orientation", media_file)
    except Exception:
        logger.exception(f"could not read the orientation of {media_file}")
        return None
    if value is None:
        return 1
    return value if isinstance(value, int) else None

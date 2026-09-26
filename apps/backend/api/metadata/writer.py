import os

import exiftool

from api import binaries

from api.metadata.reader import get_sidecar_files_in_priority_order
from api.util import logger


def write_metadata(media_file, tags, use_sidecar=True):
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
        params = []
        for tag, value in tags.items():
            if isinstance(value, list):
                for item in value:
                    params.append(os.fsencode(f"-{tag}={item}"))
            else:
                params.append(os.fsencode(f"-{tag}={value}"))
        params.append(b"-overwrite_original")
        params.append(os.fsencode(file_path))
        et.execute(*params)
    finally:
        if terminate_et:
            et.terminate()


def read_orientation(media_file):
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

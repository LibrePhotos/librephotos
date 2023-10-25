import logging.handlers
import os
import os.path

import exiftool
import requests
from constance import config as site_config
from django.conf import settings

logger = logging.getLogger("ownphotos")
formatter = logging.Formatter(
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s"
)
fileMaxByte = 256 * 1024 * 200  # 100MB
fileHandler = logging.handlers.RotatingFileHandler(
    os.path.join(settings.LOGS_ROOT, "ownphotos.log"),
    maxBytes=fileMaxByte,
    backupCount=10,
)
fileHandler.setFormatter(formatter)
logger.addHandler(fileHandler)
logger.setLevel(logging.INFO)


def convert_to_degrees(values):
    """
    Helper function to convert the GPS coordinates stored in the EXIF to degrees in float format
    :param value:
    :type value: exifread.utils.Ratio
    :rtype: float
    """
    d = float(values[0].num) / float(values[0].den)
    m = float(values[1].num) / float(values[1].den)
    s = float(values[2].num) / float(values[2].den)

    return d + (m / 60.0) + (s / 3600.0)


weekdays = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
}


def get_sidecar_files_in_priority_order(media_file):
    """
    Returns a list of possible XMP sidecar files for *media_file*, ordered
    by priority.

    """
    image_basename = os.path.splitext(media_file)[0]
    return [
        image_basename + ".xmp",
        image_basename + ".XMP",
        media_file + ".xmp",
        media_file + ".XMP",
    ]


def _get_existing_metadata_files_reversed(media_file, include_sidecar_files):
    if include_sidecar_files:
        files = [
            file
            for file in get_sidecar_files_in_priority_order(media_file)
            if os.path.exists(file)
        ]
        files.append(media_file)
        return list(reversed(files))
    return [media_file]


def get_metadata(media_file, tags, try_sidecar=True, struct=False):
    """
    Get values for each metadata tag in *tags* from *media_file*.
    If *try_sidecar* is `True`, use the value set in any XMP sidecar file
    stored alongside *media_file*.
    If *struct* is `True`, use the exiftool instance which returns structured data

    Returns a list with the value of each tag in *tags* or `None` if the
    tag was not found.

    """
    et = None
    if struct:
        et = exiftool.ExifTool(common_args=["-struct"])
    else:
        et = exiftool.ExifTool()
    terminate_et = False
    if not et.running:
        et.start()
        terminate_et = True

    files_by_reverse_priority = _get_existing_metadata_files_reversed(
        media_file, try_sidecar
    )

    values = []
    try:
        for tag in tags:
            value = None
            for file in files_by_reverse_priority:
                retrieved_value = et.get_tag(tag, file)
                if retrieved_value is not None:
                    value = retrieved_value
            values.append(value)
    finally:
        if terminate_et:
            et.terminate()
    return values


def write_metadata(media_file, tags, use_sidecar=True):
    et = exiftool.ExifTool()
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
        params = [os.fsencode(f"-{tag}={value}") for tag, value in tags.items()]
        params.append(b"-overwrite_original")
        params.append(os.fsencode(file_path))
        et.execute(*params)
    finally:
        if terminate_et:
            et.terminate()

import logging
import logging.handlers
import os
import os.path

import exiftool
import requests
from constance import config as site_config

import ownphotos.settings

logger = logging.getLogger("ownphotos")
formatter = logging.Formatter(
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s"
)
fileMaxByte = 256 * 1024 * 200  # 100MB
fileHandler = logging.handlers.RotatingFileHandler(
    os.path.join(ownphotos.settings.LOGS_ROOT, "ownphotos.log"),
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


def mapbox_reverse_geocode(lat, lon):
    mapbox_api_key = site_config.MAP_API_KEY

    if mapbox_api_key == "":
        return {}

    url = (
        "https://api.mapbox.com/geocoding/v5/mapbox.places/%f,%f.json?access_token=%s"
        % (lon, lat, mapbox_api_key)
    )
    resp = requests.get(url)
    if resp.status_code == 200:
        resp_json = resp.json()
        search_terms = []
        if "features" in resp_json.keys():
            for feature in resp_json["features"]:
                search_terms.append(feature["text"])

        resp_json["search_text"] = " ".join(search_terms)
        logger.info("mapbox returned status 200.")
        return resp_json
    else:
        # logger.info('mapbox returned non 200 response.')
        logger.warning("mapbox returned status {} response.".format(resp.status_code))
        return {}


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


def get_metadata(media_file, tags, try_sidecar=True):
    """
    Get values for each metadata tag in *tags* from *media_file*.
    If *try_sidecar* is `True`, use the value set in any XMP sidecar file
    stored alongside *media_file*.

    Returns a list with the value of each tag in *tags* or `None` if the
    tag was not found.

    """

    files_by_reverse_priority = _get_existing_metadata_files_reversed(
        media_file, try_sidecar
    )

    values = []
    with exiftool.ExifToolAlpha() as et:
        for tag in tags:
            value = None
            for file in files_by_reverse_priority:
                retrieved_value = et.get_tag(file, tag)
                if retrieved_value is not None:
                    value = retrieved_value
            values.append(value)  #
    return values


def write_metadata(media_file, tags, use_sidecar=True):
    # To-Do: Replace with new File Structure
    if use_sidecar:
        file_path = get_sidecar_files_in_priority_order(media_file)[0]
    else:
        file_path = media_file

    with exiftool.ExifTool() as et:
        logger.info(f"Writing {tags} to {file_path}")
        params = [os.fsencode(f"-{tag}={value}") for tag, value in tags.items()]
        params.append(b"-overwrite_original")
        params.append(os.fsencode(file_path))
        et.execute(*params)

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


exiftool_instance_struct = exiftool.ExifTool(common_args=["-struct"])
exiftool_instance = exiftool.ExifTool()


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
    et = exiftool_instance
    if struct:
        et = exiftool_instance_struct
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
    et = exiftool_instance
    terminate_et = False
    if not et.running:
        et.start()
        terminate_et = True
    # To-Do: Replace with new File Structure
    if use_sidecar:
        file_path = get_sidecar_files_in_priority_order(media_file)[0]
    else:
        file_path = media_file.path

    try:
        logger.info(f"Writing {tags} to {file_path}")
        params = [os.fsencode(f"-{tag}={value}") for tag, value in tags.items()]
        params.append(b"-overwrite_original")
        params.append(os.fsencode(file_path))
        et.execute(*params)
    finally:
        if terminate_et:
            et.terminate()

def convert_exif_orientation_to_degrees(orientation):
    """
    Function to convert EXIF Orientation values to a rotation in degrees
    and a boolean indicating if the image is flipped.
    Orientation value is an integer, 1 through 8.
    The math works better if we make the range from 0 to 7.
    Rotation is assumed to be clockwise.
    """
    if orientation not in range(1, 9):
        return 0, False
    this_orientation = orientation - 1
    is_flipped = this_orientation in [1, 3, 4, 6]
    # Re-flip flipped orientation
    if is_flipped:
        flip_delta = 1 if this_orientation % 2 == 0 else -1
        this_orientation = this_orientation + flip_delta
    angle = 0
    if this_orientation == 0:
        angle = 0
    elif this_orientation == 7:
        angle = 90
    elif this_orientation == 2:
        angle = 180
    elif this_orientation == 5:
        angle = 270
    
    return angle, is_flipped

def convert_degrees_to_exif_orientation(angle, is_flipped=False):
    """
    Reverse of the function above.
    angle needs to be a multiple of 90, and it's clockwise.
    Negative values are treated as counter-clockwise rotation.
    """
    COUNTER_CLOCKWISE = 1
    CLOCKWISE = -1

    angle = int(round(angle / 90.0) * 90)
    turns = int(angle / 90)
    direction = CLOCKWISE if turns >= 0 else COUNTER_CLOCKWISE
    turns = abs(turns)
    orientation = 0
    for _i in range(turns):
        step = 5
        if (orientation == 7 and direction == COUNTER_CLOCKWISE or \
            orientation == 0 and direction == CLOCKWISE):
            step = 1
        orientation = (orientation + step * direction) % 8
    if is_flipped:
        flip_delta = 1 if orientation % 2 == 0 else -1
        orientation = orientation + flip_delta
    return orientation + 1

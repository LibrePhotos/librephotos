import logging.handlers
import os
import os.path

from django.conf import settings

logger = logging.getLogger("ownphotos")
formatter = logging.Formatter(
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s"
)
FILE_MAX_BYTE = 256 * 1024 * 200  # 100MB
FILE_HANDLER = logging.handlers.RotatingFileHandler(
    os.path.join(settings.LOGS_ROOT, "ownphotos.log"),
    maxBytes=FILE_MAX_BYTE,
    backupCount=10,
)
FILE_HANDLER.setFormatter(formatter)
logger.addHandler(FILE_HANDLER)
logger.setLevel(logging.INFO)


def is_valid_path(path, root_path):
    # Resolve absolute paths to prevent directory traversal attacks
    abs_path = os.path.abspath(path)
    abs_root = os.path.abspath(root_path)

    try:
        common = os.path.commonpath([abs_path, abs_root])
    except ValueError:
        # Raised when paths are on different drives
        return False

    if common != abs_root:
        return False

    # Guard against paths that merely share a prefix with the root path
    # (e.g. /root and /root_dir). By normalising with os.path.commonpath
    # and checking for path separators we ensure the path really resides
    # within the root directory or is the directory itself.
    return abs_path == abs_root or abs_path.startswith(abs_root + os.sep)


def is_number(s):
    try:
        float(s)
        return True
    except Exception:
        return False


def convert_to_degrees(values):
    """Helper function to convert the GPS coordinates stored in the EXIF to degrees in float format
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

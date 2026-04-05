import logging
import os
import os.path

from concurrent_log_handler import ConcurrentRotatingFileHandler
from django.conf import settings

logger = logging.getLogger("ownphotos")
formatter = logging.Formatter(
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s"
)

DEFAULT_LOG_MAX_BYTES = 200 * 1024 * 1024  # 200 MB
DEFAULT_LOG_BACKUP_COUNT = 10

# Use ConcurrentRotatingFileHandler instead of RotatingFileHandler to avoid
# premature log rotation when multiple processes (gunicorn workers, django-q2
# workers) write to the same log file simultaneously.
FILE_HANDLER = ConcurrentRotatingFileHandler(
    os.path.join(settings.LOGS_ROOT, "ownphotos.log"),
    maxBytes=DEFAULT_LOG_MAX_BYTES,
    backupCount=DEFAULT_LOG_BACKUP_COUNT,
)
FILE_HANDLER.setFormatter(formatter)
logger.addHandler(FILE_HANDLER)
logger.setLevel(logging.INFO)


def reconfigure_logging():
    """Reconfigure the log handler from CONSTANCE settings.

    Call this after Django is fully initialised and the database is available
    so that ``constance.config`` can be read.
    """
    try:
        from constance import config as constance_config

        max_bytes = int(getattr(constance_config, "LOG_MAX_BYTES", DEFAULT_LOG_MAX_BYTES))
        backup_count = int(
            getattr(constance_config, "LOG_BACKUP_COUNT", DEFAULT_LOG_BACKUP_COUNT)
        )
    except Exception:
        max_bytes = DEFAULT_LOG_MAX_BYTES
        backup_count = DEFAULT_LOG_BACKUP_COUNT

    FILE_HANDLER.maxBytes = max_bytes
    FILE_HANDLER.backupCount = backup_count


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


def calculate_iou(box1_top, box1_right, box1_bottom, box1_left,
                  box2_top, box2_right, box2_bottom, box2_left):
    """Calculate Intersection over Union (IoU) of two bounding boxes.

    Each box is defined by (top, right, bottom, left) pixel coordinates,
    where top < bottom and left < right.

    Returns a float in [0, 1]. A value of 0 means no overlap.
    """
    inter_top = max(box1_top, box2_top)
    inter_left = max(box1_left, box2_left)
    inter_bottom = min(box1_bottom, box2_bottom)
    inter_right = min(box1_right, box2_right)

    inter_width = max(0, inter_right - inter_left)
    inter_height = max(0, inter_bottom - inter_top)
    intersection = inter_width * inter_height

    area1 = (box1_bottom - box1_top) * (box1_right - box1_left)
    area2 = (box2_bottom - box2_top) * (box2_right - box2_left)
    union = area1 + area2 - intersection

    if union <= 0:
        return 0.0

    return intersection / union


# Minimum IoU to consider two face bounding boxes as the same face.
FACE_OVERLAP_IOU_THRESHOLD = 0.3

# ---------------------------------------------------------------------------
# EXIF Orientation helpers
# ---------------------------------------------------------------------------
# Every EXIF Orientation value (1-8) corresponds to an element of the dihedral
# group D4.  We encode each element as (n, m) where:
#   n ∈ {0, 1, 2, 3} is the number of 90° CW rotation steps
#   m ∈ {0, 1}       is a horizontal flip (1 = flipped, 0 = not flipped)
# so the transform is: R^n followed by (optionally) H, i.e. H^m ∘ R^n.
_ORIENTATION_TO_PARAMS: dict[int, tuple[int, int]] = {
    1: (0, 0),  # Normal
    2: (0, 1),  # Flip horizontal
    3: (2, 0),  # Rotate 180°
    4: (2, 1),  # Flip vertical (= Rotate 180° + Flip H)
    5: (3, 1),  # Rotate 270° CW + Flip H
    6: (1, 0),  # Rotate 90° CW
    7: (1, 1),  # Rotate 90° CW + Flip H
    8: (3, 0),  # Rotate 270° CW (= 90° CCW)
}
_PARAMS_TO_ORIENTATION: dict[tuple[int, int], int] = {
    v: k for k, v in _ORIENTATION_TO_PARAMS.items()
}


def compose_orientation(
    current_orientation: int,
    delta_angle_cw: int = 0,
    flip_h: bool = False,
) -> int:
    """Compose an EXIF orientation value with an additional rotation/flip.

    Uses D4 group multiplication so repeated calls accumulate correctly.

    Args:
        current_orientation: Current EXIF Orientation code (1-8).  Values
            outside this range are treated as 1 (identity).
        delta_angle_cw: Additional clockwise rotation in degrees.  Must be a
            multiple of 90.
        flip_h: If True, apply a horizontal flip on top of the rotation.

    Returns:
        New EXIF Orientation code (1-8).
    """
    n_a, m_a = _ORIENTATION_TO_PARAMS.get(current_orientation, (0, 0))

    # Number of 90° CW steps for the requested delta angle
    n_b = int(round(delta_angle_cw / 90.0)) % 4
    m_b = 1 if flip_h else 0

    # D4 multiplication: (H^m_b ∘ R^n_b) ∘ (H^m_a ∘ R^n_a)
    #   = H^m_b ∘ R^(n_b + (-1)^m_b * n_a) ∘ H^(m_a + m_b)
    result_n = (n_b + (1 if m_b == 0 else -1) * n_a) % 4
    result_m = (m_b + m_a) % 2

    return _PARAMS_TO_ORIENTATION.get((result_n, result_m), 1)

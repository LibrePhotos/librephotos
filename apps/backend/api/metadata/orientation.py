"""EXIF orientation arithmetic.

Composing an orientation with a rotation or flip, and moving a face region
between the stored image and the image as displayed.
"""

import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)

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
    if current_orientation not in _ORIENTATION_TO_PARAMS:
        logger.warning(
            "compose_orientation: invalid orientation value %r, treating as 1",
            current_orientation,
        )

    # Number of 90° CW steps for the requested delta angle
    n_b = int(round(delta_angle_cw / 90.0)) % 4
    m_b = 1 if flip_h else 0

    # D4 multiplication: (H^m_b ∘ R^n_b) ∘ (H^m_a ∘ R^n_a)
    #   = H^m_b ∘ R^(n_b + (-1)^m_b * n_a) ∘ H^(m_a + m_b)
    result_n = (n_b + (1 if m_b == 0 else -1) * n_a) % 4
    result_m = (m_b + m_a) % 2

    return _PARAMS_TO_ORIENTATION.get((result_n, result_m), 1)


# ExifTool's print conversion of each Orientation value. The exif service's
# struct instance answers with these, its plain one (``-n``) with the numbers.
_ORIENTATION_NAMES: dict[str, int] = {
    "Horizontal (normal)": 1,
    "Mirror horizontal": 2,
    "Rotate 180": 3,
    "Mirror vertical": 4,
    "Mirror horizontal and rotate 270 CW": 5,
    "Rotate 90 CW": 6,
    "Mirror horizontal and rotate 90 CW": 7,
    "Rotate 270 CW": 8,
}


def normalize_orientation(value: int | str | None) -> int:
    """The EXIF Orientation (1-8) in an ExifTool answer.

    ``value`` is the number, the number as text, or ExifTool's print string
    ("Rotate 90 CW"), depending on which ExifTool instance read it (#2292).
    A missing or unknown value is 1, upright.
    """
    if isinstance(value, str):
        text = value.strip()
        number = _ORIENTATION_NAMES.get(text) or (int(text) if text.isdigit() else 1)
    else:
        number = value if isinstance(value, int) else 1
    return number if number in _ORIENTATION_TO_PARAMS else 1


# A region: its centre x and y, width and height, normalized to the image
# (0-1), as MWG-RS stores face areas.
Region = tuple[float, float, float, float]

# Where a region of the stored image lands once the image is shown under each
# orientation, as libvips' autorot() turns it. 5 is a transpose and 7 a
# transverse; the rotations 6 and 8 undo each other.
_REGION_TO_DISPLAY: dict[int, Callable[[float, float, float, float], Region]] = {
    2: lambda x, y, w, h: (1 - x, y, w, h),
    3: lambda x, y, w, h: (1 - x, 1 - y, w, h),
    4: lambda x, y, w, h: (x, 1 - y, w, h),
    5: lambda x, y, w, h: (y, x, h, w),
    6: lambda x, y, w, h: (1 - y, x, h, w),
    7: lambda x, y, w, h: (1 - y, 1 - x, h, w),
    8: lambda x, y, w, h: (y, 1 - x, h, w),
}
# Every other orientation is its own inverse.
_INVERSE = {6: 8, 8: 6}


def region_to_display(region: Region, orientation: int) -> Region:
    """``region`` of the stored image, in the image shown under ``orientation``.

    Face areas in a file (``XMP:RegionInfo``) are in stored coordinates;
    LibrePhotos' face boxes are in the displayed (thumbnail) image.
    """
    transform = _REGION_TO_DISPLAY.get(orientation)
    return transform(*region) if transform else region


def region_to_stored(region: Region, orientation: int) -> Region:
    """The inverse of ``region_to_display``: a displayed region, as stored."""
    return region_to_display(region, _INVERSE.get(orientation, orientation))

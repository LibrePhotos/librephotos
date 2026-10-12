"""EXIF orientation arithmetic: composing an orientation with a rotation or flip."""

import logging

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

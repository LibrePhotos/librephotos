"""ThumbHash: a photo's placeholder in about 25 bytes (https://evanw.github.io/thumbhash/).

The grid shows it, decoded by the web app's ``thumbhash`` package, until the
photo's thumbnail has loaded, instead of loading a small thumbnail first. This
is a numpy port of the reference encoder (``rgbaToThumbHash``, MIT): the bytes
must match it, since the web app decodes them with the reference decoder.
"""

from __future__ import annotations

import base64
import math
from typing import TYPE_CHECKING

from PIL import Image

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray
else:
    from api.lazy_import import LazyModule

    np = LazyModule("numpy")

# The encoder's input fits in this box: a larger picture adds nothing.
MAX_SIZE = 100


def _round(value: float) -> int:
    """JavaScript's ``Math.round``: halves go up, as the reference encoder rounds."""
    return math.floor(value + 0.5)


def _sum(values: NDArray[np.float64]) -> float:
    """The sum of ``values`` added up one by one, in order, as the reference's loops do.

    ``ndarray.sum`` adds pairwise, which rounds differently: enough to change
    a factor that lies near a half, and with it the hash.
    """
    return float(np.add.accumulate(values.ravel())[-1]) if values.size else 0.0


def _encode_channel(
    channel: NDArray[np.float64], nx: int, ny: int
) -> tuple[float, list[float], float]:
    """The DCT of ``channel`` (h x w): its DC term, normalised AC terms and their scale."""
    h, w = channel.shape
    xs = np.arange(w) + 0.5
    ys = np.arange(h) + 0.5
    # The reference's operations, in its order: cos(PI / w * cx * (x + 0.5)),
    # then channel * fx * fy summed row by row.
    dc = 0.0
    ac: list[float] = []
    scale = 0.0
    for cy in range(ny):
        fy = np.cos(math.pi / h * cy * ys)
        cx = 0
        while cx * ny < nx * (ny - cy):
            fx = np.cos(math.pi / w * cx * xs)
            f = _sum(channel * fx[np.newaxis, :] * fy[:, np.newaxis]) / (w * h)
            if cx or cy:
                ac.append(f)
                scale = max(scale, abs(f))
            else:
                dc = f
            cx += 1
    if scale:
        ac = [0.5 + 0.5 / scale * f for f in ac]
    return dc, ac, scale


def rgba_to_thumbhash(rgba: NDArray[np.uint8]) -> bytes:
    """The ThumbHash of an h x w x 4 RGBA picture of at most 100 x 100 pixels."""
    h, w = rgba.shape[:2]
    if w > MAX_SIZE or h > MAX_SIZE:
        raise ValueError(f"{w}x{h} does not fit in {MAX_SIZE}x{MAX_SIZE}")
    channels = rgba.astype(np.float64)
    alpha = channels[:, :, 3] / 255
    # alpha / 255 * value, in that order, as the reference computes it.
    weighted = [alpha / 255 * channels[:, :, c] for c in range(3)]
    avg_a = _sum(alpha)
    avg = [_sum(value) for value in weighted]
    if avg_a:
        avg = [value / avg_a for value in avg]

    has_alpha = avg_a < w * h
    l_limit = 5 if has_alpha else 7
    lx = max(1, _round(l_limit * w / max(w, h)))
    ly = max(1, _round(l_limit * h / max(w, h)))

    # Composite atop the average colour, then RGB to LPQ.
    r, g, b = (avg[c] * (1 - alpha) + weighted[c] for c in range(3))
    l_dc, l_ac, l_scale = _encode_channel((r + g + b) / 3, max(3, lx), max(3, ly))
    p_dc, p_ac, p_scale = _encode_channel((r + g) / 2 - b, 3, 3)
    q_dc, q_ac, q_scale = _encode_channel(r - g, 3, 3)

    is_landscape = w > h
    header24 = (
        _round(63 * l_dc)
        | (_round(31.5 + 31.5 * p_dc) << 6)
        | (_round(31.5 + 31.5 * q_dc) << 12)
        | (_round(31 * l_scale) << 18)
        | (int(has_alpha) << 23)
    )
    header16 = (
        (ly if is_landscape else lx)
        | (_round(63 * p_scale) << 3)
        | (_round(63 * q_scale) << 9)
        | (int(is_landscape) << 15)
    )
    head = [
        header24 & 255,
        (header24 >> 8) & 255,
        header24 >> 16,
        header16 & 255,
        header16 >> 8,
    ]
    varying = [l_ac, p_ac, q_ac]
    if has_alpha:
        a_dc, a_ac, a_scale = _encode_channel(alpha, 5, 5)
        head.append(_round(15 * a_dc) | (_round(15 * a_scale) << 4))
        varying.append(a_ac)
    factors = [_round(15 * f) for ac in varying for f in ac]
    body = bytearray((len(factors) + 1) // 2)
    for index, factor in enumerate(factors):
        body[index >> 1] |= factor << ((index & 1) << 2)
    return bytes(head) + bytes(body)


def thumbhash_of_file(path: str) -> str:
    """The base64 ThumbHash of the picture at ``path``, as the API sends it.

    Raises what PIL raises for a missing or unreadable file (``OSError``).
    """
    with Image.open(path) as img:
        img.thumbnail((MAX_SIZE, MAX_SIZE))
        rgba = np.asarray(img.convert("RGBA"))
    return base64.b64encode(rgba_to_thumbhash(rgba)).decode("ascii")

"""The lookup tables and constants of the develop stage, computed once per render.

Plain functions of the recipe, in float64: the web editor computes the same
values (``src/components/editor/engine/tables.ts``) and both are checked
against ``testdata/goldens.json``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from api.editing.recipe import BANDS, CURVE_CHANNELS, BwMix, Curve, Light, Point, Recipe
from api.lazy_import import LazyModule

if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt
else:
    np = LazyModule("numpy")

LUMA: Final = (0.2126, 0.7152, 0.0722)
TABLE_SIZE: Final = 1024
# Hue of each band's centre, in degrees.
BAND_HUES: Final = {
    "red": 29,
    "orange": 55,
    "yellow": 105,
    "green": 142,
    "aqua": 195,
    "blue": 262,
    "purple": 298,
    "magenta": 330,
}


@dataclass(frozen=True)
class WhiteBalanceValues:
    """Stage 4.2: the channel multipliers ``k``, the exposure ``gain`` and ``M``."""

    k: tuple[float, float, float]
    gain: float
    ceiling: float


def white_balance(recipe: Recipe, source_max: float) -> WhiteBalanceValues:
    t = recipe.wb.temp / 100
    g = recipe.wb.tint / 100
    raw = (2 ** (0.6 * t), 2 ** (-0.4 * g), 2 ** (-0.6 * t))
    norm = raw[0] * LUMA[0] + raw[1] * LUMA[1] + raw[2] * LUMA[2]
    k = (raw[0] / norm, raw[1] / norm, raw[2] / norm)
    gain = 2**recipe.light.exposure
    ceiling = max(1.0, source_max * max(k) * gain)
    return WhiteBalanceValues(k=k, gain=gain, ceiling=ceiling)


def table_positions() -> npt.NDArray[np.float64]:
    """``x = i / 1023`` for the 1024 entries of the light and curve tables."""
    return np.arange(TABLE_SIZE, dtype=np.float64) / (TABLE_SIZE - 1)


def light_table(light: Light) -> npt.NDArray[np.float64]:
    """Stage 4.6: Whites, Blacks and Contrast, 1024 entries."""
    x = table_positions()
    b = light.blacks / 100
    w = light.whites / 100
    c = light.contrast / 100
    x1 = np.clip(x + 0.15 * b * (1 - x) ** 3 + 0.15 * w * x**3, 0.0, 1.0)
    q = 2 ** (0.75 * c)
    low = 0.5 * (2 * x1) ** q
    high = 1 - 0.5 * (2 * (1 - x1)) ** q
    out: npt.NDArray[np.float64] = np.where(x1 < 0.5, low, high)
    return out


def monotone_curve(
    points: tuple[Point, ...], x: npt.NDArray[np.float64]
) -> npt.NDArray[np.float64]:
    """The monotone cubic (Fritsch and Carlson) through ``points``, at ``x``."""
    px = np.array([p[0] for p in points], dtype=np.float64)
    py = np.array([p[1] for p in points], dtype=np.float64)
    n = len(points)
    h = np.diff(px)
    s = np.diff(py) / h
    m = np.empty(n, dtype=np.float64)
    m[0] = s[0]
    m[-1] = s[-1]
    for k in range(1, n - 1):
        if s[k - 1] * s[k] <= 0:
            m[k] = 0.0
        else:
            w1 = 2 * h[k] + h[k - 1]
            w2 = h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / s[k - 1] + w2 / s[k])
    k_index = np.clip(np.searchsorted(px, x, side="right") - 1, 0, n - 2)
    x0 = px[k_index]
    hk = h[k_index]
    t = (x - x0) / hk
    t2 = t * t
    t3 = t2 * t
    y = (
        (2 * t3 - 3 * t2 + 1) * py[k_index]
        + (t3 - 2 * t2 + t) * hk * m[k_index]
        + (-2 * t3 + 3 * t2) * py[k_index + 1]
        + (t3 - t2) * hk * m[k_index + 1]
    )
    y = np.where(x < px[0], py[0], y)
    out: npt.NDArray[np.float64] = np.where(x > px[-1], py[-1], y)
    return out


def curve_table(curve: Curve) -> npt.NDArray[np.float64]:
    """Stage 4.8: ``curve_c(master(x))`` clamped to 0 to 1, 1024 x 3."""
    master = monotone_curve(curve.master, table_positions())
    channels = [
        np.clip(monotone_curve(getattr(curve, channel), master), 0.0, 1.0)
        for channel in CURVE_CHANNELS[1:]
    ]
    return np.stack(channels, axis=1)


def _band_weights(degree: int) -> dict[str, float]:
    """The two bands around ``degree``, weighed by distance (they sum to 1)."""
    for index, band in enumerate(BANDS):
        following = BANDS[(index + 1) % len(BANDS)]
        start = BAND_HUES[band]
        span = (BAND_HUES[following] - start) % 360
        offset = (degree - start) % 360
        if offset < span:
            t = offset / span
            return {band: 1 - t, following: t}
    raise AssertionError("the bands cover the whole circle")


def hue_table(recipe: Recipe) -> npt.NDArray[np.float64]:
    """Stage 4.7: ``(dh, ds, dl, bw)`` for each whole degree, 360 x 4."""
    table = np.zeros((360, 4), dtype=np.float64)
    bw_mix: BwMix = recipe.bw_mix
    for degree in range(360):
        for band, weight in _band_weights(degree).items():
            mixer_band = getattr(recipe.mixer, band)
            table[degree, 0] += weight * mixer_band.hue / 100 * 30
            table[degree, 1] += weight * mixer_band.sat / 100
            table[degree, 2] += weight * mixer_band.lum / 100
            table[degree, 3] += weight * getattr(bw_mix, band) / 100
    return table


def wheel_vector(hue: float, sat: float) -> tuple[float, float]:
    """A colour grading wheel as an OkLab ``(a, b)`` offset before its 0.10 factor."""
    radians = math.radians(hue)
    return (sat / 100 * math.cos(radians), sat / 100 * math.sin(radians))

"""The server renderer: an edit recipe applied to a source, stages 1 to 5 of the doc.

numpy float32, channels first (``3 x H x W``) so that every per-pixel factor
broadcasts along contiguous rows. The geometry (stage 1) is one warp of the
encoded source into the output frame. Then three passes over horizontal strips
run in a thread pool: noise reduction (stage 2) fills ``D``, the one full-size
float picture of a render; develop (stage 4) turns ``D`` into ``E`` in place;
and the finish (stage 5) writes the 8-bit output. A strip of a 5 x 5 tap stage
is read with the rows around it that its taps reach. Strips are small, so the
temporaries of the long per-pixel chains stay in the CPU caches.

The per-pixel stages (``develop``, ``vignette``, ``grain``) take channels-first
arrays of any float dtype, so the golden values are computed by the same code
in float64.
"""

from __future__ import annotations

import math
import os
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from api.editing import tables
from api.editing.geometry import Frame, make_frame, round_half_up
from api.editing.recipe import (
    Detail,
    Grain,
    Recipe,
    Vignette,
    colour_active,
    curve_active,
    light_table_active,
)
from api.lazy_import import LazyModule

if TYPE_CHECKING:
    import cv2
    import numpy as np
    import numpy.typing as npt

    from api.editing.source import Source
else:
    cv2 = LazyModule("cv2")
    np = LazyModule("numpy")

type Floats = npt.NDArray[np.floating]
type Bytes8 = npt.NDArray[np.uint8]

KNEE: Final = 0.8
# Pixels per strip of the tap stages (2 and 5.1) and per chunk of stage 4.
# Smaller chunks spend more time in Python, under the GIL, than in numpy.
TAP_STRIP_PIXELS: Final = 1 << 16
DEVELOP_CHUNK_PIXELS: Final = 1 << 16
# Threads per pass: the physical cores, as numpy and OpenCV share them badly
# with a second thread per core.
WORKERS: Final = max(1, min(8, (os.cpu_count() or 2) // 2))
# The warp reads the source with bilinear taps; above this many source pixels
# per output pixel the source is first area-averaged down, or it would alias.
PRESCALE_ABOVE: Final = 1.5
_L0, _L1, _L2 = tables.LUMA
_LN2: Final = math.log(2)

# Björn Ottosson's OkLab matrices.
_LMS_FROM_LINEAR: Final = (
    (0.4122214708, 0.5363325363, 0.0514459929),
    (0.2119034982, 0.6806995451, 0.1073969566),
    (0.0883024619, 0.2817188376, 0.6299787005),
)
_LAB_FROM_LMS: Final = (
    (0.2104542553, 0.7936177850, -0.0040720468),
    (1.9779984951, -2.4285922050, 0.4505937099),
    (0.0259040371, 0.7827717662, -0.8086757660),
)
_LMS_FROM_LAB: Final = (
    (1.0, 0.3963377774, 0.2158037573),
    (1.0, -0.1055613458, -0.0638541728),
    (1.0, -0.0894841775, -1.2914855480),
)
_LINEAR_FROM_LMS: Final = (
    (4.0767416621, -3.3077115913, 0.2309699292),
    (-1.2684380046, 2.6097574011, -0.3413193965),
    (-0.0041960863, -0.7034186147, 1.7076147010),
)


# --- Notation ----------------------------------------------------------------


def luma(rgb: Floats) -> Floats:
    """``Y`` of a channels-first array."""
    out: Floats = rgb[0] * _L0 + rgb[1] * _L1 + rgb[2] * _L2
    return out


def _flat(x: Floats) -> Floats:
    """``x`` as one contiguous column, the shape OpenCV takes any array in."""
    return np.ascontiguousarray(x).reshape(-1, 1)


# OpenCV's exp, log and polar conversion are vectorised and several times
# faster than numpy's on float32 (numpy's are scalar on some builds). float64,
# which the golden values use, stays on numpy.
def _exp(x: Floats) -> Floats:
    if x.dtype == np.float32:
        return cv2.exp(_flat(x)).astype(x.dtype, copy=False).reshape(x.shape)
    out: Floats = np.exp(x)
    return out


def _log(x: Floats) -> Floats:
    if x.dtype == np.float32:
        return cv2.log(_flat(x)).astype(x.dtype, copy=False).reshape(x.shape)
    out: Floats = np.log(x)
    return out


def _exp2(x: Floats) -> Floats:
    return _exp(x * _LN2)


def _log2(x: Floats) -> Floats:
    out: Floats = _log(x) * (1 / _LN2)
    return out


def _pow(x: Floats, p: float) -> Floats:
    """``x ** p`` for ``x >= 0``."""
    return _exp(_log(np.maximum(x, 1e-30)) * p)


def _polar(a: Floats, b: Floats) -> tuple[Floats, Floats]:
    """``hypot(a, b)`` and ``atan2(b, a)`` in degrees, 0 to 360."""
    if a.dtype == np.float32:
        magnitude, angle = cv2.cartToPolar(_flat(a), _flat(b), angleInDegrees=True)
        polar_chroma: Floats = magnitude.astype(a.dtype, copy=False).reshape(a.shape)
        polar_hue: Floats = angle.astype(a.dtype, copy=False).reshape(a.shape) % 360
        return polar_chroma, polar_hue
    chroma: Floats = np.hypot(a, b)
    hue: Floats = np.degrees(np.arctan2(b, a)) % 360
    return chroma, hue


def oetf(x: Floats) -> Floats:
    out: Floats = np.where(x <= 0.0031308, 12.92 * x, 1.055 * _pow(x, 1 / 2.4) - 0.055)
    return out


def eotf(e: Floats) -> Floats:
    out: Floats = np.where(e <= 0.04045, e / 12.92, _pow((e + 0.055) / 1.055, 2.4))
    return out


def smoothstep(a: float, b: float, x: Floats) -> Floats:
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    out: Floats = t * t * (3 - 2 * t)
    return out


def _mat3(
    m: tuple[tuple[float, float, float], ...], x: Floats, y: Floats, z: Floats
) -> tuple[Floats, Floats, Floats]:
    return (
        m[0][0] * x + m[0][1] * y + m[0][2] * z,
        m[1][0] * x + m[1][1] * y + m[1][2] * z,
        m[2][0] * x + m[2][1] * y + m[2][2] * z,
    )


def oklab(rgb: Floats) -> tuple[Floats, Floats, Floats]:
    """OkLab ``(L, a, b)`` of channels-first linear sRGB (``rgb >= 0``)."""
    long_, medium, short = _mat3(_LMS_FROM_LINEAR, rgb[0], rgb[1], rgb[2])
    third = 1 / 3
    return _mat3(
        _LAB_FROM_LMS, _pow(long_, third), _pow(medium, third), _pow(short, third)
    )


def linear_from_oklab(lk: Floats, a: Floats, b: Floats) -> Floats:
    """Channels-first linear sRGB of OkLab ``(L, a, b)``."""
    l_, m_, s_ = _mat3(_LMS_FROM_LAB, lk, a, b)
    r, g, bl = _mat3(_LINEAR_FROM_LMS, l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_)
    return np.stack([r, g, bl])


def _lookup(table: Floats, x: Floats) -> Floats:
    """Linear lookup of channels-first ``x`` (0 to 1) in an N or N x 3 table."""
    n = table.shape[0]
    pos = np.clip(x, 0.0, 1.0) * (n - 1)
    index = np.minimum(pos.astype(np.intp), n - 2)
    frac = pos - index.astype(pos.dtype)
    out: Floats = np.empty_like(pos)
    for channel in range(3):
        column = table if table.ndim == 1 else np.ascontiguousarray(table[:, channel])
        low = column[index[channel]]
        out[channel] = low + (column[index[channel] + 1] - low) * frac[channel]
    return out


@dataclass(frozen=True)
class _HueTap:
    """Where a hue falls in the 360-entry hue table: two entries and a weight."""

    index: npt.NDArray[np.intp]
    next_index: npt.NDArray[np.intp]
    frac: Floats

    def read(self, column: Floats) -> Floats:
        out: Floats = (
            column[self.index] * (1 - self.frac) + column[self.next_index] * self.frac
        )
        return out


def _hue_tap(h: Floats) -> _HueTap:
    floor = np.floor(h)
    index = floor.astype(np.intp) % 360
    return _HueTap(index=index, next_index=(index + 1) % 360, frac=h - floor)


# --- Stage 4: develop ----------------------------------------------------------


@dataclass(frozen=True, eq=False)
class ColourParams:
    # The hue table's columns dh, ds, dl and bw; None for an all-zero column.
    dh: npt.NDArray[np.float64] | None
    ds: npt.NDArray[np.float64] | None
    dl: npt.NDArray[np.float64] | None
    bw_mix: npt.NDArray[np.float64] | None
    bw: bool
    vibrance: float
    saturation: float
    balance: float
    blending: float
    # (a, b, lum) of the shadows, midtones, highlights and global wheels.
    wheels: tuple[tuple[float, float, float], ...]


@dataclass(frozen=True, eq=False)
class DevelopParams:
    """What stage 4 needs from a recipe, computed once per render."""

    wb: tables.WhiteBalanceValues
    dehaze: float
    highlights: float
    shadows: float
    clarity: float
    texture: float
    light: npt.NDArray[np.float64] | None
    curve: npt.NDArray[np.float64] | None
    colour: ColourParams | None

    @property
    def needs_lc(self) -> bool:
        return bool(self.highlights or self.shadows or self.clarity)

    @property
    def needs_lf(self) -> bool:
        return bool(self.texture)

    @property
    def needs_dk(self) -> bool:
        return bool(self.dehaze)


def _colour_params(recipe: Recipe) -> ColourParams:
    g = recipe.grading
    wheels = tuple(
        (*tables.wheel_vector(w.hue, w.sat), w.lum)
        for w in (g.shadows, g.midtones, g.highlights, g.global_)
    )
    hue = tables.hue_table(recipe)
    dh, ds, dl, bw = (
        np.ascontiguousarray(hue[:, column]) if hue[:, column].any() else None
        for column in range(4)
    )
    return ColourParams(
        dh=dh,
        ds=ds,
        dl=dl,
        bw_mix=bw,
        bw=recipe.color.treatment == "bw",
        vibrance=recipe.color.vibrance / 100,
        saturation=recipe.color.saturation / 100,
        balance=g.balance / 100,
        blending=g.blending / 100,
        wheels=wheels,
    )


def develop_params(recipe: Recipe, source_max: float) -> DevelopParams:
    light = recipe.light
    return DevelopParams(
        wb=tables.white_balance(recipe, source_max),
        dehaze=recipe.effects.dehaze / 100,
        highlights=light.highlights / 100,
        shadows=light.shadows / 100,
        clarity=recipe.effects.clarity / 100,
        texture=recipe.effects.texture / 100,
        light=tables.light_table(light) if light_table_active(light) else None,
        curve=tables.curve_table(recipe.curve) if curve_active(recipe.curve) else None,
        colour=_colour_params(recipe) if colour_active(recipe) else None,
    )


@dataclass(frozen=True)
class PixelPlanes:
    """The plane values at each pixel (``lc``, ``lf``, ``dk``); None when unused."""

    lc: Floats | None = None
    lf: Floats | None = None
    dk: Floats | None = None


def _plane(value: Floats | None, name: str) -> Floats:
    if value is None:
        raise ValueError(f"this recipe needs the {name} plane")
    return value


def _dehaze(rgb: Floats, dk: Floats, a: float) -> Floats:
    x = np.minimum(rgb, 1.0)
    rest = rgb - x
    if a > 0:
        t = np.maximum(1 - 0.6 * a * dk, 0.4)
        x = np.maximum(0.0, 1 - (1 - x) / t)
    else:
        t = 1 - 0.6 * abs(a) * (0.4 + 0.6 * dk)
        x = x * t + (1 - t)
    out: Floats = x + rest
    return out


def _display(rgb: Floats) -> Floats:
    """``clamp(Y, 0, 1)^(1/2.2)``."""
    return _pow(np.clip(luma(rgb), 0.0, 1.0), 1 / 2.2)


def _roll_off(rgb: Floats, ceiling: float) -> Floats:
    """Stage 4.5: highlight roll-off into 0 to 1, then the sRGB encoding."""
    c = np.clip(rgb, 0.0, ceiling)
    if ceiling > 1:
        t = (c - KNEE) / (ceiling - KNEE)
        p = (ceiling - KNEE) / (1 - KNEE)
        rolled = KNEE + (1 - KNEE) * (1 - _pow(np.maximum(1 - t, 0.0), p))
        c = np.where(c > KNEE, rolled, c)
    return oetf(np.clip(c, 0.0, 1.0))


def _grade(
    lk: Floats, a: Floats, b: Floats, params: ColourParams
) -> tuple[Floats, Floats, Floats]:
    """Colour grading: tints and lightness offsets by the wheels, weighted by lightness."""
    p = 0.5 - 0.25 * params.balance
    dd = 0.05 + 0.25 * params.blending
    ws = 1 - smoothstep(p - 0.25 - dd, p - 0.25 + dd, lk)
    wh = smoothstep(p + 0.25 - dd, p + 0.25 + dd, lk)
    wm = np.maximum(0.0, 1 - ws - wh)
    protect = np.clip(lk / 0.08, 0.0, 1.0) * np.clip((1 - lk) / 0.04, 0.0, 1.0)
    (sa, sb, sl), (ma, mb, ml), (ha, hb, hl), (ga, gb, gl) = params.wheels
    a = a + 0.10 * protect * (ws * sa + wm * ma + wh * ha + ga)
    b = b + 0.10 * protect * (ws * sb + wm * mb + wh * hb + gb)
    lk = lk + 0.2 * protect * (ws * sl + wm * ml + wh * hl + gl) / 100
    return lk, a, b


def _vibrance(chroma: Floats, hue: Floats, vibrance: float) -> Floats:
    distance = (hue - 55) % 360
    distance = np.minimum(distance, 360 - distance)
    skin = _exp(-np.square(distance / 25))
    out: Floats = chroma * (
        1 + 0.7 * vibrance * (1 - smoothstep(0, 0.25, chroma)) * (1 - 0.8 * skin)
    )
    return out


def _column(column: npt.NDArray[np.float64] | None, e: Floats) -> Floats | None:
    return None if column is None else column.astype(e.dtype)


def _colour(e: Floats, params: ColourParams) -> Floats:
    """Stage 4.7: mixer, vibrance, saturation, B&W and colour grading in OkLab.

    ``(cos h, sin h)`` is taken as ``(A, B) / C`` and a hue shift turns it, which
    is the doc's formula without a sine and a cosine per pixel.
    """
    lk, a, b = oklab(eotf(e))
    chroma, hue = _polar(a, b)
    safe = np.maximum(chroma, 1e-12)
    cos_h = a / safe
    sin_h = b / safe
    mc = smoothstep(0, 0.05, chroma)
    ml = smoothstep(0, 0.12, chroma)
    tap = _hue_tap(hue)
    if params.bw:
        bw_mix = _column(params.bw_mix, e)
        if bw_mix is not None:
            lk = lk * (1 + 0.5 * tap.read(bw_mix) * ml)
        chroma = np.zeros_like(chroma)
    else:
        dh = _column(params.dh, e)
        ds = _column(params.ds, e)
        dl = _column(params.dl, e)
        if dh is not None:
            delta = tap.read(dh) * mc
            hue = hue + delta
            turn = np.radians(delta)
            cos_d, sin_d = np.cos(turn), np.sin(turn)
            cos_h, sin_h = cos_h * cos_d - sin_h * sin_d, sin_h * cos_d + cos_h * sin_d
        if ds is not None:
            chroma = chroma * (1 + tap.read(ds) * mc)
        if dl is not None:
            lk = lk * (1 + 0.35 * tap.read(dl) * ml)
        if params.vibrance:
            chroma = _vibrance(chroma, hue, params.vibrance)
        if params.saturation:
            chroma = chroma * (1 + params.saturation)
    a = chroma * cos_h
    b = chroma * sin_h
    if any(w != (0.0, 0.0, 0.0) for w in params.wheels):
        lk, a, b = _grade(lk, a, b, params)
    return oetf(np.clip(linear_from_oklab(lk, a, b), 0.0, 1.0))


def _soft(x: Floats) -> Floats:
    """``x / (1 + 1.5 |x|)``: small differences kept, large ones limited."""
    out: Floats = x / (1 + 1.5 * np.abs(x))
    return out


def _local_contrast(
    rgb: Floats, ly: Floats, planes: PixelPlanes, params: DevelopParams
) -> Floats:
    """Stages 4.3 (Highlights, Shadows) and 4.4 (Clarity, Texture)."""
    if params.highlights or params.shadows:
        lc = _plane(planes.lc, "lc")
        dblur = _pow(np.clip(_exp2(lc) * params.wb.gain, 0.0, 1.0), 1 / 2.2)
        dpix = _display(rgb)
        d = np.clip(dblur, dpix - 0.05, dpix + 0.05)
        ws = 1 - smoothstep(0, 0.5, d)
        wh = smoothstep(0.5, 1, d)
        if params.highlights < 0:
            brightest = np.minimum(rgb.max(axis=0) / params.wb.ceiling, 1.0)
            wh = wh * (1 - _pow(brightest, 8))
        rgb = rgb * _exp2(1.5 * params.shadows * ws + 0.9 * params.highlights * wh)
    if params.clarity or params.texture:
        dpix = _display(rgb)
        m = 1 - np.square(2 * dpix - 1)
        stops = np.zeros_like(dpix)
        if params.clarity:
            dc = _soft(ly - _plane(planes.lc, "lc"))
            stops = stops + 0.9 * params.clarity * dc * m
        if params.texture:
            dt = _soft(ly - _plane(planes.lf, "lf"))
            stops = stops + 1.2 * params.texture * dt * (0.5 + 0.5 * m)
        rgb = rgb * _exp2(stops)
    return rgb


def develop(rgb: Floats, planes: PixelPlanes, params: DevelopParams) -> Floats:
    """Stage 4: channels-first linear ``rgb`` to display-encoded ``e``, in its dtype."""
    ly = _log2(np.maximum(luma(rgb), 1e-4))
    if params.dehaze:
        rgb = _dehaze(rgb, _plane(planes.dk, "dk"), params.dehaze)
    k = np.array(params.wb.k, dtype=rgb.dtype) * params.wb.gain
    rgb = rgb * k.reshape((3,) + (1,) * (rgb.ndim - 1))
    rgb = _local_contrast(rgb, ly, planes, params)
    e = _roll_off(rgb, params.wb.ceiling)
    if params.light is not None:
        e = _lookup(params.light.astype(e.dtype), e)
    if params.colour is not None:
        e = _colour(e, params.colour)
    if params.curve is not None:
        e = _lookup(params.curve.astype(e.dtype), e)
    return e


# --- Stage 5: finish (the per-pixel parts) -------------------------------------


def vignette(
    e: Floats, uv: tuple[Floats, Floats], size: tuple[int, int], settings: Vignette
) -> Floats:
    """Stage 5.2 on channels-first ``e`` at the normalised positions ``uv``.

    ``size`` is the output's ``(Wout, Hout)``.
    """
    uvx, uvy = uv
    width, height = size
    qx = 2 * uvx - 1
    qy = 2 * uvy - 1
    ar = width / height
    r = settings.roundness / 100
    if r > 0 and ar > 1:
        qx = qx * (1 + (ar - 1) * r)
    if r > 0 and ar < 1:
        qy = qy * (1 + (1 / ar - 1) * r)
    n = 2 - 6 * min(r, 0.0)
    if n == 2:
        d = np.sqrt(np.square(qx) + np.square(qy))
    else:
        d = _pow(_pow(np.abs(qx), n) + _pow(np.abs(qy), n), 1 / n)
    r0 = 0.2 + settings.midpoint / 100
    r1 = r0 + 0.2 + settings.feather / 100
    v = smoothstep(r0, r1, d)
    a = settings.amount / 100
    if a < 0:
        out: Floats = e * (1 + 0.85 * a * v)
        return out
    out = e + (1 - e) * (0.85 * a * v)
    return out


def _hash(ix: npt.NDArray[np.uint32], iy: npt.NDArray[np.uint32], seed: int) -> Floats:
    n = (
        ix * np.uint32(0x8DA6B343)
        ^ iy * np.uint32(0xD8163841)
        ^ np.uint32((seed * 0xCB1AB31F) & 0xFFFFFFFF)
    )
    n = n ^ (n >> np.uint32(15))
    n = n * np.uint32(0x2C1B3C6D)
    n = n ^ (n >> np.uint32(12))
    n = n * np.uint32(0x297A2D39)
    n = n ^ (n >> np.uint32(15))
    out: Floats = n.astype(np.float64) / 4294967295 * 2 - 1
    return out


def _noise(gx: Floats, gy: Floats, seed: int) -> Floats:
    """Value noise at points: the hash at the four cell corners, mixed bilinearly."""
    x_floor = np.floor(gx)
    y_floor = np.floor(gy)
    fx = (gx - x_floor).astype(np.float64)
    fy = (gy - y_floor).astype(np.float64)
    ix = x_floor.astype(np.int64).astype(np.uint32)
    iy = y_floor.astype(np.int64).astype(np.uint32)
    ix1 = ix + np.uint32(1)
    iy1 = iy + np.uint32(1)
    left = _hash(ix, iy, seed) * (1 - fy) + _hash(ix, iy1, seed) * fy
    right = _hash(ix1, iy, seed) * (1 - fy) + _hash(ix1, iy1, seed) * fy
    out: Floats = left * (1 - fx) + right * fx
    return out


def _noise_grid(gx: Floats, gy: Floats, seed: int) -> Floats:
    """``_noise`` at every pair of ``gx`` (columns) and ``gy`` (rows): ``(rows, columns)``.

    The same values in the same order of operations, hashing each cell corner
    once instead of four times a pixel.
    """
    x_floor = np.floor(gx)
    y_floor = np.floor(gy)
    fx = (gx - x_floor).astype(np.float64)
    fy = (gy - y_floor).astype(np.float64)[:, None]
    ix = x_floor.astype(np.int64)
    iy = y_floor.astype(np.int64)
    x0, y0 = int(ix.min()), int(iy.min())
    xs = np.arange(x0, int(ix.max()) + 2, dtype=np.int64).astype(np.uint32)
    ys = np.arange(y0, int(iy.max()) + 2, dtype=np.int64).astype(np.uint32)
    corners = _hash(xs[None, :], ys[:, None], seed)
    rows = iy - y0
    along_y = corners[rows] * (1 - fy) + corners[rows + 1] * fy
    columns = ix - x0
    out: Floats = along_y[:, columns] * (1 - fx) + along_y[:, columns + 1] * fx
    return out


def _grain_cells(width: int, height: int, settings: Grain) -> tuple[float, float]:
    """Noise cells per unit of ``uv``, across and down."""
    long_edge = max(width, height)
    cells = 2560 / (1 + 3 * settings.size / 100)
    return cells * width / long_edge, cells * height / long_edge


def grain_noise(
    uvx: Floats, uvy: Floats, width: int, height: int, settings: Grain
) -> Floats:
    """Stage 5.3's ``n`` at the normalised points ``(uvx, uvy)``."""
    across, down = _grain_cells(width, height, settings)
    gx, gy = uvx * across, uvy * down
    rough = settings.roughness / 100
    fine = _noise(gx, gy, settings.seed)
    coarse = _noise(2 * gx + 17, 2 * gy + 31, settings.seed)
    out: Floats = (1 - 0.5 * rough) * fine + 0.5 * rough * coarse
    return out


def _grain_noise_grid(
    uvx: Floats, uvy: Floats, width: int, height: int, settings: Grain
) -> Floats:
    """``grain_noise`` on the grid of the columns ``uvx`` and the rows ``uvy``."""
    across, down = _grain_cells(width, height, settings)
    gx, gy = uvx * across, uvy * down
    rough = settings.roughness / 100
    fine = _noise_grid(gx, gy, settings.seed)
    coarse = _noise_grid(2 * gx + 17, 2 * gy + 31, settings.seed)
    out: Floats = (1 - 0.5 * rough) * fine + 0.5 * rough * coarse
    return out


def grain(e: Floats, noise: Floats, settings: Grain) -> Floats:
    """Stage 5.3 on channels-first ``e`` with the noise ``n`` at each pixel."""
    ye = luma(e)
    amount = (
        0.18
        * (settings.amount / 100)
        * noise.astype(e.dtype)
        * np.sqrt(np.clip(4 * ye * (1 - ye), 0.0, 1.0))
    )
    out: Floats = np.clip(e + amount, 0.0, 1.0)
    return out


# --- Strips --------------------------------------------------------------------


@dataclass(frozen=True)
class _Window:
    """Output rows ``[start, stop)`` computed from buffer rows ``[first, last)``."""

    first: int
    start: int
    stop: int
    last: int
    height: int

    @property
    def inner(self) -> slice:
        return slice(self.start - self.first, self.stop - self.first)


def _windows(height: int, strip: int, halo: int) -> list[_Window]:
    return [
        _Window(
            first=max(0, start - halo),
            start=start,
            stop=min(height, start + strip),
            last=min(height, start + strip + halo),
            height=height,
        )
        for start in range(0, height, strip)
    ]


def _run(task: Callable[[_Window], None], windows: list[_Window]) -> None:
    workers = min(WORKERS, len(windows))
    if workers <= 1:
        for window in windows:
            task(window)
        return
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for _ in pool.map(task, windows):
            pass


def _inner_rows(a: Floats, window: _Window) -> Floats:
    """The window's output rows of buffer rows ``a`` (rows are axis -2)."""
    return a[..., window.inner, :]


def _mix(a: Floats, b: Floats, t: float) -> Floats:
    """``a (1 - t) + b t`` on float32 planes (2-D or 3 x rows x columns), in one pass."""
    if a.ndim == 2:
        out: Floats = np.asarray(cv2.addWeighted(a, 1 - t, b, t, 0.0), dtype=np.float32)
        return out
    return np.stack(
        [cv2.addWeighted(x, 1 - t, y, t, 0.0) for x, y in zip(a, b, strict=True)]
    )


def _columns_from(a: Floats, shift: int) -> Floats:
    """``a`` read at column ``x + shift``, clamped to the edge (``a`` itself for 0)."""
    if shift == 0:
        return a
    width = a.shape[-1]
    out: Floats = np.empty_like(a)
    k = min(abs(shift), width)
    if shift > 0:
        out[..., : width - k] = a[..., k:]
        out[..., width - k :] = a[..., width - 1 : width]
    else:
        out[..., k:] = a[..., : width - k]
        out[..., :k] = a[..., 0:1]
    return out


def _shift_columns(a: Floats, offset: float) -> Floats:
    """``a`` read at ``x + offset`` along its last axis (bilinear, clamped).

    May return ``a`` itself: never write into the result.
    """
    whole = math.floor(offset)
    frac = offset - whole
    if not frac:
        return _columns_from(a, whole)
    return _mix(_columns_from(a, whole), _columns_from(a, whole + 1), frac)


def _rows_from(a: Floats, shift: int, window: _Window) -> Floats:
    low, high = window.start + shift, window.stop + shift
    if low >= 0 and high <= window.height:
        return a[..., low - window.first : high - window.first, :]
    rows = np.clip(np.arange(low, high), 0, window.height - 1) - window.first
    out: Floats = np.take(a, rows, axis=-2)
    return out


def _shift_rows(a: Floats, offset: float, window: _Window) -> Floats:
    """The window's output rows of ``a`` (its buffer rows) read at ``y + offset``.

    May return a view of ``a``: never write into the result.
    """
    whole = math.floor(offset)
    frac = offset - whole
    if not frac:
        return _rows_from(a, whole, window)
    return _mix(_rows_from(a, whole, window), _rows_from(a, whole + 1, window), frac)


_TAPS: Final = range(-2, 3)


def _bilateral(
    yp: Floats,
    window: _Window,
    step: float,
    spread: float,
    values: Floats | None,
) -> Floats:
    """Stage 2's 25-tap average, weighted by distance and by the ``yp`` difference.

    Averages ``yp`` itself when ``values`` is None, else ``values`` (3 x H x W).
    """
    centre = np.ascontiguousarray(_inner_rows(yp, window))
    scale = -1 / (2 * spread * spread)
    weights = np.zeros_like(centre)
    w = np.empty_like(centre)
    total = np.zeros_like(centre if values is None else _inner_rows(values, window))
    # OpenCV's accumulate functions add a product in one pass over memory.
    for i in _TAPS:
        y_column = _shift_columns(yp, i * step)
        v_column = None if values is None else _shift_columns(values, i * step)
        for j in _TAPS:
            y_tap = _shift_rows(y_column, j * step, window)
            cv2.subtract(y_tap, centre, dst=w)
            # g(i, j) exp(scale d^2) = exp(scale d^2 + log g(i, j))
            cv2.multiply(w, w, dst=w, scale=scale)
            w += -(i * i + j * j) / 4.5
            cv2.exp(w, dst=w)
            cv2.accumulate(w, weights)
            if v_column is None:
                cv2.accumulateProduct(y_tap, w, total)
            else:
                v_tap = _shift_rows(v_column, j * step, window)
                for channel in range(3):
                    cv2.accumulateProduct(v_tap[channel], w, total[channel])
    out: Floats = total / weights
    return out


def _denoise(g: Floats, window: _Window, u: float, detail: Detail) -> Floats:
    """Stage 2 on the buffer rows ``g`` (3 x rows x W): ``D`` of the output rows."""
    p = np.sqrt(np.maximum(g, 0.0))
    yp = luma(p)
    cp = p - yp
    y_new = _inner_rows(yp, window)
    c_new = _inner_rows(cp, window)
    luminance = detail.nr_luminance / 100
    colour = detail.nr_color / 100
    if luminance > 0:
        spread = 0.004 + 0.06 * luminance
        y_new = _bilateral(yp, window, u, spread, None)
    if colour > 0:
        averaged = _bilateral(yp, window, 2 * u, 0.08, cp)
        c_new = c_new + (averaged - c_new) * colour
    out: Floats = np.square(np.maximum(y_new + c_new, 0.0))
    return out


def _sharpen(e: Floats, window: _Window, u: float, detail: Detail) -> Floats:
    """Stage 5.1 on the buffer rows ``e``: the window's output rows, sharpened.

    The 25 Gaussian taps are a product of 5 across and 5 down, so the blur is
    two passes of 5.
    """
    sigma = 0.8 * detail.sharpen_radius * u
    weights = [math.exp(-(i * i) / 2) for i in _TAPS]
    norm = sum(weights)
    ye = luma(e)
    across = np.zeros_like(ye)
    for i, w in zip(_TAPS, weights, strict=True):
        across += (w / norm) * _shift_columns(ye, i * sigma)
    blur = np.zeros_like(_inner_rows(ye, window))
    for j, w in zip(_TAPS, weights, strict=True):
        blur += (w / norm) * _shift_rows(across, j * sigma, window)
    amount = 1.2 * (detail.sharpen_amount / 100) * (_inner_rows(ye, window) - blur)
    out: Floats = np.clip(_inner_rows(e, window) + amount, 0.0, 1.0)
    return out


# --- Stage 3: planes -----------------------------------------------------------


@dataclass(frozen=True)
class _Plane:
    """A blurred plane, already interpolated across to the output width."""

    across: npt.NDArray[np.float32]

    def rows(self, first: int, last: int, height: int) -> npt.NDArray[np.float32]:
        plane_height = self.across.shape[0]
        y = (
            np.arange(first, last, dtype=np.float64) + 0.5
        ) * plane_height / height - 0.5
        y0 = np.floor(y)
        t = (y - y0).astype(np.float32)[:, None]
        top = np.clip(y0, 0, plane_height - 1).astype(np.intp)
        bottom = np.clip(y0 + 1, 0, plane_height - 1).astype(np.intp)
        out: npt.NDArray[np.float32] = (
            self.across[top] * (1 - t) + self.across[bottom] * t
        )
        return out


def _plane_size(width: int, height: int, cap: int) -> tuple[int, int]:
    long_edge = min(cap, max(width, height))
    if width >= height:
        return long_edge, max(1, round_half_up(long_edge * height / width))
    return max(1, round_half_up(long_edge * width / height)), long_edge


def _blurred(value: npt.NDArray[np.float32], sigma: float, width: int) -> _Plane:
    radius = math.ceil(3 * sigma)
    blurred = cv2.GaussianBlur(
        np.ascontiguousarray(value),
        (2 * radius + 1, 2 * radius + 1),
        sigmaX=sigma,
        sigmaY=sigma,
        borderType=cv2.BORDER_REPLICATE,
    )
    plane_width = blurred.shape[1]
    x = (np.arange(width, dtype=np.float64) + 0.5) * plane_width / width - 0.5
    x0 = np.floor(x)
    t = (x - x0).astype(np.float32)[None, :]
    left = np.clip(x0, 0, plane_width - 1).astype(np.intp)
    right = np.clip(x0 + 1, 0, plane_width - 1).astype(np.intp)
    across = blurred[:, left] * (1 - t) + blurred[:, right] * t
    return _Plane(across=across.astype(np.float32))


def _averaged(d: npt.NDArray[np.float32], cap: int) -> npt.NDArray[np.float32]:
    """``D`` (3 x H x W) area-averaged down to a plane's size."""
    height, width = d.shape[1:]
    size = _plane_size(width, height, cap)
    if size == (width, height):
        return d
    return np.stack(
        [cv2.resize(channel, size, interpolation=cv2.INTER_AREA) for channel in d]
    )


def _log_luma(rgb: npt.NDArray[np.float32]) -> npt.NDArray[np.float32]:
    out: npt.NDArray[np.float32] = _log2(np.maximum(luma(rgb), 1e-4)).astype(np.float32)
    return out


@dataclass(frozen=True)
class _Planes:
    lc: _Plane | None
    lf: _Plane | None
    dk: _Plane | None

    def at(self, first: int, last: int, height: int) -> PixelPlanes:
        return PixelPlanes(
            lc=None if self.lc is None else self.lc.rows(first, last, height),
            lf=None if self.lf is None else self.lf.rows(first, last, height),
            dk=None if self.dk is None else self.dk.rows(first, last, height),
        )


def _planes(d: npt.NDArray[np.float32], params: DevelopParams) -> _Planes:
    width = d.shape[2]
    lc = dk = lf = None
    if params.needs_lc or params.needs_dk:
        small = _averaged(d, 256)
        sigma = 0.02 * max(small.shape[1:])
        if params.needs_lc:
            lc = _blurred(_log_luma(small), sigma, width)
        if params.needs_dk:
            dark = np.clip(small.min(axis=0), 0.0, 1.0).astype(np.float32)
            dk = _blurred(dark, sigma, width)
    if params.needs_lf:
        small = _averaged(d, 1024)
        lf = _blurred(_log_luma(small), 0.004 * max(small.shape[1:]), width)
    return _Planes(lc=lc, lf=lf, dk=dk)


# --- Stage 1 and the render -----------------------------------------------------


def _like_source(
    array: object, source: Source
) -> npt.NDArray[np.uint8] | npt.NDArray[np.uint16]:
    """An OpenCV result as the source's pixel type."""
    if source.kind == "srgb8":
        return np.asarray(array, dtype=np.uint8)
    return np.asarray(array, dtype=np.uint16)


def _warp(
    source: Source, frame: Frame
) -> npt.NDArray[np.uint8] | npt.NDArray[np.uint16]:
    """The encoded source resampled into the output frame (bilinear, edges clamped)."""
    pixels = source.pixels
    a, b, c, d, e, f = frame.matrix
    density = math.sqrt(abs(a * e - b * d))
    if density > PRESCALE_ABOVE:
        width = max(1, round_half_up(source.width / density))
        height = max(1, round_half_up(source.height / density))
        pixels = _like_source(
            cv2.resize(pixels, (width, height), interpolation=cv2.INTER_AREA), source
        )
        sx, sy = width / source.width, height / source.height
        a, b, c, d, e, f = a * sx, b * sx, c * sx, d * sy, e * sy, f * sy
    # Pixel indices (centres at integers) instead of positions (centres at halves).
    c = a * 0.5 + b * 0.5 + c - 0.5
    f = d * 0.5 + e * 0.5 + f - 0.5
    size = (frame.width, frame.height)
    if (a, b, c, d, e, f) == (1, 0, 0, 0, 1, 0) and pixels.shape[1::-1] == size:
        return pixels
    matrix = np.array([[a, b, c], [d, e, f]], dtype=np.float64)
    warped = cv2.warpAffine(
        pixels,
        matrix,
        size,
        flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return _like_source(warped, source)


def _linear_table(source: Source) -> npt.NDArray[np.float32]:
    """Encoded value to linear light: ``eotf`` (srgb8) or the square law (linear16)."""
    if source.kind == "srgb8":
        codes = np.arange(256, dtype=np.float64) / 255
        return eotf(codes).astype(np.float32)
    codes = np.arange(65536, dtype=np.float64) / 65535
    return (source.max * codes * codes).astype(np.float32)


def _tap_strip(width: int, halo: int, strip_height: int | None) -> int:
    if strip_height is not None:
        return max(1, strip_height)
    return max(8, 4 * halo, TAP_STRIP_PIXELS // width)


def _chunk_rows(width: int, strip_height: int | None) -> int:
    if strip_height is not None:
        return max(1, strip_height)
    return max(1, DEVELOP_CHUNK_PIXELS // width)


def _linear_pass(
    d: npt.NDArray[np.float32],
    encoded: npt.NDArray[np.uint8] | npt.NDArray[np.uint16],
    linear: npt.NDArray[np.float32],
    detail: Detail,
    strip_height: int | None,
) -> None:
    """Stage 1's conversion to linear light, and stage 2: fill ``D``."""
    height, width = d.shape[1:]
    u = max(width, height) / 2560

    def linear_rows(first: int, last: int) -> npt.NDArray[np.float32]:
        return np.ascontiguousarray(np.moveaxis(linear[encoded[first:last]], -1, 0))

    if detail.nr_luminance > 0 or detail.nr_color > 0:
        halo = math.ceil(4 * u) + 2

        def denoise(window: _Window) -> None:
            g = linear_rows(window.first, window.last)
            d[:, window.start : window.stop] = _denoise(g, window, u, detail)

        _run(denoise, _windows(height, _tap_strip(width, halo, strip_height), halo))
        return

    def linearise(window: _Window) -> None:
        d[:, window.start : window.stop] = linear_rows(window.start, window.stop)

    _run(linearise, _windows(height, _chunk_rows(width, strip_height), 0))


def _develop_pass(
    d: npt.NDArray[np.float32], params: DevelopParams, strip_height: int | None
) -> None:
    """Stages 3 and 4: ``D`` becomes ``E`` in place."""
    height, width = d.shape[1:]
    planes = _planes(d, params)

    def develop_rows(window: _Window) -> None:
        rows = d[:, window.start : window.stop]
        d[:, window.start : window.stop] = develop(
            rows, planes.at(window.start, window.stop, height), params
        )

    _run(develop_rows, _windows(height, _chunk_rows(width, strip_height), 0))


def _finish_pass(
    e: npt.NDArray[np.float32], recipe: Recipe, strip_height: int | None
) -> Bytes8:
    """Stage 5 on ``E``: the 8-bit picture."""
    height, width = e.shape[1:]
    u = max(width, height) / 2560
    detail = recipe.detail
    out = np.empty((height, width, 3), dtype=np.uint8)
    sharpen = detail.sharpen_amount > 0
    columns = (np.arange(width, dtype=np.float64) + 0.5) / width
    uvx = columns.astype(np.float32)[None, :]

    def finish(window: _Window) -> None:
        if sharpen:
            rows_e = _sharpen(e[:, window.first : window.last], window, u, detail)
        else:
            rows_e = e[:, window.start : window.stop]
        rows = (np.arange(window.start, window.stop, dtype=np.float64) + 0.5) / height
        if recipe.vignette.amount:
            uvy = rows.astype(np.float32)[:, None]
            rows_e = vignette(rows_e, (uvx, uvy), (width, height), recipe.vignette)
        if recipe.grain.amount:
            noise = _grain_noise_grid(columns, rows, width, height, recipe.grain)
            rows_e = grain(rows_e, noise, recipe.grain)
        encoded8 = np.floor(rows_e * 255 + 0.5).astype(np.uint8)
        out[window.start : window.stop] = np.moveaxis(encoded8, 0, -1)

    halo = math.ceil(1.6 * detail.sharpen_radius * u) + 2 if sharpen else 0
    _run(finish, _windows(height, _tap_strip(width, halo, strip_height), halo))
    return out


def render(
    source: Source,
    recipe: Recipe,
    long_edge: int | None = None,
    *,
    strip_height: int | None = None,
) -> Bytes8:
    """The edited picture, 8-bit sRGB (H x W x 3), its long edge at most ``long_edge``.

    ``strip_height`` overrides the strip sizes; the result does not depend on it.
    """
    frame = make_frame(recipe.geometry, source.width, source.height, long_edge)
    d = np.empty((3, frame.height, frame.width), dtype=np.float32)
    # The warped source is only held while D is filled.
    _linear_pass(
        d, _warp(source, frame), _linear_table(source), recipe.detail, strip_height
    )
    _develop_pass(d, develop_params(recipe, source.max), strip_height)
    return _finish_pass(d, recipe, strip_height)

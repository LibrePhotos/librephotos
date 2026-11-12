"""Stage 1 frame math: output size and the map between output and source pixels.

Pure Python (no numpy), so views can move face boxes with it. Coordinates are
continuous, in pixels, with pixel centres at half integers; "normalised" is
the same divided by the picture's width and height (0 to 1 across it).
"""

from __future__ import annotations

import dataclasses
import math
from dataclasses import dataclass

from api.editing.recipe import FULL_CROP, Crop, Geometry

# Row-major 2 x 3 affine matrix (a, b, c, d, e, f): x' = a x + b y + c, y' = d x + e y + f.
type Affine = tuple[float, float, float, float, float, float]


def round_half_up(value: float) -> int:
    """``round`` of the doc: halves go up, as in JavaScript's ``Math.round``."""
    return math.floor(value + 0.5)


def oriented_size(width: int, height: int, orientation: int) -> tuple[int, int]:
    """The source's size after ``orientation`` degrees of clockwise turn."""
    if (orientation // 90) % 2:
        return height, width
    return width, height


def default_crop_scale(width: int, height: int, straighten: float) -> float:
    """``s``: the largest rectangle of the picture's aspect inside it at that angle."""
    angle = math.radians(straighten)
    cos = abs(math.cos(angle))
    sin = abs(math.sin(angle))
    return min(
        width / (width * cos + height * sin),
        height / (width * sin + height * cos),
    )


def effective_crop(geometry: Geometry, width: int, height: int) -> Crop:
    """The recipe's crop, or the default one for its straighten angle.

    ``width`` and ``height`` are the oriented picture's.
    """
    if geometry.crop is not None:
        return geometry.crop
    if geometry.straighten == 0:
        return FULL_CROP
    s = default_crop_scale(width, height, geometry.straighten)
    return Crop(cx=0.5, cy=0.5, w=s, h=s)


def output_size(
    geometry: Geometry,
    source_width: int,
    source_height: int,
    long_edge: int | None = None,
) -> tuple[int, int]:
    """Width and height of the edited picture, its long edge at most ``long_edge``."""
    width, height = oriented_size(source_width, source_height, geometry.orientation)
    crop = effective_crop(geometry, width, height)
    out_w = max(1, round_half_up(crop.w * width))
    out_h = max(1, round_half_up(crop.h * height))
    if long_edge is not None and max(out_w, out_h) > long_edge:
        factor = long_edge / max(out_w, out_h)
        out_w = max(1, round_half_up(out_w * factor))
        out_h = max(1, round_half_up(out_h * factor))
    return out_w, out_h


def _compose(outer: Affine, inner: Affine) -> Affine:
    """``outer`` after ``inner``."""
    a, b, c, d, e, f = outer
    p, q, r, s, t, u = inner
    return (
        a * p + b * s,
        a * q + b * t,
        a * r + b * u + c,
        d * p + e * s,
        d * q + e * t,
        d * r + e * u + f,
    )


def _invert(m: Affine) -> Affine:
    a, b, c, d, e, f = m
    det = a * e - b * d
    if det == 0:
        raise ValueError("the geometry maps the picture to a line")
    ia, ib, id_, ie = e / det, -b / det, -d / det, a / det
    return (ia, ib, -(ia * c + ib * f), id_, ie, -(id_ * c + ie * f))


def _apply(m: Affine, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = m
    return (a * x + b * y + c, d * x + e * y + f)


@dataclass(frozen=True)
class Frame:
    """How one render's output pixels sit on the source.

    ``to_source`` is the doc's stage 1 formula; ``to_output`` its inverse.
    """

    source_width: int
    source_height: int
    width: int
    height: int
    matrix: Affine
    inverse: Affine

    def to_source(self, x: float, y: float) -> tuple[float, float]:
        """An output point (pixels) to source pixels."""
        return _apply(self.matrix, x, y)

    def to_output(self, x: float, y: float) -> tuple[float, float]:
        """A source point (pixels) to output pixels."""
        return _apply(self.inverse, x, y)

    def to_source_normalised(self, u: float, v: float) -> tuple[float, float]:
        """An output point (0 to 1 across the edited picture) to the source's 0 to 1."""
        x, y = self.to_source(u * self.width, v * self.height)
        return x / self.source_width, y / self.source_height

    def to_output_normalised(self, s: float, t: float) -> tuple[float, float]:
        """A source point (0 to 1 across the source) to the edited picture's 0 to 1."""
        x, y = self.to_output(s * self.source_width, t * self.source_height)
        return x / self.width, y / self.height


def make_frame(
    geometry: Geometry,
    source_width: int,
    source_height: int,
    long_edge: int | None = None,
) -> Frame:
    """The frame of rendering ``geometry`` on a ``source_width`` x ``source_height`` source."""
    width, height = oriented_size(source_width, source_height, geometry.orientation)
    crop = effective_crop(geometry, width, height)
    out_w, out_h = output_size(geometry, source_width, source_height, long_edge)
    angle = math.radians(geometry.straighten)
    cos, sin = math.cos(angle), math.sin(angle)
    # dx = (px / Wout - 0.5) w W, dy = (py / Hout - 0.5) h H
    sx = crop.w * width / out_w
    sy = crop.h * height / out_h
    to_offset: Affine = (
        sx,
        0.0,
        -0.5 * crop.w * width,
        0.0,
        sy,
        -0.5 * crop.h * height,
    )
    # x = cx W + dx cos a + dy sin a, y = cy H - dx sin a + dy cos a
    turn: Affine = (cos, sin, crop.cx * width, -sin, cos, crop.cy * height)
    m = _compose(turn, to_offset)
    if geometry.flip_h:
        m = _compose((-1.0, 0.0, float(width), 0.0, 1.0, 0.0), m)
    if geometry.flip_v:
        m = _compose((1.0, 0.0, 0.0, 0.0, -1.0, float(height)), m)
    quarter_turns = (geometry.orientation // 90) % 4
    w0, h0 = float(source_width), float(source_height)
    unturn: Affine = (
        (1.0, 0.0, 0.0, 0.0, 1.0, 0.0),
        (0.0, 1.0, 0.0, -1.0, 0.0, h0),
        (-1.0, 0.0, w0, 0.0, -1.0, h0),
        (0.0, -1.0, w0, 1.0, 0.0, 0.0),
    )[quarter_turns]
    m = _compose(unturn, m)
    return Frame(
        source_width=source_width,
        source_height=source_height,
        width=out_w,
        height=out_h,
        matrix=m,
        inverse=_invert(m),
    )


# --- Turning an edited picture ---------------------------------------------------


def _turned_aspect(aspect: str | None) -> str | None:
    """The aspect lock of the picture a quarter turn later: ``"4:5"`` is ``"5:4"``."""
    if aspect is None or ":" not in aspect:
        return aspect
    width, height = aspect.split(":")
    return f"{height}:{width}"


def turn_geometry(geometry: Geometry) -> Geometry:
    """``geometry`` with its edited picture turned a quarter clockwise.

    The flipped picture turns with the crop on it: the orientation goes up a
    quarter, the two flips trade places (a quarter turn after a horizontal flip
    is a vertical flip after the turn), the crop's centre and size turn with
    the picture and the straighten angle stays.
    """
    crop = geometry.crop
    turned = (
        None if crop is None else Crop(cx=1 - crop.cy, cy=crop.cx, w=crop.h, h=crop.w)
    )
    return dataclasses.replace(
        geometry,
        orientation=(geometry.orientation + 90) % 360,
        flip_h=geometry.flip_v,
        flip_v=geometry.flip_h,
        crop=turned,
        aspect=_turned_aspect(geometry.aspect),
    )


def mirror_geometry(geometry: Geometry) -> Geometry:
    """``geometry`` with its edited picture flipped horizontally."""
    crop = geometry.crop
    mirrored = None if crop is None else dataclasses.replace(crop, cx=1 - crop.cx)
    return dataclasses.replace(
        geometry,
        flip_h=not geometry.flip_h,
        straighten=0.0 - geometry.straighten,
        crop=mirrored,
    )


# --- Boxes on the picture ------------------------------------------------------

# A box as (left, top, right, bottom), 0 to 1 across its picture.
type Box = tuple[float, float, float, float]


def _bounds(points: list[tuple[float, float]]) -> Box:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    return min(xs), min(ys), max(xs), max(ys)


def _corners(box: Box) -> list[tuple[float, float]]:
    left, top, right, bottom = box
    return [(left, top), (right, top), (left, bottom), (right, bottom)]


def box_to_source(frame: Frame, box: Box) -> Box:
    """``box`` on the picture of ``frame``, on its source (0 to 1), not clamped.

    The bounding box of its corners; it may reach past the source.
    """
    return _bounds([frame.to_source_normalised(u, v) for u, v in _corners(box)])


def box_to_output(frame: Frame, box: Box) -> Box:
    """``box`` on ``frame``'s source (0 to 1), on its picture, clamped to it.

    The bounding box of its corners; empty (``left == right`` or ``top ==
    bottom``) when the box is outside the picture.
    """
    return _bounds(
        [
            (min(1.0, max(0.0, x)), min(1.0, max(0.0, y)))
            for x, y in (frame.to_output_normalised(s, t) for s, t in _corners(box))
        ]
    )

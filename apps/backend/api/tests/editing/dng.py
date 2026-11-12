"""A camera RAW for the tests, written as a DNG with the standard library and numpy.

``write_dng`` mosaics a scene-linear picture (linear sRGB, ``1.0`` where the
sensor clips) into an uncompressed 16-bit RGGB Bayer image and writes it with
the tags LibRaw needs to develop it. The colour matrix is the inverse of the
sRGB primaries, so LibRaw's camera-to-sRGB matrix is the identity and the
developed picture is the input again, white-balanced by ``AsShotNeutral``.
A JPEG ``preview`` goes into a second IFD, as a camera stores its own.

``test_card`` is a picture of flat patches of known linear values (``PATCHES``),
for tests that assert numbers.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Final

import numpy as np
import numpy.typing as npt

BLACK_LEVEL: Final = 512
WHITE_LEVEL: Final = 16383
# Green is the most sensitive channel, as on most cameras: red and blue are
# recorded weaker and the white balance multiplies them back up.
NEUTRAL: Final = (0.5, 1.0, 0.7)

# Linear sRGB (D65) to XYZ; ColorMatrix1 is its inverse (XYZ to camera).
_SRGB_TO_XYZ: Final = np.array(
    [
        [0.412453, 0.357580, 0.180423],
        [0.212671, 0.715160, 0.072169],
        [0.019334, 0.119193, 0.950227],
    ]
)

# TIFF field types.
_BYTE, _ASCII, _SHORT, _LONG, _RATIONAL, _SRATIONAL = 1, 2, 3, 4, 5, 10
_TYPE_FORMATS: Final = {
    _BYTE: "B",
    _ASCII: "B",
    _SHORT: "H",
    _LONG: "I",
    _RATIONAL: "II",
    _SRATIONAL: "ii",
}
_D65: Final = 21


@dataclass(frozen=True)
class Patch:
    """A flat patch of ``test_card``: its cell and its linear sRGB value."""

    name: str
    row: int
    column: int
    rgb: tuple[float, float, float]


CELL: Final = 32
ROWS, COLUMNS = 4, 6
# Row 0 a grey ramp, row 1 saturated colours, rows 2 and 3 the bright end:
# LibRaw's 1.0 is the source's max (1.4), so a linear value above 1 / 1.4
# is brighter than the white of a JPEG.
PATCHES: Final = (
    Patch("grey_02", 0, 0, (0.02, 0.02, 0.02)),
    Patch("grey_05", 0, 1, (0.05, 0.05, 0.05)),
    Patch("grey_10", 0, 2, (0.10, 0.10, 0.10)),
    Patch("grey_20", 0, 3, (0.20, 0.20, 0.20)),
    Patch("grey_35", 0, 4, (0.35, 0.35, 0.35)),
    Patch("grey_50", 0, 5, (0.50, 0.50, 0.50)),
    Patch("red", 1, 0, (0.40, 0.03, 0.03)),
    Patch("green", 1, 1, (0.04, 0.35, 0.04)),
    Patch("blue", 1, 2, (0.03, 0.04, 0.45)),
    Patch("yellow", 1, 3, (0.40, 0.35, 0.03)),
    Patch("cyan", 1, 4, (0.03, 0.35, 0.40)),
    Patch("magenta", 1, 5, (0.40, 0.03, 0.40)),
    Patch("grey_60", 2, 0, (0.60, 0.60, 0.60)),
    Patch("grey_70", 2, 1, (0.70, 0.70, 0.70)),
    Patch("over_white", 2, 2, (0.90, 0.90, 0.90)),
    Patch("clipped", 2, 3, (1.20, 1.20, 1.20)),
    Patch("warm_bright", 2, 4, (0.95, 0.80, 0.60)),
    Patch("black", 2, 5, (0.0, 0.0, 0.0)),
    Patch("grey_15", 3, 0, (0.15, 0.15, 0.15)),
    Patch("grey_25", 3, 1, (0.25, 0.25, 0.25)),
    Patch("grey_30", 3, 2, (0.30, 0.30, 0.30)),
    Patch("grey_40", 3, 3, (0.40, 0.40, 0.40)),
    Patch("grey_45", 3, 4, (0.45, 0.45, 0.45)),
    Patch("grey_55", 3, 5, (0.55, 0.55, 0.55)),
)


def test_card() -> npt.NDArray[np.float64]:
    """The picture of ``PATCHES``, ``ROWS * CELL`` by ``COLUMNS * CELL`` pixels."""
    picture = np.zeros((ROWS * CELL, COLUMNS * CELL, 3))
    for patch in PATCHES:
        top, left = patch.row * CELL, patch.column * CELL
        picture[top : top + CELL, left : left + CELL] = patch.rgb
    return picture


def patch_centre(
    pixels: npt.NDArray[np.floating] | npt.NDArray[np.integer],
    patch: Patch,
    rows: int = ROWS,
    columns: int = COLUMNS,
) -> npt.NDArray[np.float64]:
    """The mean colour of the middle half of ``patch`` in an upright ``pixels``."""
    cell_h = pixels.shape[0] / rows
    cell_w = pixels.shape[1] / columns
    top = round((patch.row + 0.25) * cell_h)
    bottom = round((patch.row + 0.75) * cell_h)
    left = round((patch.column + 0.25) * cell_w)
    right = round((patch.column + 0.75) * cell_w)
    region = np.asarray(pixels[top:bottom, left:right], dtype=np.float64)
    mean: npt.NDArray[np.float64] = region.reshape(-1, 3).mean(axis=0)
    return mean


def mosaic(
    linear: npt.NDArray[np.floating], neutral: tuple[float, float, float] = NEUTRAL
) -> npt.NDArray[np.uint16]:
    """The RGGB sensor values of a linear picture (``1.0`` clips green)."""
    height, width = linear.shape[:2]
    if height % 2 or width % 2:
        raise ValueError("a Bayer picture has an even size")
    span = WHITE_LEVEL - BLACK_LEVEL
    values = np.empty((height, width), dtype=np.uint16)
    # (row offset, column offset, channel) of the four sites of a 2 x 2 tile.
    for dy, dx, channel in ((0, 0, 0), (0, 1, 1), (1, 0, 1), (1, 1, 2)):
        sensed = linear[dy::2, dx::2, channel] * neutral[channel]
        site = np.round(BLACK_LEVEL + np.clip(sensed, 0.0, 1.0) * span)
        values[dy::2, dx::2] = site.astype(np.uint16)
    return values


def _rational(value: float, signed: bool) -> tuple[int, int]:
    denominator = 10000
    numerator = round(value * denominator)
    if not signed and numerator < 0:
        raise ValueError("an unsigned rational is not negative")
    return numerator, denominator


type _Entry = tuple[int, int, list[int]]


def _entry(tag: int, kind: int, values: list[int] | list[float] | bytes) -> _Entry:
    if kind in (_RATIONAL, _SRATIONAL):
        flat: list[int] = []
        for value in values:
            flat.extend(_rational(float(value), kind == _SRATIONAL))
        return tag, kind, flat
    return tag, kind, [int(v) for v in values]


def _ascii(tag: int, text: str) -> _Entry:
    return tag, _ASCII, list(text.encode("ascii") + b"\x00")


def _count(kind: int, values: list[int]) -> int:
    return len(values) // len(_TYPE_FORMATS[kind])


def _ifd(entries: list[_Entry], offset: int, next_ifd: int) -> bytes:
    """An IFD at ``offset``, its values that do not fit in 4 bytes right after it."""
    entries = sorted(entries)
    table = struct.pack("<H", len(entries))
    extra = b""
    extra_at = offset + 2 + 12 * len(entries) + 4
    for tag, kind, values in entries:
        data = struct.pack(f"<{len(values)}{_TYPE_FORMATS[kind][0]}", *values)
        count = _count(kind, values)
        if len(data) <= 4:
            table += struct.pack("<HHI", tag, kind, count) + data.ljust(4, b"\x00")
        else:
            if len(extra) % 2:
                extra += b"\x00"
            table += struct.pack("<HHII", tag, kind, count, extra_at + len(extra))
            extra += data
    return table + struct.pack("<I", next_ifd) + extra


def _ifd_size(entries: list[_Entry]) -> int:
    return len(_ifd(entries, 0, 0))


def jpeg_size(jpeg: bytes) -> tuple[int, int]:
    """The width and height in a JPEG's start-of-frame segment."""
    at = 2
    while at + 9 < len(jpeg):
        marker, length = jpeg[at + 1], struct.unpack(">H", jpeg[at + 2 : at + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", jpeg[at + 5 : at + 9])
            return width, height
        at += 2 + length
    raise ValueError("not a JPEG with a frame")


def write_dng(
    path: str,
    linear: npt.NDArray[np.floating],
    *,
    orientation: int = 1,
    neutral: tuple[float, float, float] = NEUTRAL,
    preview: bytes | None = None,
) -> None:
    """Write ``linear`` (H x W x 3 linear sRGB, 1.0 = clip) as a DNG at ``path``.

    ``orientation`` is the TIFF Orientation tag; ``preview`` a JPEG stored
    in a second IFD.
    """
    sensor = mosaic(linear, neutral)
    height, width = sensor.shape
    pixels = sensor.astype("<u2").tobytes()
    color_matrix = np.linalg.inv(_SRGB_TO_XYZ)

    def raw_entries(strip_offset: int) -> list[_Entry]:
        return [
            _entry(254, _LONG, [0]),
            _entry(256, _LONG, [width]),
            _entry(257, _LONG, [height]),
            _entry(258, _SHORT, [16]),
            _entry(259, _SHORT, [1]),
            _entry(262, _SHORT, [32803]),
            _ascii(271, "LibrePhotos"),
            _ascii(272, "Test DNG"),
            _entry(273, _LONG, [strip_offset]),
            _entry(274, _SHORT, [orientation]),
            _entry(277, _SHORT, [1]),
            _entry(278, _LONG, [height]),
            _entry(279, _LONG, [len(pixels)]),
            _entry(284, _SHORT, [1]),
            _entry(33421, _SHORT, [2, 2]),
            _entry(33422, _BYTE, [0, 1, 1, 2]),
            _entry(50706, _BYTE, [1, 4, 0, 0]),
            _entry(50707, _BYTE, [1, 1, 0, 0]),
            _ascii(50708, "LibrePhotos Test DNG"),
            _entry(50710, _BYTE, [0, 1, 2]),
            _entry(50711, _SHORT, [1]),
            _entry(50714, _LONG, [BLACK_LEVEL]),
            _entry(50717, _LONG, [WHITE_LEVEL]),
            _entry(50721, _SRATIONAL, color_matrix.flatten().tolist()),
            _entry(50728, _RATIONAL, list(neutral)),
            _entry(50778, _SHORT, [_D65]),
        ]

    def preview_entries(strip_offset: int) -> list[_Entry]:
        if preview is None:
            raise ValueError("no preview")
        preview_size = jpeg_size(preview)
        return [
            _entry(254, _LONG, [1]),
            _entry(256, _LONG, [preview_size[0]]),
            _entry(257, _LONG, [preview_size[1]]),
            _entry(258, _SHORT, [8, 8, 8]),
            _entry(259, _SHORT, [7]),
            _entry(262, _SHORT, [6]),
            _entry(273, _LONG, [strip_offset]),
            _entry(277, _SHORT, [3]),
            _entry(278, _LONG, [preview_size[1]]),
            _entry(279, _LONG, [len(preview)]),
        ]

    first = 8
    raw_size = _ifd_size(raw_entries(0))
    second = first + raw_size + (raw_size % 2)
    preview_ifd_size = _ifd_size(preview_entries(0)) if preview is not None else 0
    data_at = second + preview_ifd_size
    data_at += data_at % 2
    preview_at = data_at + len(pixels)
    raw_ifd = _ifd(raw_entries(data_at), first, second if preview is not None else 0)
    chunks = [b"II*\x00", struct.pack("<I", first), raw_ifd]
    chunks.append(b"\x00" * (second - first - len(raw_ifd)))
    if preview is not None:
        chunks.append(_ifd(preview_entries(preview_at), second, 0))
    written = sum(len(chunk) for chunk in chunks)
    chunks.append(b"\x00" * (data_at - written))
    chunks.append(pixels)
    if preview is not None:
        chunks.append(preview)
    with open(path, "wb") as handle:
        handle.write(b"".join(chunks))

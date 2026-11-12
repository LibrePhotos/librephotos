"""The source an edit recipe is applied to, and the edit source file the web editor loads.

A source is the upright picture as the app shows it: the file's own
orientation applied, then the photo's ``local_orientation`` on top, in the
sRGB primaries. Ordinary pictures become 8-bit sRGB (``srgb8``); RAW files are
developed into scene-linear 16-bit (``linear16``), stored as
``u = 65535 sqrt(v / max)`` like the edit source file. FlashRaw develops them,
5 to 9 times faster than LibRaw with the same levels and colours; LibRaw
(rawpy) takes over for a file FlashRaw cannot read.
"""

from __future__ import annotations

import importlib
import io
import json
import logging
import zlib
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final, Literal

import PIL.Image
import PIL.ImageOps

from api.lazy_import import LazyModule
from api.photos.media_files import is_raw
from api.thumbnails.render import apply_local_orientation

if TYPE_CHECKING:
    import cv2
    import flashraw
    import numpy as np
    import numpy.typing as npt
    import pyvips
    import rawpy
else:
    cv2 = LazyModule("cv2")
    flashraw = LazyModule("flashraw")
    np = LazyModule("numpy")
    pyvips = LazyModule("pyvips")
    rawpy = LazyModule("rawpy")

logger = logging.getLogger(__name__)

type SourceKind = Literal["srgb8", "linear16"]

# LibRaw's clipping point (1.0) times this is the source's max: half a stop
# of highlight headroom above diffuse white.
RAW_BASE_GAIN: Final = 1.4
# Long edges of the edit source file's payload.
SRGB8_FILE_EDGE: Final = 2560
LINEAR16_FILE_EDGE: Final = 2048

FILE_MAGIC: Final = b"LPES"
FILE_VERSION: Final = 1
_KIND_CODES: Final[dict[SourceKind, int]] = {"srgb8": 0, "linear16": 1}


@dataclass(frozen=True, eq=False)
class Source:
    """An upright picture: ``pixels`` is H x W x 3, uint8 (srgb8) or uint16 (linear16)."""

    pixels: npt.NDArray[np.uint8] | npt.NDArray[np.uint16]
    kind: SourceKind
    max: float
    full_width: int
    full_height: int

    @property
    def width(self) -> int:
        return int(self.pixels.shape[1])

    @property
    def height(self) -> int:
        return int(self.pixels.shape[0])


def _swaps_sides(local_orientation: int) -> bool:
    return local_orientation in (5, 6, 7, 8)


def _local_oriented[A: np.generic](
    pixels: npt.NDArray[A], local_orientation: int
) -> npt.NDArray[A]:
    if local_orientation in (0, 1):
        return pixels
    image = apply_local_orientation(
        pyvips.Image.new_from_array(pixels), local_orientation
    )
    oriented: npt.NDArray[A] = np.ascontiguousarray(image.numpy())
    return oriented


def _pillow_image(path: str) -> pyvips.Image:
    """What libvips cannot open (HEIC, JPEG XL), through Pillow, keeping its ICC profile."""
    # Importing decoding registers Pillow's HEIC and JPEG XL openers.
    importlib.import_module("api.thumbnails.decoding")
    with PIL.Image.open(path) as opened:
        image = PIL.ImageOps.exif_transpose(opened)
        icc = image.info.get("icc_profile")
        rgb_like = image.mode in ("RGB", "RGBA")
        if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
            rgba = image.convert("RGBA")
            flat = PIL.Image.new("RGB", rgba.size, (255, 255, 255))
            flat.paste(rgba, mask=rgba.getchannel("A"))
            image = flat
        array = np.asarray(image.convert("RGB"))
    vips = pyvips.Image.new_from_array(array)
    if icc and rgb_like:
        vips.set_type(pyvips.GValue.blob_type, "icc-profile-data", icc)
    return vips


def _srgb8(image: pyvips.Image) -> npt.NDArray[np.uint8]:
    """Three 8-bit sRGB bands, converted from an embedded profile when there is one."""
    if "icc-profile-data" in image.get_fields():
        try:
            image = image.icc_transform(
                "srgb", embedded=True, intent=pyvips.enums.Intent.RELATIVE
            )
        except pyvips.Error:
            logger.warning("Ignoring an unusable ICC profile", exc_info=True)
    if image.interpretation not in ("srgb",) or image.format != "uchar":
        image = image.colourspace("srgb")
    if image.hasalpha():
        image = image.flatten(background=[255, 255, 255])
    if image.bands > 3:
        image = image.extract_band(0, n=3)
    if image.format != "uchar":
        image = image.cast("uchar")
    pixels: npt.NDArray[np.uint8] = np.ascontiguousarray(image.numpy())
    return pixels


def _header_size(path: str) -> tuple[int, int] | None:
    """The upright size of a file libvips can open, from its header."""
    try:
        header = pyvips.Image.new_from_file(path)
    except pyvips.Error:
        return None
    orientation = 1
    if "orientation" in header.get_fields():
        orientation = int(header.get("orientation"))
    if orientation in (5, 6, 7, 8):
        return header.height, header.width
    return header.width, header.height


def _load_srgb8(
    path: str, long_edge: int | None
) -> tuple[npt.NDArray[np.uint8], int, int]:
    """Pixels and full upright size of an ordinary picture."""
    try:
        if long_edge is None:
            image = pyvips.Image.new_from_file(f"{path}[revalidate]").autorot()
        else:
            image = pyvips.Image.thumbnail(
                f"{path}[revalidate]",
                long_edge,
                height=long_edge,
                size=pyvips.enums.Size.DOWN,
            )
        image = image.copy_memory()  # decode now, so an unsupported codec fails here
        full = _header_size(path) if long_edge is not None else None
        if full is None:
            full = (image.width, image.height)
    except pyvips.Error:
        image = _pillow_image(path)
        full = (image.width, image.height)
        if long_edge is not None:
            image = image.thumbnail_image(
                long_edge, height=long_edge, size=pyvips.enums.Size.DOWN
            )
    return _srgb8(image), full[0], full[1]


def _sqrt_encode_table() -> npt.NDArray[np.uint16]:
    """LibRaw's linear 16-bit output to ``u = 65535 sqrt(v / 65535)``."""
    linear = np.arange(65536, dtype=np.float64)
    return np.round(np.sqrt(linear * 65535.0)).astype(np.uint16)


def _half_size(long_edge: int | None, full_w: int, full_h: int) -> bool:
    """Whether a 2x2 binned development (no demosaic) still has ``long_edge``."""
    return long_edge is not None and 2 * long_edge <= max(full_w, full_h)


def _exif_upright[A: np.generic](
    pixels: npt.NDArray[A], orientation: int
) -> npt.NDArray[A]:
    """Pixels as stored, turned upright by their EXIF ``orientation`` (1 to 8)."""
    match orientation:
        case 2:
            turned = pixels[:, ::-1]
        case 3:
            turned = pixels[::-1, ::-1]
        case 4:
            turned = pixels[::-1]
        case 5:
            turned = pixels.transpose(1, 0, 2)
        case 6:
            turned = np.rot90(pixels, -1)
        case 7:
            turned = pixels[::-1, ::-1].transpose(1, 0, 2)
        case 8:
            turned = np.rot90(pixels, 1)
        case _:
            turned = pixels
    upright: npt.NDArray[A] = np.ascontiguousarray(turned)
    return upright


def _develop_flashraw(
    path: str, long_edge: int | None
) -> tuple[npt.NDArray[np.uint16], int, int]:
    """Linear 16-bit RGB and full upright size, developed by FlashRaw.

    Its levels are LibRaw's below: the sensor's clip is 65535, camera white
    balance, sRGB primaries, highlights clipped. The picture is the camera's
    recommended crop (the size of its own JPEG), a few pixels inside LibRaw's.
    """
    with flashraw.open(path) as raw:
        info = raw.frame_info
        full_w, full_h = info.crop.width, info.crop.height
        if info.orientation in (5, 6, 7, 8):
            full_w, full_h = full_h, full_w
        frame = raw.decode(
            output="linear-rgb16",
            demosaic="half-size" if _half_size(long_edge, full_w, full_h) else "auto",
            highlights="clip",
            white_balance="as-shot",
            color_space="srgb",
        )
        # Linear outputs keep the sensor's orientation.
        linear = _exif_upright(
            np.asarray(frame.array, dtype=np.uint16), frame.orientation
        )
    return linear, full_w, full_h


def _develop_libraw(
    path: str, long_edge: int | None
) -> tuple[npt.NDArray[np.uint16], int, int]:
    """Linear 16-bit RGB and full upright size, developed by LibRaw."""
    with rawpy.imread(path) as raw:
        sizes = raw.sizes
        full_w, full_h = int(sizes.width), int(sizes.height)
        # Flips 4 to 7 (bit 4) transpose: orientations 5 to 8.
        if sizes.flip & 4:
            full_w, full_h = full_h, full_w
        half = _half_size(long_edge, full_w, full_h)
        linear = raw.postprocess(
            use_camera_wb=True,
            use_auto_wb=False,
            no_auto_bright=True,
            output_bps=16,
            gamma=(1.0, 1.0),
            output_color=rawpy.ColorSpace.sRGB,
            highlight_mode=rawpy.HighlightMode.Clip,
            # LibRaw's default (0.75) takes the brightest pixel as the clipping
            # point when it is above 75 % of the white level, which brightens a
            # picture without clipped highlights by up to 0.4 stop: 1.0 would
            # depend on the picture instead of being where the sensor clips.
            adjust_maximum_thr=0.0,
            half_size=half,
        )
    developed: npt.NDArray[np.uint16] = np.asarray(linear, dtype=np.uint16)
    return developed, full_w, full_h


def _load_linear16(
    path: str, long_edge: int | None
) -> tuple[npt.NDArray[np.uint16], int, int]:
    """Pixels and full upright size of a RAW file: FlashRaw, else LibRaw."""
    try:
        linear, full_w, full_h = _develop_flashraw(path, long_edge)
    except flashraw.FlashRawError as error:
        # Every FlashRaw error, its IoError and OutOfMemoryError included:
        # formats it does not read (Nikon's High Efficiency NEF), a camera it
        # does not know, a file it finds corrupt. LibRaw tries, and raises its
        # own error when it cannot read the file either.
        logger.info(
            "FlashRaw cannot develop a RAW file (%s): LibRaw does", type(error).__name__
        )
        linear, full_w, full_h = _develop_libraw(path, long_edge)
    if long_edge is not None and max(linear.shape[:2]) > long_edge:
        factor = long_edge / max(linear.shape[:2])
        size = (
            max(1, round(linear.shape[1] * factor)),
            max(1, round(linear.shape[0] * factor)),
        )
        linear = np.asarray(
            cv2.resize(linear, size, interpolation=cv2.INTER_AREA), dtype=np.uint16
        )
    pixels: npt.NDArray[np.uint16] = _sqrt_encode_table()[linear]
    return pixels, full_w, full_h


def load_source(
    path: str, local_orientation: int, long_edge: int | None = None
) -> Source:
    """The source of the picture at ``path``, its long edge at most ``long_edge``.

    ``local_orientation`` is ``Photo.local_orientation`` (1 to 8, 1 changes nothing).
    """
    swap = _swaps_sides(local_orientation)
    if is_raw(path):
        linear16, width, height = _load_linear16(path, long_edge)
        if swap:
            width, height = height, width
        return Source(
            pixels=_local_oriented(linear16, local_orientation),
            kind="linear16",
            max=RAW_BASE_GAIN,
            full_width=width,
            full_height=height,
        )
    srgb8, width, height = _load_srgb8(path, long_edge)
    if swap:
        width, height = height, width
    return Source(
        pixels=_local_oriented(srgb8, local_orientation),
        kind="srgb8",
        max=1.0,
        full_width=width,
        full_height=height,
    )


# --- Edit source file ("LPES") -----------------------------------------------


def source_file_edge(path: str) -> int:
    """The long edge to load ``path`` at for its edit source file.

    A RAW file at its payload's size: most sensors are then developed half
    size, without a demosaic, which is the payload's quality anyway.
    """
    return LINEAR16_FILE_EDGE if is_raw(path) else SRGB8_FILE_EDGE


def _reduced_size(width: int, height: int, long_edge: int) -> tuple[int, int] | None:
    if max(width, height) <= long_edge:
        return None
    factor = long_edge / max(width, height)
    return max(1, round(width * factor)), max(1, round(height * factor))


def _srgb8_payload(pixels: npt.NDArray[np.uint8]) -> npt.NDArray[np.uint8]:
    size = _reduced_size(pixels.shape[1], pixels.shape[0], SRGB8_FILE_EDGE)
    if size is None:
        return pixels
    return np.asarray(
        cv2.resize(pixels, size, interpolation=cv2.INTER_AREA), dtype=np.uint8
    )


def _linear16_payload(pixels: npt.NDArray[np.uint16]) -> npt.NDArray[np.uint16]:
    size = _reduced_size(pixels.shape[1], pixels.shape[0], LINEAR16_FILE_EDGE)
    if size is None:
        return pixels
    linear = (pixels.astype(np.float32) / 65535) ** 2
    reduced = np.asarray(
        cv2.resize(linear, size, interpolation=cv2.INTER_AREA), dtype=np.float32
    )
    encoded = np.round(65535 * np.sqrt(np.clip(reduced, 0.0, 1.0)))
    return encoded.astype(np.uint16)


def _jpeg(pixels: npt.NDArray[np.uint8]) -> bytes:
    buffer = io.BytesIO()
    PIL.Image.fromarray(pixels).save(buffer, "JPEG", quality=95, subsampling=0)
    return buffer.getvalue()


def _delta_planes(pixels: npt.NDArray[np.uint16]) -> bytes:
    """The linear16 payload before zlib: six byte planes of row differences."""
    values = pixels & np.uint16(0xFFF0)
    deltas = values.copy()
    deltas[:, 1:] -= values[:, :-1]
    planes = []
    for channel in range(3):
        plane = deltas[:, :, channel]
        planes.append((plane >> 8).astype(np.uint8).tobytes())
        planes.append((plane & 0xFF).astype(np.uint8).tobytes())
    return b"".join(planes)


def _deflate(data: bytes) -> bytes:
    """A zlib stream of ``data`` with Huffman coding only.

    The planes' bytes repeat as values, not as strings: LZ77's matching made
    the stream 8 % larger and took twice the time (0.9 s for a 3 MP payload).
    """
    compressor = zlib.compressobj(6, zlib.DEFLATED, 15, 8, zlib.Z_HUFFMAN_ONLY)
    return compressor.compress(data) + compressor.flush()


def encode_source_file(source: Source) -> bytes:
    """``source`` as an edit source file (the doc's "Edit source file")."""
    if source.kind == "srgb8":
        srgb8 = _srgb8_payload(source.pixels.astype(np.uint8, copy=False))
        width, height = srgb8.shape[1], srgb8.shape[0]
        payload = _jpeg(srgb8)
    else:
        linear16 = _linear16_payload(source.pixels.astype(np.uint16, copy=False))
        width, height = linear16.shape[1], linear16.shape[0]
        payload = _deflate(_delta_planes(linear16))
    header = json.dumps(
        {
            "kind": source.kind,
            "width": int(width),
            "height": int(height),
            "full_width": source.full_width,
            "full_height": source.full_height,
            "max": source.max,
        },
        separators=(",", ":"),
    ).encode()
    prefix = FILE_MAGIC + bytes([FILE_VERSION, _KIND_CODES[source.kind], 0, 0])
    return prefix + len(header).to_bytes(4, "little") + header + payload

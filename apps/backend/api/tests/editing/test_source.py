"""Loading a source from a file, and the edit source file ("LPES")."""

import io
import json
import tempfile
import types
import zlib
from pathlib import Path
from unittest import mock

import numpy as np
import PIL.Image
import pyvips
from django.test import SimpleTestCase

from api.editing import source as source_module
from api.editing.source import (
    FILE_MAGIC,
    FILE_VERSION,
    Source,
    encode_source_file,
    load_source,
)


def decode_source_file(data: bytes) -> Source:
    """The source an edit source file holds, read as the web editor reads it."""
    if data[:4] != FILE_MAGIC or data[4] != FILE_VERSION:
        raise ValueError("not an edit source file")
    length = int.from_bytes(data[8:12], "little")
    header = json.loads(data[12 : 12 + length])
    payload = data[12 + length :]
    width, height = int(header["width"]), int(header["height"])
    kind = "srgb8" if data[5] == 0 else "linear16"
    if kind != header["kind"]:
        raise ValueError("the kind byte and the header disagree")
    if kind == "srgb8":
        with PIL.Image.open(io.BytesIO(payload)) as image:
            pixels = np.asarray(image.convert("RGB")).copy()
    else:
        planes = np.frombuffer(zlib.decompress(payload), dtype=np.uint8).reshape(
            6, height, width
        )
        deltas = (planes[0::2].astype(np.uint16) << 8) | planes[1::2]
        values = np.cumsum(deltas, axis=2, dtype=np.uint16)
        pixels = np.ascontiguousarray(values.transpose(1, 2, 0))
    return Source(
        pixels=pixels,
        kind=kind,
        max=float(header["max"]),
        full_width=int(header["full_width"]),
        full_height=int(header["full_height"]),
    )


def _blocks() -> np.ndarray:
    """A 40 x 60 picture of six flat, distinct blocks (survives JPEG)."""
    pixels = np.zeros((40, 60, 3), dtype=np.uint8)
    colours = [
        (250, 0, 0),
        (0, 250, 0),
        (0, 0, 250),
        (250, 250, 0),
        (0, 250, 250),
        (250, 0, 250),
    ]
    for index, colour in enumerate(colours):
        row, column = divmod(index, 3)
        pixels[row * 20 : row * 20 + 20, column * 20 : column * 20 + 20] = colour
    return pixels


def _block_colours(pixels: np.ndarray, rows: int, columns: int) -> np.ndarray:
    """The centre pixel of each block, ``rows x columns`` blocks."""
    height, width = pixels.shape[0] // rows, pixels.shape[1] // columns
    return np.array(
        [
            [
                pixels[r * height + height // 2, c * width + width // 2]
                for c in range(columns)
            ]
            for r in range(rows)
        ]
    ).astype(int)


class LoadSourceTest(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def _path(self, name: str) -> str:
        return str(Path(self.directory.name) / name)

    def test_png_with_local_orientation(self):
        path = self._path("blocks.png")
        PIL.Image.fromarray(_blocks()).save(path)
        plain = load_source(path, 1)
        self.assertEqual(plain.kind, "srgb8")
        self.assertEqual(plain.max, 1.0)
        np.testing.assert_array_equal(plain.pixels, _blocks())
        # local_orientation 6 turns a quarter counter-clockwise (render.py).
        turned = load_source(path, 6)
        np.testing.assert_array_equal(turned.pixels, np.rot90(_blocks(), k=1))
        self.assertEqual((turned.full_width, turned.full_height), (40, 60))

    def test_jpeg_exif_orientation_and_long_edge(self):
        path = self._path("tagged.jpg")
        exif = PIL.Image.Exif()
        exif[0x0112] = 6  # stored sideways, shown a quarter turn clockwise
        PIL.Image.fromarray(_blocks()).save(path, quality=95, exif=exif)
        upright = load_source(path, 1)
        expected = _block_colours(np.rot90(_blocks(), k=-1), 3, 2)
        self.assertLess(
            np.abs(_block_colours(upright.pixels, 3, 2) - expected).max(), 12
        )
        small = load_source(path, 1, long_edge=30)
        self.assertEqual(small.pixels.shape, (30, 20, 3))
        self.assertEqual((small.full_width, small.full_height), (40, 60))

    def test_embedded_profile_is_converted_to_srgb(self):
        red = np.zeros((8, 8, 3), dtype=np.uint8)
        red[...] = (220, 30, 30)
        image = pyvips.Image.new_from_array(red).copy(interpretation="srgb")
        try:
            p3 = image.icc_transform("p3", input_profile="srgb", embedded=False)
        except pyvips.Error:
            self.skipTest("this libvips has no built-in Display P3 profile")
        path = self._path("p3.png")
        p3.write_to_file(path)
        stored = np.asarray(PIL.Image.open(path).convert("RGB"))
        self.assertGreater(np.abs(stored.astype(int) - red).max(), 5)
        loaded = load_source(path, 1)
        self.assertLessEqual(np.abs(loaded.pixels.astype(int) - red).max(), 3)

    def test_raw_is_developed_linear_by_libraw(self):
        linear = np.zeros((10, 16, 3), dtype=np.uint16)
        linear[..., 0] = 65535
        linear[..., 1] = 16384
        calls = []

        class Raw:
            sizes = types.SimpleNamespace(width=16, height=10, flip=6)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def postprocess(self, **kwargs):
                calls.append(kwargs)
                return linear

        fake = types.SimpleNamespace(
            imread=lambda path: Raw(),
            ColorSpace=types.SimpleNamespace(sRGB="srgb"),
            HighlightMode=types.SimpleNamespace(Clip="clip"),
        )
        with mock.patch.object(source_module, "rawpy", fake):
            source = load_source("photo.NEF", 1)
            half = load_source("photo.NEF", 1, long_edge=8)
        self.assertEqual(source.kind, "linear16")
        self.assertEqual(source.max, 1.4)
        # LibRaw's flip 6 is a quarter turn: the full size is upright.
        self.assertEqual((source.full_width, source.full_height), (10, 16))
        self.assertEqual(source.pixels[0, 0, 0], 65535)
        self.assertEqual(source.pixels[0, 0, 1], round(65535 * np.sqrt(16384 / 65535)))
        self.assertEqual(source.pixels[0, 0, 2], 0)
        first = calls[0]
        self.assertTrue(first["use_camera_wb"])
        self.assertTrue(first["no_auto_bright"])
        self.assertEqual(first["output_bps"], 16)
        self.assertEqual(first["gamma"], (1.0, 1.0))
        self.assertEqual(first["output_color"], "srgb")
        self.assertEqual(first["highlight_mode"], "clip")
        self.assertFalse(first["half_size"])
        self.assertTrue(calls[1]["half_size"])
        self.assertEqual(max(half.pixels.shape[:2]), 8)


class SourceFileTest(SimpleTestCase):
    def test_srgb8_round_trip(self):
        rng = np.random.default_rng(2)
        pixels = np.repeat(np.repeat(rng.integers(0, 256, (6, 8, 3)), 8, 0), 8, 1)
        source = Source(pixels.astype(np.uint8), "srgb8", 1.0, 640, 480)
        data = encode_source_file(source)
        self.assertEqual(data[:6], b"LPES\x01\x00")
        length = int.from_bytes(data[8:12], "little")
        header = json.loads(data[12 : 12 + length])
        self.assertEqual(
            header,
            {
                "kind": "srgb8",
                "width": 64,
                "height": 48,
                "full_width": 640,
                "full_height": 480,
                "max": 1.0,
            },
        )
        with PIL.Image.open(io.BytesIO(data[12 + length :])) as jpeg:
            self.assertEqual(jpeg.format, "JPEG")
            self.assertNotIn("exif", jpeg.info)
        decoded = decode_source_file(data)
        self.assertEqual(decoded.kind, "srgb8")
        self.assertEqual((decoded.full_width, decoded.full_height), (640, 480))
        self.assertLess(np.abs(decoded.pixels.astype(int) - pixels).mean(), 2)

    def test_linear16_round_trip(self):
        rng = np.random.default_rng(3)
        pixels = rng.integers(0, 65536, (7, 9, 3)).astype(np.uint16)
        source = Source(pixels, "linear16", 1.4, 90, 70)
        data = encode_source_file(source)
        self.assertEqual(data[5], 1)
        decoded = decode_source_file(data)
        self.assertEqual(decoded.kind, "linear16")
        self.assertEqual(decoded.max, 1.4)
        np.testing.assert_array_equal(decoded.pixels, pixels & 0xFFF0)

    def test_payloads_are_capped(self):
        wide = Source(
            np.zeros((10, 3000, 3), dtype=np.uint16), "linear16", 1.4, 3000, 10
        )
        self.assertEqual(decode_source_file(encode_source_file(wide)).width, 2048)
        tall = Source(np.zeros((2600, 10, 3), dtype=np.uint8), "srgb8", 1.0, 10, 2600)
        self.assertEqual(decode_source_file(encode_source_file(tall)).height, 2560)

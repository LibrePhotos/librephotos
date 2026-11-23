"""A photo file missing its last bytes still gets its thumbnails.

Phones and cameras leave files a few bytes short (a copy cut off, a card
pulled early). libvips renders such a JPEG with the missing rows grey, as
other photo apps do, but a file libvips cannot decode goes to Pillow, which
refused it: ``OSError: image file is truncated (5 bytes not processed)``, and
the photo had no thumbnails. Pillow now renders what is there too, and its
module-wide switch for that is put back after the decode.
"""

import io
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pyvips
from PIL import Image, ImageFile

from api.thumbnails import decoding


def _picture() -> Image.Image:
    """Dark left half, light right half: whether it decoded is easy to see."""
    pixels = np.zeros((300, 400, 3), np.uint8)
    pixels[:, 200:] = 220
    return Image.fromarray(pixels)


def _cut(data: bytes, missing: int, directory: str, name: str) -> str:
    path = os.path.join(directory, name)
    with open(path, "wb") as handle:
        handle.write(data[:-missing])
    return path


def _encoded(format: str) -> bytes:
    buffer = io.BytesIO()
    _picture().save(buffer, format)
    return buffer.getvalue()


class TruncatedImageDecodingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def _assert_rendered(self, image: pyvips.Image) -> None:
        self.assertEqual((image.width, image.height), (200, 150))
        # The middle: a JPEG misses its last rows, a bottom-up BMP its first.
        row = image.numpy()[75]
        self.assertLess(int(row[10].max()), 40)
        self.assertGreater(int(row[190].min()), 180)
        self.assertFalse(ImageFile.LOAD_TRUNCATED_IMAGES)

    def test_a_truncated_jpeg_renders_through_libvips(self) -> None:
        for missing in (5, 462):
            with self.subTest(missing=missing):
                path = _cut(_encoded("JPEG"), missing, self.dir, f"cut{missing}.jpg")

                self._assert_rendered(decoding.thumbnail(path, 150))

    def test_a_truncated_jpeg_libvips_cannot_decode_renders_through_pillow(
        self,
    ) -> None:
        path = _cut(_encoded("JPEG"), 5, self.dir, "cut.jpg")

        with patch.object(
            decoding.pyvips.Image,
            "thumbnail",
            side_effect=pyvips.Error("unable to copy to memory"),
        ):
            image = decoding.thumbnail(path, 150)

        self._assert_rendered(image)

    def test_a_truncated_file_only_pillow_reads_renders(self) -> None:
        """The bundled libvips has no BMP loader: Pillow is the only decoder."""
        for missing in (5, 462):
            with self.subTest(missing=missing):
                path = _cut(_encoded("BMP"), missing, self.dir, f"cut{missing}.bmp")

                self._assert_rendered(decoding.thumbnail(path, 150))

    def test_full_size_renders_a_truncated_file(self) -> None:
        path = _cut(_encoded("BMP"), 462, self.dir, "cut.bmp")

        image = decoding.full_size(path)

        self.assertEqual((image.width, image.height), (400, 300))
        self.assertFalse(ImageFile.LOAD_TRUNCATED_IMAGES)

    def test_a_file_that_is_no_picture_still_fails(self) -> None:
        path = os.path.join(self.dir, "garbage.bmp")
        with open(path, "wb") as handle:
            handle.write(b"BM not a bitmap")

        with self.assertRaises(OSError):
            decoding.thumbnail(path, 150)
        self.assertFalse(ImageFile.LOAD_TRUNCATED_IMAGES)

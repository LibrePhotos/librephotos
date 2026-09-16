"""Formats the bundled libvips cannot decode (HEIC, JPEG XL, BMP) still thumbnail via Pillow."""

import os
import tempfile
import unittest

import pyvips
from PIL import Image

from api import image_decoding
from api.models.file import is_valid_media

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "niaz.jpg"
)


class ImageDecodingFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        with Image.open(FIXTURE) as source:
            rgb = source.convert("RGB").resize((400, 300))
            for ext in ("heic", "jxl", "bmp"):
                rgb.save(os.path.join(cls.dir, f"photo.{ext}"))
            rgb.save(os.path.join(cls.dir, "photo.jpg"))

    def test_libvips_handles_jpeg_directly(self):
        image = image_decoding.thumbnail(os.path.join(self.dir, "photo.jpg"), 150)
        self.assertEqual((image.width, image.height), (200, 150))

    def test_pillow_fallback_decodes_heic_jxl_and_bmp(self):
        for ext in ("heic", "jxl", "bmp"):
            with self.subTest(ext=ext):
                image = image_decoding.thumbnail(
                    os.path.join(self.dir, f"photo.{ext}"), 150
                )
                self.assertEqual((image.width, image.height), (200, 150))
                self.assertEqual(image.bands, 3)

    def test_fallback_applies_exif_orientation(self):
        path = os.path.join(self.dir, "rotated.jxl")
        with Image.open(FIXTURE) as source:
            rotated = source.convert("RGB").resize((400, 300))
            exif = rotated.getexif()
            exif[0x0112] = 6  # rotate 90 CW on display
            rotated.save(path, exif=exif.tobytes())
        image = image_decoding.thumbnail(path, 400)
        self.assertEqual((image.width, image.height), (300, 400))

    def test_unreadable_file_raises(self):
        path = os.path.join(self.dir, "garbage.heic")
        with open(path, "wb") as handle:
            handle.write(b"not an image at all")
        with self.assertRaises(Exception):
            image_decoding.thumbnail(path, 100)

    def test_absurd_dimensions_are_refused_from_the_header(self):
        # A BMP header claiming 30000x30000 (900 MP) with no pixel data: refused at
        # open time, so nothing is allocated for it.
        import struct

        path = os.path.join(self.dir, "bomb.bmp")
        header = b"BM" + struct.pack("<IHHI", 54, 0, 0, 54)
        header += struct.pack("<IiiHHIIiiII", 40, 30000, 30000, 1, 24, 0, 0, 0, 0, 0, 0)
        with open(path, "wb") as handle:
            handle.write(header)
        with self.assertRaises(Image.DecompressionBombError):
            image_decoding.thumbnail(path, 100)
        self.assertFalse(image_decoding.can_decode(path))

    def test_is_valid_media_accepts_heic(self):
        self.assertTrue(is_valid_media(os.path.join(self.dir, "photo.heic"), user=None))
        self.assertFalse(
            is_valid_media(os.path.join(self.dir, "garbage.heic"), user=None)
        )


class VipsSanity(unittest.TestCase):
    def test_bundled_or_system_libvips_loads(self):
        self.assertGreaterEqual(pyvips.version(0), 8)

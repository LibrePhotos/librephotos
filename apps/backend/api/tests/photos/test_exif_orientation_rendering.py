"""What the renderer makes of an EXIF Orientation that exiftool writes (#2068).

A MEDIA_FILE rotate moves the rotation into the file and resets
``local_orientation`` to 1, but only for the formats ``renders_exif_orientation``
lists, and only with the value ``exif_orientation_showing`` works out. Both
claims are about libvips, Pillow and pillow-heif rather than about our code,
so these decode real files after a real exiftool write: an upgrade that changes
the answer fails here instead of rotating photos twice, or not at all, in
somebody's library.
"""

import os
import shutil
import tempfile
import unittest

import numpy as np
import pyvips
from django.test import SimpleTestCase
from PIL import Image

from api import binaries, image_decoding
from api.metadata.tags import Tags
from api.metadata.writer import read_orientation, write_metadata
from api.thumbnails import (
    _apply_local_orientation,
    exif_orientation_showing,
    renders_exif_orientation,
)


def _exiftool_available():
    return shutil.which(binaries.exiftool()) is not None


def _picture():
    """Landscape blocks of colour: every rotation and flip of it differs."""
    rng = np.random.default_rng(7)
    blocks = rng.integers(0, 256, (4, 8, 3), dtype=np.uint8)
    return Image.fromarray(blocks).resize((64, 32), Image.NEAREST)


@unittest.skipUnless(_exiftool_available(), "exiftool binary not available")
class ExifOrientationRenderingTest(SimpleTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)

    def _tagged(self, name, image_format, orientation):
        path = os.path.join(self.dir, name)
        _picture().save(path, format=image_format)
        write_metadata(path, {Tags.ORIENTATION: orientation}, use_sidecar=False)
        return path

    def test_the_allowlist_matches_what_the_decoder_does(self):
        formats = {
            "photo.jpg": "JPEG",
            "photo.tif": "TIFF",
            "photo.png": "PNG",
            "photo.webp": "WEBP",
            "photo.heic": "HEIF",
            "photo.avif": "AVIF",
        }
        for name, image_format in formats.items():
            with self.subTest(name):
                try:
                    path = self._tagged(name, image_format, 6)
                except (KeyError, OSError, ValueError):
                    self.skipTest(f"cannot encode {image_format} here")
                self.assertEqual(6, read_orientation(path))

                image = image_decoding.thumbnail(path, 64)

                turned = image.height > image.width
                self.assertEqual(turned, renders_exif_orientation(path))

    def test_formats_left_out_of_the_allowlist(self):
        for name in ("photo.heic", "photo.avif", "photo.jxl", "photo.CR2", "photo.dng"):
            self.assertFalse(renders_exif_orientation(name), name)
        for name in ("photo.JPG", "photo.jpeg", "photo.tiff", "photo.PNG"):
            self.assertTrue(renders_exif_orientation(name), name)

    def test_the_written_value_renders_like_the_local_orientation(self):
        """For every orientation a file can carry and every local orientation
        on top, the value written shows exactly what the thumbnails showed."""
        rendered = {}
        for orientation in range(1, 9):
            path = self._tagged(f"o{orientation}.png", "PNG", orientation)
            rendered[orientation] = image_decoding.thumbnail(path, 64).numpy()

        for on_disk in range(1, 9):
            for local in range(1, 9):
                with self.subTest(on_disk=on_disk, local=local):
                    shown = _apply_local_orientation(
                        pyvips.Image.new_from_array(rendered[on_disk]), local
                    ).numpy()

                    written = rendered[exif_orientation_showing(on_disk, local)]

                    self.assertEqual(shown.shape, written.shape)
                    self.assertTrue((shown == written).all())

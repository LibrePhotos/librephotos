"""A thumbnail file left empty or cut short is made again, not taken as made.

libvips creates a WebP file before it writes the picture into it, so a
worker killed meanwhile (the task timeout, the OOM killer, a restart) leaves
an empty or half-written file. The next scan took it for a finished
thumbnail and skipped it, and every read of it failed:
``UnidentifiedImageError`` in ``calculate_aspect_ratio`` and "Failed to
calculate perceptual hash" for the same photo, which then had no aspect
ratio and stayed out of every grid. Only a whole WebP file (its RIFF header
names its size) counts as made now.
"""

import io
import os

from django.test import TestCase
from PIL import Image

from api.models import Thumbnail
from api.models.thumbnail import STATIC_THUMBNAIL_DIRS, thumbnail_path
from api.tests.utils import create_test_photo, create_test_user
from api.thumbnails import render


def _webp() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 120, 40)).save(buffer, "WEBP")
    return buffer.getvalue()


BROKEN = {"empty": b"", "cut short": _webp()[:-20]}


class BrokenBigThumbnailTest(TestCase):
    def setUp(self) -> None:
        self.photo = create_test_photo(owner=create_test_user(), aspect_ratio=None)
        Image.new("RGB", (400, 300), (30, 90, 160)).save(
            self.photo.main_file.path, "JPEG"
        )
        for directory in STATIC_THUMBNAIL_DIRS:
            path = thumbnail_path(directory, self.photo.image_hash, ".webp")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            self.addCleanup(_remove_if_there, path)

    def _big(self) -> str:
        return thumbnail_path("thumbnails_big", self.photo.image_hash, ".webp")

    def test_a_broken_big_thumbnail_is_rendered_again(self) -> None:
        for name, content in BROKEN.items():
            with self.subTest(name):
                with open(self._big(), "wb") as handle:
                    handle.write(content)
                thumbnail = Thumbnail.objects.get(photo=self.photo)

                render.generate_thumbnail(thumbnail)
                with self.assertNoLogs("api.thumbnails.render", "ERROR"):
                    render.calculate_aspect_ratio(thumbnail)

                with Image.open(self._big()) as big:
                    self.assertEqual(big.size, (400, 300))
                self.assertEqual(
                    Thumbnail.objects.get(photo=self.photo).aspect_ratio, 1.33
                )

    def test_a_whole_thumbnail_is_kept(self) -> None:
        with open(self._big(), "wb") as handle:
            handle.write(_webp())

        self.assertTrue(
            render.does_static_thumbnail_exist("thumbnails_big", self.photo.image_hash)
        )

    def test_a_broken_one_is_missing(self) -> None:
        for name, content in BROKEN.items():
            with self.subTest(name):
                with open(self._big(), "wb") as handle:
                    handle.write(content)

                self.assertFalse(
                    render.does_static_thumbnail_exist(
                        "thumbnails_big", self.photo.image_hash
                    )
                )


def _remove_if_there(path: str) -> None:
    if os.path.exists(path):
        os.remove(path)

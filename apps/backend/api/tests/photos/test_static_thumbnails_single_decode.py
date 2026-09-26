"""``create_static_thumbnails``: every size from one decode of the original."""

import os
import shutil
import tempfile
from unittest import mock

import pyvips
from django.test import SimpleTestCase, override_settings
from PIL import Image

from api import image_decoding
from api.thumbnails import create_static_thumbnails

ALL_SIZES = ["thumbnails_big", "square_thumbnails", "square_thumbnails_small"]


def _size(path):
    # From bytes, so libvips holds no handle on Windows and cleanup works.
    with open(path, "rb") as handle:
        image = pyvips.Image.new_from_buffer(handle.read(), "")
    return image.width, image.height


class CreateStaticThumbnailsTest(SimpleTestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp(prefix="librephotos-thumbs")
        self.addCleanup(shutil.rmtree, self.media, True)
        for directory in ALL_SIZES:
            os.makedirs(os.path.join(self.media, directory))
        self.source = os.path.join(self.media, "photo.jpg")
        Image.new("RGB", (2000, 1500), (200, 120, 40)).save(self.source)
        settings = override_settings(MEDIA_ROOT=self.media)
        settings.enable()
        self.addCleanup(settings.disable)

    def path(self, directory):
        return os.path.join(self.media, directory, "h.webp")

    def test_all_sizes_from_one_decode(self):
        with mock.patch(
            "api.thumbnails.image_decoding.thumbnail", wraps=image_decoding.thumbnail
        ) as decode:
            create_static_thumbnails(self.source, "h", ALL_SIZES)

        decode.assert_called_once_with(self.source, 1080)
        self.assertEqual(_size(self.path("thumbnails_big")), (1440, 1080))
        self.assertEqual(_size(self.path("square_thumbnails")), (667, 500))
        self.assertEqual(_size(self.path("square_thumbnails_small")), (333, 250))

    def test_missing_small_sizes_come_from_the_big_thumbnail(self):
        create_static_thumbnails(self.source, "h", ["thumbnails_big"])
        os.remove(self.source)  # the original is not read again

        create_static_thumbnails(
            self.source, "h", ["square_thumbnails", "square_thumbnails_small"]
        )

        self.assertEqual(_size(self.path("square_thumbnails")), (667, 500))
        self.assertEqual(_size(self.path("square_thumbnails_small")), (333, 250))

    def test_local_orientation_reaches_every_size(self):
        create_static_thumbnails(self.source, "h", ALL_SIZES, local_orientation=6)

        # Rotated after the resize, as create_thumbnail always did.
        self.assertEqual(_size(self.path("thumbnails_big")), (1080, 1440))
        self.assertEqual(_size(self.path("square_thumbnails")), (375, 500))
        self.assertEqual(_size(self.path("square_thumbnails_small")), (188, 250))

    def test_small_original_is_not_enlarged(self):
        Image.new("RGB", (400, 300)).save(self.source)

        create_static_thumbnails(self.source, "h", ALL_SIZES)

        self.assertEqual(_size(self.path("thumbnails_big")), (400, 300))
        self.assertEqual(_size(self.path("square_thumbnails_small")), (333, 250))

    def test_raw_without_usable_preview_still_goes_to_the_service(self):
        raw = os.path.join(self.media, "photo.CR2")

        def service(input_path, height, complete_path, local_orientation):
            Image.new("RGB", (1620, 1080)).save(complete_path, "WEBP")
            return complete_path

        with (
            mock.patch("api.thumbnails.image_decoding.raw_preview", return_value=None),
            mock.patch(
                "api.thumbnails._request_raw_thumbnail", side_effect=service
            ) as request,
        ):
            create_static_thumbnails(raw, "h", ALL_SIZES)

        request.assert_called_once_with(raw, 1080, self.path("thumbnails_big"), 1)
        self.assertEqual(_size(self.path("square_thumbnails")), (750, 500))

    def test_raw_with_usable_preview_skips_the_service(self):
        raw = os.path.join(self.media, "photo.CR2")
        preview = pyvips.Image.black(1620, 1080, bands=3)

        with (
            mock.patch(
                "api.thumbnails.image_decoding.raw_preview", return_value=preview
            ) as raw_preview,
            mock.patch("api.thumbnails._request_raw_thumbnail") as request,
        ):
            create_static_thumbnails(raw, "h", ALL_SIZES)

        raw_preview.assert_called_once_with(raw, 1080)
        request.assert_not_called()
        self.assertEqual(_size(self.path("thumbnails_big")), (1620, 1080))
        self.assertEqual(_size(self.path("square_thumbnails_small")), (375, 250))

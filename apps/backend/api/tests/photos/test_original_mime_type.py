"""What a photo's original is: ``original_mime_type`` in the details, and the
type the original is served with (#2742).

The web lightbox and the mobile viewer load the original when the user zooms
in, but only for a format they can draw; they decide from this field. The
main file decides, never the order of ``image_path``.
"""

import os
import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from api.mime import RAW_MIME_TYPE, original_mime_type, still_content_type
from api.models import File
from api.tests.utils import (
    ONE_PIXEL_PNG,
    TEST_MEDIA_ROOT,
    create_test_file,
    create_test_photo,
    create_test_user,
)

JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64
# Most RAW formats are TIFF containers: a sniff alone calls them image/tiff.
TIFF_BYTES = b"II*\x00\x08\x00\x00\x00" + b"\x00" * 64
SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'


def _media_path(suffix: str) -> str:
    return os.path.join(TEST_MEDIA_ROOT, f"{uuid.uuid4().hex}{suffix}")


def _write(suffix: str, content: bytes) -> str:
    path = _media_path(suffix)
    with open(path, "wb") as handle:
        handle.write(content)
    return path


class OriginalMimeTypeTest(TestCase):
    def test_a_jpeg_is_named_by_its_bytes(self):
        # Even under a misleading extension.
        self.assertEqual(original_mime_type(_write(".png", JPEG_BYTES)), "image/jpeg")

    def test_a_raw_file_is_raw_even_though_it_sniffs_as_tiff(self):
        self.assertEqual(original_mime_type(_write(".NEF", TIFF_BYTES)), RAW_MIME_TYPE)

    def test_a_plain_tiff_stays_tiff(self):
        self.assertEqual(original_mime_type(_write(".tif", TIFF_BYTES)), "image/tiff")

    def test_jpeg_xl_has_a_type_without_a_sniff(self):
        # filetype has no JPEG XL matcher and mimetypes may not know .jxl.
        self.assertEqual(original_mime_type(_media_path(".jxl")), "image/jxl")

    def test_a_missing_file_falls_back_to_its_extension(self):
        self.assertEqual(original_mime_type(_media_path(".jpg")), "image/jpeg")

    def test_an_unknown_file_is_octet_stream(self):
        self.assertEqual(
            original_mime_type(_media_path(".unknownext")), "application/octet-stream"
        )


class StillContentTypeTest(TestCase):
    def test_an_image_keeps_its_type(self):
        self.assertEqual(still_content_type(_write(".jpg", JPEG_BYTES)), "image/jpeg")

    def test_svg_is_never_served_as_an_image_the_browser_runs(self):
        self.assertEqual(
            still_content_type(_media_path(".svg")), "application/octet-stream"
        )

    def test_svg_bytes_under_an_image_extension_are_not_svg(self):
        # Nothing sniffs SVG, so the extension decides: a .jpg stays a JPEG.
        self.assertEqual(still_content_type(_write(".jpg", SVG_BYTES)), "image/jpeg")

    def test_something_that_is_not_an_image_is_octet_stream(self):
        self.assertEqual(
            still_content_type(_media_path(".html")), "application/octet-stream"
        )


class PhotoDetailOriginalMimeTypeTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _detail(self, photo):
        response = self.client.get(f"/api/photos/{photo.image_hash}/")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_a_png_photo(self):
        photo = create_test_photo(owner=self.user)
        self.assertEqual(self._detail(photo)["original_mime_type"], "image/png")

    def test_a_jpeg_photo(self):
        main = create_test_file(_media_path(".jpg"), self.user, JPEG_BYTES)
        photo = create_test_photo(owner=self.user, main_file=main)
        self.assertEqual(self._detail(photo)["original_mime_type"], "image/jpeg")

    def test_a_raw_plus_jpeg_pair_is_named_by_its_main_file(self):
        main = create_test_file(_media_path(".jpg"), self.user, JPEG_BYTES)
        photo = create_test_photo(owner=self.user, main_file=main)
        raw = create_test_file(_media_path(".cr2"), self.user, file_type=File.RAW_FILE)
        photo.files.add(raw)
        details = self._detail(photo)
        self.assertIn(raw.path, details["image_path"])
        self.assertEqual(details["original_mime_type"], "image/jpeg")

    def test_a_raw_main_file_is_raw(self):
        main = create_test_file(
            _media_path(".arw"), self.user, TIFF_BYTES + uuid.uuid4().bytes
        )
        photo = create_test_photo(owner=self.user, main_file=main)
        self.assertEqual(self._detail(photo)["original_mime_type"], RAW_MIME_TYPE)

    def test_no_main_file_is_null(self):
        photo = create_test_photo(owner=self.user)
        photo.main_file = None
        photo.save(update_fields=["main_file"])
        self.assertIsNone(self._detail(photo)["original_mime_type"])

    def test_png_fixture_bytes_are_a_png(self):
        # Guards the fixture the first test leans on.
        self.assertEqual(original_mime_type(_write(".bin", ONE_PIXEL_PNG)), "image/png")

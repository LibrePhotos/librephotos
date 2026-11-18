"""An upload is validated by the client's file name, not the staged ``.part``.

The chunked upload stages the bytes at ``<upload_id>.part``, so the RAW
extension check never matched and a RAW had to pass the image loaders, which
open the TIFF-based RAWs (NEF, CR2, DNG) but not a Canon CR3: every CR3 upload
answered "File type not allowed". The client's name now carries the extension,
and LibRaw has to open the content before a RAW name is believed.

The RAW here is a DNG from ``api.tests.editing.dng``. libvips opens a DNG too,
so the tests that stand for a CR3 make the image loaders refuse it: then only
LibRaw can vouch for it, as for a real CR3.
"""

import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch

from django.test import TestCase

from api.photos.media_files import is_valid_media
from api.tests.editing.dng import test_card, write_dng
from api.tests.uploads.test_chunked_upload_completion import OnCompletionTestBase
from chunked_upload.exceptions import ChunkedUploadError

NO_IMAGE_LOADER = patch("api.thumbnails.decoding.can_decode", return_value=False)


def _dng_bytes() -> bytes:
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "card.dng")
        write_dng(path, test_card())
        with open(path, "rb") as handle:
            return handle.read()


class StagedFileTest(TestCase):
    """``is_valid_media`` on a staged upload, given the client's name."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.raw = _dng_bytes()

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="staged-")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def staged(self, content: bytes) -> str:
        path = os.path.join(self.dir, "0123abcd.part")
        with open(path, "wb") as handle:
            handle.write(content)
        return path

    def test_raw_no_image_loader_opens_is_taken_by_its_raw_name(self):
        path = self.staged(self.raw)
        with NO_IMAGE_LOADER:
            self.assertTrue(is_valid_media(path, None, name="IMG_1811.CR3"))

    def test_without_the_name_the_staged_raw_was_refused(self):
        # The bug: the ".part" path alone says nothing about a RAW.
        path = self.staged(self.raw)
        with NO_IMAGE_LOADER:
            self.assertFalse(is_valid_media(path, None))

    def test_dng_is_taken_by_name(self):
        self.assertTrue(is_valid_media(self.staged(self.raw), None, name="a.dng"))

    def test_text_renamed_to_a_raw_name_is_refused(self):
        path = self.staged(b"13 20\nRoll notes\n")
        for name in ("notes.cr3", "notes.CR3", "notes.dng", "notes.nef"):
            with self.subTest(name=name):
                self.assertFalse(is_valid_media(path, None, name=name))

    def test_a_cr3_header_without_a_raw_behind_it_is_refused(self):
        # The ISO-BMFF box a CR3 starts with, and nothing LibRaw can read.
        head = b"\x00\x00\x00\x18ftypcrx \x00\x00\x00\x01crx isom"
        path = self.staged(head + b"\x00" * 256)
        self.assertFalse(is_valid_media(path, None, name="IMG_0001.CR3"))

    def test_a_sidecar_name_is_not_taken_for_an_upload(self):
        # The scan takes an .xmp by its extension; an upload is a photo or a
        # video, and "x.xmp" on arbitrary bytes vouches for nothing.
        path = self.staged(b"<x:xmpmeta xmlns:x='adobe:ns:meta/'/>")
        self.assertFalse(is_valid_media(path, None, name="IMG_0001.xmp"))

    def test_a_photo_needs_no_name(self):
        fixture = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "fixtures", "niaz.jpg"
        )
        with open(fixture, "rb") as handle:
            path = self.staged(handle.read())
        for name in ("niaz.jpg", "niaz", ""):
            with self.subTest(name=name):
                self.assertTrue(is_valid_media(path, None, name=name))

    def test_the_scan_still_takes_a_raw_by_its_path(self):
        # Unchanged: a scanned file's own path has its extension.
        path = os.path.join(self.dir, "IMG_1811.CR3")
        with open(path, "wb") as handle:
            handle.write(self.raw)
        with NO_IMAGE_LOADER:
            self.assertTrue(is_valid_media(path, None))


@patch("api.jobs.queue.AsyncTask")
@patch("api.views.upload.create_new_image")
@patch("api.views.upload.get_object_or_404")
class CompletionByClientNameTest(OnCompletionTestBase):
    """``/api/upload/complete/`` with the real media check."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.raw = _dng_bytes()

    def setUp(self):
        super().setUp()
        # Where chunked_upload stages it (chunked_upload.settings.default_upload_to).
        self.source = os.path.join(self.scan_dir, "0123abcd.part")

    def test_cr3_upload_is_imported(self, get_object_or_404, create_new_image, _task):
        get_object_or_404.return_value = MagicMock()
        create_new_image.return_value = None

        with NO_IMAGE_LOADER:
            self.assertIsNone(
                self.run_on_completion(content=self.raw, filename="IMG_1811.CR3")
            )

        expected = os.path.join(self.scan_dir, "uploads", "web", "IMG_1811.CR3")
        create_new_image.assert_called_once_with(self.user, expected)

    def test_text_renamed_cr3_is_refused(
        self, get_object_or_404, create_new_image, _task
    ):
        chunked = MagicMock()
        get_object_or_404.return_value = chunked

        with self.assertRaises(ChunkedUploadError) as ctx:
            self.run_on_completion(content=b"not a photo\n", filename="IMG_1811.CR3")

        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual("File type not allowed", ctx.exception.data["detail"])
        chunked.delete.assert_called_once_with(delete_file=True)
        self.assertFalse(os.path.exists(os.path.join(self.scan_dir, "uploads")))
        create_new_image.assert_not_called()

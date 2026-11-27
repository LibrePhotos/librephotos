import os
import tempfile
from unittest import mock

import PIL.EpsImagePlugin
import PIL.Image
from django.test import SimpleTestCase

from api.photos import media_files
from api.thumbnails import decoding


class EpsWithoutGhostscriptTest(SimpleTestCase):
    def setUp(self) -> None:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = os.path.join(folder.name, "logo.eps")
        PIL.Image.new("RGB", (16, 16), "red").save(self.path, "EPS")

    def test_an_eps_file_is_not_taken_without_ghostscript(self) -> None:
        with mock.patch.object(
            PIL.EpsImagePlugin, "has_ghostscript", return_value=False
        ):
            self.assertFalse(decoding.can_decode(self.path))
            self.assertFalse(media_files.is_valid_media(self.path, None))

    def test_an_eps_file_is_taken_where_ghostscript_is_installed(self) -> None:
        with mock.patch.object(
            PIL.EpsImagePlugin, "has_ghostscript", return_value=True
        ):
            self.assertTrue(decoding.can_decode(self.path))

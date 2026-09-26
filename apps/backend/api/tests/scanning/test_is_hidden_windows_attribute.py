"""``is_hidden`` has to honour the Windows hidden attribute on Windows.

The Windows branch was guarded by ``os.name == "Windows"``, but ``os.name`` is
``"nt"`` there, so the branch was dead: only dot-files counted as hidden, and
files marked hidden in Explorer (``desktop.ini``, ``Thumbs.db``, ...) were
imported like photos.
"""

import os
import stat
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from api.directory_watcher import utils


def _stat_with(attributes):
    return SimpleNamespace(st_file_attributes=attributes)


class IsHiddenTest(SimpleTestCase):
    def test_dotfile_is_hidden_everywhere(self):
        for windows in (True, False):
            with (
                self.subTest(windows=windows),
                patch.object(utils, "_IS_WINDOWS", windows),
            ):
                self.assertTrue(utils.is_hidden(os.path.join("some", ".hidden")))

    def test_windows_hidden_attribute_counts(self):
        with (
            patch.object(utils, "_IS_WINDOWS", True),
            patch.object(
                utils.os, "stat", return_value=_stat_with(stat.FILE_ATTRIBUTE_HIDDEN)
            ),
        ):
            self.assertTrue(utils.is_hidden(os.path.join("some", "desktop.ini")))

    def test_windows_plain_file_is_not_hidden(self):
        with (
            patch.object(utils, "_IS_WINDOWS", True),
            patch.object(
                utils.os, "stat", return_value=_stat_with(stat.FILE_ATTRIBUTE_ARCHIVE)
            ),
        ):
            self.assertFalse(utils.is_hidden(os.path.join("some", "photo.jpg")))

    def test_windows_unreadable_file_is_not_hidden(self):
        with (
            patch.object(utils, "_IS_WINDOWS", True),
            patch.object(utils.os, "stat", side_effect=OSError("gone")),
        ):
            self.assertFalse(utils.is_hidden(os.path.join("some", "photo.jpg")))

    def test_attribute_is_ignored_off_windows(self):
        with (
            patch.object(utils, "_IS_WINDOWS", False),
            patch.object(
                utils.os, "stat", return_value=_stat_with(stat.FILE_ATTRIBUTE_HIDDEN)
            ),
        ):
            self.assertFalse(utils.is_hidden(os.path.join("some", "photo.jpg")))

    def test_windows_flag_matches_os_name(self):
        self.assertEqual(os.name == "nt", utils._IS_WINDOWS)

    @unittest.skipUnless(os.name == "nt", "the hidden attribute only exists on Windows")
    def test_real_hidden_file_on_windows(self):
        import ctypes

        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "Thumbs.db")
            with open(path, "wb"):
                pass
            self.assertFalse(utils.is_hidden(path))
            ctypes.windll.kernel32.SetFileAttributesW(path, stat.FILE_ATTRIBUTE_HIDDEN)
            self.assertTrue(utils.is_hidden(path))
            ctypes.windll.kernel32.SetFileAttributesW(path, stat.FILE_ATTRIBUTE_NORMAL)

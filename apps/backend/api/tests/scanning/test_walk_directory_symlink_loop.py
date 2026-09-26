"""``walk_directory`` must terminate on a symlink loop.

The walker deliberately follows directory symlinks (the scan directory is often
a link to a mounted share, see issue #124), but it had no cycle detection: a
link pointing back at one of its own ancestors made it recurse until the path
got too long or Python ran out of stack, and the whole scan job failed.
"""

import os
import shutil
import tempfile
from unittest.mock import patch

from django.test import TestCase

from api.directory_watcher import utils
from api.directory_watcher.utils import walk_directory
from api.tests.scanning.test_issue_169_dangling_symlink_skipped import _make_dir_link


class SymlinkLoopTest(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="walk-loop-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.album = os.path.join(self.root, "album")
        os.makedirs(self.album)
        self.photo = os.path.join(self.album, "a.jpg")
        with open(self.photo, "wb") as fh:
            fh.write(b"jpeg")

    def _link(self, link_path, target):
        if _make_dir_link(link_path, target) is None:
            self.skipTest("cannot create directory links on this platform")
        # Remove links before rmtree so it never follows them.
        self.addCleanup(self._unlink, link_path)

    @staticmethod
    def _unlink(path):
        if os.path.islink(path) or os.path.isdir(path):
            try:
                os.unlink(path)
            except OSError:
                os.rmdir(path)

    def test_link_back_to_an_ancestor_terminates(self):
        self._link(os.path.join(self.album, "loop"), self.root)

        found = []
        with self.assertLogs("ownphotos", level="WARNING") as logs:
            walk_directory(self.root, found)

        self.assertEqual(found, [self.photo])
        self.assertTrue(any("loop" in line for line in logs.output))

    def test_mutual_links_between_siblings_terminate(self):
        other = os.path.join(self.root, "other")
        os.makedirs(other)
        self._link(os.path.join(self.album, "to-other"), other)
        self._link(os.path.join(other, "to-album"), self.album)

        found = []
        walk_directory(self.root, found)

        # Each directory is reachable through a link as well as directly, so
        # the photo shows up once per distinct non-looping path, never forever.
        self.assertIn(self.photo, found)
        self.assertLessEqual(len(found), 2)

    def test_link_to_a_sibling_directory_is_still_followed(self):
        """Only loops are cut; an ordinary directory link is still scanned."""
        outside = tempfile.mkdtemp(prefix="walk-target-")
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        with open(os.path.join(outside, "b.jpg"), "wb") as fh:
            fh.write(b"jpeg")
        self._link(os.path.join(self.root, "share"), outside)

        found = []
        walk_directory(self.root, found)

        self.assertCountEqual(
            found, [self.photo, os.path.join(self.root, "share", "b.jpg")]
        )


class SkipPatternsReadOnceTest(TestCase):
    def test_skip_patterns_setting_is_read_once_per_walk(self):
        root = tempfile.mkdtemp(prefix="walk-skip-")
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        for sub in ("a", "b", "@eaDir"):
            os.makedirs(os.path.join(root, sub))
            for name in ("1.jpg", "2.jpg", "3.jpg"):
                with open(os.path.join(root, sub, name), "wb") as fh:
                    fh.write(b"jpeg")

        reads = []

        class CountingConfig:
            @property
            def SKIP_PATTERNS(self):
                reads.append(1)
                return "@eaDir, #recycle"

        found = []
        with patch.object(utils, "site_config", CountingConfig()):
            walk_directory(root, found)

        self.assertEqual(len(found), 6)
        self.assertFalse(any("@eaDir" in path for path in found))
        self.assertEqual(len(reads), 1)

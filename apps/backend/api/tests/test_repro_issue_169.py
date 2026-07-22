"""Regression test for https://github.com/LibrePhotos/librephotos/issues/169

"Photos in a symlinked directory not being scanned".

The reporter added extra photo folders to the scan directory with symlinks::

    lrwxrwxrwx 1 librephotos librephotos 22 Feb 15 13:30 test -> /home/librephotos/test

Inside the container that link target does not exist (the host path was never
bind mounted), so ``/data/test`` is a *dangling* directory symlink.  The scan
then logged::

    directory_watcher.py : handle_new_image : could not load image /data/test.
    reason: [Errno 2] No such file or directory: '/data/test'

``api.directory_watcher.utils.walk_directory`` classifies every entry it finds
with ``os.path.isdir()``, which *follows* symlinks.  For a dangling link that
returns ``False``, so the link is not descended into (fine) but it falls into
the ``else`` branch and is appended to the photo list as if it were an image
file.  Every such link is then queued as a photo, blows up on ``open()`` deep
inside the pipeline, inflates the job's progress target and pushes the scan job
into the "failed" state.

Expected behaviour: ``walk_directory`` must only collect real, readable files -
exactly the guarantee its sibling ``walk_files`` gives with its
``os.path.isfile()`` check.  A link that resolves to nothing is neither a
directory nor a file and must simply be skipped.

Windows note: ``os.symlink`` needs SeCreateSymbolicLinkPrivilege (Developer
Mode).  Where that is unavailable we fall back to a directory junction created
with ``mklink /J``, which needs no privileges and which Python reports exactly
like a POSIX directory symlink (``isdir()`` True when the target exists, False
once it is gone).
"""

import os
import shutil
import subprocess
import tempfile

from django.test import TestCase

from api.directory_watcher.utils import walk_directory


def _make_dir_link(link_path, target_path):
    """Create a directory symlink, or ``None`` if the platform refuses.

    Returns the link path on success so callers can ``skipTest`` on ``None``.
    """
    try:
        os.symlink(target_path, link_path, target_is_directory=True)
        return link_path
    except (OSError, NotImplementedError):
        pass

    if os.name == "nt":
        # Junctions are reparse points too and need no special privilege.
        completed = subprocess.run(
            ["cmd", "/c", "mklink", "/J", link_path, target_path],
            capture_output=True,
        )
        if completed.returncode == 0:
            return link_path

    return None


def _norm(paths):
    return sorted(os.path.normcase(os.path.abspath(p)) for p in paths)


class Issue169SymlinkedDirectoryScanTest(TestCase):
    def setUp(self):
        # /root
        #   |- data                       <- the user's scan directory
        #   |    |- album/real.jpg        <- an ordinary photo
        #   |    |- linked  -> /root/outside/pictures
        #   |    |- test    -> /root/gone (target does not exist in the container)
        #   |- outside/pictures/linked.jpg
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

        self.scan_dir = os.path.join(self.root, "data")
        os.makedirs(os.path.join(self.scan_dir, "album"))
        self.real_photo = os.path.join(self.scan_dir, "album", "real.jpg")
        with open(self.real_photo, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0jpeg-ish")

        outside = os.path.join(self.root, "outside", "pictures")
        os.makedirs(outside)
        self.linked_photo = os.path.join(outside, "linked.jpg")
        with open(self.linked_photo, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0jpeg-ish")

        self.good_link = _make_dir_link(os.path.join(self.scan_dir, "linked"), outside)
        self.broken_link = _make_dir_link(
            os.path.join(self.scan_dir, "test"), os.path.join(self.root, "gone")
        )
        if self.good_link is None or self.broken_link is None:
            self.skipTest("this platform does not allow creating directory symlinks")

    def test_dangling_symlink_is_not_collected_as_a_photo(self):
        """A symlink whose target is missing is not an image - skip it."""
        self.assertFalse(
            os.path.isfile(self.broken_link),
            "test setup: the broken link must not resolve to a file",
        )

        photo_list = []
        walk_directory(self.scan_dir, photo_list)

        self.assertNotIn(
            os.path.normcase(os.path.abspath(self.broken_link)),
            _norm(photo_list),
            "walk_directory handed the dangling symlink to the photo pipeline; "
            "it cannot be opened and fails the whole scan job",
        )
        self.assertEqual(
            _norm(photo_list),
            _norm(
                [self.real_photo, os.path.join(self.scan_dir, "linked", "linked.jpg")]
            ),
        )

    def test_everything_collected_is_an_openable_file(self):
        """Whatever walk_directory returns must survive open() downstream."""
        photo_list = []
        walk_directory(self.scan_dir, photo_list)

        not_files = [p for p in photo_list if not os.path.isfile(p)]
        self.assertEqual(
            not_files,
            [],
            "walk_directory collected paths that are not readable files",
        )

    def test_photos_inside_a_symlinked_directory_are_scanned(self):
        """The headline symptom: images behind a working symlink must be found."""
        photo_list = []
        walk_directory(self.scan_dir, photo_list)

        self.assertIn(
            os.path.normcase(
                os.path.abspath(os.path.join(self.scan_dir, "linked", "linked.jpg"))
            ),
            _norm(photo_list),
        )

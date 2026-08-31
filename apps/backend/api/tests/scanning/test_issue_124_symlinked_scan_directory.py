"""Regression test for https://github.com/LibrePhotos/librephotos/issues/124

"Failed to load image when using symbolic linked smb share".

The reporter ran LibrePhotos in Docker with the pictures folder *symbolically
linked* to an SMB share backed by ZFS.  Nothing rendered in the web UI:

    "I have a VM running docker with pictures folder symbolic linked to an smb
     share (zfs). The images fail to load, but when I click the route it is
     available."

The maintainer's diagnosis in the thread was "if an image can't load it is
usually connected to missing thumbnails" -- i.e. the scan never produced any
photo/thumbnail rows for the files living behind the link, so every tile in the
grid was a broken image even though the underlying share was mounted and
browsable.

Root cause at the time the issue was filed (Nov 2020), in ``scan_photos``::

    image_paths.extend([
        os.path.join(dp, f) for dp, dn, fn in os.walk(user.scan_directory)
        for f in fn
    ])

``os.walk`` does **not** descend into symlinked directories unless it is asked
to -- ``followlinks`` defaults to ``False``.  So a scan directory that is (or
contains) a symlink to a mounted share yielded zero files, no Photo rows and no
thumbnails: exactly "the images fail to load".

Fixed by commit 6ed99b95 (2021-01-05, "[FIX] #98 and #95"), which rewrote the
walk as ``os.walk(user.scan_directory, followlinks=True)``.  The scanner was
later rewritten again (commit 133709c1) into today's
``api.directory_watcher.utils.walk_directory``, which classifies entries with
``os.path.isdir()`` -- that follows symlinks too, so the fix survived the
rewrite.

These tests therefore PASS on current ``main``: they pin the fixed behaviour so
the ``followlinks`` regression cannot come back, and they follow the path all
the way to the media endpoint to show that a photo discovered behind the link
is still addressable through nginx's internal ``/original`` route (had the walk
resolved the link to its real target outside ``settings.PHOTOS``, the media view
would emit a raw filesystem path that nginx cannot serve -- the same broken
image by a different route).

Windows note: ``os.symlink`` needs SeCreateSymbolicLinkPrivilege (Developer
Mode).  Where that is unavailable we fall back to a directory junction created
with ``mklink /J``, which needs no privilege and which ``os.path.isdir()``
treats exactly like a POSIX directory symlink.  Be aware that the junction
fallback is *not* a faithful stand-in for the original defect:
``os.path.islink()`` is ``False`` for a junction, so even the pre-fix
``os.walk(dir)`` would have descended into it.  On POSIX -- where the issue was
reported and where CI runs -- ``os.symlink`` succeeds and the tests discriminate
properly.  Independently of the platform, the fix is visible by inspection:
neither ``walk_directory`` nor anything else on the scan path consults
``os.path.islink``/``DirEntry.is_symlink``, so symlinked directories are always
descended into.
"""

import os
import shutil
import subprocess
import tempfile

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.directory_watcher.utils import walk_directory
from api.tests.utils import create_test_file, create_test_photo, create_test_user

# Minimal JPEG so python-magic/File.create classify the file as an image.
JPEG_BYTES = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00\x43\x00" + bytes(64) + b"\xff\xd9"
)


def _make_dir_link(link_path, target_path):
    """Create a directory symlink, or return ``None`` if the platform refuses."""
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


class Issue124SymlinkedShareTest(TestCase):
    """The scan must see through the symlink that stands in for the SMB share."""

    def setUp(self):
        # <root>/share                      <- the mounted SMB/ZFS share
        #        share/holiday/beach.jpg
        #        share/portrait.jpg
        # <root>/data                       <- settings.PHOTOS (the docker /data)
        #        data/pictures -> ../share  <- the reporter's symlink
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

        self.share = os.path.join(self.root, "share")
        os.makedirs(os.path.join(self.share, "holiday"))
        self.share_photos = [
            os.path.join(self.share, "portrait.jpg"),
            os.path.join(self.share, "holiday", "beach.jpg"),
        ]
        for path in self.share_photos:
            with open(path, "wb") as f:
                f.write(JPEG_BYTES)

        self.photos_root = os.path.join(self.root, "data")
        os.makedirs(self.photos_root)
        self.link = _make_dir_link(
            os.path.join(self.photos_root, "pictures"), self.share
        )
        if self.link is None:
            self.skipTest("this platform does not allow creating directory symlinks")

    def _expected_through_link(self):
        return [
            os.path.join(self.link, "portrait.jpg"),
            os.path.join(self.link, "holiday", "beach.jpg"),
        ]

    def test_symlinked_share_inside_the_scan_directory_is_descended_into(self):
        """The headline symptom: /data/pictures -> /mnt/smb must be scanned."""
        photo_list = []
        walk_directory(self.photos_root, photo_list)

        self.assertEqual(
            _norm(photo_list),
            _norm(self._expected_through_link()),
            "the scan found no files behind the symlinked share, so no Photo "
            "rows and no thumbnails are ever created and every tile in the "
            "frontend is a broken image (issue #124)",
        )

    def test_scan_directory_that_is_itself_a_symlink_is_traversed(self):
        """The user's scan_directory may itself be the link to the share."""
        user = create_test_user(scan_directory=self.link)

        photo_list = []
        walk_directory(user.scan_directory, photo_list)

        self.assertEqual(_norm(photo_list), _norm(self._expected_through_link()))

    def test_collected_paths_go_through_the_link_not_its_real_target(self):
        """Paths must stay under DATA_ROOT so nginx's /original alias applies.

        Resolving the link to its real target (``<root>/share/...``) would push
        every photo outside ``settings.PHOTOS``; the media view then falls back
        to emitting the bare filesystem path as an X-Accel-Redirect, which nginx
        cannot serve.
        """
        photo_list = []
        walk_directory(self.photos_root, photo_list)

        outside = [
            p
            for p in photo_list
            if not os.path.normcase(os.path.abspath(p)).startswith(
                os.path.normcase(os.path.abspath(self.photos_root))
            )
        ]
        self.assertEqual(
            outside,
            [],
            "the walk handed back paths outside the data root; these cannot be "
            "mapped onto nginx's internal /original route",
        )

    def test_photo_found_behind_the_link_is_servable_by_the_media_endpoint(self):
        """End of the chain: the discovered file actually loads over /media."""
        photo_list = []
        walk_directory(self.photos_root, photo_list)
        self.assertTrue(photo_list, "nothing was discovered behind the symlink")

        discovered = sorted(photo_list)[0]

        with self.settings(PHOTOS=self.photos_root, DATA_ROOT=self.photos_root):
            user = create_test_user(scan_directory=self.photos_root)
            photo = create_test_photo(owner=user)
            photo.main_file = create_test_file(discovered, user, JPEG_BYTES)
            photo.save()

            client = APIClient()
            client.cookies["jwt"] = str(AccessToken.for_user(user))
            response = client.get(f"/media/photos/{photo.image_hash}.jpg")

            self.assertEqual(response.status_code, 200)
            internal_path = response["X-Accel-Redirect"]
            self.assertTrue(
                internal_path.startswith("/original"),
                "a photo living behind the symlinked share was handed to nginx "
                f"as {internal_path!r} instead of an /original route, so the "
                "browser gets a 404 and the image fails to load",
            )

"""Regression test for https://github.com/LibrePhotos/librephotos/issues/833

"Access to photo folders owned by other users".

The scan directory is a network mount (NFS/Synology, Proxmox bind mount, ...)
that contains folders owned by a different unix user.  The server process can
read the mount point itself, but at least one folder inside it is not readable
(``os.scandir`` on it raises ``PermissionError``).

``api.api_util.path_to_dict`` walks the tree with a bare ``os.scandir`` and no
error handling, so a *single* unreadable sub folder makes the whole
``/api/dirtree/`` request blow up.  ``RootPathTreeView`` turns that into a
HTTP 500 and the admin gets an empty folder picker in the user setup screen -
none of the directories are selectable any more, not even the ones the server
*can* read.

Expected behaviour: a folder the server cannot descend into must be skipped
(listed with no children), the rest of the tree must still be returned.
"""

import errno
import os
import shutil
import tempfile

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.api_util import path_to_dict
from api.models import User
from api.tests.utils import create_password

REAL_SCANDIR = os.scandir


def deny_scandir(denied_path):
    """Emulate a directory owned by another user: scandir() -> EACCES."""
    denied = os.path.abspath(denied_path)

    def fake_scandir(path=".", *args, **kwargs):
        if os.path.abspath(os.fspath(path)) == denied:
            raise PermissionError(errno.EACCES, "Permission denied", os.fspath(path))
        return REAL_SCANDIR(path, *args, **kwargs)

    return fake_scandir


class Issue833ForeignOwnedFolderTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(
            "admin833", "admin833@test.com", create_password()
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        # /data
        #   |- my_photos/2023      <- readable
        #   |- nobody_photos/2023  <- owned by nobody:nogroup, not readable
        self.data_root = tempfile.mkdtemp(prefix="repro833_")
        self.addCleanup(shutil.rmtree, self.data_root, True)
        os.makedirs(os.path.join(self.data_root, "my_photos", "2023"))
        self.foreign = os.path.join(self.data_root, "nobody_photos")
        os.makedirs(os.path.join(self.foreign, "2023"))

    def test_dirtree_still_lists_folders_next_to_an_unreadable_one(self):
        with override_settings(DATA_ROOT=self.data_root):
            patcher = _patch_scandir(deny_scandir(self.foreign))
            self.addCleanup(patcher.stop)
            patcher.start()

            response = self.client.get("/api/dirtree/")

            self.assertEqual(
                200,
                response.status_code,
                "one unreadable folder broke the whole directory listing: "
                f"{response.status_code} {response.json()}",
            )

            titles = [child["title"] for child in response.json()[0]["children"]]
            self.assertIn("my_photos", titles)
            self.assertIn("nobody_photos", titles)

    def test_path_to_dict_skips_the_unreadable_folder(self):
        patcher = _patch_scandir(deny_scandir(self.foreign))
        self.addCleanup(patcher.stop)
        patcher.start()

        try:
            tree = path_to_dict(self.data_root)
        except OSError as exc:
            self.fail(
                "path_to_dict() must not propagate a permission error for a "
                f"folder owned by another user, got: {exc!r}"
            )

        children = {child["title"]: child for child in tree["children"]}
        self.assertEqual({"my_photos", "nobody_photos"}, set(children))
        self.assertEqual([], children["nobody_photos"]["children"])
        self.assertEqual(
            ["2023"], [c["title"] for c in children["my_photos"]["children"]]
        )


def _patch_scandir(replacement):
    from unittest import mock

    return mock.patch("os.scandir", replacement)

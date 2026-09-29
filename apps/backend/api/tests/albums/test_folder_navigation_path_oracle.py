"""Folder navigation must refuse a path before it says anything about it.

``/api/folders/subfolders/?path=`` checked that the path existed and was a
directory before checking that the requester was allowed to look there. A
regular user confined to their own scan directory therefore got three
different answers for paths outside it: 400 "Path does not exist", 400
"Path is not a directory", or 403 "Access denied" for an existing folder.
That is a filesystem existence oracle for every path on the server,
including other users' libraries (``/data/bob/Hospital 2023``).

The access check now runs first, so every path outside the caller's root
gets the same 403. Paths inside it keep their 400s, which the folder
browser relies on.
"""

import os
import shutil
import tempfile

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

URL = "/api/folders/subfolders/"
DENIED = {"error": "Access denied - can only access folders within your scan directory"}


class FolderNavigationPathOracleTest(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="lp-folder-oracle-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        settings_ctx = override_settings(DATA_ROOT=self.root)
        settings_ctx.enable()
        self.addCleanup(settings_ctx.disable)

        self.scan_dir = os.path.join(self.root, "alice")
        self.other_lib = os.path.join(self.root, "bob")
        os.makedirs(self.scan_dir)
        os.makedirs(os.path.join(self.other_lib, "Hospital 2023"))
        with open(os.path.join(self.other_lib, "notes.txt"), "w") as fh:
            fh.write("x")

        self.client = APIClient()
        self.client.force_authenticate(
            user=create_test_user(scan_directory=self.scan_dir)
        )

    def test_paths_outside_the_scan_directory_are_indistinguishable(self):
        for name in ("Hospital 2023", "does-not-exist", "notes.txt"):
            with self.subTest(name=name):
                response = self.client.get(
                    URL, {"path": os.path.join(self.other_lib, name)}
                )

                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json(), DENIED)

    def test_paths_inside_the_scan_directory_keep_their_validation_errors(self):
        with open(os.path.join(self.scan_dir, "a.txt"), "w") as fh:
            fh.write("x")

        missing = self.client.get(URL, {"path": os.path.join(self.scan_dir, "nope")})
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json(), {"error": "Path does not exist"})

        a_file = self.client.get(URL, {"path": os.path.join(self.scan_dir, "a.txt")})
        self.assertEqual(a_file.status_code, 400)
        self.assertEqual(a_file.json(), {"error": "Path is not a directory"})

"""Admins make a folder from the folder picker, inside the data root (#2035).

``POST /api/dirtree/folders/`` makes one folder in an existing folder inside
``DATA_ROOT``: no separators, ``..``, Windows device names or other names
Windows refuses, and no way out through a symlink.
"""

import os
import shutil
import tempfile
import uuid
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.serving.directory_tree import folder_name_problem, resolves_inside
from api.tests.utils import api_error, create_test_user

URL = "/api/dirtree/folders/"


class FolderNameTest(TestCase):
    def test_plain_names_pass(self):
        for name in ("2026", "Summer holiday", "été", "a.b", "CONSOLE", "com10"):
            self.assertIsNone(folder_name_problem(name), name)

    def test_names_that_are_not_one_folder_fail(self):
        for name in ("", "   ", ".", "..", "a/b", "a\\b", "../x", "..\\x", "/abs"):
            self.assertIsNotNone(folder_name_problem(name), name)

    def test_names_windows_refuses_fail(self):
        for name in (
            "CON",
            "con",
            "Nul.txt",
            "COM1",
            "lpt9",
            "a:b",
            "c:",
            "what?",
            "x*",
            'say"',
            "a<b",
            "a|b",
            "tab\there",
            "trailing.",
            "trailing ",
            " leading",
            "x" * 256,
        ):
            self.assertIsNotNone(folder_name_problem(name), repr(name))


class CreateFolderViewTest(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        override = override_settings(DATA_ROOT=self.root)
        override.enable()
        self.addCleanup(override.disable)
        self.photos = os.path.join(self.root, "photos")
        os.mkdir(self.photos)
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def post(self, parent, name):
        return self.client.post(
            URL, {"parent_path": parent, "name": name}, format="json"
        )

    def test_makes_the_folder_and_lists_its_parent_again(self):
        response = self.post(self.photos, "sam")

        self.assertEqual(response.status_code, 201)
        folder = os.path.join(self.photos, "sam")
        self.assertTrue(os.path.isdir(folder))
        body = response.json()
        self.assertEqual(body["absolute_path"], folder)
        self.assertEqual(body["parent"]["absolute_path"], self.photos)
        self.assertEqual(
            [child["title"] for child in body["parent"]["children"]], ["sam"]
        )

    def test_in_the_data_root_itself(self):
        response = self.post(self.root, "new")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(os.path.isdir(os.path.join(self.root, "new")))

    def test_a_taken_name_is_409(self):
        os.mkdir(os.path.join(self.photos, "sam"))

        response = self.post(self.photos, "sam")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "folder_exists")

    def test_a_bad_name_is_400_and_makes_nothing(self):
        for name in ("..", "../escape", "a/b", "CON", "x:y"):
            response = self.post(self.photos, name)
            self.assertEqual(response.status_code, 400, name)
            self.assertEqual(api_error(response)["field"], "name")
        self.assertEqual(os.listdir(self.photos), [])
        self.assertFalse(os.path.exists(os.path.join(self.root, "escape")))

    def test_a_parent_outside_the_data_root_is_400(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)

        for parent in (outside, os.path.join(self.photos, "..", "..")):
            response = self.post(parent, "new")
            self.assertEqual(response.status_code, 400, parent)
            self.assertEqual(api_error(response)["field"], "parent_path")
        self.assertFalse(os.path.exists(os.path.join(outside, "new")))

    def test_a_relative_parent_is_400(self):
        response = self.post("photos", "new")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "parent_path")

    def test_the_new_path_is_spelled_like_the_parent(self):
        # The picker finds the folder in its tree by the spelling it sent.
        parent = self.photos + "/"
        response = self.post(parent, "sam")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["absolute_path"], os.path.join(parent, "sam"))

    def test_a_missing_parent_is_400(self):
        response = self.post(os.path.join(self.photos, "nope"), "new")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(os.path.exists(os.path.join(self.photos, "nope")))

    def test_a_symlink_out_of_the_data_root_is_not_followed(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        link = os.path.join(self.photos, "link")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except OSError:
            self.skipTest("this system does not let the tests make symlinks")

        response = self.post(link, "new")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(os.listdir(outside), [])

    def test_a_folder_the_server_cannot_write_to_is_400(self):
        with patch(
            "api.serving.directory_tree.os.mkdir",
            side_effect=PermissionError(13, "denied"),
        ):
            response = self.post(self.photos, "sam")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "folder_not_writable")

    def test_only_admins(self):
        user = create_test_user()
        self.client.force_authenticate(user=user)

        response = self.post(self.photos, "sam")

        self.assertEqual(response.status_code, 403)
        self.assertFalse(os.path.exists(os.path.join(self.photos, "sam")))

    def test_anonymous_is_refused(self):
        response = APIClient().post(URL, {"parent_path": self.photos, "name": "x"})

        self.assertIn(response.status_code, (401, 403))


class ResolvesInsideTest(TestCase):
    def test_a_path_and_its_root(self):
        root = settings.DATA_ROOT
        self.assertTrue(resolves_inside(root, root))
        self.assertTrue(resolves_inside(os.path.join(root, "a", "b"), root))
        self.assertFalse(resolves_inside(root + uuid.uuid4().hex[:4], root))
        self.assertFalse(resolves_inside(os.path.dirname(root), root))

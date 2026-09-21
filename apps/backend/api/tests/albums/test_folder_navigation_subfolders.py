"""Characterization tests for api/views/album_folder.py (CRAP unit 31).

Pins the CURRENT behavior of ``FolderNavigationViewSet.subfolders``:
the default-path resolution, the admin / regular-user permission branches,
the path validation branches, folder scanning + sorting + photo-count
filtering, the pagination arithmetic and the catch-all error handler.

Everything runs against real temp directories on disk (cheap: only empty
dirs and tiny files are created).  No ML, no network, no exiftool.
"""

import os
import shutil
import tempfile
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import File
from api.tests.utils import create_test_photo, create_test_user

URL = "/api/folders/subfolders/"


def _mkdirs(root, *names):
    for name in names:
        os.makedirs(os.path.join(root, name), exist_ok=True)


class SubfoldersTestBase(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="lp-crap-u31-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.settings_ctx = override_settings(DATA_ROOT=self.root)
        self.settings_ctx.enable()
        self.addCleanup(self.settings_ctx.disable)

    def client_for(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def add_photo_in(self, owner, folder_path, filename="pic.jpg"):
        """Attach a Photo owned by ``owner`` with a File under ``folder_path``."""
        photo = create_test_photo(owner=owner)
        file = File.objects.create(
            hash=uuid.uuid4().hex,
            path=os.path.join(folder_path, filename),
            type=File.IMAGE,
        )
        photo.files.add(file)
        return photo


class SubfoldersAuthTests(SubfoldersTestBase):
    def test_anonymous_is_rejected(self):
        resp = APIClient().get(URL)
        self.assertIn(resp.status_code, (401, 403))

    def test_regular_user_without_scan_directory_is_rejected(self):
        user = create_test_user()  # scan_directory defaults to ""
        resp = self.client_for(user).get(URL)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json(), {"error": "User scan directory not configured"})

    def test_regular_user_without_scan_directory_rejected_even_with_path(self):
        # The default-path branch runs before ``path`` is read, so an explicit
        # (valid) path does not help a user with no scan directory.
        user = create_test_user()
        resp = self.client_for(user).get(URL, {"path": self.root})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json(), {"error": "User scan directory not configured"})


class SubfoldersPathValidationTests(SubfoldersTestBase):
    def test_missing_path_returns_400(self):
        admin = create_test_user(is_admin=True)
        missing = os.path.join(self.root, "nope")
        resp = self.client_for(admin).get(URL, {"path": missing})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {"error": "Path does not exist"})

    def test_file_path_returns_400(self):
        admin = create_test_user(is_admin=True)
        file_path = os.path.join(self.root, "a-file.txt")
        with open(file_path, "w") as fh:
            fh.write("x")
        resp = self.client_for(admin).get(URL, {"path": file_path})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {"error": "Path is not a directory"})

    def test_admin_outside_data_root_returns_403(self):
        admin = create_test_user(is_admin=True)
        outside = tempfile.mkdtemp(prefix="lp-crap-u31-outside-")
        self.addCleanup(shutil.rmtree, outside, ignore_errors=True)
        resp = self.client_for(admin).get(URL, {"path": outside})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json(), {"error": "Access denied"})

    def test_user_outside_scan_directory_returns_403(self):
        scan_dir = os.path.join(self.root, "scan")
        other = os.path.join(self.root, "other")
        _mkdirs(self.root, "scan", "other")
        user = create_test_user(scan_directory=scan_dir)
        resp = self.client_for(user).get(URL, {"path": other})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(
            resp.json(),
            {
                "error": "Access denied - can only access folders "
                "within your scan directory"
            },
        )

    def test_user_with_nonexistent_scan_directory_returns_403(self):
        # ``path`` exists so validation gets as far as the scan-directory check.
        user = create_test_user(scan_directory=os.path.join(self.root, "gone"))
        resp = self.client_for(user).get(URL, {"path": self.root})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json(), {"error": "Scan directory does not exist"})

    def test_prefix_matching_is_string_based_not_path_based(self):
        """Known quirk: the guard uses ``str.startswith``, so a sibling
        directory whose name merely *starts with* the scan directory name is
        considered inside it."""
        _mkdirs(self.root, "scan", "scan-evil")
        user = create_test_user(scan_directory=os.path.join(self.root, "scan"))
        resp = self.client_for(user).get(
            URL, {"path": os.path.join(self.root, "scan-evil")}
        )
        self.assertEqual(resp.status_code, 200)


class SubfoldersListingTests(SubfoldersTestBase):
    def test_empty_directory_response_shape(self):
        admin = create_test_user(is_admin=True)
        resp = self.client_for(admin).get(URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(),
            {
                "current_path": self.root,
                "parent_path": None,  # base_path == DATA_ROOT
                "subfolders": [],
                "pagination": {
                    "page": 1,
                    "page_size": 100,
                    "total_folders": 0,
                    "total_pages": 0,
                    "has_next": False,
                    "has_previous": False,
                },
            },
        )

    def test_empty_directory_below_data_root_has_parent_path(self):
        admin = create_test_user(is_admin=True)
        _mkdirs(self.root, "sub")
        sub = os.path.join(self.root, "sub")
        resp = self.client_for(admin).get(URL, {"path": sub, "page": 3})
        body = resp.json()
        self.assertEqual(body["parent_path"], self.root)
        self.assertEqual(body["pagination"]["page"], 3)
        self.assertTrue(body["pagination"]["has_previous"])
        self.assertFalse(body["pagination"]["has_next"])

    def test_only_folders_with_photos_are_listed_and_sorted(self):
        admin = create_test_user(is_admin=True)
        _mkdirs(self.root, "Beta", "alpha", "Gamma", "empty")
        for name in ("Beta", "alpha", "Gamma"):
            self.add_photo_in(admin, os.path.join(self.root, name))

        resp = self.client_for(admin).get(URL)
        body = resp.json()
        self.assertEqual(
            [f["name"] for f in body["subfolders"]], ["alpha", "Beta", "Gamma"]
        )
        # "empty" is scanned (counted in total_folders) but filtered out of the
        # subfolders list because its photo_count is 0.
        self.assertEqual(body["pagination"]["total_folders"], 4)
        self.assertEqual(body["pagination"]["total_pages"], 1)
        entry = body["subfolders"][0]
        self.assertEqual(
            sorted(entry.keys()), ["modified", "name", "path", "photo_count"]
        )
        self.assertEqual(entry["path"], os.path.join(self.root, "alpha"))
        self.assertEqual(entry["photo_count"], 1)
        self.assertIsInstance(entry["modified"], float)

    def test_hidden_folders_and_files_are_ignored(self):
        admin = create_test_user(is_admin=True)
        _mkdirs(self.root, ".hidden", "visible")
        self.add_photo_in(admin, os.path.join(self.root, ".hidden"))
        self.add_photo_in(admin, os.path.join(self.root, "visible"))
        with open(os.path.join(self.root, "loose.jpg"), "w") as fh:
            fh.write("x")

        body = self.client_for(admin).get(URL).json()
        self.assertEqual([f["name"] for f in body["subfolders"]], ["visible"])
        self.assertEqual(body["pagination"]["total_folders"], 1)

    def test_photos_of_other_users_are_not_counted(self):
        admin = create_test_user(is_admin=True)
        stranger = create_test_user()
        _mkdirs(self.root, "shared")
        self.add_photo_in(stranger, os.path.join(self.root, "shared"))

        body = self.client_for(admin).get(URL).json()
        self.assertEqual(body["subfolders"], [])
        self.assertEqual(body["pagination"]["total_folders"], 1)

    def test_multiple_files_in_one_folder_count_photos_distinctly(self):
        admin = create_test_user(is_admin=True)
        _mkdirs(self.root, "trip")
        folder = os.path.join(self.root, "trip")
        photo = self.add_photo_in(admin, folder, "a.jpg")
        # A second file of the SAME photo must not inflate the count
        # (the aggregate is distinct on the photo pk).
        photo.files.add(
            File.objects.create(
                hash=uuid.uuid4().hex,
                path=os.path.join(folder, "a.xmp"),
                type=File.METADATA_FILE,
            )
        )
        self.add_photo_in(admin, folder, "b.jpg")

        body = self.client_for(admin).get(URL).json()
        self.assertEqual(body["subfolders"][0]["photo_count"], 2)

    def test_regular_user_at_scan_directory_root_has_no_parent(self):
        scan_dir = os.path.join(self.root, "scan")
        _mkdirs(self.root, "scan")
        _mkdirs(scan_dir, "holiday")
        user = create_test_user(scan_directory=scan_dir)
        self.add_photo_in(user, os.path.join(scan_dir, "holiday"))

        body = self.client_for(user).get(URL).json()
        self.assertEqual(body["current_path"], scan_dir)
        self.assertIsNone(body["parent_path"])
        self.assertEqual([f["name"] for f in body["subfolders"]], ["holiday"])

    def test_regular_user_below_scan_directory_has_parent(self):
        scan_dir = os.path.join(self.root, "scan")
        _mkdirs(self.root, "scan")
        _mkdirs(scan_dir, "holiday")
        user = create_test_user(scan_directory=scan_dir)
        body = (
            self.client_for(user)
            .get(URL, {"path": os.path.join(scan_dir, "holiday")})
            .json()
        )
        self.assertEqual(body["parent_path"], scan_dir)


class SubfoldersPaginationTests(SubfoldersTestBase):
    def _make_folders(self, count):
        names = [f"f{i:03d}" for i in range(count)]
        _mkdirs(self.root, *names)
        return names

    def test_non_numeric_page_falls_back_to_one(self):
        admin = create_test_user(is_admin=True)
        body = self.client_for(admin).get(URL, {"page": "abc"}).json()
        self.assertEqual(body["pagination"]["page"], 1)

    def test_page_zero_and_negative_clamp_to_one(self):
        admin = create_test_user(is_admin=True)
        for value in ("0", "-5"):
            body = self.client_for(admin).get(URL, {"page": value}).json()
            self.assertEqual(body["pagination"]["page"], 1)

    def test_page_size_is_fixed_at_100_and_slices_entries(self):
        admin = create_test_user(is_admin=True)
        names = self._make_folders(101)
        for name in names:
            self.add_photo_in(admin, os.path.join(self.root, name))

        page1 = self.client_for(admin).get(URL).json()
        self.assertEqual(len(page1["subfolders"]), 100)
        self.assertEqual(page1["subfolders"][0]["name"], "f000")
        self.assertEqual(page1["pagination"]["total_folders"], 101)
        self.assertEqual(page1["pagination"]["total_pages"], 2)
        self.assertTrue(page1["pagination"]["has_next"])
        self.assertFalse(page1["pagination"]["has_previous"])

        page2 = self.client_for(admin).get(URL, {"page": 2}).json()
        self.assertEqual([f["name"] for f in page2["subfolders"]], ["f100"])
        self.assertFalse(page2["pagination"]["has_next"])
        self.assertTrue(page2["pagination"]["has_previous"])

    def test_page_beyond_last_returns_empty_page_with_totals(self):
        admin = create_test_user(is_admin=True)
        self._make_folders(2)
        body = self.client_for(admin).get(URL, {"page": 9}).json()
        self.assertEqual(body["subfolders"], [])
        self.assertEqual(body["pagination"]["page"], 9)
        self.assertEqual(body["pagination"]["total_folders"], 2)
        self.assertEqual(body["pagination"]["total_pages"], 1)
        self.assertFalse(body["pagination"]["has_next"])
        self.assertTrue(body["pagination"]["has_previous"])
        self.assertEqual(body["parent_path"], None)


class SubfoldersErrorHandlingTests(SubfoldersTestBase):
    def test_scandir_failure_returns_500(self):
        admin = create_test_user(is_admin=True)
        with _patch_scandir_to_raise():
            resp = self.client_for(admin).get(URL)
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(resp.json(), {"error": "Error scanning directory"})


def _patch_scandir_to_raise():
    from unittest import mock

    return mock.patch("api.views.album_folder.os.scandir", side_effect=OSError("boom"))

"""RAW and JPEG of the same shot are one photo, whatever stack_raw_jpeg says.

RAW+JPEG grouping moved out of stack detection into scan-time file variants
(migration 0112, api/directory_watcher/file_grouping.py) and has no switch:
files in the same folder with the same base name are grouped. Each test runs
a real entry point with stack_raw_jpeg off, so gating one of them on the
setting again fails here.

User.stack_raw_jpeg is read by nothing. Its column stays, to avoid a
column-drop migration, and the user API still returns and stores it, as it
does skip_raw_files.
"""

import os
import shutil
import tempfile
import uuid
from unittest.mock import patch

import pyvips
from django.test import TestCase
from rest_framework.test import APIClient

from api.directory_watcher.file_handlers import create_new_image, handle_file_group
from api.directory_watcher.repair_jobs import repair_ungrouped_file_variants
from api.directory_watcher.scan_jobs import _partition_scan_paths
from api.models import File, Photo
from api.tests.utils import create_test_user

MODULE = "api.directory_watcher.file_handlers"


class RawJpegAlwaysGroupedTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user(is_admin=True, stack_raw_jpeg=False)
        directory = tempfile.mkdtemp(prefix="lp-raw-jpeg-")
        self.addCleanup(shutil.rmtree, directory, True)
        self.jpeg_path = os.path.join(directory, "IMG_0001.jpg")
        self.raw_path = os.path.join(directory, "IMG_0001.CR2")
        pyvips.Image.black(8, 8).write_to_file(self.jpeg_path)
        with open(self.raw_path, "wb") as fh:
            fh.write(b"raw-bytes")
        # Thumbnails, EXIF and the rest of the processing are not under test.
        for target in ("_process_photo", "has_embedded_motion_video"):
            patcher = patch(f"{MODULE}.{target}", return_value=False)
            patcher.start()
            self.addCleanup(patcher.stop)

    def assert_one_photo_with_a_raw_variant(self):
        photo = Photo.objects.owned_by(self.user).get()
        self.assertEqual(self.jpeg_path, photo.main_file.path)
        raw = photo.files.get(path=self.raw_path)
        self.assertEqual(File.RAW_FILE, raw.type)

    def test_a_pair_in_one_scan(self):
        # As scan_photos does: group the paths, then make a photo of each group.
        groups, _ = _partition_scan_paths([self.raw_path, self.jpeg_path])
        for paths in groups.values():
            handle_file_group(self.user, paths, "job")
        self.assert_one_photo_with_a_raw_variant()

    def test_a_raw_scanned_after_its_jpeg(self):
        # Each scan makes a photo of the RAW on its own; the repair job that
        # follows every scan merges it into the JPEG's photo.
        handle_file_group(self.user, [self.jpeg_path], "job")
        handle_file_group(self.user, [self.raw_path], "job")
        repair_ungrouped_file_variants(self.user, uuid.uuid4())
        self.assert_one_photo_with_a_raw_variant()

    def test_a_raw_uploaded_after_its_jpeg(self):
        create_new_image(self.user, self.jpeg_path)
        create_new_image(self.user, self.raw_path)
        self.assert_one_photo_with_a_raw_variant()

    def test_the_api_still_returns_and_stores_it(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        for url in (f"/api/user/{self.user.id}/", f"/api/manage/user/{self.user.id}/"):
            with self.subTest(url):
                response = client.patch(url, {"stack_raw_jpeg": True}, format="json")
                self.assertEqual(200, response.status_code)
                self.assertTrue(response.json()["stack_raw_jpeg"])

import os
import tempfile
import uuid
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.directory_watcher import scan_photos
from api.tests.utils import create_test_user


class DummyAsyncTask:
    def __init__(self, *args, **kwargs):
        pass

    def run(self):
        return None


class DummyChain:
    def __init__(self, *args, **kwargs):
        self.appended = []

    def append(self, *args, **kwargs):
        self.appended.append((args, kwargs))
        return self

    def run(self):
        return None


class ScanPhotosDirectoryCreationTest(TestCase):
    def test_existing_thumbnail_directory_does_not_raise(self):
        user = create_test_user()
        with tempfile.TemporaryDirectory() as media_root:
            preexisting_dir = os.path.join(media_root, "square_thumbnails_small")
            os.makedirs(preexisting_dir, exist_ok=True)

            user.scan_directory = media_root
            user.save(update_fields=["scan_directory"])

            with override_settings(MEDIA_ROOT=media_root):
                with patch("api.directory_watcher.walk_directory"), patch(
                    "api.directory_watcher.walk_files"
                ), patch("api.directory_watcher.photo_scanner"), patch(
                    "api.directory_watcher.AsyncTask", DummyAsyncTask
                ), patch("api.directory_watcher.Chain", DummyChain):
                    scan_photos(user, full_scan=False, job_id=str(uuid.uuid4()))

            expected_directories = [
                "square_thumbnails_small",
                "square_thumbnails",
                "thumbnails_big",
            ]
            for directory_name in expected_directories:
                directory_path = os.path.join(media_root, directory_name)
                self.assertTrue(
                    os.path.isdir(directory_path),
                    msg=f"Expected directory {directory_path} to exist",
                )

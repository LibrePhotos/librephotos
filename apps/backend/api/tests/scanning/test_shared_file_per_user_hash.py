"""Two users who scan the same file each get a Photo hashed for them (#1957).

``File.path`` is unique, so a path in two users' scan scope has one File row,
hashed with the user id of whoever scanned it first. ``Photo.image_hash`` is
the per-user key: the thumbnails and face crops are named after it and the
media routes resolve it to one row, so the second user's Photo must not carry
the first user's salt.
"""

import os
import shutil
import tempfile
from unittest.mock import patch

import pyvips
from django.test import TestCase

from api.directory_watcher.file_handlers import (
    create_file_record,
    create_new_image,
    group_files_into_photo,
)
from api.models import File, Photo
from api.photos.media_files import calculate_hash
from api.tests.utils import create_test_user

MODULE = "api.directory_watcher.file_handlers"


def _write_image(path: str, width: int) -> str:
    pyvips.Image.black(width, 8).write_to_file(path)
    return path


class SharedFilePerUserHashTest(TestCase):
    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.tmpdir = tempfile.mkdtemp(prefix="lp-1957-")
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.path = _write_image(os.path.join(self.tmpdir, "shared.png"), width=19)
        patcher = patch(f"{MODULE}.has_embedded_motion_video", return_value=False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _scan(self, user, path=None):
        file = create_file_record(user, path or self.path)
        return group_files_into_photo(user, [file], "job-1957")

    def test_second_scanner_gets_a_photo_hashed_for_them(self):
        alices = self._scan(self.alice)
        bobs = self._scan(self.bob)

        self.assertEqual(1, File.objects.filter(path=self.path).count())
        self.assertNotEqual(alices.pk, bobs.pk)
        self.assertEqual(calculate_hash(self.alice, self.path), alices.image_hash)
        self.assertEqual(calculate_hash(self.bob, self.path), bobs.image_hash)
        self.assertEqual(alices, Photo.objects.get(image_hash=alices.image_hash))
        self.assertEqual(bobs, Photo.objects.get(image_hash=bobs.image_hash))

    def test_both_share_the_one_file_row(self):
        alices = self._scan(self.alice)
        bobs = self._scan(self.bob)

        self.assertEqual(alices.main_file_id, bobs.main_file_id)

    def test_rescanning_returns_the_same_photo(self):
        self._scan(self.alice)
        bobs = self._scan(self.bob)

        self.assertEqual(bobs.pk, self._scan(self.bob).pk)
        self.assertEqual(2, Photo.objects.count())

    def test_upload_path_and_scan_path_agree(self):
        """``create_new_image`` already salted per user; the scan now does too."""
        self._scan(self.alice)

        bobs = create_new_image(self.bob, self.path)

        self.assertEqual(calculate_hash(self.bob, self.path), bobs.image_hash)

    def _own_copy(self):
        """A copy of the shared file in a folder only the second user scans."""
        own = os.path.join(self.tmpdir, "bob")
        os.makedirs(own)
        copy = os.path.join(own, "shared.png")
        shutil.copyfile(self.path, copy)
        return copy

    def test_an_own_copy_of_a_shared_file_joins_the_users_photo(self):
        """The same bytes stay one photo per user, as for any exact copy."""
        self._scan(self.alice)
        bobs = self._scan(self.bob)

        self.assertEqual(bobs.pk, self._scan(self.bob, self._own_copy()).pk)
        self.assertEqual(1, Photo.objects.filter(owner=self.bob).count())

    def test_a_shared_file_joins_the_users_photo_of_an_own_copy(self):
        self._scan(self.alice)
        bobs = self._scan(self.bob, self._own_copy())

        self.assertEqual(bobs.pk, self._scan(self.bob).pk)
        self.assertEqual(1, Photo.objects.filter(owner=self.bob).count())

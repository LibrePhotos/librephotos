"""An exact copy of a photo under a second path is a known file to the scan (#2417).

File rows are keyed by content hash, so the copy and the original share one
row. Saving a new ``File(hash=H, path=<copy>)`` used to UPDATE the original's
row onto the copy's path; the next incremental scan then found the original's
path unknown and moved the row back, re-processing the photo every time.
"""

import datetime
import os
import shutil
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

import pyvips
from django.test import TestCase
from django.utils import timezone

from api.directory_watcher.file_handlers import handle_file_group
from api.directory_watcher.scan_jobs import (
    _known_paths,
    _partition_scan_paths,
    _select_groups_to_process,
)
from api.models import File, FileCopy, Photo
from api.tests.utils import create_test_file, create_test_user

MODULE = "api.directory_watcher.file_handlers"


class ExactCopyRescanTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user(is_admin=True)
        root = tempfile.mkdtemp(prefix="lp-copy-")
        self.addCleanup(shutil.rmtree, root, True)
        os.makedirs(os.path.join(root, "phone-old"))
        os.makedirs(os.path.join(root, "phone-new"))
        self.original = os.path.join(root, "phone-old", "IMG-20250715-WA0003.jpg")
        self.copy = os.path.join(root, "phone-new", "IMG-20250715-WA0003.jpg")
        pyvips.Image.black(8, 8).write_to_file(self.original)
        shutil.copyfile(self.original, self.copy)

        # _process_photo stands in for thumbnails, EXIF and the rest; it is
        # what sets metadata_read_at, which makes a path known to the scan.
        def process(photo, *_args):
            Photo.objects.filter(pk=photo.pk).update(metadata_read_at=timezone.now())

        patcher = patch(f"{MODULE}._process_photo", side_effect=process)
        self.process_photo = patcher.start()
        self.addCleanup(patcher.stop)
        motion = patch(f"{MODULE}.has_embedded_motion_video", return_value=False)
        motion.start()
        self.addCleanup(motion.stop)

    def next_scan_selects(self, paths=None):
        """Phase 1 of an incremental scan whose baseline is newer than both files."""
        baseline = SimpleNamespace(
            started_at=timezone.now() + datetime.timedelta(minutes=5)
        )
        groups, _ = _partition_scan_paths(paths or [self.original, self.copy])
        selected = _select_groups_to_process(
            list(groups.items()), _known_paths, False, baseline
        )
        return sorted(path for _, group_paths in selected for path in group_paths)

    def run_scan(self, scan, paths=None):
        selected = self.next_scan_selects(paths)
        self.process_photo.reset_mock()
        for path in selected:
            handle_file_group(self.user, [path], f"scan-{scan}")
        processed = [call.args[0].pk for call in self.process_photo.call_args_list]
        return selected, processed

    def row_directory(self, file_hash):
        return os.path.basename(os.path.dirname(File.objects.get(hash=file_hash).path))

    def test_a_copy_is_read_once_and_then_known(self):
        handle_file_group(self.user, [self.original], "scan-0")
        photo = Photo.objects.owned_by(self.user).get()
        file_hash = photo.main_file.hash

        # The first scan that meets the copy hashes it, and nothing else:
        # the photo it is a copy of has not changed.
        selected, processed = self.run_scan(1)
        self.assertEqual([self.copy], selected)
        self.assertEqual([], processed)
        self.assertEqual("phone-old", self.row_directory(file_hash))

        for scan in (2, 3, 4):
            selected, processed = self.run_scan(scan)
            self.assertEqual([], selected, f"scan {scan}")
            self.assertEqual([], processed, f"scan {scan}")
            self.assertEqual("phone-old", self.row_directory(file_hash))

        photo.refresh_from_db()
        self.assertEqual(self.original, photo.main_file.path)
        self.assertEqual(1, Photo.objects.count())
        self.assertEqual(1, File.objects.count())

    def test_a_first_import_of_both_makes_one_photo_and_records_the_copy(self):
        selected, processed = self.run_scan(1)
        self.assertEqual(sorted([self.original, self.copy]), selected)
        photo = Photo.objects.owned_by(self.user).get()
        self.assertEqual([photo.pk], processed)
        # Whichever path was read first holds the row, the other is its copy.
        copies = [c.path for c in FileCopy.objects.all()]
        self.assertEqual(
            sorted([self.original, self.copy]), sorted([photo.main_file.path, *copies])
        )

        self.assertEqual(([], []), self.run_scan(2))

    def test_the_copy_takes_the_file_over_when_the_original_is_gone(self):
        handle_file_group(self.user, [self.original], "scan-0")
        self.run_scan(1)
        photo = Photo.objects.owned_by(self.user).get()
        os.remove(self.original)

        selected, processed = self.run_scan(2, paths=[self.copy])
        self.assertEqual([self.copy], selected)
        self.assertEqual([photo.pk], processed)
        photo.refresh_from_db()
        self.assertEqual(self.copy, photo.main_file.path)
        self.assertEqual([self.copy], list(photo.files.values_list("path", flat=True)))
        self.assertFalse(FileCopy.objects.exists())

        self.assertEqual(([], []), self.run_scan(3, paths=[self.copy]))

    def test_a_copy_that_changes_becomes_its_own_photo(self):
        handle_file_group(self.user, [self.original], "scan-0")
        self.run_scan(1)
        # Written aside and moved in: libvips may still hold the old file open.
        edited = os.path.join(os.path.dirname(self.copy), "edited.jpg")
        pyvips.Image.black(9, 7).write_to_file(edited)
        os.replace(edited, self.copy)
        later = (timezone.now() + datetime.timedelta(minutes=10)).timestamp()
        os.utime(self.copy, (later, later))

        selected, processed = self.run_scan(2)
        self.assertEqual([self.copy], selected)
        self.assertEqual(2, Photo.objects.count())
        self.assertEqual(
            {self.original, self.copy}, set(File.objects.values_list("path", flat=True))
        )
        self.assertFalse(FileCopy.objects.exists())


class FileCreateTestCase(TestCase):
    def test_a_row_with_the_same_hash_keeps_its_path(self):
        user = create_test_user()
        original = create_test_file("/photos/a/IMG_1.jpg", user)

        row = File.create("/photos/b/IMG_1.jpg", original.hash, File.IMAGE)

        self.assertEqual(original.hash, row.hash)
        self.assertEqual("/photos/a/IMG_1.jpg", File.objects.get().path)

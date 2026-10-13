"""A photo whose original is gone but whose exact copy is on disk is not missing.

Since #2417 an exact copy of a photo's file is recorded as a ``FileCopy`` of
the original's ``File`` row. When only the original was deleted, the
missing-file check flagged the photo missing, and the #2195 guard counted it
as losing all its files, until the next scan let the copy take the row over.
The check now lets the copy take the row over right there.
"""

import os
import shutil
import tempfile
import uuid

from django.test import TestCase

from api.directory_watcher.scan_jobs import scan_missing_photos
from api.models import File, FileCopy, LongRunningJob
from api.photos.files import detach_missing_files, missing_files
from api.tests.utils import create_test_file, create_test_photo, create_test_user


class ExactCopyMissingCheckTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.root = tempfile.mkdtemp(prefix="lp-copy-missing-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.user.scan_directory = self.root
        self.user.save(update_fields=["scan_directory"])
        os.makedirs(os.path.join(self.root, "old"))
        os.makedirs(os.path.join(self.root, "new"))
        self.original = os.path.join(self.root, "old", "IMG_1.jpg")
        self.copy = os.path.join(self.root, "new", "IMG_1.jpg")
        self.file = create_test_file(self.original, self.user, on_disk=True)
        shutil.copyfile(self.original, self.copy)
        FileCopy.objects.create(path=self.copy, file=self.file)
        self.photo = create_test_photo(owner=self.user, main_file=self.file)
        self.photo.files.add(self.file)
        # Another photo keeps the scan directory from looking unmounted.
        other = create_test_file(
            os.path.join(self.root, "other.jpg"), self.user, on_disk=True
        )
        create_test_photo(owner=self.user, main_file=other).files.add(other)

    def run_check(self):
        job_id = uuid.uuid4()
        scan_missing_photos(self.user, job_id)
        return LongRunningJob.objects.get(job_id=job_id)

    def test_the_copy_takes_the_file_over_and_the_photo_is_not_missing(self):
        os.remove(self.original)

        job = self.run_check()

        self.assertFalse(job.failed)
        self.file.refresh_from_db()
        self.assertFalse(self.file.missing)
        self.assertEqual(self.copy, self.file.path)
        self.assertEqual([self.copy], [f.path for f in self.photo.files.all()])
        self.photo.refresh_from_db()
        self.assertEqual(self.copy, self.photo.main_file.path)
        self.assertFalse(FileCopy.objects.exists())

    def test_without_a_copy_on_disk_the_photo_is_missing(self):
        os.remove(self.original)
        os.remove(self.copy)

        self.run_check()

        self.file.refresh_from_db()
        self.assertTrue(self.file.missing)
        self.assertFalse(self.photo.files.exists())

    def test_with_the_original_on_disk_nothing_changes(self):
        self.run_check()

        self.file.refresh_from_db()
        self.assertEqual(self.original, self.file.path)
        self.assertFalse(self.file.missing)
        self.assertEqual(
            [self.copy], list(FileCopy.objects.values_list("path", flat=True))
        )

    def test_a_gone_copy_is_skipped_for_one_on_disk(self):
        gone = os.path.join(self.root, "gone", "IMG_1.jpg")
        FileCopy.objects.create(path=gone, file=self.file)
        os.remove(self.original)

        self.assertEqual([], missing_files(self.photo))

        self.file.refresh_from_db()
        self.assertEqual(self.copy, self.file.path)

    def test_detaching_lets_the_copy_take_over(self):
        os.remove(self.original)

        detach_missing_files(self.photo)

        self.file.refresh_from_db()
        self.assertEqual(self.copy, self.file.path)
        self.assertFalse(self.file.missing)
        self.assertEqual(1, self.photo.files.count())
        self.assertEqual(2, File.objects.count())


class ExactCopyMissingGuardTest(TestCase):
    """Moving most of a library to a folder of copies does not trip #2195's guard."""

    PHOTOS = 120

    def test_photos_kept_by_their_copies_do_not_count_as_lost(self):
        user = create_test_user()
        root = tempfile.mkdtemp(prefix="lp-copy-guard-")
        self.addCleanup(shutil.rmtree, root, True)
        user.scan_directory = root
        user.save(update_fields=["scan_directory"])
        os.makedirs(os.path.join(root, "copies"))
        for n in range(self.PHOTOS):
            original = os.path.join(root, f"{n}.jpg")
            file = create_test_file(original, user, on_disk=True)
            create_test_photo(owner=user, main_file=file).files.add(file)
            if n < 110:
                copy = os.path.join(root, "copies", f"{n}.jpg")
                shutil.copyfile(original, copy)
                FileCopy.objects.create(path=copy, file=file)
                os.remove(original)

        job_id = uuid.uuid4()
        scan_missing_photos(user, job_id)

        self.assertFalse(LongRunningJob.objects.get(job_id=job_id).failed)
        self.assertFalse(File.objects.filter(missing=True).exists())
        self.assertEqual(110, File.objects.filter(path__contains="copies").count())

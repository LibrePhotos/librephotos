"""The library scan walks every library folder of the user (#123).

A further folder that cannot be read (an unplugged disk) is left out and
listed in the job; the scan of the rest goes on, and the missing-file check
leaves the photos in that folder alone instead of flagging them missing.
"""

import os
import uuid

from api.directory_watcher import scan_jobs
from api.directory_watcher.scan_jobs import scan_missing_photos
from api.models import File, LongRunningJob
from api.tests.scanning.test_scan_photos_orchestration import (
    ScanPhotosCharacterizationBase,
)
from api.tests.utils import (
    create_test_file,
    create_test_library_folder,
    create_test_photo,
)


class LibraryScanTest(ScanPhotosCharacterizationBase):
    def setUp(self):
        super().setUp()
        self.extra = os.path.join(self.media_root.name, "family")
        os.makedirs(self.extra)

    def walked(self, res):
        return [call.args[0] for call in res["walk_directory"].call_args_list]

    def test_walks_the_scan_directory_and_every_further_folder(self):
        create_test_library_folder(self.user, self.extra)

        res = self.run_scan()

        self.assertEqual(self.walked(res), [self.scan_dir, self.extra])
        self.assertTrue(self.job().result[LongRunningJob.LIBRARY_SCAN])
        self.assertEqual(len(res["tasks"].find(scan_jobs.scan_missing_photos)), 1)

    def test_a_scan_of_another_folder_walks_only_that_folder(self):
        create_test_library_folder(self.user, self.extra)
        other = os.path.join(self.media_root.name, "other")

        res = self.run_scan(scan_directory=other)

        self.assertEqual(self.walked(res), [other])

    def test_a_missing_further_folder_is_skipped_and_listed(self):
        create_test_library_folder(self.user, self.extra)
        gone = os.path.join(self.media_root.name, "usb")
        create_test_library_folder(self.user, gone)

        res = self.run_scan()

        job = self.job()
        self.assertFalse(job.failed)
        self.assertEqual(self.walked(res), [self.scan_dir, self.extra])
        self.assertTrue(any(gone in error for error in job.result["errors"]))
        # Still a library scan: the missing-file check runs and skips that folder.
        self.assertTrue(job.result[LongRunningJob.LIBRARY_SCAN])
        self.assertEqual(len(res["tasks"].find(scan_jobs.scan_missing_photos)), 1)

    def test_an_emptied_further_folder_with_photos_is_skipped(self):
        create_test_library_folder(self.user, self.extra)
        file = create_test_file(os.path.join(self.extra, "a.jpg"), self.user)
        photo = create_test_photo(owner=self.user, main_file=file)
        photo.files.add(file)

        res = self.run_scan()

        self.assertEqual(self.walked(res), [self.scan_dir])
        self.assertIn("Is the library mounted?", self.job().result["errors"][0])


class MissingCheckOfUnavailableFolderTest(ScanPhotosCharacterizationBase):
    def setUp(self):
        super().setUp()
        self.usb = os.path.join(self.media_root.name, "usb")
        create_test_library_folder(self.user, self.usb)
        # One file on disk in the scan directory, so it is not empty.
        os.makedirs(self.scan_dir, exist_ok=True)
        with open(os.path.join(self.scan_dir, "keep.jpg"), "wb") as handle:
            handle.write(b"x")

    def photo(self, folder, name):
        file = create_test_file(os.path.join(folder, name), self.user)
        photo = create_test_photo(owner=self.user, main_file=file)
        photo.files.add(file)
        return photo, file

    def run_check(self):
        job_id = uuid.uuid4()
        scan_missing_photos(self.user, job_id)
        return LongRunningJob.objects.get(job_id=job_id)

    def test_photos_in_an_unplugged_folder_are_not_flagged_missing(self):
        _, on_usb = self.photo(self.usb, "a.jpg")
        _, gone_from_main = self.photo(self.scan_dir, "b.jpg")

        job = self.run_check()

        self.assertFalse(job.failed)
        self.assertFalse(File.objects.get(pk=on_usb.pk).missing)
        self.assertTrue(File.objects.get(pk=gone_from_main.pk).missing)

    def test_photos_of_a_folder_that_is_back_are_checked_again(self):
        os.makedirs(self.usb)
        with open(os.path.join(self.usb, "other.jpg"), "wb") as handle:
            handle.write(b"x")
        _, gone = self.photo(self.usb, "a.jpg")

        self.run_check()

        self.assertTrue(File.objects.get(pk=gone.pk).missing)

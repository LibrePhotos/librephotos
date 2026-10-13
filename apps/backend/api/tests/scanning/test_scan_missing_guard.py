"""A scan of an unmounted library must not mark every photo missing (#2195).

When the library mount is gone but the mount point is still there (a Docker
bind mount whose host folder is missing, a dropped NFS/SMB share, an unplugged
USB disk), the scan saw an empty directory, finished, and its missing-file
follow-up flagged every photo's files as missing; one click on "Remove missing
photos" then deleted the whole library from the database.

Now a scan of the scan directory refuses to run when that directory cannot be
read, or is empty while the user has photos in it. The missing-file check runs
the same test again (the mount can drop between the scan and the check), then
looks at every photo before changing anything, and changes nothing when more
than ``SCAN_MISSING_MAX_FRACTION`` of the photos (and more than a floor) would
lose all their files.
"""

import os
import shutil
import tempfile
import uuid

from constance.test import override_config
from django.test import TestCase

from api.directory_watcher import scan_jobs
from api.directory_watcher.scan_jobs import scan_missing_photos
from api.models import File, LongRunningJob
from api.tests.scanning.test_scan_photos_orchestration import (
    ScanPhotosCharacterizationBase,
)
from api.tests.utils import create_test_file, create_test_photo, create_test_user


class ScanOfEmptiedLibraryTest(ScanPhotosCharacterizationBase):
    """``self.scan_dir`` is an empty directory, like an unmounted mount point."""

    def _photo_in_scan_dir(self):
        file = create_test_file(os.path.join(self.scan_dir, "a.jpg"), self.user)
        photo = create_test_photo(owner=self.user, main_file=file)
        photo.files.add(file)
        return photo

    def _followups(self, res):
        return res["tasks"].find(scan_jobs.scan_missing_photos) + res["tasks"].find(
            scan_jobs.repair_ungrouped_file_variants
        )

    def test_empty_scan_directory_with_photos_in_it_fails_the_scan(self):
        self._photo_in_scan_dir()

        res = self.run_scan()

        job = self.job()
        self.assertTrue(job.failed)
        self.assertIn("Is the library mounted?", job.result["error"])
        res["walk_directory"].assert_not_called()
        self.assertEqual(self._followups(res), [])

    def test_empty_scan_directory_without_photos_still_scans(self):
        """A new user's empty library is not a problem."""
        res = self.run_scan()

        job = self.job()
        self.assertFalse(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(len(res["tasks"].find(scan_jobs.scan_missing_photos)), 1)

    def test_photos_only_outside_the_scan_directory_do_not_count(self):
        create_test_photo(owner=self.user)  # in TEST_MEDIA_ROOT, not scan_dir

        self.run_scan()

        self.assertFalse(self.job().failed)

    def test_another_users_photos_do_not_count(self):
        other = create_test_user()
        file = create_test_file(os.path.join(self.scan_dir, "theirs.jpg"), other)
        create_test_photo(owner=other, main_file=file)

        self.run_scan()

        self.assertFalse(self.job().failed)

    @override_config(SCAN_MISSING_MAX_FRACTION=1.0)
    def test_emptied_library_scans_when_the_limit_is_off(self):
        """A user who really emptied their library can still clear it."""
        self._photo_in_scan_dir()

        res = self.run_scan()

        self.assertFalse(self.job().failed)
        self.assertEqual(len(res["tasks"].find(scan_jobs.scan_missing_photos)), 1)

    def test_missing_scan_directory_fails_the_scan(self):
        os.rmdir(self.scan_dir)

        res = self.run_scan()

        job = self.job()
        self.assertTrue(job.failed)
        self.assertIn("Is the library mounted?", job.result["error"])
        res["walk_directory"].assert_not_called()

    def test_scanning_another_directory_is_not_checked(self):
        """Only a scan of the scan directory leads to the missing-file check."""
        self._photo_in_scan_dir()
        other = os.path.join(self.media_root.name, "other")
        os.makedirs(other)

        self.run_scan(scan_directory=other)

        self.assertFalse(self.job().failed)


class ScanMissingPhotosGuardTest(TestCase):
    PHOTOS = 200

    @classmethod
    def setUpTestData(cls):
        cls.user = create_test_user()

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="scan-missing-guard-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.user.scan_directory = self.root
        self.user.save(update_fields=["scan_directory"])
        self.files = []
        for n in range(self.PHOTOS):
            file = create_test_file(
                os.path.join(self.root, f"{n}.jpg"), self.user, on_disk=True
            )
            photo = create_test_photo(owner=self.user, main_file=file)
            photo.files.add(file)
            self.files.append(file)
        self.job_id = uuid.uuid4()

    def _delete(self, count):
        for file in self.files[:count]:
            os.remove(file.path)

    def _run(self):
        scan_missing_photos(self.user, self.job_id)
        return LongRunningJob.objects.get(job_id=self.job_id)

    def _detached(self):
        return File.objects.filter(missing=True).count()

    def test_most_of_the_library_gone_detaches_nothing_and_fails(self):
        self._delete(150)

        job = self._run()

        self.assertEqual(self._detached(), 0)
        self.assertTrue(job.failed)
        self.assertIn("150 of 200 photos", job.result["error"])
        self.assertIn("Nothing was changed", job.result["error"])

    def test_a_few_gone_are_detached(self):
        self._delete(10)

        job = self._run()

        self.assertFalse(job.failed)
        self.assertEqual(self._detached(), 10)
        for file in self.files[:10]:
            self.assertFalse(file.photo_set.exists())

    @override_config(SCAN_MISSING_MAX_FRACTION=1.0)
    def test_limit_off_detaches_everything_gone(self):
        self._delete(150)

        job = self._run()

        self.assertFalse(job.failed)
        self.assertEqual(self._detached(), 150)

    def test_root_emptied_since_the_scan_detaches_nothing(self):
        """The mount dropped between the scan and this follow-up."""
        for entry in os.listdir(self.root):
            os.remove(os.path.join(self.root, entry))

        job = self._run()

        self.assertEqual(self._detached(), 0)
        self.assertTrue(job.failed)
        self.assertIn("Is the library mounted?", job.result["error"])

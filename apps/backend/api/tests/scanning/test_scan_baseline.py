"""The incremental scan's change baseline (#2192, #2212).

An incremental scan re-reads a known file only when it, or one of its
sidecars, changed after the baseline scan started. The baseline must be a
scan that walked the whole library and reached every file: not stack
detection, a Nextcloud import or a file-list scan (#2192), and not a run that
was cancelled, crashed or cut off by the stuck-job cleanup (#2212).
"""

import datetime
import os
import tempfile
import uuid
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.directory_watcher.scan_jobs import KnownFile, _group_needs_processing
from api.directory_watcher.utils import update_scan_counter
from api.models import LongRunningJob
from api.stacks.detection import batch_detect_stacks
from api.tests.scanning.test_scan_photos_orchestration import (
    ScanPhotosCharacterizationBase,
)
from api.tests.utils import create_test_job, create_test_user


class LibraryScanMarkerTest(ScanPhotosCharacterizationBase):
    def test_a_scan_of_the_scan_directory_is_a_library_scan(self):
        self.run_scan()

        self.assertIs(self.job().result["library_scan"], True)

    def test_a_full_scan_of_the_scan_directory_is_a_library_scan(self):
        self.run_scan(full_scan=True)

        self.assertIs(self.job().result["library_scan"], True)

    def test_a_file_list_scan_is_not(self):
        self.run_scan(scan_files=["/p/a.jpg"], walk_result=["/p/a.jpg"])

        self.assertNotIn("library_scan", self.job().result or {})

    def test_a_scan_of_another_directory_is_not(self):
        self.run_scan(scan_directory=os.path.join(self.media_root.name, "uploads"))

        self.assertNotIn("library_scan", self.job().result or {})

    def test_the_marker_survives_the_follow_ups_and_per_file_errors(self):
        self.run_scan(walk_result=["/p/a.jpg", "/p/b.jpg"])
        update_scan_counter(self.job_id, failed=True, error="unreadable")
        update_scan_counter(self.job_id)

        job = self.job()
        self.assertTrue(job.finished)
        self.assertIs(job.result["library_scan"], True)


class LastFinishedScanTest(ScanPhotosCharacterizationBase):
    """The scan baseline is the newest scan that walked the library to the end."""

    def baseline(self):
        return LongRunningJob.baseline_for(self.user, LongRunningJob.JOB_SCAN_PHOTOS)

    def library_scan(self):
        job_id = str(uuid.uuid4())
        self.run_scan(job_id=job_id)
        return self.job(job_id)

    def test_a_library_scan_is_the_baseline(self):
        scan = self.library_scan()

        self.assertEqual(self.baseline(), scan)

    @patch("api.stacks.detection.detect_burst_sequences", return_value=2)
    def test_stack_detection_is_not(self, _bursts):
        scan = self.library_scan()
        batch_detect_stacks(self.user)

        self.assertEqual(self.baseline(), scan)

    def test_a_nextcloud_import_is_not(self):
        scan = self.library_scan()
        # What nextcloud.directory_watcher.scan_photos leaves behind.
        create_test_job(
            started_by=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            started_at=timezone.now(),
        ).complete()

        self.assertEqual(self.baseline(), scan)

    def test_a_file_list_scan_is_not(self):
        scan = self.library_scan()
        self.run_scan(job_id=str(uuid.uuid4()), scan_files=["/p/a.jpg"], walk_result=[])

        self.assertEqual(self.baseline(), scan)

    def test_a_cancelled_scan_is_not(self):
        scan = self.library_scan()
        job_id = str(uuid.uuid4())
        self.run_scan(job_id=job_id, walk_result=["/p/a.jpg", "/p/b.jpg"])
        self.job(job_id).cancel()

        self.assertEqual(self.baseline(), scan)

    def test_a_scan_the_stuck_job_cleanup_cut_off_is_not(self):
        scan = self.library_scan()
        job_id = str(uuid.uuid4())
        self.run_scan(job_id=job_id, walk_result=["/p/a.jpg", "/p/b.jpg"])
        update_scan_counter(job_id)
        LongRunningJob.objects.filter(job_id=job_id).update(
            started_at=timezone.now() - datetime.timedelta(days=2),
            last_progress_at=timezone.now() - datetime.timedelta(days=2),
        )
        LongRunningJob.cleanup_stuck_jobs()

        self.assertTrue(self.job(job_id).failed)
        self.assertEqual(self.baseline(), scan)

    def test_a_scan_that_raised_is_not(self):
        scan = self.library_scan()
        job_id = str(uuid.uuid4())
        self.run_scan(job_id=job_id, walk_result=["/p/a.jpg", "/p/b.jpg"])
        self.job(job_id).fail(error="worker lost")

        self.assertEqual(self.baseline(), scan)

    def test_a_scan_over_the_error_threshold_that_reached_every_file_is(self):
        self.library_scan()
        job_id = str(uuid.uuid4())
        # More errors than FAILURE_ERROR_FLOOR, so the job is flagged failed.
        files = [f"/p/{n}.jpg" for n in range(12)]
        self.run_scan(job_id=job_id, walk_result=files)
        for _ in files:
            update_scan_counter(job_id, failed=True, error="unreadable")

        job = self.job(job_id)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(self.baseline(), job)

    def test_another_users_scan_is_not(self):
        scan = self.library_scan()
        other = create_test_user()
        create_test_job(
            started_by=other,
            started_at=timezone.now(),
            finished=True,
            finished_at=timezone.now(),
            result={"library_scan": True},
        )

        self.assertEqual(self.baseline(), scan)


class ChangedDuringTheBaselineScanTest(TestCase):
    """A file edited while the baseline scan ran was maybe read before the edit."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "a.jpg")
        with open(self.path, "wb") as f:
            f.write(b"jpeg")
        now = timezone.now()
        # Hours apart, so a host whose local zone is not UTC cannot move the
        # mtime across either end.
        self.baseline = LongRunningJob(
            started_at=now - datetime.timedelta(hours=40),
            finished_at=now - datetime.timedelta(hours=2),
        )

    def set_mtime(self, moment):
        os.utime(self.path, (moment.timestamp(), moment.timestamp()))

    def test_a_file_changed_while_the_baseline_scan_ran_is_processed(self):
        self.set_mtime(timezone.now() - datetime.timedelta(hours=20))

        self.assertTrue(
            _group_needs_processing(
                [self.path], {self.path: KnownFile()}, False, self.baseline
            )
        )

    def test_a_file_unchanged_since_before_the_baseline_scan_is_skipped(self):
        self.set_mtime(timezone.now() - datetime.timedelta(hours=60))

        self.assertFalse(
            _group_needs_processing(
                [self.path], {self.path: KnownFile()}, False, self.baseline
            )
        )

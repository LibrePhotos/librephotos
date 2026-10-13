"""Tests for ``LongRunningJob.cleanup_stuck_jobs``.

Orphaned unfinished rows (worker OOM, container restart, uncaught exceptions)
must be marked failed after the stuck threshold so they stop blocking
``GET /api/rqavailable/``. See issue #1919.
"""

import uuid
from datetime import timedelta

from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone

from api.directory_watcher.utils import update_scan_counter
from api.models import LongRunningJob
from api.tests.utils import create_test_job, create_test_user

J = LongRunningJob


class CleanupStuckJobsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _job(
        self,
        *,
        hours_ago=0,
        started=True,
        finished=False,
        job_type=J.JOB_SCAN_PHOTOS,
    ):
        now = timezone.now()
        queued_at = now - timedelta(hours=hours_ago)
        started_at = queued_at if started else None
        return J.objects.create(
            started_by=self.user,
            job_id=str(uuid.uuid4()),
            job_type=job_type,
            finished=finished,
            failed=False,
            queued_at=queued_at,
            started_at=started_at,
        )

    def test_marks_old_started_unfinished_job_as_failed(self):
        stuck = self._job(hours_ago=settings.STUCK_JOB_HOURS + 1, started=True)
        count = J.cleanup_stuck_jobs()
        self.assertEqual(count, 1)
        stuck.refresh_from_db()
        self.assertTrue(stuck.finished)
        self.assertTrue(stuck.failed)
        self.assertIsNotNone(stuck.finished_at)
        self.assertEqual(stuck.result["status"], "failed")

    def test_leaves_recent_unfinished_job_untouched(self):
        recent = self._job(hours_ago=1, started=True)
        count = J.cleanup_stuck_jobs()
        self.assertEqual(count, 0)
        recent.refresh_from_db()
        self.assertFalse(recent.finished)
        self.assertFalse(recent.failed)

    def test_marks_never_started_orphan_as_failed(self):
        orphan = self._job(
            hours_ago=settings.STUCK_JOB_HOURS + 1, started=False, finished=False
        )
        count = J.cleanup_stuck_jobs()
        self.assertEqual(count, 1)
        orphan.refresh_from_db()
        self.assertTrue(orphan.finished)
        self.assertTrue(orphan.failed)

    def test_leaves_recent_never_started_job_untouched(self):
        queued = self._job(hours_ago=1, started=False)
        count = J.cleanup_stuck_jobs()
        self.assertEqual(count, 0)
        queued.refresh_from_db()
        self.assertFalse(queued.finished)

    def test_respects_custom_hours_threshold(self):
        mid = self._job(hours_ago=5, started=True)
        count = J.cleanup_stuck_jobs(hours=3)
        self.assertEqual(count, 1)
        mid.refresh_from_db()
        self.assertTrue(mid.failed)


class CleanupWaitsForProgressTest(TestCase):
    """A job is stuck after a day without progress, not a day after it started (#2248).

    A first scan of a large library can take days; the cleanup failed it after
    24 hours while its file groups were still being imported, so its
    follow-ups never ran and the queue reported itself free.
    """

    def setUp(self):
        self.user = create_test_user()
        self.now = timezone.now()

    def job(self, *, started_hours_ago, progress_hours_ago=None, result=None):
        started_at = self.now - timedelta(hours=started_hours_ago)
        return create_test_job(
            self.user,
            queued_at=started_at,
            started_at=started_at,
            progress_target=10,
            last_progress_at=(
                None
                if progress_hours_ago is None
                else self.now - timedelta(hours=progress_hours_ago)
            ),
            result=result,
        )

    def test_long_job_with_recent_progress_is_left_alone(self):
        job = self.job(started_hours_ago=30)
        update_scan_counter(job.job_id)
        self.assertEqual(J.cleanup_stuck_jobs(), 0)
        job.refresh_from_db()
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)

    def test_job_without_progress_for_a_day_is_failed(self):
        job = self.job(started_hours_ago=30, progress_hours_ago=25)
        self.assertEqual(J.cleanup_stuck_jobs(), 1)
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertTrue(job.failed)

    def test_started_job_that_never_reported_progress_is_failed_after_a_day(self):
        job = self.job(started_hours_ago=25)
        self.assertEqual(J.cleanup_stuck_jobs(), 1)
        job.refresh_from_db()
        self.assertTrue(job.failed)

    def test_failed_job_keeps_what_it_recorded(self):
        job = self.job(
            started_hours_ago=30,
            progress_hours_ago=25,
            result={"followups": {"full_scan": False}, "error_count": 2},
        )
        J.cleanup_stuck_jobs()
        job.refresh_from_db()
        self.assertEqual(job.result["followups"], {"full_scan": False})
        self.assertEqual(job.result["error_count"], 2)
        self.assertEqual(job.result["status"], "failed")
        self.assertIn("24 hours", job.result["error"])

    @override_settings(STUCK_JOB_HOURS=48)
    def test_threshold_comes_from_the_setting(self):
        job = self.job(started_hours_ago=30)
        self.assertEqual(J.cleanup_stuck_jobs(), 0)
        job.refresh_from_db()
        self.assertFalse(job.finished)


class ProgressStampTest(TestCase):
    """Every progress writer stamps ``last_progress_at`` (#2248)."""

    def setUp(self):
        self.user = create_test_user()
        self.job = create_test_job(
            self.user, started_at=timezone.now() - timedelta(hours=30)
        )

    def stamped(self):
        self.job.refresh_from_db()
        self.assertIsNotNone(self.job.last_progress_at)
        self.assertLess(
            timezone.now() - self.job.last_progress_at, timedelta(minutes=1)
        )

    def test_update_progress(self):
        J.objects.get(pk=self.job.pk).update_progress(current=1, target=2)
        self.stamped()

    def test_set_result(self):
        J.objects.get(pk=self.job.pk).set_result({"stage": "exact_copies"})
        self.stamped()

    def test_update_scan_counter(self):
        update_scan_counter(self.job.job_id)
        self.stamped()

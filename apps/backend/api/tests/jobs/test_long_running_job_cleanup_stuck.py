"""Tests for ``LongRunningJob.cleanup_stuck_jobs``.

Orphaned unfinished rows (worker OOM, container restart, uncaught exceptions)
must be marked failed after the stuck threshold so they stop blocking
``GET /api/rqavailable/``. See issue #1919.
"""

import uuid
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from api.models import LongRunningJob
from api.tests.utils import create_test_user

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
        stuck = self._job(hours_ago=J.STUCK_JOB_HOURS + 1, started=True)
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
            hours_ago=J.STUCK_JOB_HOURS + 1, started=False, finished=False
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

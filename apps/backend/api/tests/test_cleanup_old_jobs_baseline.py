"""Tests for ``LongRunningJob.cleanup_old_jobs`` baseline preservation.

The incremental scan derives its "last scan" baseline by querying the most
recent ``finished=True`` job of each type (``api/directory_watcher/scan_jobs.py``
and ``processing_jobs.py``). The daily cleanup used to delete every finished job
older than 30 days, including that baseline — which silently forced a full
re-scan/re-enrichment of the whole library on the next run. Cleanup must now
keep the latest finished job of each (user, job_type) regardless of age, while
still pruning older surplus jobs.
"""

import uuid
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from api.models import LongRunningJob
from api.tests.utils import create_test_user

J = LongRunningJob


class CleanupOldJobsBaselineTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _job(self, job_type, days_ago, finished=True, user=None):
        return J.objects.create(
            started_by=user or self.user,
            job_id=str(uuid.uuid4()),
            job_type=job_type,
            finished=finished,
            failed=False,
            finished_at=(
                timezone.now() - timedelta(days=days_ago) if finished else None
            ),
        )

    def test_keeps_latest_finished_job_per_type_even_when_old(self):
        # The only Scan Photos job is 60 days old — older than the 30d cutoff —
        # but it is the incremental-scan baseline and must survive.
        baseline = self._job(J.JOB_SCAN_PHOTOS, days_ago=60)
        J.cleanup_old_jobs(days=30)
        self.assertTrue(
            J.objects.filter(id=baseline.id).exists(),
            "the latest finished job (scan baseline) must survive cleanup",
        )

    def test_prunes_older_duplicates_but_keeps_newest(self):
        older = self._job(J.JOB_SCAN_PHOTOS, days_ago=90)
        newer = self._job(J.JOB_SCAN_PHOTOS, days_ago=60)
        J.cleanup_old_jobs(days=30)
        self.assertFalse(J.objects.filter(id=older.id).exists())
        self.assertTrue(J.objects.filter(id=newer.id).exists())

    def test_prunes_old_surplus_when_latest_is_recent(self):
        recent = self._job(J.JOB_SCAN_PHOTOS, days_ago=2)
        stale = self._job(J.JOB_SCAN_PHOTOS, days_ago=60)
        J.cleanup_old_jobs(days=30)
        self.assertTrue(J.objects.filter(id=recent.id).exists())
        self.assertFalse(J.objects.filter(id=stale.id).exists())

    def test_keeps_latest_of_each_type_independently(self):
        jobs = [
            self._job(J.JOB_SCAN_PHOTOS, days_ago=60),
            self._job(J.JOB_ADD_GEOLOCATION, days_ago=60),
            self._job(J.JOB_SCAN_FACES, days_ago=60),
            self._job(J.JOB_GENERATE_TAGS, days_ago=60),
        ]
        J.cleanup_old_jobs(days=30)
        for j in jobs:
            self.assertTrue(
                J.objects.filter(id=j.id).exists(),
                f"baseline for job_type {j.job_type} must survive",
            )

    def test_keeps_latest_baseline_per_user(self):
        other = create_test_user()
        mine = self._job(J.JOB_SCAN_PHOTOS, days_ago=60)
        theirs = self._job(J.JOB_SCAN_PHOTOS, days_ago=60, user=other)
        J.cleanup_old_jobs(days=30)
        self.assertTrue(J.objects.filter(id=mine.id).exists())
        self.assertTrue(J.objects.filter(id=theirs.id).exists())

    def test_recent_jobs_within_cutoff_are_kept(self):
        extra = self._job(J.JOB_SCAN_PHOTOS, days_ago=2)
        latest = self._job(J.JOB_SCAN_PHOTOS, days_ago=1)
        J.cleanup_old_jobs(days=30)
        self.assertTrue(J.objects.filter(id=extra.id).exists())
        self.assertTrue(J.objects.filter(id=latest.id).exists())

"""Queue availability must ignore unfinished jobs past the stuck threshold.

``GET /api/rqavailable/`` used to treat any ``finished=False`` row as busy,
so orphaned jobs blocked every heavyweight action forever. Age filtering
matches ``LongRunningJob.cleanup_stuck_jobs`` / ``STUCK_JOB_HOURS``. See #1919.
"""

import uuid
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.utils import create_test_user

J = LongRunningJob
RQ_AVAILABLE_URL = "/api/rqavailable/"


class QueueAvailabilityStuckJobsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _unfinished_job(self, *, hours_ago, started=True):
        now = timezone.now()
        queued_at = now - timedelta(hours=hours_ago)
        return J.objects.create(
            started_by=self.user,
            job_id=str(uuid.uuid4()),
            job_type=J.JOB_SCAN_PHOTOS,
            finished=False,
            failed=False,
            queued_at=queued_at,
            started_at=queued_at if started else None,
        )

    def test_recent_unfinished_job_blocks_queue(self):
        self._unfinished_job(hours_ago=1, started=True)
        response = self.client.get(RQ_AVAILABLE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["queue_can_accept_job"])
        self.assertIsNotNone(response.data["job_detail"])

    def test_stuck_started_job_does_not_block_queue(self):
        self._unfinished_job(hours_ago=J.STUCK_JOB_HOURS + 1, started=True)
        response = self.client.get(RQ_AVAILABLE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["queue_can_accept_job"])
        self.assertIsNone(response.data["job_detail"])

    def test_stuck_never_started_job_does_not_block_queue(self):
        self._unfinished_job(hours_ago=J.STUCK_JOB_HOURS + 1, started=False)
        response = self.client.get(RQ_AVAILABLE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["queue_can_accept_job"])
        self.assertIsNone(response.data["job_detail"])

    def test_empty_queue_accepts_jobs(self):
        response = self.client.get(RQ_AVAILABLE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["queue_can_accept_job"])
        self.assertIsNone(response.data["job_detail"])

"""``GET /api/rqavailable/`` must not show one user another's job (GHSA-975v-mx44-9jxq).

The queue is shared, so whether it can take another job stays a global
answer. The running job's record (type, progress, and the ``started_by``
user) follows the #1861 rule for ``/api/jobs/``: its starter and staff see
it, everybody else gets ``job_detail: null``.
"""

import uuid

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.utils import create_test_user

RQ_AVAILABLE_URL = "/api/rqavailable/"


class QueueAvailabilityOwnerScopeTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.bob = create_test_user()
        now = timezone.now()
        self.job = LongRunningJob.objects.create(
            started_by=self.admin,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_DOWNLOAD_MODELS,
            finished=False,
            queued_at=now,
            started_at=now,
        )
        self.client = APIClient()

    def _get(self, user):
        self.client.force_authenticate(user=user)
        response = self.client.get(RQ_AVAILABLE_URL)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_other_user_sees_a_busy_queue_but_not_the_job(self):
        body = self._get(self.bob)
        self.assertFalse(body["queue_can_accept_job"])
        self.assertIsNone(body["job_detail"])
        self.assertNotIn(self.admin.username, str(body))

    def test_starter_sees_their_own_job(self):
        self.job.started_by = self.bob
        self.job.save(update_fields=["started_by"])
        body = self._get(self.bob)
        self.assertFalse(body["queue_can_accept_job"])
        self.assertEqual(body["job_detail"]["job_id"], self.job.job_id)

    def test_staff_keep_the_global_view(self):
        self.job.started_by = self.bob
        self.job.save(update_fields=["started_by"])
        body = self._get(self.admin)
        self.assertEqual(body["job_detail"]["job_id"], self.job.job_id)

"""Repro for issue #1066 -- "Nextcloud integration does not work".

Reported symptom: the Nextcloud connection works (the top level folders are
listed in the browse dialog) but the "Scan photos (Nextcloud)" button stays
grey/disabled forever.

The frontend disables that button with

    disabled={isNextcloudFetching || !workerAvailability || !nextcloud_server_address}

(apps/frontend/src/components/settings/Library.tsx), where ``workerAvailability``
is ``queue_can_accept_job`` from ``GET /api/rqavailable/``. That endpoint
(api/views/jobs.py::QueueAvailabilityView) reports the queue as busy whenever
*any* ``LongRunningJob`` still has ``finished=False``.

``nextcloud/directory_watcher.py::scan_photos`` creates the LongRunningJob and
*then* does the Nextcloud login, the recursive listing and the file downloads
**outside** of its ``try/except`` block. Any failure there (bad app password,
server unreachable, unset/renamed scan directory) escapes the function without
ever calling ``lrj.fail()``, so the job row stays ``finished=False`` for good.
From that point on ``queue_can_accept_job`` is permanently ``False`` and every
scan button in the UI - Nextcloud included - is greyed out.

The local scanner does this correctly: in
``api/directory_watcher/scan_jobs.py::scan_photos`` everything after the job is
created lives inside the ``try`` and the ``except`` marks the job failed.
"""

import uuid
from unittest import mock

import owncloud
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.utils import create_test_user
from nextcloud.directory_watcher import scan_photos as nextcloud_scan_photos

RQ_AVAILABLE_URL = "/api/rqavailable/"


class NextcloudScanFailureLeavesQueueBlockedTest(TestCase):
    def setUp(self):
        self.user = create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_username="alice",
            nextcloud_app_password="app-password",
            nextcloud_scan_directory="/Photos",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _run_failing_nextcloud_scan(self, job_id):
        """Run a Nextcloud scan whose login fails, as a rejected app password does.

        The exception is swallowed here on purpose: this test is about the state
        the job row is left in, not about whether the call raises.
        """
        fake_client = mock.MagicMock()
        fake_client.login.side_effect = owncloud.HTTPResponseError(401)
        with mock.patch(
            "nextcloud.directory_watcher.nextcloud.Client", return_value=fake_client
        ):
            try:
                nextcloud_scan_photos(self.user, job_id)
            except Exception:
                pass

    def test_failed_nextcloud_scan_marks_job_finished(self):
        job_id = uuid.uuid4()

        self._run_failing_nextcloud_scan(job_id)

        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(
            job.finished,
            "A Nextcloud scan that could not log in must close its "
            "LongRunningJob, otherwise the job stays 'running' forever and "
            "blocks the queue.",
        )
        self.assertTrue(
            job.failed,
            "A Nextcloud scan that could not log in must be marked as failed.",
        )

    def test_queue_accepts_new_jobs_after_failed_nextcloud_scan(self):
        """The 'Scan photos (Nextcloud)' button must not stay grey forever."""
        response = self.client.get(RQ_AVAILABLE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            response.json()["queue_can_accept_job"],
            "sanity check: the queue is idle before any scan",
        )

        self._run_failing_nextcloud_scan(uuid.uuid4())

        response = self.client.get(RQ_AVAILABLE_URL)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            response.json()["queue_can_accept_job"],
            "after a Nextcloud scan failed the queue must be free again; "
            "while queue_can_accept_job is False the frontend keeps every "
            "scan button (including 'Scan photos (Nextcloud)') disabled.",
        )

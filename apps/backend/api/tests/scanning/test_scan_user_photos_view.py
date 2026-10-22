"""Admins scan another user's library from the Admin Area (#2037).

``POST /api/manage/user/<id>/scan/`` starts the scan that user's own Scan
button starts: the job is theirs and it reads their scan directory only.
Nothing heavy runs: the queue is patched as in ``test_scan_trigger_views``.
"""

import os
import tempfile
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.scanning.test_scan_trigger_views import RecordingChain, RecordingTask
from api.tests.utils import api_error, create_test_job, create_test_user

MODULE = "api.views.scan_triggers"


def scan_url(user_id: int) -> str:
    return f"/api/manage/user/{user_id}/scan/"


class ScanUserPhotosViewTest(TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.library = self._tmp.name
        self.admin = create_test_user(is_admin=True)
        self.owner = create_test_user(scan_directory=self.library)
        self.client = APIClient()
        RecordingChain.instances = []
        RecordingChain.run_error = None

    def post(self, user_id: int, as_user=None):
        self.client.force_authenticate(user=as_user or self.admin)
        with (
            patch("api.jobs.queue.Chain", RecordingChain),
            patch("api.jobs.queue.AsyncTask", RecordingTask),
            patch("api.runtime.ml_models.do_all_models_exist", return_value=True),
            patch(f"{MODULE}.scan_photos", autospec=True) as scan_photos,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self.scan_photos = scan_photos
            return self.client.post(scan_url(user_id))

    def test_admin_starts_the_users_own_scan(self):
        response = self.post(self.owner.id)

        self.assertEqual(response.status_code, 200)
        job = LongRunningJob.objects.get(job_id=response.data["job_id"])
        # The job is the owner's, not the admin's: their job list shows it and
        # it counts as their scan.
        self.assertEqual(job.started_by, self.owner)
        self.assertEqual(job.job_type, LongRunningJob.JOB_SCAN_PHOTOS)
        args, kwargs = RecordingChain.instances[0].appended[0]
        self.assertEqual(args[1], self.owner)
        self.assertEqual(kwargs["scan_directory"], self.library)

    def test_admin_can_scan_their_own_library_too(self):
        self.admin.scan_directory = self.library
        self.admin.save(update_fields=["scan_directory"])
        self.owner.scan_directory = ""
        self.owner.save(update_fields=["scan_directory"])

        response = self.post(self.admin.id)

        self.assertEqual(response.status_code, 200)
        job = LongRunningJob.objects.get(job_id=response.data["job_id"])
        self.assertEqual(job.started_by, self.admin)

    def test_a_user_who_is_not_an_admin_is_refused(self):
        other = create_test_user(scan_directory=os.path.join(self.library, "x"))

        response = self.post(self.owner.id, as_user=other)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(LongRunningJob.objects.exists())

    def test_not_even_for_their_own_library(self):
        response = self.post(self.owner.id, as_user=self.owner)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(LongRunningJob.objects.exists())

    def test_anonymous_is_refused(self):
        response = APIClient().post(scan_url(self.owner.id))

        self.assertIn(response.status_code, (401, 403))
        self.assertFalse(LongRunningJob.objects.exists())

    def test_unknown_user_is_404(self):
        response = self.post(self.owner.id + 1000)

        self.assertEqual(response.status_code, 404)

    def test_deactivated_user_is_404(self):
        self.owner.is_active = False
        self.owner.save(update_fields=["is_active"])

        response = self.post(self.owner.id)

        self.assertEqual(response.status_code, 404)
        self.assertFalse(LongRunningJob.objects.exists())

    def test_user_without_scan_directory_is_400(self):
        self.owner.scan_directory = ""
        self.owner.save(update_fields=["scan_directory"])

        response = self.post(self.owner.id)

        self.assertEqual(response.status_code, 400)
        self.assertIn("No scan directory", api_error(response)["message"])
        self.assertFalse(LongRunningJob.objects.exists())

    def test_running_scan_of_the_user_is_409_with_its_job(self):
        running = create_test_job(self.owner, LongRunningJob.JOB_SCAN_PHOTOS)

        response = self.post(self.owner.id)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertEqual(RecordingChain.instances, [])
        self.assertEqual(LongRunningJob.objects.owned_by(self.owner).count(), 1)
        self.assertTrue(LongRunningJob.objects.filter(pk=running.pk).exists())

    def test_a_scan_of_the_admin_does_not_block_the_users_scan(self):
        create_test_job(self.admin, LongRunningJob.JOB_SCAN_PHOTOS)

        response = self.post(self.owner.id)

        self.assertEqual(response.status_code, 200)

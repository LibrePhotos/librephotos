"""Tests for job cancellation feature."""

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.utils import create_test_user


class LongRunningJobCancelModelTest(TestCase):
    """Test LongRunningJob.cancel() model method."""

    def setUp(self):
        self.user = create_test_user()

    def test_cancel_sets_cancelled_and_finished(self):
        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        self.assertFalse(job.cancelled)
        self.assertFalse(job.finished)

        job.cancel()

        job.refresh_from_db()
        self.assertTrue(job.cancelled)
        self.assertTrue(job.finished)
        self.assertIsNotNone(job.finished_at)
        self.assertEqual(job.result, {"status": "cancelled"})

    def test_cancel_already_finished_job_still_works_at_model_level(self):
        """Model-level cancel() doesn't guard against finished jobs."""
        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        job.complete()
        job.cancel()

        job.refresh_from_db()
        self.assertTrue(job.cancelled)
        self.assertTrue(job.finished)


class LongRunningJobCancelAPITest(TestCase):
    """Test the cancel API endpoint."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_cancel_running_job(self):
        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        response = self.client.post(f"/api/jobs/{job.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["status"])
        self.assertTrue(response.data["job"]["cancelled"])
        self.assertTrue(response.data["job"]["finished"])

    def test_cancel_already_finished_job_returns_400(self):
        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        job.complete()

        response = self.client.post(f"/api/jobs/{job.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data["status"])

    def test_cancel_queued_job(self):
        """A job that has not started yet can be cancelled."""
        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=False,
        )
        response = self.client.post(f"/api/jobs/{job.id}/cancel/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        job.refresh_from_db()
        self.assertTrue(job.cancelled)
        self.assertTrue(job.finished)

    def test_cancelled_field_in_job_list(self):
        """The cancelled field should appear in the job list API."""
        LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        response = self.client.get("/api/jobs/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data["results"]
        self.assertGreater(len(results), 0)
        self.assertIn("cancelled", results[0])


class IsJobCancelledHelperTest(TestCase):
    """Test the is_job_cancelled() shared helper function."""

    def setUp(self):
        self.user = create_test_user()

    def test_returns_false_for_running_job(self):
        from api.directory_watcher.utils import is_job_cancelled

        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        self.assertFalse(is_job_cancelled(job.job_id))

    def test_returns_true_for_cancelled_job(self):
        from api.directory_watcher.utils import is_job_cancelled

        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        job.cancel()
        self.assertTrue(is_job_cancelled(job.job_id))

    def test_returns_false_for_nonexistent_job(self):
        from api.directory_watcher.utils import is_job_cancelled

        self.assertFalse(is_job_cancelled("nonexistent-job-id"))

    def test_returns_false_for_completed_job(self):
        from api.directory_watcher.utils import is_job_cancelled

        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        job.complete()
        self.assertFalse(is_job_cancelled(job.job_id))


class UpdateScanCounterCancellationTest(TestCase):
    """Test that update_scan_counter respects cancellation."""

    def setUp(self):
        self.user = create_test_user()

    def test_update_scan_counter_skips_cancelled_job(self):
        from api.directory_watcher.utils import update_scan_counter

        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            start_now=True,
        )
        job.update_progress(current=0, target=10)
        job.cancel()

        # Call update_scan_counter - it should not unmark the finished state
        update_scan_counter(job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.cancelled)
        self.assertTrue(job.finished)
        # progress_current is incremented but the job remains cancelled
        self.assertEqual(job.progress_current, 1)

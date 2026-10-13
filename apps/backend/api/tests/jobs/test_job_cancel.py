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
        self.assertEqual(response.data["errors"][0]["code"], "job_finished")

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


class JobRowWritesTest(TestCase):
    """A job row is written only through the model's methods (#2334).

    A full-row ``save()`` of an instance loaded before a cancel writes
    ``cancelled=False, finished=False`` back, so the cancelled job reappears
    as running.
    """

    def setUp(self):
        self.user = create_test_user()
        self.job = LongRunningJob.create_job(
            user=self.user, job_type=LongRunningJob.JOB_SCAN_PHOTOS, start_now=True
        )

    def test_full_row_save_of_an_existing_job_is_refused(self):
        job = LongRunningJob.objects.get(pk=self.job.pk)
        job.progress_current = 5
        with self.assertRaises(RuntimeError):
            job.save()
        job.refresh_from_db()
        self.assertEqual(job.progress_current, 0)

    def test_save_with_update_fields_is_allowed(self):
        job = LongRunningJob.objects.get(pk=self.job.pk)
        job.progress_current = 5
        job.save(update_fields=["progress_current"])
        job.refresh_from_db()
        self.assertEqual(job.progress_current, 5)

    def stale_and_cancelled(self):
        """An instance loaded before the job was cancelled elsewhere."""
        stale = LongRunningJob.objects.get(pk=self.job.pk)
        LongRunningJob.objects.get(pk=self.job.pk).cancel()
        return stale

    def assert_row_cancelled(self):
        job = LongRunningJob.objects.get(pk=self.job.pk)
        self.assertTrue(job.cancelled)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result, {"status": "cancelled"})

    def assert_still_cancelled(self, stale):
        self.assert_row_cancelled()
        # The stale instance now says what the row says.
        self.assertTrue(stale.cancelled)
        self.assertEqual(stale.result, {"status": "cancelled"})

    def test_complete_does_not_overwrite_a_cancel(self):
        stale = self.stale_and_cancelled()
        self.assertFalse(stale.complete())
        self.assert_still_cancelled(stale)

    def test_fail_does_not_overwrite_a_cancel(self):
        stale = self.stale_and_cancelled()
        self.assertFalse(stale.fail(error="boom"))
        self.assert_still_cancelled(stale)

    def test_set_result_does_not_overwrite_a_cancel(self):
        stale = self.stale_and_cancelled()
        self.assertFalse(stale.set_result({"status": "running"}))
        self.assert_still_cancelled(stale)

    def test_progress_keeps_a_cancel(self):
        stale = self.stale_and_cancelled()
        stale.update_progress(current=3, target=4, step="tick")
        self.assert_row_cancelled()
        self.assertEqual(LongRunningJob.objects.get(pk=self.job.pk).progress_current, 3)

    def test_complete_and_fail_still_write_a_job_that_was_not_cancelled(self):
        self.assertTrue(self.job.complete({"status": "done"}))
        job = LongRunningJob.objects.get(pk=self.job.pk)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "done"})

        other = LongRunningJob.create_job(
            user=self.user, job_type=LongRunningJob.JOB_SCAN_PHOTOS, start_now=True
        )
        self.assertTrue(other.fail(error="boom"))
        other.refresh_from_db()
        self.assertTrue(other.failed)
        self.assertEqual(other.result, {"status": "failed", "error": "boom"})

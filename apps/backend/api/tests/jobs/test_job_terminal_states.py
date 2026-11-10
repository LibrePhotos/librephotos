"""A job ends once: completed, failed or cancelled, and only from unfinished.

``complete``, ``fail`` and ``cancel`` are the edges out of "queued or
running". Each used to write whatever it was given, so a cancel or a failure
arriving after the job had ended rewrote its outcome: a completed scan became
cancelled (and stopped being the next incremental scan's baseline), or failed
because a step after its completion raised. The progress counters kept
counting items into an ended job, and the outcome flags could disagree with
each other and with ``result["status"]``.
"""

import datetime
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs
from api.directory_watcher.utils import update_batch_counter, update_scan_counter
from api.models import LongRunningJob, Photo
from api.tests.utils import create_test_photo, create_test_user


def _scan(user, **result):
    job = LongRunningJob.create_job(
        user=user, job_type=LongRunningJob.JOB_SCAN_PHOTOS, start_now=True
    )
    if result:
        LongRunningJob.objects.filter(pk=job.pk).update(result=result)
    return job


def _row(job):
    return LongRunningJob.objects.get(pk=job.pk)


class CancelAfterTheEndTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_cancel_of_a_completed_job_changes_nothing(self):
        job = _scan(self.user, library_scan=True)
        stale = _row(job)
        job.complete()

        self.assertFalse(stale.cancel())

        row = _row(job)
        self.assertTrue(row.finished)
        self.assertFalse(row.cancelled)
        self.assertEqual(row.result, {"library_scan": True})
        self.assertEqual(LongRunningJob.baseline_for(self.user, job.job_type), row)
        # The stale instance now says what the row says.
        self.assertFalse(stale.cancelled)

    def test_cancel_reports_that_it_cancelled(self):
        job = _scan(self.user)
        self.assertTrue(job.cancel())
        self.assertTrue(_row(job).cancelled)


class CancelViewRaceTest(TestCase):
    """The job completes after the view's ``finished`` check, before the cancel."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_a_job_that_completes_meanwhile_stays_completed(self):
        job = _scan(self.user, library_scan=True)

        def completes_meanwhile(_job):
            _row(job).complete()

        with (
            patch("api.views.jobs._refuse_unfinished_import", completes_meanwhile),
            patch("api.views.jobs.remove_queued_tasks") as remove,
        ):
            response = self.client.post(f"/api/jobs/{job.id}/cancel/")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["errors"][0]["code"], "job_finished")
        remove.assert_not_called()
        row = _row(job)
        self.assertFalse(row.cancelled)
        self.assertEqual(LongRunningJob.baseline_for(self.user, job.job_type), row)


class FailAfterTheEndTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_fail_after_complete_keeps_the_job_completed(self):
        """scan_photos: the last item finishes the scan, then a later step raises."""
        job = _scan(self.user, library_scan=True)
        update_scan_counter(job.job_id)  # target 0: this finishes it

        self.assertFalse(job.fail(error="backfill raised"))

        row = _row(job)
        self.assertTrue(row.finished)
        self.assertFalse(row.failed)
        self.assertEqual(row.result, {"library_scan": True})
        self.assertEqual(LongRunningJob.baseline_for(self.user, job.job_type), row)

    def test_complete_after_the_counter_finished_keeps_its_finish_time(self):
        """generate_face_embeddings: the counter finishes it, then complete() ran again."""
        job = _scan(self.user)
        job.update_progress(current=0, target=1)
        update_scan_counter(job.job_id)
        finished_at = _row(job).finished_at

        later = timezone.now() + datetime.timedelta(hours=1)
        with patch("django.utils.timezone.now", return_value=later):
            self.assertFalse(job.complete())

        self.assertEqual(_row(job).finished_at, finished_at)


class FailKeepsTheResultTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_fail_adds_the_error_to_what_the_job_recorded(self):
        recorded = {
            "library_scan": True,
            "followups": {"full_scan": False},
            "errors": ["a.jpg: unreadable"],
            "error_count": 1,
        }
        job = _scan(self.user, **recorded)

        self.assertTrue(job.fail(error="boom", details={"checked": 3}))

        self.assertEqual(
            _row(job).result,
            {**recorded, "checked": 3, "status": "failed", "error": "boom"},
        )

    def test_fail_without_an_error_still_says_failed(self):
        job = _scan(self.user, status="partial_failure", error_count=1)
        self.assertTrue(job.fail())
        row = _row(job)
        self.assertTrue(row.failed)
        self.assertEqual(row.result["status"], "failed")
        self.assertEqual(row.result["error_count"], 1)


class OutcomesAreConsistentTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_cancel_after_item_errors_is_cancelled_not_failed(self):
        job = _scan(self.user)
        job.update_progress(current=0, target=100)
        for i in range(20):
            update_scan_counter(job.job_id, failed=True, error=f"e{i}")
        self.assertTrue(_row(job).failed)

        self.assertTrue(_row(job).cancel())

        row = _row(job)
        self.assertTrue(row.cancelled)
        self.assertFalse(row.failed)
        self.assertEqual(row.result["status"], "cancelled")
        self.assertEqual(row.result["error_count"], 20)

    def queued(self):
        return LongRunningJob.create_job(
            user=self.user, job_type=LongRunningJob.JOB_SCAN_PHOTOS
        )

    def test_a_queued_job_that_fails_has_a_start(self):
        job = self.queued()
        job.fail(error="Could not queue the job")
        row = _row(job)
        self.assertEqual(row.started_at, row.finished_at)

    def test_a_queued_job_that_is_cancelled_has_a_start(self):
        job = self.queued()
        job.cancel()
        row = _row(job)
        self.assertEqual(row.started_at, row.finished_at)

    def test_a_running_job_keeps_its_start(self):
        job = _scan(self.user)
        started_at = _row(job).started_at
        job.complete()
        self.assertEqual(_row(job).started_at, started_at)

    def test_a_stuck_queued_job_has_a_start(self):
        job = self.queued()
        old = timezone.now() - datetime.timedelta(days=3)
        LongRunningJob.objects.filter(pk=job.pk).update(queued_at=old)

        self.assertEqual(LongRunningJob.cleanup_stuck_jobs(hours=24), 1)

        row = _row(job)
        self.assertTrue(row.failed)
        self.assertEqual(row.started_at, row.finished_at)
        self.assertEqual(row.result["status"], "failed")


class CountersStopAtTheEndTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.job = _scan(self.user)
        self.job.update_progress(current=0, target=10)

    def test_cancelled_job_does_not_count_items(self):
        self.job.cancel()
        update_scan_counter(self.job.job_id)
        update_scan_counter(self.job.job_id, failed=True, error="late")
        update_batch_counter(self.job.job_id, 3, {"moved": 3}, [])
        self.assertEqual(_row(self.job).progress_current, 0)

    def test_finished_job_does_not_count_past_its_target(self):
        self.job.update_progress(current=9, target=10)
        update_scan_counter(self.job.job_id)
        update_scan_counter(self.job.job_id)
        update_batch_counter(self.job.job_id, 2, {"moved": 2}, ["late"])
        row = _row(self.job)
        self.assertTrue(row.finished)
        self.assertEqual(row.progress_current, 10)
        self.assertNotIn("moved", row.result or {})

    def test_late_error_does_not_fail_a_finished_job(self):
        self.job.complete()
        for i in range(20):
            update_scan_counter(self.job.job_id, failed=True, error=f"late {i}")
        row = _row(self.job)
        self.assertFalse(row.failed)
        self.assertIsNone(row.result)


class ClassifyMediaCancelTest(TestCase):
    def test_cancel_keeps_the_classifications_already_made(self):
        user = create_test_user()
        photos = [create_test_photo(owner=user, is_screenshot=False) for _ in range(3)]
        job = LongRunningJob.create_job(
            user=user, job_type=LongRunningJob.JOB_CLASSIFY_MEDIA
        )

        with (
            patch.object(processing_jobs, "CANCELLATION_CHECK_INTERVAL", 2),
            patch.object(
                processing_jobs, "is_job_cancelled", side_effect=[False, True]
            ),
            patch("api.classification.screenshots.classify", return_value=True),
            patch.object(processing_jobs, "detect_document", return_value=None),
        ):
            processing_jobs.classify_media(user, job.job_id)

        screenshots = Photo.objects.filter(
            pk__in=[p.pk for p in photos], is_screenshot=True
        ).count()
        self.assertEqual(screenshots, 2)
        self.assertEqual(_row(job).progress_current, 2)

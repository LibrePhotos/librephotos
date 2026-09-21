"""Tests for the failure-threshold logic in ``update_scan_counter``.

Previously a single per-photo error would sticky ``job.failed = True``
for the whole job, so a 152,520-photo geolocation run with 4 erroring
photos showed as "Failed" in the admin UI even though 99.997% of work
succeeded. The threshold added in
``api.directory_watcher.utils._exceeds_failure_threshold`` only marks
the job as failed when the absolute error count is meaningful relative
to the total work.

The per-photo errors are still accumulated in ``result['errors']`` and
``result['status']`` distinguishes ``partial_failure`` from a true
``failed``, so callers that want per-photo detail are unaffected.
"""

from django.test import TestCase

from api.directory_watcher.utils import (
    FAILURE_ERROR_FLOOR,
    _exceeds_failure_threshold,
    update_scan_counter,
)
from api.models import LongRunningJob
from api.tests.utils import create_test_user


class ExceedsFailureThresholdTest(TestCase):
    """Direct tests of the threshold function — no DB involvement."""

    def test_no_errors_is_not_failed(self):
        self.assertFalse(_exceeds_failure_threshold(0, 1000))

    def test_single_error_below_floor_is_not_failed(self):
        # 1 / 1000 → 0.1% — well below the rate threshold AND below the floor.
        self.assertFalse(_exceeds_failure_threshold(1, 1000))

    def test_few_errors_in_large_target_below_floor_not_failed(self):
        # Real production case: 4 errors out of 152520 photos.
        self.assertFalse(_exceeds_failure_threshold(4, 152520))

    def test_errors_above_floor_but_below_rate_not_failed_on_large_target(self):
        # Above the floor but below the 5% rate for the target.
        self.assertFalse(_exceeds_failure_threshold(FAILURE_ERROR_FLOOR + 1, 1000))

    def test_errors_above_floor_when_no_target_is_failed(self):
        # Defensive: when target is unknown, any error tips the flag.
        self.assertTrue(_exceeds_failure_threshold(1, 0))
        self.assertTrue(_exceeds_failure_threshold(1, -1))

    def test_errors_above_rate_on_large_target_is_failed(self):
        # 100 errors / 100 photos = 100% — clearly failed.
        self.assertTrue(_exceeds_failure_threshold(100, 100))

    def test_majority_failures_marks_failed(self):
        self.assertTrue(_exceeds_failure_threshold(600, 1000))


class UpdateScanCounterThresholdTest(TestCase):
    """Integration tests that drive update_scan_counter against a real LongRunningJob."""

    def setUp(self):
        self.user = create_test_user()

    def _new_job(self, target):
        job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            start_now=True,
        )
        job.update_progress(current=0, target=target)
        return job

    def test_zero_errors_finish_clean(self):
        job = self._new_job(target=3)
        for _ in range(3):
            update_scan_counter(job.job_id)
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_four_errors_in_huge_run_not_marked_failed(self):
        # Reproduces the production case in PR description: ~152k photos,
        # 4 erroring photos. We use a 200-photo target to keep the test
        # fast — the absolute floor still applies because 5% × 200 = 10,
        # so 4 errors stays below max(10, 10) = 10.
        target = 200
        job = self._new_job(target=target)
        for i in range(target):
            failed = i < 4
            error = f"err-{i}" if failed else None
            update_scan_counter(job.job_id, failed=failed, error=error)
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(
            job.failed,
            "4 errors in 200 photos must not sticky the job-level failed flag",
        )
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertEqual(job.result["error_count"], 4)
        self.assertEqual(len(job.result["errors"]), 4)

    def test_many_errors_above_threshold_marks_failed(self):
        target = 200
        job = self._new_job(target=target)
        # 30 errors out of 200 = 15%, well above the 5% rate.
        for i in range(target):
            failed = i < 30
            error = f"err-{i}" if failed else None
            update_scan_counter(job.job_id, failed=failed, error=error)
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertTrue(job.failed)
        self.assertEqual(job.result["status"], "failed")
        self.assertEqual(job.result["error_count"], 30)

    def test_mid_run_error_does_not_sticky_failed_flag(self):
        # Single error early in a 200-photo run: job.failed must stay False
        # while the run is in progress, and result.status must become
        # 'partial_failure' so the UI can distinguish from a clean run.
        job = self._new_job(target=200)
        update_scan_counter(job.job_id, failed=True, error="boom")
        job.refresh_from_db()
        self.assertFalse(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["status"], "partial_failure")
        self.assertEqual(job.result["error_count"], 1)

    def test_error_count_survives_errors_list_cap_at_100(self):
        # The errors list is capped at 100 to bound DB-row growth, but
        # error_count must keep increasing past the cap for the threshold
        # decision.
        target = 250
        job = self._new_job(target=target)
        for i in range(target):
            failed = i < 130
            error = f"unique-error-{i}" if failed else None
            update_scan_counter(job.job_id, failed=failed, error=error)
        job.refresh_from_db()
        self.assertEqual(len(job.result["errors"]), 100, "errors list is capped")
        self.assertEqual(job.result["error_count"], 130, "but error_count is uncapped")
        self.assertTrue(job.failed)
        self.assertEqual(job.result["status"], "failed")

    def test_cancelled_job_does_not_get_failed_flag(self):
        # Pre-existing contract from test_job_cancel — cancellation
        # short-circuits before any failed/status mutation.
        job = self._new_job(target=10)
        job.cancel()
        update_scan_counter(job.job_id, failed=True, error="boom")
        job.refresh_from_db()
        self.assertTrue(job.cancelled)
        self.assertFalse(job.failed)

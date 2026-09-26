"""Concurrency tests for ``update_scan_counter``.

Scan and enrichment workers all report into one ``LongRunningJob`` row. The
counter used to read ``result`` into Python, add this worker's error and save
it back, so a second worker writing between that read and that save had its
error silently overwritten; and every worker that saw ``progress_current >=
progress_target`` re-ran the "finished" transition.

The in-memory SQLite test database cannot run two real writers at once, so the
interleaving is simulated: the second worker's whole update is injected at the
point where the first one has read ``result`` but not written it back yet.
"""

import datetime
import uuid
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.directory_watcher import utils
from api.directory_watcher.utils import update_scan_counter
from api.models import LongRunningJob
from api.tests.utils import create_test_user


class _InterleaveOnce:
    """Wrap ``_exceeds_failure_threshold`` to run ``other_worker`` mid-update.

    The threshold is evaluated after the first worker has read the job's
    ``result`` and before it writes the merged value back, which is exactly the
    window a concurrent worker used to slip into.
    """

    def __init__(self, other_worker):
        self.other_worker = other_worker
        self.fired = False
        self.real = utils._exceeds_failure_threshold

    def __call__(self, error_count, target):
        if not self.fired:
            self.fired = True
            self.other_worker()
        return self.real(error_count, target)


class ConcurrentErrorCountTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            start_now=True,
        )
        self.job.update_progress(current=0, target=100)

    def test_interleaved_errors_are_both_counted(self):
        def worker_b():
            update_scan_counter(self.job.job_id, failed=True, error="error from B")

        with patch.object(
            utils, "_exceeds_failure_threshold", _InterleaveOnce(worker_b)
        ):
            update_scan_counter(self.job.job_id, failed=True, error="error from A")

        self.job.refresh_from_db()
        self.assertEqual(self.job.progress_current, 2)
        self.assertEqual(self.job.result["error_count"], 2)
        self.assertCountEqual(
            self.job.result["errors"], ["error from A", "error from B"]
        )

    def test_interleaved_success_does_not_drop_an_error(self):
        def worker_b():
            update_scan_counter(self.job.job_id, failed=True, error="error from B")

        with patch.object(
            utils, "_exceeds_failure_threshold", _InterleaveOnce(worker_b)
        ):
            update_scan_counter(self.job.job_id, failed=True, error="error from A")
        update_scan_counter(self.job.job_id)

        self.job.refresh_from_db()
        self.assertEqual(self.job.progress_current, 3)
        self.assertEqual(self.job.result["error_count"], 2)


class FinishedTransitionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.job = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            start_now=True,
        )
        self.job.update_progress(current=0, target=1)

    def _ticking_clock(self):
        start = timezone.now()
        ticks = iter(start + datetime.timedelta(seconds=i) for i in range(1000))
        return start, (lambda: next(ticks))

    def test_counter_overshoot_does_not_finish_the_job_twice(self):
        """A worker past the target must not redo the finished transition."""
        start, clock = self._ticking_clock()
        with patch.object(utils.timezone, "now", side_effect=clock):
            update_scan_counter(self.job.job_id)
            self.job.refresh_from_db()
            first_finished_at = self.job.finished_at
            update_scan_counter(self.job.job_id)

        self.job.refresh_from_db()
        self.assertTrue(self.job.finished)
        self.assertEqual(first_finished_at, start)
        self.assertEqual(self.job.finished_at, first_finished_at)

    def test_error_after_finish_still_counts_but_does_not_refinish(self):
        start, clock = self._ticking_clock()
        with patch.object(utils.timezone, "now", side_effect=clock):
            update_scan_counter(self.job.job_id)
            update_scan_counter(self.job.job_id, failed=True, error="late")

        self.job.refresh_from_db()
        self.assertEqual(self.job.finished_at, start)
        self.assertEqual(self.job.result["error_count"], 1)

    def test_finish_runs_completion_hook_once(self):
        with patch.object(utils, "_on_job_finished") as hook:
            update_scan_counter(self.job.job_id)
            update_scan_counter(self.job.job_id)
            update_scan_counter(self.job.job_id, failed=True, error="x")
        hook.assert_called_once_with(self.job.job_id)

    def test_unknown_job_is_ignored(self):
        update_scan_counter(str(uuid.uuid4()), failed=True, error="nobody home")

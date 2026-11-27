import datetime
import uuid
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.directory_watcher import utils
from api.directory_watcher.utils import update_scan_counter
from api.models import LongRunningJob
from api.tests.utils import create_test_user


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
        # The first call reads the clock twice (progress stamp, finish); a
        # second finish would read a later tick.
        self.assertLess(first_finished_at, start + datetime.timedelta(seconds=2))
        self.assertEqual(self.job.finished_at, first_finished_at)

    def test_error_after_finish_neither_counts_nor_refinishes(self):
        start, clock = self._ticking_clock()
        with patch.object(utils.timezone, "now", side_effect=clock):
            update_scan_counter(self.job.job_id)
            update_scan_counter(self.job.job_id, failed=True, error="late")

        self.job.refresh_from_db()
        self.assertLess(self.job.finished_at, start + datetime.timedelta(seconds=2))
        self.assertEqual(self.job.progress_current, 1)
        self.assertFalse(self.job.failed)
        self.assertIsNone(self.job.result)

    def test_finish_runs_completion_hook_once(self):
        with patch.object(utils, "_on_job_finished") as hook:
            update_scan_counter(self.job.job_id)
            update_scan_counter(self.job.job_id)
            update_scan_counter(self.job.job_id, failed=True, error="x")
        hook.assert_called_once_with(self.job.job_id)

    def test_unknown_job_is_ignored(self):
        update_scan_counter(str(uuid.uuid4()), failed=True, error="nobody home")

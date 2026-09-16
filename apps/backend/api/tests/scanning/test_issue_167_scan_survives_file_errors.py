"""Regression tests for issue #167: a file that errors mid-scan must not stop
the rest of the batch, and must still be reported on the job."""

import os
import shutil
import tempfile
import uuid
from unittest.mock import patch

import pyvips
from django.test import TestCase

from api.directory_watcher.file_handlers import handle_file_group, handle_new_image
from api.models import LongRunningJob, Photo
from api.tests.utils import create_test_user

MODULE = "api.directory_watcher.file_handlers"


def _write_image(path: str, width: int = 8) -> str:
    pyvips.Image.black(width, 8).write_to_file(path)
    return path


class ScanSurvivesPerFileErrorsTests(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.tmpdir = tempfile.mkdtemp(prefix="lp-issue-167-")
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.job_id = uuid.uuid4()
        patcher = patch(f"{MODULE}.has_embedded_motion_video", return_value=False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def p(self, name: str) -> str:
        return os.path.join(self.tmpdir, name)

    def _make_job(self, target: int) -> LongRunningJob:
        return LongRunningJob.objects.create(
            started_by=self.user,
            job_id=self.job_id,
            queued_at="2021-02-11T13:52:53Z",
            started_at="2021-02-11T13:52:53Z",
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            progress_current=0,
            progress_target=target,
        )

    def test_one_failing_file_does_not_stop_the_rest_of_the_batch(self):
        """An OSError on one file must not prevent the other files importing."""
        job = self._make_job(target=3)
        paths = [_write_image(self.p(f"IMG_{i}.png"), width=10 + i) for i in range(3)]
        failing_path = paths[1]

        def flaky_process(photo, path, job_id, start):
            if path == failing_path:
                raise OSError(116, "Stale file handle")

        with patch(f"{MODULE}._process_photo", side_effect=flaky_process):
            for path in paths:
                handle_file_group(self.user, [path], self.job_id)

        # The two healthy files are still imported.
        imported = set(
            Photo.objects.filter(owner=self.user).values_list("files__path", flat=True)
        )
        self.assertIn(paths[0], imported)
        self.assertIn(paths[2], imported)

        # The job advances past the bad file and completes.
        job.refresh_from_db()
        self.assertEqual(3, job.progress_current)
        self.assertTrue(job.finished)

    def test_failing_file_is_recorded_in_the_job_result(self):
        """A swallowed per-file OSError must still surface on the job."""
        job = self._make_job(target=3)
        paths = [_write_image(self.p(f"R_{i}.png"), width=20 + i) for i in range(3)]
        failing_path = paths[1]

        def flaky_process(photo, path, job_id, start):
            if path == failing_path:
                raise OSError(116, "Stale file handle")

        with patch(f"{MODULE}._process_photo", side_effect=flaky_process):
            for path in paths:
                handle_file_group(self.user, [path], self.job_id)

        job.refresh_from_db()
        self.assertTrue(job.finished)
        result = job.result or {}
        self.assertEqual(1, result.get("error_count"))
        self.assertEqual("partial_failure", result.get("status"))
        self.assertTrue(any("Stale file handle" in e for e in result.get("errors", [])))
        # One bad file out of three is below the failure floor, so the job is
        # a partial failure, not a hard failure.
        self.assertFalse(job.failed)

    def test_handle_new_image_records_its_error_too(self):
        """The upload/metadata single-file path has the same contract."""
        job = self._make_job(target=1)
        path = _write_image(self.p("single.png"), width=31)

        with patch(
            f"{MODULE}._process_photo",
            side_effect=OSError(13, "Permission denied"),
        ):
            handle_new_image(self.user, path, self.job_id)

        job.refresh_from_db()
        self.assertEqual(1, job.progress_current)
        self.assertTrue(job.finished)
        result = job.result or {}
        self.assertEqual(1, result.get("error_count"))
        self.assertTrue(any("Permission denied" in e for e in result.get("errors", [])))

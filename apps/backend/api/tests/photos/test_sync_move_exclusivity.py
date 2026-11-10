"""A move or rename done within the request holds off a scan while it works.

Up to ``SYNC_MOVE_LIMIT`` photos move or are renamed in the request, without a
job row, so a scan started meanwhile was not refused: it read the paths the
request was changing. The request now works under a row of its own job type,
written and refused like a start (``api.jobs.start.run_in_request``).
"""

import datetime
from collections.abc import Callable
from unittest.mock import patch

from rest_framework.test import APIClient

from api.drf.exceptions import JobAlreadyRunning
from api.jobs.queue import enqueue_job
from api.models import LongRunningJob
from api.photos import moves, renames
from api.tests.photos.move_fixtures import LibraryTestCase

J = LongRunningJob


def scan(user: object, job_id: str | None = None) -> None:
    """A planted scan task."""


class SyncMoveExclusivityTest(LibraryTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        queue = patch("api.jobs.queue.AsyncTask")
        queue.start()
        self.addCleanup(queue.stop)
        self.refused: list[JobAlreadyRunning] = []

    def start_a_scan(self) -> None:
        try:
            enqueue_job(self.user, J.JOB_SCAN_PHOTOS, scan, self.user)
        except JobAlreadyRunning as refused:
            self.refused.append(refused)

    def during(self, work: Callable[..., object]) -> Callable[..., object]:
        def run(*args: object, **kwargs: object) -> object:
            self.start_a_scan()
            return work(*args, **kwargs)

        return run

    def assert_scan_held_off(self, job_type: int) -> None:
        [refused] = self.refused
        job = J.objects.get(job_id=refused.job_id)
        self.assertEqual(job.job_type, job_type)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        # Afterwards a scan starts.
        self.start_a_scan()
        self.assertEqual(len(self.refused), 1)

    def test_a_scan_started_during_a_move_is_refused(self) -> None:
        photo = self.photo()

        with patch.object(
            moves, "move_photos", side_effect=self.during(moves.move_photos)
        ):
            response = self.client.post(
                "/api/photos/move/",
                {"image_hashes": [photo.image_hash], "target_folder": self.target},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(response.json()["moved"], 1)
        self.assert_scan_held_off(J.JOB_MOVE_PHOTOS)

    def test_a_scan_started_during_a_rename_is_refused(self) -> None:
        photo = self.photo(taken=datetime.datetime(2024, 5, 1, 12, 0, 0))

        with patch.object(
            renames, "rename_photos", side_effect=self.during(renames.rename_photos)
        ):
            response = self.client.post(
                "/api/photos/rename/",
                {"image_hashes": [photo.image_hash], "pattern": "{year}_{hour}"},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assert_scan_held_off(J.JOB_RENAME_PHOTOS)

    def test_a_failed_move_fails_its_row(self) -> None:
        photo = self.photo()

        with (
            patch.object(moves, "move_photos", side_effect=RuntimeError("disk gone")),
            self.assertRaises(RuntimeError),
        ):
            self.client.post(
                "/api/photos/move/",
                {"image_hashes": [photo.image_hash], "target_folder": self.target},
                format="json",
            )

        job = J.objects.get(job_type=J.JOB_MOVE_PHOTOS)
        self.assertTrue(job.failed)
        self.start_a_scan()
        self.assertEqual(self.refused, [])

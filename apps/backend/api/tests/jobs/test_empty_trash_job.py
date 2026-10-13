"""Empty trash: ``POST /api/photosedit/empty-trash/`` and its job (#2203).

Delete permanently on a select-all deletes in the request; Empty trash answers
at once and deletes the requester's trashed photos, and only theirs, in a job.
"""

import json
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import LongRunningJob, Photo
from api.models.long_running_job import JobCancelledError
from api.photos import files
from api.photos.retention import MAX_JOB_ERRORS, empty_trash_job
from api.tests.utils import (
    api_error,
    create_test_job,
    create_test_photo,
    create_test_user,
)

URL = "/api/photosedit/empty-trash/"


def _removed(photo):
    return Photo.objects.get(pk=photo.pk).removed


class EmptyTrashJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.trashed = [
            create_test_photo(owner=self.user, in_trashcan=True) for _ in range(3)
        ]

    def run_job(self, user=None):
        user = user or self.user
        job = create_test_job(user, LongRunningJob.JOB_EMPTY_TRASH)
        empty_trash_job(user, job_id=job.job_id)
        job.refresh_from_db()
        return job

    def test_deletes_every_trashed_photo_and_completes(self):
        job = self.run_job()

        self.assertTrue(all(_removed(photo) for photo in self.trashed))
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual((job.progress_current, job.progress_target), (3, 3))
        self.assertEqual(
            job.result,
            {"status": "completed", "deleted": 3, "failed_count": 0, "failed": []},
        )

    def test_only_the_users_own_trash_is_emptied(self):
        other_user = create_test_user()
        others_trash = create_test_photo(owner=other_user, in_trashcan=True)
        own_kept = create_test_photo(owner=self.user)

        self.run_job()

        self.assertFalse(_removed(others_trash))
        self.assertTrue(Photo.objects.get(pk=others_trash.pk).in_trashcan)
        self.assertFalse(_removed(own_kept))

    def test_an_empty_trash_completes_with_nothing_deleted(self):
        job = self.run_job(create_test_user())

        self.assertFalse(job.failed)
        self.assertEqual(job.result["deleted"], 0)
        self.assertEqual(job.progress_target, 0)

    def test_a_photo_that_fails_is_skipped_and_fails_the_job(self):
        broken = self.trashed[0]
        real_remove = files.remove_photo

        def remove(photo):
            if photo.pk == broken.pk:
                raise PermissionError("read-only library")
            real_remove(photo)

        with (
            mock.patch.object(files, "remove_photo", remove),
            self.assertLogs("api.photos.files", "ERROR"),
        ):
            job = self.run_job()

        self.assertFalse(_removed(broken))
        self.assertTrue(all(_removed(photo) for photo in self.trashed[1:]))
        self.assertTrue(job.failed)
        self.assertEqual(job.result["deleted"], 2)
        self.assertEqual(job.result["failed_count"], 1)
        self.assertEqual(job.result["failed"], [broken.image_hash])
        self.assertIn("1 could not be deleted", job.result["error"])

    def test_the_result_lists_only_the_first_failed_photos(self):
        for _ in range(MAX_JOB_ERRORS):
            create_test_photo(owner=self.user, in_trashcan=True)

        with (
            mock.patch.object(
                files, "remove_photo", side_effect=PermissionError("read-only")
            ),
            self.assertLogs("api.photos.files", "ERROR"),
        ):
            job = self.run_job()

        self.assertEqual(job.result["failed_count"], MAX_JOB_ERRORS + 3)
        self.assertEqual(len(job.result["failed"]), MAX_JOB_ERRORS)

    def test_a_job_cancelled_while_queued_does_nothing(self):
        job = create_test_job(self.user, LongRunningJob.JOB_EMPTY_TRASH)
        job.cancel()

        empty_trash_job(self.user, job_id=job.job_id)

        self.assertFalse(any(_removed(photo) for photo in self.trashed))

    def test_a_cancel_stops_after_the_current_photo(self):
        calls = []

        def stop(job):
            calls.append(job)
            raise JobCancelledError(job.job_id)

        with mock.patch.object(LongRunningJob, "stop_if_cancelled", stop):
            job = self.run_job()

        self.assertEqual(len(calls), 1)
        self.assertEqual(sum(_removed(photo) for photo in self.trashed), 1)
        self.assertFalse(job.finished)


class EmptyTrashViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()

    def test_starts_the_job_for_the_requester(self):
        self.client.force_authenticate(user=self.user)
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 200, response.content)
        job_id = response.json()["job_id"]
        job = LongRunningJob.objects.get(job_id=job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_EMPTY_TRASH)
        self.assertEqual(job.started_by, self.user)
        self.assertEqual(async_task.call_args.args, (empty_trash_job, self.user))
        self.assertEqual(async_task.call_args.kwargs["job_id"], job_id)

    def test_a_second_start_while_it_runs_is_refused(self):
        running = create_test_job(self.user, LongRunningJob.JOB_EMPTY_TRASH)
        self.client.force_authenticate(user=self.user)

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertIn(running.job_id, json.dumps(response.json()))
        async_task.assert_not_called()

    def test_another_users_running_job_does_not_block(self):
        create_test_job(create_test_user(), LongRunningJob.JOB_EMPTY_TRASH)
        self.client.force_authenticate(user=self.user)

        with mock.patch("api.jobs.queue.AsyncTask"):
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 200, response.content)

    def test_an_anonymous_request_is_refused(self):
        response = self.client.post(URL)

        self.assertEqual(response.status_code, 401)
        self.assertFalse(LongRunningJob.objects.exists())

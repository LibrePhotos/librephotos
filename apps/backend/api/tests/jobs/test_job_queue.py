"""Jobs get their row when they are queued (``api.jobs.queue``, issue #2333).

The row used to be written by the worker when it picked the task up, so
between the click and that moment the job did not exist: ``/api/rqavailable/``
reported the queue free and a second click queued the same job again. These
tests pin the request-side half (row first, duplicate starts refused) and the
worker-side half (the task claims the row, and skips a job cancelled while it
waited).

django-q's ``AsyncTask`` is patched in ``api.jobs.queue``: no task runs.
"""

import datetime
import shutil
import tempfile
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.albums.auto_albums import generate_event_albums
from api.directory_watcher.processing_jobs import (
    _limit_to_photos_added_since_last_scan,
)
from api.duplicates.detection import batch_detect_duplicates
from api.jobs.queue import JobStep, enqueue_chain, enqueue_job
from api.models import LongRunningJob, Photo
from api.search.embedding_jobs import batch_calculate_clip_embedding
from api.stacks.detection import batch_detect_stacks
from api.tests.utils import (
    api_error,
    create_test_job,
    create_test_photo,
    create_test_user,
)


def task_without_job_id(user):
    """A planted task that cannot claim a row."""


def task_with_job_id(user, job_id, full_scan=False):
    """A planted task that can."""


class ScanQueuedTest(TestCase):
    def setUp(self):
        self.scan_directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.scan_directory, True)
        self.user = create_test_user(scan_directory=self.scan_directory)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        models = patch("api.ml_models.do_all_models_exist", return_value=True)
        models.start()
        self.addCleanup(models.stop)

    def test_the_row_exists_before_the_task_runs(self):
        with patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post("/api/scanphotos/")

        self.assertEqual(response.status_code, 200)
        # The commit hooks never ran: nothing reached the broker.
        async_task.assert_not_called()
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(job.job_type, LongRunningJob.JOB_SCAN_PHOTOS)
        self.assertIsNone(job.started_at)
        self.assertFalse(job.finished)

        availability = self.client.get("/api/rqavailable/").json()
        self.assertFalse(availability["queue_can_accept_job"])
        self.assertEqual(availability["job_detail"]["job_id"], job.job_id)

    def test_a_second_start_while_queued_is_a_409_with_the_first_job_id(self):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            first = self.client.post("/api/scanphotos/")
            second = self.client.post("/api/scanphotos/")
            # A full scan is not quietly turned into the incremental one.
            full = self.client.post("/api/fullscanphotos/")

        self.assertEqual(first.status_code, 200)
        first_id = first.json()["job_id"]
        for response in (second, full):
            self.assertEqual(response.status_code, 409)
            error = api_error(response)
            self.assertEqual(error["code"], "job_already_running")
            self.assertEqual(error["job_id"], first_id)
            self.assertTrue(error["message"])
        self.assertEqual(async_task.call_count, 1)
        self.assertEqual(LongRunningJob.objects.count(), 1)

    def test_another_users_job_does_not_block_a_start(self):
        create_test_job(
            started_by=create_test_user(), job_type=LongRunningJob.JOB_SCAN_PHOTOS
        )
        with patch("api.jobs.queue.AsyncTask"):
            response = self.client.post("/api/scanphotos/")
        self.assertEqual(response.status_code, 200)

    def test_a_finished_or_stuck_job_does_not_block_a_start(self):
        create_test_job(
            started_by=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            finished=True,
        )
        create_test_job(
            started_by=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            queued_at=timezone.now()
            - datetime.timedelta(hours=LongRunningJob.STUCK_JOB_HOURS + 1),
        )
        with patch("api.jobs.queue.AsyncTask"):
            response = self.client.post("/api/scanphotos/")
        self.assertEqual(response.status_code, 200)


class DetectionJobIdTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_duplicate_detection_returns_its_job_and_the_task_uses_that_row(self):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post("/api/duplicates/detect", {}, format="json")

        self.assertEqual(response.status_code, 202)
        job_id = response.json()["job_id"]
        self.assertEqual(async_task.call_args.kwargs["job_id"], job_id)

        options = async_task.call_args.args[2]
        batch_detect_duplicates(self.user, options, job_id=job_id)

        job = LongRunningJob.objects.get()
        self.assertEqual(job.job_id, job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_DETECT_DUPLICATES)
        self.assertIsNotNone(job.started_at)
        self.assertTrue(job.finished)

    def test_stack_detection_returns_its_job_and_the_task_uses_that_row(self):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post("/api/stacks/detect/", {}, format="json")

        self.assertEqual(response.status_code, 202)
        job_id = response.json()["job_id"]
        batch_detect_stacks(self.user, async_task.call_args.args[2], job_id=job_id)

        job = LongRunningJob.objects.get()
        self.assertEqual(job.job_id, job_id)
        self.assertIsNotNone(job.started_at)
        self.assertTrue(job.finished)


class EnqueueJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_a_task_without_a_job_id_parameter_is_refused_before_any_row(self):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            with self.assertRaises(TypeError):
                enqueue_job(
                    self.user,
                    LongRunningJob.JOB_SCAN_PHOTOS,
                    task_without_job_id,
                    self.user,
                )
        async_task.assert_not_called()
        self.assertFalse(LongRunningJob.objects.exists())

    def test_a_positional_argument_landing_on_job_id_is_refused(self):
        # task_with_job_id(user, job_id, full_scan): full_scan must be named.
        with self.assertRaises(TypeError):
            enqueue_job(
                self.user,
                LongRunningJob.JOB_SCAN_PHOTOS,
                task_with_job_id,
                self.user,
                True,
            )
        self.assertFalse(LongRunningJob.objects.exists())

    def test_the_task_gets_the_rows_id_by_name(self):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            job = enqueue_job(
                self.user,
                LongRunningJob.JOB_SCAN_PHOTOS,
                task_with_job_id,
                self.user,
                full_scan=True,
            )
        async_task.assert_called_once_with(
            task_with_job_id, self.user, job_id=job.job_id, full_scan=True
        )

    def test_a_non_exclusive_job_is_never_refused(self):
        for _ in range(2):
            enqueue_job(
                self.user,
                LongRunningJob.JOB_DOWNLOAD_PHOTOS,
                task_with_job_id,
                self.user,
                exclusive=False,
            )
        self.assertEqual(LongRunningJob.objects.count(), 2)

    def test_a_chain_writes_every_row_up_front(self):
        with (
            patch("api.jobs.queue.Chain") as chain,
            self.captureOnCommitCallbacks(execute=True),
        ):
            jobs = enqueue_chain(
                self.user,
                [
                    JobStep(
                        LongRunningJob.JOB_SCAN_FACES, task_with_job_id, (self.user,)
                    ),
                    JobStep(
                        LongRunningJob.JOB_TRAIN_FACES, task_with_job_id, (self.user,)
                    ),
                ],
            )
        self.assertEqual(
            [job.job_type for job in jobs],
            [LongRunningJob.JOB_SCAN_FACES, LongRunningJob.JOB_TRAIN_FACES],
        )
        self.assertEqual(
            [c.kwargs["job_id"] for c in chain.return_value.append.call_args_list],
            [job.job_id for job in jobs],
        )
        chain.return_value.run.assert_called_once_with()


class ClaimTest(TestCase):
    """The task's side: one conditional update marks the queued row started."""

    def setUp(self):
        self.user = create_test_user()

    def queued(self, job_type=LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS):
        return create_test_job(started_by=self.user, job_type=job_type)

    def test_the_claim_is_one_conditional_update(self):
        job = self.queued()
        with self.assertNumQueries(2):  # the UPDATE, then reading the row back
            claimed = LongRunningJob.claim(self.user, job.job_type, job.job_id)
        self.assertEqual(claimed.pk, job.pk)
        self.assertIsNotNone(claimed.started_at)

    def test_a_row_is_claimed_once(self):
        job = self.queued()
        self.assertIsNotNone(LongRunningJob.claim(self.user, job.job_type, job.job_id))
        # A second delivery of the same task finds it started.
        self.assertIsNone(LongRunningJob.claim(self.user, job.job_type, job.job_id))

    def test_a_job_cancelled_while_queued_does_no_work(self):
        job = self.queued()
        job.cancel()
        create_test_photo(owner=self.user)

        with patch("api.search.embedding_jobs.store_clip_embeddings") as store:
            batch_calculate_clip_embedding(self.user, job_id=job.job_id)

        store.assert_not_called()
        job.refresh_from_db()
        self.assertIsNone(job.started_at)
        self.assertTrue(job.cancelled)
        self.assertEqual(LongRunningJob.objects.count(), 1)

    def test_a_job_failed_by_the_stuck_job_cleanup_does_no_work(self):
        job = self.queued(LongRunningJob.JOB_GENERATE_AUTO_ALBUMS)
        LongRunningJob.objects.filter(pk=job.pk).update(
            queued_at=timezone.now()
            - datetime.timedelta(hours=LongRunningJob.STUCK_JOB_HOURS + 1)
        )
        LongRunningJob.cleanup_stuck_jobs()

        with patch("api.albums.auto_albums._group_photos") as group:
            self.assertEqual(generate_event_albums(self.user, job.job_id), 0)
        group.assert_not_called()

    def test_a_task_queued_before_the_upgrade_still_gets_a_row(self):
        with self.assertLogs("api.models.long_running_job", level="WARNING"):
            job = LongRunningJob.claim(
                self.user, LongRunningJob.JOB_SCAN_PHOTOS, "queued-before-rows"
            )
        self.assertEqual(job.job_id, "queued-before-rows")
        self.assertIsNotNone(job.started_at)

    def test_without_an_id_a_started_row_is_written(self):
        # A job chained in front of another, such as the model download.
        job = LongRunningJob.claim(self.user, LongRunningJob.JOB_DOWNLOAD_MODELS, None)
        self.assertIsNotNone(job.started_at)
        self.assertEqual(job.job_type, LongRunningJob.JOB_DOWNLOAD_MODELS)


class NeverStartedBaselineTest(TestCase):
    """A run cancelled while queued finished without starting: not a baseline."""

    def test_the_incremental_photo_jobs_skip_a_never_started_run(self):
        user = create_test_user()
        old = create_test_photo(owner=user)
        Photo.objects.filter(pk=old.pk).update(
            added_on=timezone.now() - datetime.timedelta(days=3)
        )
        new = create_test_photo(owner=user)
        create_test_job(
            started_by=user,
            job_type=LongRunningJob.JOB_SCAN_FACES,
            started_at=timezone.now() - datetime.timedelta(days=2),
            finished=True,
            finished_at=timezone.now() - datetime.timedelta(days=2),
        )
        create_test_job(
            started_by=user, job_type=LongRunningJob.JOB_SCAN_FACES
        ).cancel()

        photos = _limit_to_photos_added_since_last_scan(
            Photo.objects.owned_by(user), user, LongRunningJob.JOB_SCAN_FACES, False
        )

        self.assertEqual(list(photos), [new])

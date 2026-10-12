"""Starting a background job from a request.

Every job-starting view used to wrap the enqueue in ``except BaseException``
and answer ``{"status": False}`` with HTTP 200 when the queue was down, so a
client saw a success status code for a job that never started. They now share
``start_job`` (over ``api.jobs.queue``), which writes the job's row, queues
the task once the row is committed, and answers 500 with a message when the
queue refuses it.

The task is handed to django-q in ``transaction.on_commit``. A ``TestCase``
never commits, so the success tests run the callbacks with
``captureOnCommitCallbacks``; the failure tests are ``TransactionTestCase``s,
where the request's own commit queues the task as in production.
"""

import shutil
import tempfile
from unittest.mock import patch

from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.tests.utils import api_error, create_test_user

ASYNC_JOB_URLS = (
    "/api/deletemissingphotos/",
    "/api/classifymedia/",
    "/api/generateocr/",
)
SCAN_URLS = (
    "/api/scanphotos/",
    "/api/fullscanphotos/",
    "/api/scanuploadedphotos/",
)


class StartJobTest(TestCase):
    def setUp(self):
        self.scan_directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.scan_directory, True)
        self.user = create_test_user(scan_directory=self.scan_directory)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_async_job_start_success_returns_the_job_id(self):
        for url in ASYNC_JOB_URLS:
            with self.subTest(url=url):
                with (
                    patch("api.jobs.queue.AsyncTask") as async_task,
                    self.captureOnCommitCallbacks(execute=True),
                ):
                    response = self.client.post(url)
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertTrue(data["status"])
                self.assertEqual(async_task.call_args.kwargs["job_id"], data["job_id"])
                async_task.return_value.run.assert_called_once_with()
                # Finish it, so the next URL is not refused as a duplicate.
                LongRunningJob.objects.filter(job_id=data["job_id"]).update(
                    finished=True
                )


class StartJobFailureTest(TransactionTestCase):
    """The queue refuses the task: a 500, and the row is not left queued."""

    def setUp(self):
        self.scan_directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.scan_directory, True)
        self.user = create_test_user(scan_directory=self.scan_directory)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def assertNothingLeftQueued(self):
        self.assertFalse(LongRunningJob.objects.filter(finished=False).exists())
        self.assertTrue(
            all(job.failed for job in LongRunningJob.objects.all()),
            "a job whose task could not be queued is marked failed",
        )

    def test_async_job_start_failure_is_a_500_with_a_message(self):
        for url in ASYNC_JOB_URLS:
            with self.subTest(url=url):
                with patch(
                    "api.jobs.queue.AsyncTask", side_effect=RuntimeError("queue down")
                ):
                    response = self.client.post(url)
                self.assertEqual(response.status_code, 500)
                self.assertEqual(api_error(response)["code"], "job_start_failed")
                self.assertTrue(api_error(response)["message"])
                self.assertNotIn("job_id", response.json())
                self.assertNothingLeftQueued()

    def test_scan_start_failure_is_a_500_with_a_message(self):
        for url in SCAN_URLS:
            with self.subTest(url=url):
                with (
                    patch("api.jobs.queue.AsyncTask") as async_task,
                    patch(
                        "api.runtime.ml_models.do_all_models_exist", return_value=True
                    ),
                ):
                    async_task.return_value.run.side_effect = RuntimeError("down")
                    response = self.client.post(url)
                self.assertEqual(response.status_code, 500)
                self.assertTrue(api_error(response)["message"])
                self.assertNothingLeftQueued()

    def test_a_non_exception_base_exception_is_not_swallowed(self):
        with patch("api.jobs.queue.AsyncTask", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.client.post("/api/deletemissingphotos/")

    def test_auto_album_start_failure_is_a_500(self):
        for url in ("/api/autoalbumgen/", "/api/autoalbumtitlegen/"):
            with self.subTest(url=url):
                with patch(
                    "api.jobs.queue.AsyncTask", side_effect=RuntimeError("down")
                ):
                    response = self.client.post(url)
                self.assertEqual(response.status_code, 500)
                self.assertTrue(api_error(response)["message"])
                self.assertNothingLeftQueued()

    @override_settings(FEATURE_FACE_DETECTION=True)
    def test_face_scan_start_failure_is_a_500(self):
        with (
            patch("api.jobs.queue.Chain") as chain,
            patch("api.runtime.ml_models.do_all_models_exist", return_value=False),
        ):
            chain.return_value.run.side_effect = RuntimeError("down")
            response = self.client.post("/api/scanfaces/")
        self.assertEqual(response.status_code, 500)
        self.assertTrue(api_error(response)["message"])
        self.assertNothingLeftQueued()

    @override_settings(FEATURE_FACE_CLUSTER=True)
    def test_face_training_start_failure_is_a_500(self):
        # It answered 200 {"status": false}, which web and mobile showed as
        # "training started" (#2325).
        with (
            patch("api.jobs.queue.Chain") as chain,
            patch("api.runtime.ml_models.do_all_models_exist", return_value=True),
        ):
            chain.return_value.run.side_effect = RuntimeError("down")
            response = self.client.post("/api/trainfaces/")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(api_error(response)["code"], "job_start_failed")
        self.assertNotIn("job_id", response.json())
        # Both rows of the chain (embeddings, clustering) are failed.
        self.assertEqual(LongRunningJob.objects.filter(failed=True).count(), 2)
        self.assertNothingLeftQueued()


class OtherJobStartersTest(TestCase):
    """The auto-album and face starters share ``start_job`` too."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_auto_album_start_returns_the_job_id(self):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post("/api/autoalbumgen/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            async_task.call_args.kwargs["job_id"], response.json()["job_id"]
        )

    @override_settings(FEATURE_FACE_CLUSTER=True)
    def test_face_training_queues_both_jobs_and_returns_both_ids(self):
        with (
            patch("api.jobs.queue.Chain") as chain,
            patch("api.runtime.ml_models.do_all_models_exist", return_value=True),
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post("/api/trainfaces/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        embeddings_id, clustering_id = data["job_ids"]
        self.assertEqual(data["job_id"], clustering_id)
        rows = {
            job.job_id: job.job_type
            for job in LongRunningJob.objects.filter(started_by=self.user)
        }
        self.assertEqual(
            rows,
            {
                embeddings_id: LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS,
                clustering_id: LongRunningJob.JOB_CLUSTER_ALL_FACES,
            },
        )
        queued = [c.kwargs["job_id"] for c in chain.return_value.append.call_args_list]
        self.assertEqual(queued, [embeddings_id, clustering_id])


class FullScanValidatesScanDirectoryTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _full_scan(self, scan_directory):
        user = create_test_user(scan_directory=scan_directory)
        self.client.force_authenticate(user=user)
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post("/api/fullscanphotos/")
        return response, async_task

    def test_rejects_a_missing_scan_directory(self):
        response, async_task = self._full_scan("")
        self.assertEqual(response.status_code, 400)
        self.assertIn("No scan directory", api_error(response)["message"])
        async_task.assert_not_called()
        self.assertFalse(LongRunningJob.objects.exists())

    def test_rejects_a_scan_directory_that_does_not_exist(self):
        response, async_task = self._full_scan("/definitely/not/a/real/dir")
        self.assertEqual(response.status_code, 400)
        self.assertIn("does not exist", api_error(response)["message"])
        async_task.assert_not_called()

    def test_starts_a_full_scan_of_a_valid_directory(self):
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        with patch("api.runtime.ml_models.do_all_models_exist", return_value=True):
            response, async_task = self._full_scan(directory)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["status"])
        func, user, full_scan = async_task.call_args.args
        self.assertTrue(full_scan)
        self.assertEqual(async_task.call_args.kwargs["scan_directory"], directory)
        self.assertEqual(
            async_task.call_args.kwargs["job_id"], response.json()["job_id"]
        )

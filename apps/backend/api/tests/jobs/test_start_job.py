"""Starting a background job from a request.

Every job-starting view used to wrap the enqueue in ``except BaseException``
and answer ``{"status": False}`` with HTTP 200 when the queue was down, so a
client saw a success status code for a job that never started. They now share
``start_job``, which answers 500 with a message instead.
"""

import shutil
import tempfile
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

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

    def test_async_job_start_failure_is_a_500_with_a_message(self):
        for url in ASYNC_JOB_URLS:
            with self.subTest(url=url):
                with patch(
                    "api.views.views.AsyncTask", side_effect=RuntimeError("queue down")
                ):
                    response = self.client.post(url)
                self.assertEqual(response.status_code, 500)
                data = response.json()
                self.assertFalse(data["status"])
                self.assertTrue(data["message"])
                self.assertNotIn("job_id", data)

    def test_async_job_start_success_returns_the_job_id(self):
        for url in ASYNC_JOB_URLS:
            with self.subTest(url=url):
                with patch("api.views.views.AsyncTask") as async_task:
                    response = self.client.post(url)
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertTrue(data["status"])
                # (task, user, job_id, ...) for every one of these jobs
                self.assertEqual(str(async_task.call_args.args[2]), data["job_id"])
                async_task.return_value.run.assert_called_once_with()

    def test_scan_start_failure_is_a_500_with_a_message(self):
        for url in SCAN_URLS:
            with self.subTest(url=url):
                with (
                    patch("api.views.views.Chain") as chain,
                    patch("api.views.views.do_all_models_exist", return_value=True),
                ):
                    chain.return_value.run.side_effect = RuntimeError("queue down")
                    response = self.client.post(url)
                self.assertEqual(response.status_code, 500)
                self.assertFalse(response.json()["status"])
                self.assertTrue(response.json()["message"])

    def test_a_non_exception_base_exception_is_not_swallowed(self):
        with patch("api.views.views.AsyncTask", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.client.post("/api/deletemissingphotos/")


class FullScanValidatesScanDirectoryTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _full_scan(self, scan_directory):
        user = create_test_user(scan_directory=scan_directory)
        self.client.force_authenticate(user=user)
        with patch("api.views.views.Chain") as chain:
            response = self.client.post("/api/fullscanphotos/")
        return response, chain

    def test_rejects_a_missing_scan_directory(self):
        response, chain = self._full_scan("")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()["status"])
        self.assertIn("No scan directory", response.json()["message"])
        chain.return_value.run.assert_not_called()

    def test_rejects_a_scan_directory_that_does_not_exist(self):
        response, chain = self._full_scan("/definitely/not/a/real/dir")
        self.assertEqual(response.status_code, 400)
        self.assertIn("does not exist", response.json()["message"])
        chain.return_value.run.assert_not_called()

    def test_starts_a_full_scan_of_a_valid_directory(self):
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        with patch("api.views.views.do_all_models_exist", return_value=True):
            response, chain = self._full_scan(directory)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["status"])
        func, user, full_scan, job_id, scan_dir = (
            chain.return_value.append.call_args.args
        )
        self.assertTrue(full_scan)
        self.assertEqual(scan_dir, directory)
        self.assertEqual(str(job_id), response.json()["job_id"])

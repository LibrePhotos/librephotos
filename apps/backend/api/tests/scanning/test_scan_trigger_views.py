"""Characterization tests for the scan-trigger views (unit 40).

Pins the behaviour of:

* ``api.views.scan_triggers.ScanPhotosView._scan_photos`` (reached via both GET and
  POST on ``/api/scanphotos``)

Nothing heavy runs: django-q's ``AsyncTask`` and ``Chain`` are patched in
``api.jobs.queue`` (the one module that queues), ``scan_photos`` at its import
site in ``api.views.scan_triggers`` and ``do_all_models_exist`` in
``api.ml_models``, so no broker, no filesystem walking and no model downloads
happen. The task is queued on commit; the tests run those callbacks.
"""

import os
import tempfile
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from api.ml_models import download_models
from api.models import LongRunningJob
from api.tests.utils import api_error, create_test_user
from api.views.scan_triggers import ScanPhotosView

MODULE = "api.views.scan_triggers"

NO_DIR_MESSAGE = (
    "Scan failed: No scan directory configured. Please contact your "
    "administrator to set up a scan directory for your account."
)


class RecordingChain:
    """Stand-in for django-q's ``Chain`` (and, via ``RecordingTask``, ``AsyncTask``).

    Records every ``append`` so tests can assert on the queued tasks without
    touching a broker.  ``instances`` collects every chain or task queued.
    """

    instances = []
    run_error = None

    def __init__(self, *args, **kwargs):
        self.appended = []
        self.ran = False
        RecordingChain.instances.append(self)

    def append(self, *args, **kwargs):
        self.appended.append((args, kwargs))
        return len(self.appended)

    def run(self):
        self.ran = True
        if RecordingChain.run_error is not None:
            raise RecordingChain.run_error
        return "chain-group-id"


class RecordingTask(RecordingChain):
    """Stand-in for ``AsyncTask``: a chain of one."""

    def __init__(self, func, *args, **kwargs):
        super().__init__()
        self.append(func, *args, **kwargs)


class ScanViewTestBase(TestCase):
    """Shared plumbing: a temp scan directory and a patched view environment."""

    def setUp(self):
        self.factory = APIRequestFactory()
        self._tmp = tempfile.TemporaryDirectory()
        self.scan_directory = self._tmp.name
        self.addCleanup(self._tmp.cleanup)
        self.user = create_test_user(scan_directory=self.scan_directory)
        RecordingChain.instances = []
        RecordingChain.run_error = None

    def call_view(
        self,
        view_class,
        method="get",
        user=None,
        models_exist=True,
        run_error=None,
    ):
        RecordingChain.instances = []
        RecordingChain.run_error = run_error
        request = getattr(self.factory, method)("/api/scanphotos")
        force_authenticate(request, user=user if user is not None else self.user)
        with (
            patch("api.jobs.queue.Chain", RecordingChain),
            patch("api.jobs.queue.AsyncTask", RecordingTask),
            patch("api.ml_models.do_all_models_exist", return_value=models_exist),
            patch(f"{MODULE}.scan_photos", autospec=True) as scan_photos,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self.scan_photos_mock = scan_photos
            response = view_class.as_view()(request)
        return response

    @property
    def chain(self):
        self.assertEqual(len(RecordingChain.instances), 1)
        return RecordingChain.instances[0]


class ScanPhotosViewValidationTest(ScanViewTestBase):
    """The two guard clauses at the top of ``_scan_photos``."""

    def test_missing_scan_directory_returns_400(self):
        user = create_test_user(scan_directory="")
        response = self.call_view(ScanPhotosView, user=user)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["message"], NO_DIR_MESSAGE)
        # Nothing is queued, and no row written, on the guard path.
        self.assertEqual(RecordingChain.instances, [])
        self.assertFalse(LongRunningJob.objects.exists())
        self.scan_photos_mock.assert_not_called()

    def test_whitespace_only_scan_directory_returns_400(self):
        # ``.strip() == ""`` catches whitespace-only directories.
        user = create_test_user(scan_directory="   ")
        response = self.call_view(ScanPhotosView, user=user)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["message"], NO_DIR_MESSAGE)
        self.assertEqual(RecordingChain.instances, [])

    def test_nonexistent_scan_directory_returns_400_with_path_in_message(self):
        missing = os.path.join(self.scan_directory, "definitely-not-here")
        user = create_test_user(scan_directory=missing)
        response = self.call_view(ScanPhotosView, user=user)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            api_error(response)["message"],
            f"Scan failed: Scan directory '{missing}' does not exist. "
            "Please contact your administrator.",
        )
        self.assertEqual(RecordingChain.instances, [])

    def test_directory_that_is_a_file_passes_the_existence_check(self):
        # Current behaviour quirk: the guard uses ``os.path.exists``, not
        # ``os.path.isdir`` -- a plain file is accepted and handed to
        # ``scan_photos``.
        file_path = os.path.join(self.scan_directory, "not-a-directory.txt")
        with open(file_path, "w") as handle:
            handle.write("x")
        user = create_test_user(scan_directory=file_path)

        response = self.call_view(ScanPhotosView, user=user)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["status"])
        self.assertEqual(self.chain.appended[0][1]["scan_directory"], file_path)


class ScanPhotosViewHappyPathTest(ScanViewTestBase):
    def test_models_present_queues_only_scan_photos_and_returns_job_id(self):
        response = self.call_view(ScanPhotosView, models_exist=True)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["status"])
        job_id = response.data["job_id"]
        self.assertIsInstance(job_id, str)
        self.assertEqual(set(response.data), {"status", "job_id", "job_ids"})
        self.assertEqual(response.data["job_ids"], [job_id])

        chain = self.chain
        self.assertTrue(chain.ran)
        self.assertEqual(len(chain.appended), 1)
        args, kwargs = chain.appended[0]
        # (scan_photos, user, full_scan); job_id and the directory by name
        self.assertIs(args[0], self.scan_photos_mock)
        self.assertEqual(args[1], self.user)
        self.assertFalse(args[2])
        self.assertEqual(
            kwargs, {"job_id": job_id, "scan_directory": self.scan_directory}
        )

    def test_missing_models_prepends_download_models(self):
        response = self.call_view(ScanPhotosView, models_exist=False)

        self.assertEqual(response.status_code, 200)
        chain = self.chain
        self.assertEqual(len(chain.appended), 2)
        first_args, first_kwargs = chain.appended[0]
        self.assertIs(first_args[0], download_models)
        self.assertEqual(first_args[1], self.user)
        # The download writes its own row when it runs.
        self.assertEqual(first_kwargs, {})
        self.assertIs(chain.appended[1][0][0], self.scan_photos_mock)

    def test_post_and_get_share_the_same_implementation(self):
        post_response = self.call_view(ScanPhotosView, method="post")
        post_chain = self.chain
        LongRunningJob.objects.update(finished=True)
        get_response = self.call_view(ScanPhotosView, method="get")
        get_chain = self.chain

        self.assertEqual(post_response.status_code, get_response.status_code)
        self.assertTrue(post_response.data["status"])
        self.assertTrue(get_response.data["status"])
        # Fresh uuid4 per call -- job ids never repeat.
        self.assertNotEqual(post_response.data["job_id"], get_response.data["job_id"])
        self.assertEqual(
            [a[1]["scan_directory"] for a in post_chain.appended],
            [a[1]["scan_directory"] for a in get_chain.appended],
        )

    def test_the_job_row_exists_when_the_view_answers(self):
        response = self.call_view(ScanPhotosView)

        self.assertTrue(response.data["status"])
        # Written by the request, not by the worker when it picks the task up.
        job = LongRunningJob.objects.get(job_id=response.data["job_id"])
        self.assertEqual(job.job_type, LongRunningJob.JOB_SCAN_PHOTOS)
        self.assertEqual(job.started_by, self.user)
        self.assertIsNone(job.started_at)
        self.assertFalse(job.finished)


class ScanPhotosViewErrorPathTest(ScanViewTestBase):
    """Queuing fails.

    Under a ``TestCase`` the commit hooks run when ``captureOnCommitCallbacks``
    exits, after the view answered, so the error surfaces there;
    ``api/tests/jobs/test_start_job.py`` checks the 500 of a real commit.
    """

    def test_queue_failure_propagates_and_fails_the_row(self):
        with self.assertRaises(RuntimeError):
            self.call_view(ScanPhotosView, run_error=RuntimeError("broker down"))

        job = LongRunningJob.objects.get()
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertIn("broker down", job.result["error"])

    def test_non_exception_baseexception_is_not_swallowed(self):
        # ``except Exception``: KeyboardInterrupt/SystemExit propagate.
        with self.assertRaises(KeyboardInterrupt):
            self.call_view(ScanPhotosView, run_error=KeyboardInterrupt())


class ScanPhotosViewAuthTest(TestCase):
    def test_unauthenticated_request_is_rejected_before_the_body_runs(self):
        factory = APIRequestFactory()
        request = factory.get("/api/scanphotos")
        with patch("api.jobs.queue.AsyncTask", RecordingTask):
            RecordingChain.instances = []
            response = ScanPhotosView.as_view()(request)

        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(RecordingChain.instances, [])
        self.assertFalse(LongRunningJob.objects.exists())

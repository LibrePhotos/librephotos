"""Characterization tests for the scan-trigger views (unit 40).

Pins the CURRENT behaviour of:

* ``api.views.views.ScanPhotosView._scan_photos`` (reached via both GET and
  POST on ``/api/scanphotos``)
* ``api.views.views.SelectiveScanPhotosView.get``

The two bodies are near-identical copies; the only difference is the
directory handed to ``scan_photos``: the plain view passes
``user.scan_directory``, the selective view passes
``<scan_directory>/uploads/web``.

Nothing heavy runs: ``Chain``, ``scan_photos``, ``do_all_models_exist`` and
``download_models`` are all patched at their import site in
``api.views.views``, so no django-q broker, no filesystem walking and no model
downloads happen.
"""

import os
import tempfile
import uuid
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from api.tests.utils import create_test_user
from api.views.views import ScanPhotosView, SelectiveScanPhotosView

MODULE = "api.views.views"

NO_DIR_MESSAGE = (
    "Scan failed: No scan directory configured. Please contact your "
    "administrator to set up a scan directory for your account."
)


class RecordingChain:
    """Stand-in for ``django_q.tasks.Chain``.

    Records every ``append`` so tests can assert on the composed chain without
    touching a broker.  ``instances`` collects every chain the view builds.
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
            patch(f"{MODULE}.Chain", RecordingChain),
            patch(f"{MODULE}.do_all_models_exist", return_value=models_exist),
            patch(f"{MODULE}.download_models") as download_models,
            patch(f"{MODULE}.scan_photos") as scan_photos,
            patch(f"{MODULE}.logger") as logger,
        ):
            self.scan_photos_mock = scan_photos
            self.download_models_mock = download_models
            self.logger_mock = logger
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
        self.assertEqual(response.data, {"status": False, "message": NO_DIR_MESSAGE})
        # No chain is even constructed on the guard path.
        self.assertEqual(RecordingChain.instances, [])
        self.scan_photos_mock.assert_not_called()

    def test_whitespace_only_scan_directory_returns_400(self):
        # ``.strip() == ""`` catches whitespace-only directories.
        user = create_test_user(scan_directory="   ")
        response = self.call_view(ScanPhotosView, user=user)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["message"], NO_DIR_MESSAGE)
        self.assertEqual(RecordingChain.instances, [])

    def test_nonexistent_scan_directory_returns_400_with_path_in_message(self):
        missing = os.path.join(self.scan_directory, "definitely-not-here")
        user = create_test_user(scan_directory=missing)
        response = self.call_view(ScanPhotosView, user=user)

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.data["status"])
        self.assertEqual(
            response.data["message"],
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
        self.assertEqual(self.chain.appended[0][0][4], file_path)


class ScanPhotosViewHappyPathTest(ScanViewTestBase):
    def test_models_present_appends_only_scan_photos_and_returns_job_id(self):
        response = self.call_view(ScanPhotosView, models_exist=True)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["status"])
        job_id = response.data["job_id"]
        self.assertIsInstance(job_id, uuid.UUID)
        self.assertEqual(set(response.data), {"status", "job_id"})

        chain = self.chain
        self.assertTrue(chain.ran)
        self.assertEqual(len(chain.appended), 1)
        args, kwargs = chain.appended[0]
        # positional signature: (scan_photos, user, full_scan, job_id, dir)
        self.assertIs(args[0], self.scan_photos_mock)
        self.assertEqual(args[1], self.user)
        self.assertFalse(args[2])
        self.assertEqual(args[3], job_id)
        self.assertEqual(args[4], self.scan_directory)
        self.assertEqual(kwargs, {})
        self.download_models_mock.assert_not_called()

    def test_missing_models_prepends_download_models(self):
        response = self.call_view(ScanPhotosView, models_exist=False)

        self.assertEqual(response.status_code, 200)
        chain = self.chain
        self.assertEqual(len(chain.appended), 2)
        first_args, _ = chain.appended[0]
        self.assertIs(first_args[0], self.download_models_mock)
        self.assertEqual(first_args[1], self.user)
        self.assertIs(chain.appended[1][0][0], self.scan_photos_mock)

    def test_post_and_get_share_the_same_implementation(self):
        post_response = self.call_view(ScanPhotosView, method="post")
        post_chain = self.chain
        get_response = self.call_view(ScanPhotosView, method="get")
        get_chain = self.chain

        self.assertEqual(post_response.status_code, get_response.status_code)
        self.assertTrue(post_response.data["status"])
        self.assertTrue(get_response.data["status"])
        # Fresh uuid4 per call -- job ids never repeat.
        self.assertNotEqual(post_response.data["job_id"], get_response.data["job_id"])
        self.assertEqual(
            [a[0][4] for a in post_chain.appended],
            [a[0][4] for a in get_chain.appended],
        )

    def test_job_id_is_not_persisted_by_the_view(self):
        from api.models import LongRunningJob

        response = self.call_view(ScanPhotosView)

        self.assertTrue(response.data["status"])
        # The view only hands the id to the (mocked) task; creating the
        # LongRunningJob row is scan_photos' job, not the view's.
        self.assertFalse(
            LongRunningJob.objects.filter(job_id=response.data["job_id"]).exists()
        )


class ScanPhotosViewErrorPathTest(ScanViewTestBase):
    def test_chain_run_failure_returns_status_false_with_http_200(self):
        response = self.call_view(ScanPhotosView, run_error=RuntimeError("broker down"))

        # Quirk: the failure branch answers 200, not 500, and omits job_id.
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"status": False})
        self.logger_mock.exception.assert_called_once_with("An Error occurred")

    def test_non_exception_baseexception_is_also_swallowed(self):
        # ``except BaseException`` catches KeyboardInterrupt/SystemExit too.
        response = self.call_view(ScanPhotosView, run_error=KeyboardInterrupt())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"status": False})


class SelectiveScanPhotosViewTest(ScanViewTestBase):
    """``SelectiveScanPhotosView.get`` -- same guards, different directory."""

    def test_scans_the_uploads_web_subdirectory(self):
        response = self.call_view(SelectiveScanPhotosView)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["status"])
        args, _ = self.chain.appended[0]
        self.assertIs(args[0], self.scan_photos_mock)
        self.assertEqual(args[1], self.user)
        self.assertFalse(args[2])
        self.assertEqual(args[3], response.data["job_id"])
        self.assertEqual(args[4], os.path.join(self.scan_directory, "uploads", "web"))

    def test_uploads_web_subdirectory_need_not_exist(self):
        # Quirk: only the *parent* scan_directory existence is validated; the
        # uploads/web path is passed through unchecked.
        self.assertFalse(
            os.path.exists(os.path.join(self.scan_directory, "uploads", "web"))
        )
        response = self.call_view(SelectiveScanPhotosView)
        self.assertTrue(response.data["status"])

    def test_missing_scan_directory_returns_400(self):
        user = create_test_user(scan_directory="")
        response = self.call_view(SelectiveScanPhotosView, user=user)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"status": False, "message": NO_DIR_MESSAGE})
        self.assertEqual(RecordingChain.instances, [])

    def test_nonexistent_scan_directory_returns_400(self):
        missing = os.path.join(self.scan_directory, "nope")
        user = create_test_user(scan_directory=missing)
        response = self.call_view(SelectiveScanPhotosView, user=user)

        self.assertEqual(response.status_code, 400)
        self.assertIn(missing, response.data["message"])
        self.assertEqual(RecordingChain.instances, [])

    def test_missing_models_prepends_download_models(self):
        self.call_view(SelectiveScanPhotosView, models_exist=False)

        chain = self.chain
        self.assertEqual(len(chain.appended), 2)
        self.assertIs(chain.appended[0][0][0], self.download_models_mock)

    def test_chain_run_failure_returns_status_false(self):
        response = self.call_view(
            SelectiveScanPhotosView, run_error=RuntimeError("boom")
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"status": False})
        self.logger_mock.exception.assert_called_once_with("An Error occurred")

    def test_view_only_exposes_get(self):
        # No POST handler exists on this view (unlike ScanPhotosView).
        self.assertFalse(hasattr(SelectiveScanPhotosView, "post"))


class ScanPhotosViewAuthTest(TestCase):
    def test_unauthenticated_request_is_rejected_before_the_body_runs(self):
        factory = APIRequestFactory()
        request = factory.get("/api/scanphotos")
        with patch(f"{MODULE}.Chain", RecordingChain):
            RecordingChain.instances = []
            response = ScanPhotosView.as_view()(request)

        self.assertIn(response.status_code, (401, 403))
        self.assertEqual(RecordingChain.instances, [])

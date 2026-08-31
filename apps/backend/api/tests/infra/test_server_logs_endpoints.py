"""Tests for the two endpoints behind the admin "Server Logs" card.

``/api/serverlogs`` downloads the whole file, ``/api/serverlogs/view`` returns
the tail of it. Neither had any coverage, so nothing checked the staff guard,
the download filename or the line clamp.
"""

import os
import shutil
import tempfile
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.tests.utils import create_test_user
from librephotos.logging_bootstrap import LOG_FILENAME

DOWNLOAD_URL = "/api/serverlogs"
VIEWER_URL = "/api/serverlogs/view"


class ServerLogsViewTestBase(TestCase):
    def setUp(self):
        self.logs_root = tempfile.mkdtemp(prefix="librephotos-serverlogs-")
        self.addCleanup(shutil.rmtree, self.logs_root, True)
        self.log_file = os.path.join(self.logs_root, LOG_FILENAME)
        self.lines = [f"line {index}" for index in range(1, 1501)]
        with open(self.log_file, "w", encoding="utf-8") as f:
            f.write("\n".join(self.lines) + "\n")

        overridden = override_settings(LOGS_ROOT=self.logs_root)
        overridden.enable()
        self.addCleanup(overridden.disable)

        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.user = create_test_user()

    def read_download(self, response):
        try:
            return b"".join(response.streaming_content)
        finally:
            response.close()


class ServerLogsDownloadTest(ServerLogsViewTestBase):
    def test_non_staff_user_is_forbidden(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(DOWNLOAD_URL)
        self.assertEqual(response.status_code, 403)

    def test_staff_user_gets_the_file(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(DOWNLOAD_URL)
        self.assertEqual(response.status_code, 200)
        with open(self.log_file, "rb") as f:
            self.assertEqual(self.read_download(response), f.read())

    def test_content_disposition_carries_the_log_filename(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(DOWNLOAD_URL)
        self.read_download(response)
        disposition = response.headers["Content-Disposition"]
        self.assertIn("attachment", disposition)
        self.assertIn(f'filename="{LOG_FILENAME}"', disposition)

    def test_missing_file_is_a_404(self):
        os.remove(self.log_file)
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(DOWNLOAD_URL)
        self.assertEqual(response.status_code, 404)
        self.assertIn("error", response.json())


class ServerLogsViewerTest(ServerLogsViewTestBase):
    def test_non_staff_user_is_forbidden(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(VIEWER_URL)
        self.assertEqual(response.status_code, 403)

    def test_returns_the_requested_number_of_trailing_lines(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(VIEWER_URL, {"lines": 5})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["count"], 5)
        self.assertEqual(body["logs"].splitlines(), self.lines[-5:])

    def test_defaults_to_one_hundred_lines(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(VIEWER_URL)
        self.assertEqual(response.json()["count"], 100)

    def test_non_numeric_lines_falls_back_to_the_default(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(VIEWER_URL, {"lines": "all of them"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 100)

    def test_lines_is_clamped_to_at_most_one_thousand(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(VIEWER_URL, {"lines": 5000})
        self.assertEqual(response.json()["count"], 1000)

    def test_lines_is_clamped_to_at_least_one(self):
        self.client.force_authenticate(user=self.admin)
        for requested in (0, -5):
            with self.subTest(lines=requested):
                response = self.client.get(VIEWER_URL, {"lines": requested})
                self.assertEqual(response.json()["count"], 1)

    def test_missing_file_is_a_404_with_a_reason(self):
        # A 200 with an empty "logs" string is indistinguishable from an empty
        # log to the admin UI, which would render a blank panel saying nothing.
        os.remove(self.log_file)
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(VIEWER_URL)
        self.assertEqual(response.status_code, 404)
        body = response.json()
        self.assertEqual(body["logs"], "")
        self.assertEqual(body["count"], 0)
        self.assertIn("error", body)


class ServerLogsPathResolutionTest(ServerLogsViewTestBase):
    """Both endpoints read settings.LOGS_ROOT, not $BASE_LOGS.

    A deployment may set the log directory through a settings override instead
    of the environment variable, and the environment of the gunicorn process is
    not necessarily the one the settings were built from.
    """

    def setUp(self):
        super().setUp()
        decoy_root = tempfile.mkdtemp(prefix="librephotos-serverlogs-decoy-")
        self.addCleanup(shutil.rmtree, decoy_root, True)
        with open(os.path.join(decoy_root, LOG_FILENAME), "w", encoding="utf-8") as f:
            f.write("from the environment\n")
        patcher = patch.dict(os.environ, {"BASE_LOGS": decoy_root})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client.force_authenticate(user=self.admin)

    def test_download_ignores_the_environment(self):
        response = self.client.get(DOWNLOAD_URL)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(b"from the environment", self.read_download(response))

    def test_viewer_ignores_the_environment(self):
        response = self.client.get(VIEWER_URL, {"lines": 5})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["logs"].splitlines(), self.lines[-5:])

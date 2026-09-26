"""``/api/imagetag/`` reports the build without touching the global git config.

It used to run ``git config --global --add safe.directory /code`` on every
cache miss, appending another duplicate line to the server's global git
config at request time. The images ship without ``.git`` anyway, so the hash
now comes from ``GIT_HASH`` (set at image build) and only a source checkout
falls back to asking git - with ``-c safe.directory=...``, which lasts for that
one command.
"""

import os
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user
from api.views import views


class ImageTagViewTest(TestCase):
    def setUp(self):
        views.read_git_hash.cache_clear()
        self.addCleanup(views.read_git_hash.cache_clear)
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    def _get(self):
        response = self.client.get("/api/imagetag/")
        self.assertEqual(200, response.status_code)
        return response.json()

    @patch("api.views.views.subprocess")
    def test_git_hash_from_env_skips_git(self, subprocess_mock):
        with patch.dict(os.environ, {"IMAGE_TAG": "2026w38", "GIT_HASH": "abc1234"}):
            data = self._get()
        self.assertEqual({"image_tag": "2026w38", "git_hash": "abc1234"}, data)
        subprocess_mock.run.assert_not_called()
        subprocess_mock.check_output.assert_not_called()

    @patch("api.views.views.subprocess.check_output", return_value=b"def5678\n")
    @patch("api.views.views.subprocess.run")
    def test_git_fallback_never_mutates_global_config(self, run_mock, check_output):
        environment = {k: v for k, v in os.environ.items() if k != "GIT_HASH"}
        with patch.dict(os.environ, environment, clear=True):
            data = self._get()

        self.assertEqual("def5678", data["git_hash"])
        run_mock.assert_not_called()
        command = check_output.call_args.args[0]
        self.assertNotIn("--global", command)
        self.assertEqual("git", command[0])
        self.assertEqual("-c", command[1])
        self.assertTrue(command[2].startswith("safe.directory="))

    @patch(
        "api.views.views.subprocess.check_output",
        side_effect=FileNotFoundError("git"),
    )
    def test_no_git_falls_back_to_image_tag(self, _check_output):
        environment = {k: v for k, v in os.environ.items() if k != "GIT_HASH"}
        environment["IMAGE_TAG"] = "dev"
        with patch.dict(os.environ, environment, clear=True):
            data = self._get()
        self.assertEqual({"image_tag": "dev", "git_hash": "dev"}, data)

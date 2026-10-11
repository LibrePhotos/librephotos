"""``/api/imagetag/`` reports the build without touching the global git config.

It used to run ``git config --global --add safe.directory /code`` on every
cache miss, appending another duplicate line to the server's global git
config at request time. The images ship without ``.git`` anyway, so the hash
now comes from ``GIT_HASH`` (set at image build) and only a source checkout
falls back to asking git - with ``-c safe.directory=...``, which lasts for that
one command.
"""

from subprocess import CompletedProcess
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.tests.utils import create_test_user
from api.views import server_info


class ImageTagViewTest(TestCase):
    def setUp(self):
        server_info.read_git_hash.cache_clear()
        self.addCleanup(server_info.read_git_hash.cache_clear)
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    def _get(self):
        response = self.client.get("/api/imagetag/")
        self.assertEqual(200, response.status_code)
        return response.json()

    @patch("api.views.server_info.binaries.run_tool")
    def test_git_hash_from_env_skips_git(self, run_tool):
        with override_settings(IMAGE_TAG="2026w38", GIT_HASH="abc1234"):
            data = self._get()
        self.assertEqual({"image_tag": "2026w38", "git_hash": "abc1234"}, data)
        run_tool.assert_not_called()

    @patch("api.views.server_info.binaries.available", return_value=True)
    @patch(
        "api.views.server_info.binaries.run_tool",
        return_value=CompletedProcess([], 0, "def5678\n", ""),
    )
    def test_git_fallback_never_mutates_global_config(self, run_tool, _available):
        with override_settings(GIT_HASH=""):
            data = self._get()

        self.assertEqual("def5678", data["git_hash"])
        run_tool.assert_called_once()
        name, args = run_tool.call_args.args
        self.assertEqual("git", name)
        self.assertNotIn("--global", args)
        self.assertEqual("-c", args[2])
        self.assertTrue(args[3].startswith("safe.directory="))
        self.assertIn("timeout", run_tool.call_args.kwargs)

    @patch("api.views.server_info.binaries.available", return_value=False)
    def test_no_git_falls_back_to_image_tag(self, _available):
        with override_settings(GIT_HASH="", IMAGE_TAG="dev"):
            data = self._get()
        self.assertEqual({"image_tag": "dev", "git_hash": "dev"}, data)

    @patch("api.views.server_info.binaries.available", return_value=True)
    @patch(
        "api.views.server_info.binaries.run_tool",
        return_value=CompletedProcess([], 128, "", "fatal: not a git repository"),
    )
    def test_not_a_checkout_falls_back_to_image_tag(self, _run_tool, _available):
        with override_settings(GIT_HASH="", IMAGE_TAG="dev"):
            data = self._get()
        self.assertEqual({"image_tag": "dev", "git_hash": "dev"}, data)

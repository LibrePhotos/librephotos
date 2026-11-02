"""The support prompts' state: the one-time thank-you dialog and Rewind.

Each user's ``support_prompt_seen`` and ``rewind_seen_year`` change through
PATCH /api/user/<id>/ like every other preference; the switches
``SUPPORT_PROMPTS_ENABLED`` and ``REWIND_ENABLED`` are site settings every
user's app reads and only admins change.
"""

from unittest.mock import patch

from constance import config as site_config
from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user


class SupportPromptUserFieldsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_new_users_have_seen_neither(self):
        data = self.client.get(f"/api/user/{self.user.id}/").json()
        self.assertIs(data["support_prompt_seen"], False)
        self.assertEqual(data["rewind_seen_year"], 0)

    def test_a_user_saves_their_own_fields(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"support_prompt_seen": True, "rewind_seen_year": 2026},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.user.refresh_from_db()
        self.assertTrue(self.user.support_prompt_seen)
        self.assertEqual(self.user.rewind_seen_year, 2026)

    def test_a_user_cannot_change_another_users_fields(self):
        response = self.client.patch(
            f"/api/user/{self.other.id}/",
            {"support_prompt_seen": True, "rewind_seen_year": 2026},
            format="json",
        )
        self.assertIn(response.status_code, (403, 404))
        self.other.refresh_from_db()
        self.assertFalse(self.other.support_prompt_seen)
        self.assertEqual(self.other.rewind_seen_year, 0)

    def test_a_negative_year_is_refused(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/", {"rewind_seen_year": -1}, format="json"
        )
        self.assertEqual(response.status_code, 400)


class SupportPromptSiteSettingsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.user = create_test_user()

    def test_everyone_reads_both_switches(self):
        for user in (None, self.user, self.admin):
            self.client.force_authenticate(user=user)
            data = self.client.get("/api/sitesettings").json()
            self.assertIs(data["support_prompts_enabled"], True)
            self.assertIs(data["rewind_enabled"], True)

    @override_config(SUPPORT_PROMPTS_ENABLED=True, REWIND_ENABLED=True)
    @patch("api.views.site_settings.do_all_models_exist", return_value=True)
    def test_an_admin_turns_them_off(self, _models_exist):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/sitesettings",
            {"support_prompts_enabled": False, "rewind_enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIs(response.json()["support_prompts_enabled"], False)
        self.assertFalse(site_config.SUPPORT_PROMPTS_ENABLED)
        self.assertFalse(site_config.REWIND_ENABLED)

    @override_config(SUPPORT_PROMPTS_ENABLED=True)
    def test_a_user_cannot_change_them(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/sitesettings", {"support_prompts_enabled": False}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(site_config.SUPPORT_PROMPTS_ENABLED)

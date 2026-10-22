"""The What's new card's state (#2305).

Each user's ``last_seen_release`` and ``show_whats_new`` live on their own user
row and change through PATCH /api/user/<id>/ like every other preference; the
instance switch ``WHATS_NEW_ENABLED`` is a site setting every user's app reads.
"""

from unittest.mock import patch

from constance import config as site_config
from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user


class WhatsNewUserFieldsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_new_users_have_seen_nothing_and_get_the_card(self):
        response = self.client.get(f"/api/user/{self.user.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["last_seen_release"], "")
        self.assertIs(response.json()["show_whats_new"], True)

    def test_a_user_saves_their_own_fields(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"last_seen_release": "1.5.0", "show_whats_new": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["last_seen_release"], "1.5.0")
        self.user.refresh_from_db()
        self.assertEqual(self.user.last_seen_release, "1.5.0")
        self.assertFalse(self.user.show_whats_new)

    def test_a_user_cannot_change_another_users_fields(self):
        response = self.client.patch(
            f"/api/user/{self.other.id}/",
            {"last_seen_release": "1.5.0", "show_whats_new": False},
            format="json",
        )
        self.assertIn(response.status_code, (403, 404))
        self.other.refresh_from_db()
        self.assertEqual(self.other.last_seen_release, "")
        self.assertTrue(self.other.show_whats_new)

    def test_a_release_longer_than_32_characters_is_refused(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"last_seen_release": "1" * 33},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "last_seen_release")
        self.user.refresh_from_db()
        self.assertEqual(self.user.last_seen_release, "")


class WhatsNewSiteSettingTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.user = create_test_user()

    def test_everyone_reads_it_even_anonymously(self):
        for user in (None, self.user, self.admin):
            self.client.force_authenticate(user=user)
            response = self.client.get("/api/sitesettings")
            self.assertEqual(response.status_code, 200)
            self.assertIs(response.json()["whats_new_enabled"], True)

    @override_config(WHATS_NEW_ENABLED=True)
    @patch("api.views.site_settings.do_all_models_exist", return_value=True)
    def test_an_admin_turns_it_off(self, _models_exist):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/sitesettings", {"whats_new_enabled": False}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIs(response.json()["whats_new_enabled"], False)
        self.assertFalse(site_config.WHATS_NEW_ENABLED)

    @override_config(WHATS_NEW_ENABLED=True)
    def test_a_user_cannot_change_it(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/api/sitesettings", {"whats_new_enabled": False}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertTrue(site_config.WHATS_NEW_ENABLED)

"""``GET /api/sitesettings`` must not hand out the map API key (GHSA-6367-m327-c4pf).

The endpoint is anonymous on purpose -- the login page reads it before
sign-in -- but ``map_api_key`` is the administrator's credential for a paid
geocoding provider. Only the backend's geocoder and the admin's own settings
form need it, so everyone else gets an empty string (the key stays in the
payload so older clients that require it keep parsing).
"""

from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

SECRET = "MAPBOX-SECRET-abc123xy"


@override_config(MAP_API_KEY=SECRET)
class SiteSettingsMapApiKeyTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _get(self, user=None):
        self.client.force_authenticate(user=user)
        response = self.client.get("/api/sitesettings")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_anonymous_does_not_get_the_key(self):
        body = self._get()
        self.assertEqual(body["map_api_key"], "")
        self.assertNotIn(SECRET, str(body))

    def test_regular_user_does_not_get_the_key(self):
        body = self._get(create_test_user())
        self.assertEqual(body["map_api_key"], "")

    def test_admin_still_gets_the_key_for_the_settings_form(self):
        body = self._get(create_test_user(is_admin=True))
        self.assertEqual(body["map_api_key"], SECRET)

    def test_anonymous_still_gets_the_login_page_flags(self):
        body = self._get()
        self.assertIn("allow_registration", body)
        self.assertIn("allow_upload", body)

"""POST /api/sitesettings accepts exactly what the old JSON schema accepted.

The body used to be checked with ``jsonschema`` against a dict in
``api/schemas/``; ``SiteSettingsRequest`` replaced it (#2326). The settings
form and the mobile app send these payloads, so the accepted values are
pinned here: booleans are JSON booleans, strings are JSON strings kept as
sent (blank and surrounding whitespace included), unknown keys are ignored,
and at least one known key is required. The map provider is one of the
providers reverse geocoding knows (#2302).
"""

from unittest.mock import patch

from constance import config
from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.geocode.config import MAP_API_PROVIDERS
from api.tests.utils import create_test_user

BOOLEAN_FIELDS = {
    "allow_registration": "ALLOW_REGISTRATION",
    "allow_upload": "ALLOW_UPLOAD",
    "nextcloud_enabled": "NEXTCLOUD_ENABLED",
    "auto_create_user_directory": "AUTO_CREATE_USER_DIRECTORY",
}
STRING_FIELDS = {
    "skip_patterns": "SKIP_PATTERNS",
    "map_api_key": "MAP_API_KEY",
    "map_tile_provider": "MAP_TILE_PROVIDER",
    "captioning_model": "CAPTIONING_MODEL",
    "ocr_model": "OCR_MODEL",
    "face_recognition_model": "FACE_RECOGNITION_MODEL",
}


@patch("api.views.site_settings.do_all_models_exist", return_value=True)
class SiteSettingsRequestTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user(is_admin=True))

    def post(self, body: object):
        return self.client.post("/api/sitesettings", data=body, format="json")

    def assert_rejected(self, body: object, field: str) -> None:
        response = self.post(body)
        self.assertEqual(response.status_code, 400, (body, response.content))
        fields = [error["field"] for error in response.json()["errors"]]
        self.assertEqual(fields, [field], body)

    def test_each_boolean_is_stored(self, _models):
        for key, setting in BOOLEAN_FIELDS.items():
            for value in (True, False):
                with self.subTest(key=key, value=value):
                    response = self.post({key: value})
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertIs(getattr(config, setting), value)
                    self.assertIs(response.json()[key], value)

    def test_each_string_is_stored_as_sent(self, _models):
        for key, setting in STRING_FIELDS.items():
            for value in ("value", "", "  padded  "):
                with self.subTest(key=key, value=value):
                    response = self.post({key: value})
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(getattr(config, setting), value)

    def test_several_fields_at_once_and_unknown_keys_are_ignored(self, _models):
        response = self.post(
            {
                "allow_upload": True,
                "skip_patterns": "@eaDir",
                "heavyweight_process": 3,
                "llm_model": "None",
            }
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(config.ALLOW_UPLOAD)
        self.assertEqual(config.SKIP_PATTERNS, "@eaDir")

    def test_a_whole_get_response_can_be_posted_back(self, _models):
        current = self.client.get("/api/sitesettings").json()
        response = self.post(current)
        self.assertEqual(response.status_code, 200, response.content)

    def test_booleans_must_be_json_booleans(self, _models):
        for value in ("true", "yes please", 1, 0, None, [True]):
            with self.subTest(value=value):
                self.assert_rejected(
                    {"allow_registration": value}, "allow_registration"
                )

    def test_each_map_provider_is_stored(self, _models):
        for provider in sorted(MAP_API_PROVIDERS):
            with self.subTest(provider=provider):
                response = self.post({"map_api_provider": provider})
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(config.MAP_API_PROVIDER, provider)

    @override_config(MAP_API_PROVIDER="nominatim")
    def test_an_unknown_map_provider_is_refused(self, _models):
        # reverse_geocode could not ask it: every photo would get no place.
        for value in ("photon", "", " nominatim", "ExifTool", 5):
            with self.subTest(value=value):
                self.assert_rejected({"map_api_provider": value}, "map_api_provider")
        self.assertEqual(config.MAP_API_PROVIDER, "nominatim")

    def test_strings_must_be_json_strings(self, _models):
        for value in (5, True, None, ["a"], {"a": 1}):
            with self.subTest(value=value):
                self.assert_rejected({"map_api_key": value}, "map_api_key")

    @override_config(ALLOW_UPLOAD=False)
    def test_nothing_is_saved_when_one_field_is_wrong(self, _models):
        self.assert_rejected(
            {"allow_upload": True, "skip_patterns": 3}, "skip_patterns"
        )
        self.assertFalse(config.ALLOW_UPLOAD)

    def test_a_body_without_a_known_field_is_refused(self, _models):
        for body in ({}, {"heavyweight_process": 1}, {"llm_model": "x"}):
            with self.subTest(body=body):
                self.assert_rejected(body, "non_field_errors")

    def test_missing_photos_limit_is_stored(self, _models):
        for value in (0, 0.25, 1, 1.0):
            with self.subTest(value=value):
                response = self.post({"scan_missing_max_fraction": value})
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(config.SCAN_MISSING_MAX_FRACTION, value)
                self.assertEqual(response.json()["scan_missing_max_fraction"], value)

    def test_missing_photos_limit_must_be_a_fraction(self, _models):
        for value in ("0.5", True, None, -0.1, 1.5, [0.5]):
            with self.subTest(value=value):
                self.assert_rejected(
                    {"scan_missing_max_fraction": value}, "scan_missing_max_fraction"
                )

    def test_trash_retention_is_stored(self, _models):
        for value in (0, 30, 36500):
            with self.subTest(value=value):
                response = self.post({"trash_retention_days": value})
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(config.TRASH_RETENTION_DAYS, value)
                self.assertEqual(response.json()["trash_retention_days"], value)

    def test_trash_retention_must_be_a_whole_number_of_days(self, _models):
        for value in ("30", True, None, -1, 1.5, 36501, [30]):
            with self.subTest(value=value):
                self.assert_rejected(
                    {"trash_retention_days": value}, "trash_retention_days"
                )


class TrashRetentionSettingTest(TestCase):
    """Everyone reads the trash retention; only an admin changes it (#2203)."""

    def setUp(self):
        self.client = APIClient()

    def test_it_is_off_by_default(self):
        self.assertEqual(config.TRASH_RETENTION_DAYS, 0)

    @override_config(TRASH_RETENTION_DAYS=14)
    def test_a_user_reads_it_for_the_trash_page(self):
        self.client.force_authenticate(user=create_test_user())

        response = self.client.get("/api/sitesettings")

        self.assertEqual(response.json()["trash_retention_days"], 14)

    def test_a_user_cannot_change_it(self):
        self.client.force_authenticate(user=create_test_user())

        response = self.client.post(
            "/api/sitesettings", data={"trash_retention_days": 1}, format="json"
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(config.TRASH_RETENTION_DAYS, 0)

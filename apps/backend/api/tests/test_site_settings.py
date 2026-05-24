from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.geocode.throttle import (
    build_default_geocode_throttle_profiles,
    clear_geocode_throttle_profiles_cache,
    serialize_geocode_throttle_profiles,
)
from api.tests.utils import create_test_user


class SiteSettingsTest(TestCase):
    def setUp(self):
        clear_geocode_throttle_profiles_cache()
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=self.admin)

    def tearDown(self):
        clear_geocode_throttle_profiles_cache()
        super().tearDown()

    @override_config(FACE_RECOGNITION_MODEL="buffalo_sc")
    def test_get_includes_face_recognition_model(self):
        response = self.client.get("/api/sitesettings")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["face_recognition_model"], "buffalo_sc")

    @override_config(FACE_RECOGNITION_MODEL="buffalo_sc")
    @patch("api.views.views.do_all_models_exist", return_value=True)
    def test_post_updates_face_recognition_model(self, _mock_do_all_models_exist):
        response = self.client.post(
            "/api/sitesettings",
            data={"face_recognition_model": "buffalo_l"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["face_recognition_model"], "buffalo_l")

    @override_config(
        MAP_API_PROVIDER="mapbox",
        GEOCODE_THROTTLE_PROFILES=serialize_geocode_throttle_profiles(
            {
                **build_default_geocode_throttle_profiles(),
                "mapbox": {
                    "enabled": True,
                    "requests_per_second": 3.0,
                    "burst_size": 2,
                },
            }
        ),
    )
    def test_get_includes_geocode_throttle_profiles(self):
        clear_geocode_throttle_profiles_cache()
        response = self.client.get("/api/sitesettings")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["geocode_throttle_profiles"]["mapbox"],
            {
                "enabled": True,
                "requests_per_second": 3.0,
                "burst_size": 2,
            },
        )
        self.assertEqual(
            response.json()["geocode_active_throttle_profile"],
            {
                "enabled": True,
                "requests_per_second": 3.0,
                "burst_size": 2,
            },
        )

    @patch("api.views.views.do_all_models_exist", return_value=True)
    def test_post_updates_geocode_throttle_profiles(self, _mock_do_all_models_exist):
        clear_geocode_throttle_profiles_cache()
        payload = build_default_geocode_throttle_profiles()
        payload["mapbox"] = {
            "enabled": True,
            "requests_per_second": 4.0,
            "burst_size": 3,
        }

        response = self.client.post(
            "/api/sitesettings",
            data={"geocode_throttle_profiles": payload},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["geocode_throttle_profiles"]["mapbox"], payload["mapbox"])

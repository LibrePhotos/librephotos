from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_user


class SiteSettingsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=self.admin)

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

    def test_get_includes_map_tile_default(self):
        response = self.client.get("/api/sitesettings")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["map_tile_provider"], "photoprism")

    @patch("api.views.views.do_all_models_exist", return_value=True)
    def test_post_updates_map_tile_provider(self, _mock_do_all_models_exist):
        response = self.client.post(
            "/api/sitesettings",
            data={"map_tile_provider": "none"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["map_tile_provider"], "none")

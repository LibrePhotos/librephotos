from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase
from django_q.tasks import AsyncTask
from rest_framework.test import APIClient

from api.models import LongRunningJob
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
    @patch("api.views.site_settings.do_all_models_exist", return_value=True)
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

    @patch("api.views.site_settings.do_all_models_exist", return_value=True)
    def test_post_updates_map_tile_provider(self, _mock_do_all_models_exist):
        response = self.client.post(
            "/api/sitesettings",
            data={"map_tile_provider": "none"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["map_tile_provider"], "none")

    @patch("api.views.site_settings.do_all_models_exist", return_value=False)
    @patch.object(AsyncTask, "run")
    def test_saving_while_models_download_queues_no_second_download(
        self, run, _mock_do_all_models_exist
    ):
        """The form saves on every toggle and blur, often mid-download."""
        LongRunningJob.create_job(
            user=self.admin,
            job_type=LongRunningJob.JOB_DOWNLOAD_MODELS,
            start_now=True,
        )
        response = self.client.post(
            "/api/sitesettings", data={"allow_upload": True}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        run.assert_not_called()

    @patch("api.views.site_settings.do_all_models_exist", return_value=False)
    @patch.object(AsyncTask, "run")
    def test_saving_with_models_missing_queues_the_download(
        self, run, _mock_do_all_models_exist
    ):
        response = self.client.post(
            "/api/sitesettings", data={"allow_upload": True}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        run.assert_called_once_with()

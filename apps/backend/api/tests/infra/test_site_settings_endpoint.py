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
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/sitesettings", data={"allow_upload": True}, format="json"
            )
        self.assertEqual(response.status_code, 200)
        run.assert_called_once_with()
        # The download's row exists from the moment it is queued.
        self.assertTrue(
            LongRunningJob.objects.filter(
                job_type=LongRunningJob.JOB_DOWNLOAD_MODELS, started_at=None
            ).exists()
        )


class SiteSettingsSchemaViolationTest(TestCase):
    """A body that breaks the settings schema is a 400, not a 500."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user(is_admin=True))

    def test_wrong_value_type_is_a_bad_request(self):
        response = self.client.post(
            "/api/sitesettings",
            data={"allow_registration": "yes please"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        [error] = response.json()["errors"]
        self.assertIn("allow_registration", error["field"] + error["message"])

    def test_nothing_is_saved_when_the_body_is_rejected(self):
        with override_config(ALLOW_REGISTRATION=False):
            self.client.post(
                "/api/sitesettings",
                data={"allow_registration": True, "allow_upload": "no"},
                format="json",
            )
            from constance import config

            self.assertFalse(config.ALLOW_REGISTRATION)

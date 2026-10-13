"""The feature switches on /api/sitesettings (#2217, the Features card).

GET gives staff a ``features`` object, one entry per optional feature, and the
newest model download; anonymous and non-staff callers get neither. POST takes
the six ``<feature>_enabled`` booleans and refuses one whose ``FEATURE_*``
environment variable locked it off.
"""

import tempfile
from pathlib import Path
from unittest.mock import patch

from constance import config
from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.runtime.features import feature_enabled, forget_site_switches
from api.runtime.ml_models import feature_model_ready
from api.tests.utils import create_test_user

FEATURE_KEYS = {
    "video",
    "face_detection",
    "face_cluster",
    "image_captioning",
    "reverse_geocoding",
    "scene_classification",
}


class FeaturesVisibilityTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _get(self, user=None):
        self.client.force_authenticate(user=user)
        response = self.client.get("/api/sitesettings")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_anonymous_gets_no_features(self):
        body = self._get()
        self.assertNotIn("features", body)
        self.assertNotIn("model_download", body)

    def test_regular_user_gets_no_features(self):
        body = self._get(create_test_user())
        self.assertNotIn("features", body)
        self.assertNotIn("model_download", body)

    def test_staff_gets_every_feature_on_by_default(self):
        body = self._get(create_test_user(is_admin=True))
        self.assertEqual(set(body["features"]), FEATURE_KEYS)
        for key, state in body["features"].items():
            with self.subTest(key=key):
                self.assertTrue(state["enabled"])
                self.assertFalse(state["locked"])
        self.assertIsNone(body["model_download"])

    def test_features_without_a_model_have_no_model_state(self):
        body = self._get(create_test_user(is_admin=True))
        for key in ("video", "face_cluster", "reverse_geocoding"):
            with self.subTest(key=key):
                self.assertIsNone(body["features"][key]["model_ready"])

    @override_config(IMAGE_CAPTIONING_ENABLED=False)
    def test_a_switch_turned_off_in_the_site_settings(self):
        state = self._get(create_test_user(is_admin=True))["features"]
        self.assertFalse(state["image_captioning"]["enabled"])
        self.assertFalse(state["image_captioning"]["locked"])
        self.assertTrue(state["video"]["enabled"])

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_a_switch_the_environment_turned_off_is_locked(self):
        state = self._get(create_test_user(is_admin=True))["features"]
        self.assertFalse(state["face_detection"]["enabled"])
        self.assertTrue(state["face_detection"]["locked"])
        self.assertFalse(state["face_cluster"]["locked"])

    def test_the_anonymous_get_costs_no_extra_query(self):
        # The login page and every client start read it: one constance query
        # and the email setup check, nothing per feature. The first read
        # creates the email setup row, so it is left out of the count.
        self.client.force_authenticate(user=None)
        self.client.get("/api/sitesettings")
        with self.assertNumQueries(2):
            self.client.get("/api/sitesettings")


class ModelDownloadStateTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _download(self):
        return self.client.get("/api/sitesettings").json()["model_download"]

    def _job(self, **flags):
        job = LongRunningJob.create_job(
            user=self.admin, job_type=LongRunningJob.JOB_DOWNLOAD_MODELS
        )
        LongRunningJob.objects.filter(pk=job.pk).update(**flags)
        return job

    def test_a_running_download(self):
        job = self._job(progress_current=3, progress_target=12)
        self.assertEqual(
            self._download(),
            {
                "id": job.id,
                "status": "running",
                "progress_current": 3,
                "progress_target": 12,
            },
        )

    def test_each_finished_state(self):
        cases = {
            "finished": {"finished": True},
            "failed": {"finished": True, "failed": True},
            "cancelled": {"finished": True, "cancelled": True},
        }
        for status, flags in cases.items():
            with self.subTest(status=status):
                LongRunningJob.objects.all().delete()
                self._job(**flags)
                self.assertEqual(self._download()["status"], status)

    def test_other_jobs_do_not_count(self):
        LongRunningJob.create_job(
            user=self.admin, job_type=LongRunningJob.JOB_SCAN_PHOTOS
        )
        self.assertIsNone(self._download())


class FeatureModelReadyTest(TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.models = Path(folder.name)
        patcher = patch(
            "api.runtime.ml_models._models_folder", return_value=self.models
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_feature_without_a_model(self):
        self.assertIsNone(feature_model_ready("VIDEO", "buffalo_sc", "lfm2_vl_450m"))

    def test_a_missing_model(self):
        self.assertFalse(feature_model_ready("FACE_DETECTION", "buffalo_sc", "none"))

    def test_captioning_without_a_model_has_no_model_state(self):
        self.assertIsNone(feature_model_ready("IMAGE_CAPTIONING", "buffalo_sc", "None"))
        self.assertFalse(
            feature_model_ready("IMAGE_CAPTIONING", "buffalo_sc", "lfm2_vl_450m")
        )

    def test_only_the_selected_face_model_counts(self):
        target = self.models / "face_recognition" / "models" / "buffalo_sc"
        target.mkdir(parents=True)
        (target / "det_500m.onnx").touch()
        self.assertTrue(feature_model_ready("FACE_DETECTION", "buffalo_sc", "none"))
        self.assertFalse(feature_model_ready("FACE_DETECTION", "buffalo_l", "none"))


@patch("api.views.site_settings.do_all_models_exist", return_value=True)
class FeatureSwitchPostTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user(is_admin=True))
        # A rollback sends no config_updated signal: drop what the posts cached.
        self.addCleanup(forget_site_switches)

    def post(self, body):
        return self.client.post("/api/sitesettings", data=body, format="json")

    def test_turning_a_feature_off_and_on(self, _models):
        response = self.post({"face_detection_enabled": False})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(config.FACE_DETECTION_ENABLED)
        self.assertFalse(response.json()["features"]["face_detection"]["enabled"])
        # The gates see it at once in this process (no 60 s wait).
        self.assertFalse(feature_enabled("FACE_DETECTION"))

        response = self.post({"face_detection_enabled": True})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["features"]["face_detection"]["enabled"])
        self.assertTrue(feature_enabled("FACE_DETECTION"))

    def test_every_switch_is_stored(self, _models):
        for key in FEATURE_KEYS:
            with self.subTest(key=key):
                response = self.post({f"{key}_enabled": False})
                self.assertEqual(response.status_code, 200, response.content)
                self.assertIs(getattr(config, f"{key.upper()}_ENABLED"), False)

    def test_a_switch_takes_json_booleans_only(self, _models):
        response = self.post({"video_enabled": "false"})
        self.assertEqual(response.status_code, 400)
        [error] = response.json()["errors"]
        self.assertEqual(error["field"], "video_enabled")

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_a_locked_switch_is_refused_and_named(self, _models):
        for value in (True, False):
            with self.subTest(value=value):
                response = self.post({"image_captioning_enabled": value})
                self.assertEqual(response.status_code, 400)
                [error] = response.json()["errors"]
                self.assertEqual(error["field"], "image_captioning_enabled")
                self.assertEqual(error["code"], "feature_locked")
                self.assertIn("FEATURE_IMAGE_CAPTIONING", error["message"])
        self.assertTrue(config.IMAGE_CAPTIONING_ENABLED)

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_nothing_is_saved_when_a_locked_switch_is_in_the_body(self, _models):
        with override_config(ALLOW_UPLOAD=False):
            response = self.post(
                {"allow_upload": True, "image_captioning_enabled": False}
            )
            self.assertEqual(response.status_code, 400)
            self.assertFalse(config.ALLOW_UPLOAD)

    def test_a_regular_user_cannot_change_a_switch(self, _models):
        self.client.force_authenticate(user=create_test_user())
        response = self.post({"video_enabled": False})
        self.assertEqual(response.status_code, 403)
        self.assertTrue(config.VIDEO_ENABLED)

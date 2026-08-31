"""The FEATURE_* switches decide which ML services are spawned and watched.

Without this, a deployment that turned face detection or captioning off still
paid for every model: `start_service all` spawned all nine sidecars and the
per-minute watchdog restarted any that were killed to reclaim the memory.
"""

from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.models import User
from api.services import (
    SERVICE_FEATURE_FLAGS,
    SERVICES,
    check_services,
    is_service_enabled,
    start_service,
)
from api.tests.utils import create_password


def spawned_services(popen_mock):
    """The service names behind the scripts a Popen mock was asked to run."""
    names = set()
    for call in popen_mock.call_args_list:
        script = call.args[0][1]
        if script == "image_similarity/main.py":
            names.add("image_similarity")
        else:
            names.add(script.split("/")[1])
    return names


class ServiceFeatureFlagMappingTest(SimpleTestCase):
    def test_every_service_has_a_verdict(self):
        """A new service without an entry would silently become always-on."""
        self.assertEqual(set(SERVICES), set(SERVICE_FEATURE_FLAGS))

    def test_every_service_is_enabled_out_of_the_box(self):
        for service in SERVICES:
            self.assertTrue(is_service_enabled(service), service)

    def test_flags_name_real_settings(self):
        from django.conf import settings

        for service, flag in SERVICE_FEATURE_FLAGS.items():
            if flag is not None:
                self.assertTrue(hasattr(settings, flag), f"{service} -> {flag}")

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_face_recognition_follows_face_detection(self):
        self.assertFalse(is_service_enabled("face_recognition"))
        self.assertTrue(is_service_enabled("thumbnail"))

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    def test_tags_follows_scene_classification(self):
        self.assertFalse(is_service_enabled("tags"))

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_captioning_takes_the_llm_service_with_it(self):
        """Port 8008 is only ever reached from the captioning code paths."""
        self.assertFalse(is_service_enabled("image_captioning"))
        self.assertFalse(is_service_enabled("llm"))

    def test_a_missing_setting_leaves_the_service_enabled(self):
        """An unrecognised switch must not take a service away."""
        with patch.dict(
            SERVICE_FEATURE_FLAGS, {"thumbnail": "FEATURE_NOT_IN_ANY_SETTINGS"}
        ):
            self.assertTrue(is_service_enabled("thumbnail"))


@patch("api.services.is_service_compatible", return_value=True)
@patch("api.services.subprocess.Popen")
class StartServiceTest(SimpleTestCase):
    def test_an_enabled_service_is_spawned(self, popen_mock, _compatible):
        self.assertTrue(start_service("face_recognition"))
        popen_mock.assert_called_once()

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_a_disabled_service_is_refused(self, popen_mock, _compatible):
        self.assertFalse(start_service("face_recognition"))
        popen_mock.assert_not_called()

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_the_other_services_are_unaffected(self, popen_mock, _compatible):
        self.assertTrue(start_service("thumbnail"))
        popen_mock.assert_called_once()

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_the_refusal_is_logged_at_info(self, popen_mock, _compatible):
        with self.assertLogs("ownphotos", level="INFO") as logs:
            start_service("llm")

        self.assertTrue(
            any(
                "llm" in line and "FEATURE_IMAGE_CAPTIONING" in line
                for line in logs.output
            ),
            logs.output,
        )


@patch("api.services.is_service_compatible", return_value=True)
@patch("api.services.subprocess.Popen")
class StartAllCommandTest(TestCase):
    """`manage.py start_service all` is what the Docker entrypoints run."""

    def test_everything_starts_by_default(self, popen_mock, _compatible):
        call_command("start_service", "all")

        self.assertEqual(set(SERVICES), spawned_services(popen_mock))

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_a_disabled_service_is_skipped(self, popen_mock, _compatible):
        call_command("start_service", "all")

        started = spawned_services(popen_mock)
        self.assertNotIn("face_recognition", started)
        self.assertEqual(set(SERVICES) - {"face_recognition"}, started)

    @override_settings(
        FEATURE_FACE_DETECTION=False,
        FEATURE_IMAGE_CAPTIONING=False,
        FEATURE_SCENE_CLASSIFICATION=False,
    )
    def test_only_the_core_pipeline_starts_when_every_flag_is_off(
        self, popen_mock, _compatible
    ):
        call_command("start_service", "all")

        self.assertEqual(
            {"image_similarity", "thumbnail", "clip_embeddings", "exif", "ocr"},
            spawned_services(popen_mock),
        )

    def test_the_watchdog_is_still_scheduled(self, popen_mock, _compatible):
        from django_q.models import Schedule

        with override_settings(FEATURE_FACE_DETECTION=False):
            call_command("start_service", "all")

        self.assertTrue(
            Schedule.objects.filter(func="api.services.check_services").exists()
        )


@patch("api.services.is_healthy", return_value=False)
@patch("api.services.stop_service")
@patch("api.services.start_service")
class CheckServicesTest(SimpleTestCase):
    """The per-minute watchdog must not resurrect what a flag switched off."""

    def _restarted(self, start_mock):
        return {call.args[0] for call in start_mock.call_args_list}

    def test_every_unhealthy_service_is_restarted_by_default(
        self, start_mock, stop_mock, _healthy
    ):
        check_services()

        self.assertEqual(set(SERVICES), self._restarted(start_mock))

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_a_disabled_service_is_not_restarted(self, start_mock, stop_mock, _healthy):
        check_services()

        restarted = self._restarted(start_mock)
        self.assertNotIn("face_recognition", restarted)
        self.assertNotIn(
            "face_recognition", {c.args[0] for c in stop_mock.call_args_list}
        )

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_the_enabled_unhealthy_services_are_still_restarted(
        self, start_mock, stop_mock, _healthy
    ):
        check_services()

        self.assertEqual(
            set(SERVICES) - {"face_recognition"}, self._restarted(start_mock)
        )

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_a_disabled_service_is_not_even_probed(
        self, start_mock, stop_mock, healthy_mock
    ):
        """Skipping before the health check keeps a request off a dead port."""
        check_services()

        self.assertNotIn(
            "face_recognition", {call.args[0] for call in healthy_mock.call_args_list}
        )

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_the_watchdog_stays_quiet_about_skipped_services(
        self, start_mock, stop_mock, _healthy
    ):
        """It runs every minute; a skip line per service would flood the log."""
        with self.assertLogs("ownphotos", level="INFO") as logs:
            check_services()

        self.assertFalse(
            [
                line
                for line in logs.output
                if "FEATURE_IMAGE_CAPTIONING" in line or "'llm'" in line
            ],
            logs.output,
        )


class ServiceAdminApiTest(TestCase):
    """The admin Services page has to tell "switched off" from "crashed".

    Reporting a flag-disabled service as merely unhealthy sends an admin looking
    for a fault that is not there, and offers a Start button whose 500 tells them
    nothing about why.
    """

    def setUp(self):
        self.admin = User.objects.create_superuser(
            "admin", "admin@test.com", create_password()
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    @patch("api.views.services.is_healthy", return_value=True)
    def test_an_enabled_service_reports_its_health(self, _healthy):
        response = self.client.get("/api/services/face_recognition/")

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            {
                "service_name": "face_recognition",
                "healthy": True,
                "enabled": True,
                "feature_flag": "FEATURE_FACE_DETECTION",
            },
            response.json(),
        )

    def test_a_core_service_names_no_flag(self):
        with patch("api.views.services.is_healthy", return_value=True):
            response = self.client.get("/api/services/thumbnail/")

        self.assertIsNone(response.json()["feature_flag"])
        self.assertTrue(response.json()["enabled"])

    @override_settings(FEATURE_FACE_DETECTION=False)
    @patch("api.views.services.is_healthy", return_value=False)
    def test_a_disabled_service_is_reported_as_disabled(self, healthy_mock):
        response = self.client.get("/api/services/face_recognition/")

        self.assertEqual(200, response.status_code)
        self.assertFalse(response.json()["enabled"])
        self.assertEqual("FEATURE_FACE_DETECTION", response.json()["feature_flag"])
        healthy_mock.assert_not_called()

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    @patch("api.views.services.start_service")
    def test_starting_a_disabled_service_is_a_conflict_naming_the_flag(
        self, start_mock
    ):
        response = self.client.post("/api/services/llm/start/")

        self.assertEqual(409, response.status_code)
        self.assertEqual("FEATURE_IMAGE_CAPTIONING", response.json()["feature_flag"])
        self.assertIn("FEATURE_IMAGE_CAPTIONING", response.json()["error"])
        start_mock.assert_not_called()

    @patch("api.views.services.start_service", return_value=True)
    def test_starting_an_enabled_service_still_succeeds(self, _start):
        response = self.client.post("/api/services/tags/start/")

        self.assertEqual(200, response.status_code)

    @patch("api.views.services.start_service", return_value=False)
    def test_an_enabled_service_that_fails_to_start_is_still_a_server_error(
        self, _start
    ):
        """409 is for the switch; a genuine failure must not be dressed up as one."""
        response = self.client.post("/api/services/tags/start/")

        self.assertEqual(500, response.status_code)

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_an_unknown_service_is_still_a_404(self):
        response = self.client.post("/api/services/not_a_service/start/")

        self.assertEqual(404, response.status_code)

"""``/api/updates/`` and the update check's site setting (#2311)."""

from unittest.mock import patch

from constance import config as site_config
from constance.test import override_config
from django.test import override_settings
from rest_framework.test import APIClient

from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.updates.test_update_check import session_answering
from api.tests.utils import create_test_user
from api.updates.check import check_for_updates

ROUTES = (
    ("get", "/api/updates/"),
    ("post", "/api/updates/skip/"),
    ("post", "/api/updates/snooze/"),
)


@override_settings(IMAGE_TAG="1.3.0", INSTALL_TYPE="docker", UPDATE_CHECK_ALLOWED=True)
class UpdateStatusApiTest(DeclaredResponseTestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        check_for_updates(session_answering())

    def test_admins_read_the_stored_result_as_declared(self):
        with patch("api.updates.check.requests") as http:
            body = self.assert_declared("/api/updates/", "/api/updates/")
        http.Session.assert_not_called()
        self.assertEqual(body["current"], "1.3.0")
        self.assertEqual(body["latest"], "1.5.0")
        self.assertTrue(body["update_available"])
        self.assertTrue(body["notice"])
        self.assertEqual(body["install_type"], "docker")

    def test_non_admins_and_anonymous_get_nothing(self):
        user = APIClient()
        user.force_authenticate(create_test_user())
        for method, url in ROUTES:
            with self.subTest(url=url):
                self.assertEqual(getattr(user, method)(url, {}).status_code, 403)
                self.assertIn(
                    getattr(APIClient(), method)(url, {}).status_code, (401, 403)
                )

    def test_skip_then_show_again(self):
        body = self.assert_declared(
            "/api/updates/skip/",
            "/api/updates/skip/",
            method="post",
            data={"version": "1.5.0"},
        )
        self.assertEqual(body["status"], "skipped")
        self.assertFalse(body["notice"])
        body = self.client.post(
            "/api/updates/skip/", {"version": ""}, format="json"
        ).json()
        self.assertTrue(body["notice"])
        self.assertIsNone(body["skipped_release"])

    def test_skip_takes_only_a_version(self):
        for data in ({"version": "latest"}, {}, {"version": 5}):
            with self.subTest(data=data):
                response = self.client.post("/api/updates/skip/", data, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["errors"][0]["field"], "version")

    def test_snooze_hides_the_card(self):
        body = self.assert_declared(
            "/api/updates/snooze/", "/api/updates/snooze/", method="post"
        )
        self.assertFalse(body["notice"])
        self.assertIsNotNone(body["snoozed_until"])

    @override_config(UPDATE_CHECK=False)
    def test_off_reports_enabled_false_and_no_release(self):
        body = self.assert_declared("/api/updates/", "/api/updates/")
        self.assertFalse(body["enabled"])
        self.assertEqual(body["status"], "off")
        self.assertIsNone(body["latest"])
        self.assertFalse(body["notice"])


@override_settings(IMAGE_TAG="1.3.0", UPDATE_CHECK_ALLOWED=True)
class UpdateCheckSiteSettingTest(DeclaredResponseTestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(create_test_user(is_admin=True))

    def test_admins_see_the_switch_and_others_do_not(self):
        body = self.client.get("/api/sitesettings").json()
        self.assertIs(body["update_check"], True)
        self.assertNotIn("update_check", APIClient().get("/api/sitesettings").json())

    def test_turning_it_on_checks_at_once(self):
        site_config.UPDATE_CHECK = False
        with patch("api.views.site_settings.enqueue_task") as enqueue:
            body = self.client.post(
                "/api/sitesettings", {"update_check": True}, format="json"
            ).json()
        self.assertIs(body["update_check"], True)
        enqueue.assert_called_once_with(check_for_updates)

    def test_turning_it_off_checks_nothing(self):
        with patch("api.views.site_settings.enqueue_task") as enqueue:
            self.client.post(
                "/api/sitesettings", {"update_check": False}, format="json"
            )
        enqueue.assert_not_called()
        self.assertFalse(site_config.UPDATE_CHECK)

    @override_settings(UPDATE_CHECK_ALLOWED=False)
    def test_the_environment_locks_it_off(self):
        response = self.client.post(
            "/api/sitesettings", {"update_check": True}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["code"], "update_check_locked")
        # Turning it off is always allowed.
        response = self.client.post(
            "/api/sitesettings", {"update_check": False}, format="json"
        )
        self.assertEqual(response.status_code, 200)

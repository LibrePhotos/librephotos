"""Whether admins were asked about error reporting yet (#2938).

The first-time setup asks a new instance's admin; an instance from before the
feature asks its admins once with a dialog. Either answer, and Not now, is kept
in the ERROR_REPORTING_ASKED site setting, so no admin on any device is asked
again.
"""

from constance import config as site_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.tests.utils import create_test_user

MAINTAINERS = "https://0123456789abcdef0123456789abcdef@errors.example.com/6"


@override_settings(ERROR_REPORTING_MAINTAINERS_DSN=MAINTAINERS)
class ErrorReportingAskedTest(TestCase):
    def setUp(self) -> None:
        self.admin = APIClient()
        self.admin.force_authenticate(create_test_user(is_admin=True))

    def asked(self) -> bool:
        return bool(
            self.admin.get("/api/sitesettings/").json()["error_reporting_asked"]
        )

    def test_nobody_was_asked_yet(self) -> None:
        self.assertFalse(self.asked())

    def test_only_admins_learn_it(self) -> None:
        user = APIClient()
        user.force_authenticate(create_test_user())
        self.assertNotIn("error_reporting_asked", user.get("/api/sitesettings/").json())
        self.assertNotIn(
            "error_reporting_asked", APIClient().get("/api/sitesettings/").json()
        )

    def test_any_answer_counts_as_asked(self) -> None:
        for choice in ("off", "maintainers"):
            with self.subTest(choice=choice):
                site_config.ERROR_REPORTING_ASKED = False
                response = self.admin.post(
                    "/api/sitesettings/", {"error_reporting": choice}, format="json"
                )
                self.assertEqual(response.status_code, 200, response.content)
                self.assertTrue(response.json()["error_reporting_asked"])
                self.assertEqual(response.json()["error_reporting"], choice)

    def test_not_now_is_kept_and_leaves_reporting_off(self) -> None:
        response = self.admin.post(
            "/api/sitesettings/", {"error_reporting_asked": True}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.asked())
        self.assertEqual(site_config.ERROR_REPORTING, "off")

    def test_being_asked_cannot_be_undone(self) -> None:
        site_config.ERROR_REPORTING_ASKED = True
        response = self.admin.post(
            "/api/sitesettings/", {"error_reporting_asked": False}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.asked())

    def test_non_admins_cannot_answer(self) -> None:
        user = APIClient()
        user.force_authenticate(create_test_user())
        response = user.post(
            "/api/sitesettings/", {"error_reporting_asked": True}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.asked())

"""Opting in (#2938): new errors are sent; saved ones only when the admin says so."""

import json
from unittest import mock

import sentry_sdk
from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import ErrorReport
from api.tests.error_reports.harness import capturing, inline_background, no_network
from api.tests.utils import create_test_error_report, create_test_user

MAINTAINERS = "https://0123456789abcdef0123456789abcdef@errors.example.com/6"
OWN = "https://fedcba9876543210fedcba9876543210@sentry.example.net/42"
MAINTAINERS_URL = "https://errors.example.com/api/6/envelope/"
OWN_URL = "https://sentry.example.net/api/42/envelope/"


def accepted() -> mock.Mock:
    return mock.Mock(status_code=200)


def raise_an_error() -> None:
    try:
        raise RuntimeError("the scanner fell over")
    except RuntimeError:
        sentry_sdk.capture_exception()


def posted_events(post: mock.Mock) -> list[dict[str, object]]:
    """The events in every envelope ``requests.post`` was given."""
    events = []
    for call in post.call_args_list:
        lines = call.kwargs["data"].splitlines()
        events.append(json.loads(lines[2]))
    return events


@override_settings(ERROR_REPORTING_MAINTAINERS_DSN=MAINTAINERS, SENTRY_DSN=OWN)
class OptedInTest(TestCase):
    def test_off_sends_nothing(self) -> None:
        with (
            no_network(),
            mock.patch("api.error_reports.send.requests.post") as post,
            capturing(),
        ):
            raise_an_error()
        post.assert_not_called()
        self.assertIsNone(ErrorReport.objects.get().sent_at)

    @override_config(ERROR_REPORTING="maintainers")
    def test_sharing_sends_a_new_error_to_the_maintainers(self) -> None:
        with (
            no_network(),
            mock.patch(
                "api.error_reports.send.requests.post", return_value=accepted()
            ) as post,
            capturing(),
        ):
            raise_an_error()

        post.assert_called_once()
        self.assertEqual(post.call_args.args[0], MAINTAINERS_URL)
        self.assertIn(
            "sentry_key=0123456789abcdef0123456789abcdef",
            post.call_args.kwargs["headers"]["X-Sentry-Auth"],
        )
        report = ErrorReport.objects.get()
        self.assertIsNotNone(report.sent_at)
        (event,) = posted_events(post)
        self.assertEqual(event["exception"], report.event["exception"])

    @override_config(ERROR_REPORTING="own_server")
    def test_my_own_server_gets_it_instead(self) -> None:
        with (
            no_network(),
            mock.patch(
                "api.error_reports.send.requests.post", return_value=accepted()
            ) as post,
            capturing(),
        ):
            raise_an_error()
        self.assertEqual(post.call_args.args[0], OWN_URL)

    @override_config(ERROR_REPORTING="maintainers")
    def test_a_refusing_server_leaves_the_report_saved(self) -> None:
        with (
            no_network(),
            mock.patch(
                "api.error_reports.send.requests.post",
                return_value=mock.Mock(status_code=429),
            ),
            capturing(),
        ):
            raise_an_error()
        self.assertIsNone(ErrorReport.objects.get().sent_at)


@override_settings(ERROR_REPORTING_MAINTAINERS_DSN=MAINTAINERS, SENTRY_DSN="")
class OptInFlowTest(TestCase):
    """The opt-in dialog: turn sharing on, then send the saved reports or not."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(create_test_user(is_admin=True))
        self.saved = [create_test_error_report(), create_test_error_report()]

    def opt_in(self) -> None:
        response = self.client.post(
            "/api/sitesettings/", {"error_reporting": "maintainers"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["error_reporting"], "maintainers")

    def test_opting_in_alone_sends_no_saved_report(self) -> None:
        with no_network(), mock.patch("api.error_reports.send.requests.post") as post:
            self.opt_in()
        post.assert_not_called()
        self.assertFalse(ErrorReport.objects.filter(sent_at__isnull=False).exists())

    def test_opting_in_and_choosing_to_send_the_saved_reports(self) -> None:
        with (
            no_network(),
            mock.patch(
                "api.error_reports.send.requests.post", return_value=accepted()
            ) as post,
        ):
            self.opt_in()
            response = self.client.post("/api/error-reports/send/")

        self.assertEqual(response.json(), {"sent": 2, "failed": 0})
        self.assertEqual(post.call_count, 2)
        self.assertFalse(ErrorReport.objects.filter(sent_at__isnull=True).exists())

    def test_a_new_browser_error_is_sent_once_opted_in(self) -> None:
        envelope = "\n".join(
            [
                json.dumps({"event_id": "1b2c3d4e5f60718293a4b5c6d7e8f901"}),
                json.dumps({"type": "event"}),
                json.dumps(
                    {
                        "platform": "javascript",
                        "exception": {"values": [{"type": "TypeError", "value": "x"}]},
                    }
                ),
            ]
        )
        with (
            no_network(),
            inline_background(),
            mock.patch(
                "api.error_reports.send.requests.post", return_value=accepted()
            ) as post,
        ):
            self.opt_in()
            response = self.client.post(
                "/api/error-reports/browser/", {"envelope": envelope}, format="json"
            )

        self.assertEqual(response.json(), {"saved": 1})
        post.assert_called_once()
        browser = ErrorReport.objects.get(source=ErrorReport.SOURCE_BROWSER)
        self.assertIsNotNone(browser.sent_at)

    def test_my_own_server_cannot_be_chosen_without_sentry_dsn(self) -> None:
        response = self.client.post(
            "/api/sitesettings/", {"error_reporting": "own_server"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["errors"][0]["code"], "error_reporting_unavailable"
        )

    def test_the_settings_say_which_servers_exist(self) -> None:
        body = self.client.get("/api/sitesettings/").json()
        self.assertEqual(body["error_reporting"], "off")
        self.assertFalse(body["error_reporting_own_server"])
        self.assertTrue(body["error_reporting_maintainers"])
        self.assertNotIn(MAINTAINERS, json.dumps(body))

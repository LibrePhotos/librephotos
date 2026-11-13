"""The Error reports page's endpoints (#2938) and the web app's forwarder."""

import json
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import ErrorReport
from api.tests.error_reports.harness import inline_background, no_network
from api.tests.utils import (
    create_test_error_report,
    create_test_person,
    create_test_user,
)

MAINTAINERS = "https://0123456789abcdef0123456789abcdef@errors.example.com/6"

ADMIN_ROUTES = (
    ("get", "/api/error-reports/"),
    ("delete", "/api/error-reports/"),
    ("post", "/api/error-reports/send/"),
    ("delete", "/api/error-reports/{id}/"),
    ("post", "/api/error-reports/{id}/send/"),
    ("get", "/api/error-reports/{id}/download/"),
)


def browser_envelope(
    value: str = "Cannot read properties of undefined",
    frames: list[dict[str, object]] | None = None,
) -> str:
    exception: dict[str, object] = {"type": "TypeError", "value": value}
    if frames is not None:
        exception["stacktrace"] = {"frames": frames}
    return "\n".join(
        [
            json.dumps({"event_id": "1b2c3d4e5f60718293a4b5c6d7e8f901"}),
            json.dumps({"type": "session"}),
            json.dumps({"status": "ok"}),
            json.dumps({"type": "event"}),
            json.dumps(
                {
                    "platform": "javascript",
                    "level": "error",
                    "exception": {"values": [exception]},
                    "request": {"url": "https://photos.example.org/person/1"},
                }
            ),
        ]
    )


class PermissionsTest(TestCase):
    def setUp(self) -> None:
        self.report = create_test_error_report()

    def test_non_admins_get_403_everywhere(self) -> None:
        client = APIClient()
        client.force_authenticate(create_test_user())
        for method, route in ADMIN_ROUTES:
            with self.subTest(method=method, route=route):
                response = getattr(client, method)(route.format(id=self.report.id))
                self.assertEqual(response.status_code, 403)
        self.assertTrue(ErrorReport.objects.filter(id=self.report.id).exists())

    def test_anonymous_requests_are_refused(self) -> None:
        for method, route in (*ADMIN_ROUTES, ("post", "/api/error-reports/browser/")):
            with self.subTest(method=method, route=route):
                response = getattr(APIClient(), method)(route.format(id=self.report.id))
                self.assertIn(response.status_code, (401, 403))


@override_settings(ERROR_REPORTING_MAINTAINERS_DSN=MAINTAINERS, SENTRY_DSN="")
class WithoutOptingInTest(TestCase):
    """Send once, Download and Delete work while error reporting is off."""

    def setUp(self) -> None:
        self.client = APIClient()
        self.client.force_authenticate(create_test_user(is_admin=True))
        self.report = create_test_error_report(title="KeyError: 'width'")

    def test_the_list(self) -> None:
        create_test_error_report(title="older")
        rows = self.client.get("/api/error-reports/").json()
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            set(rows[0]),
            {
                "id",
                "source",
                "title",
                "level",
                "release",
                "occurrences",
                "first_seen",
                "last_seen",
                "sent_at",
            },
        )

    def test_send_once_goes_to_the_maintainers(self) -> None:
        with (
            no_network(),
            mock.patch(
                "api.error_reports.send.requests.post",
                return_value=mock.Mock(status_code=200),
            ) as post,
        ):
            response = self.client.post(f"/api/error-reports/{self.report.id}/send/")

        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["sent_at"])
        self.assertEqual(
            post.call_args.args[0], "https://errors.example.com/api/6/envelope/"
        )

    def test_send_once_says_when_the_server_refuses(self) -> None:
        with (
            no_network(),
            mock.patch(
                "api.error_reports.send.requests.post",
                return_value=mock.Mock(status_code=500),
            ),
        ):
            response = self.client.post(f"/api/error-reports/{self.report.id}/send/")
        self.assertEqual(response.status_code, 502)
        self.report.refresh_from_db()
        self.assertIsNone(self.report.sent_at)

    @override_settings(ERROR_REPORTING_MAINTAINERS_DSN="")
    def test_send_once_without_any_server(self) -> None:
        response = self.client.post(f"/api/error-reports/{self.report.id}/send/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json()["errors"][0]["code"], "no_error_reporting_server"
        )

    def test_download_is_the_event_as_a_file(self) -> None:
        response = self.client.get(f"/api/error-reports/{self.report.id}/download/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertIn(
            f'filename="librephotos-error-report-{self.report.id}.json"',
            response["Content-Disposition"],
        )
        self.assertEqual(json.loads(response.content), self.report.event)

    def test_delete_one_and_delete_all(self) -> None:
        other = create_test_error_report()
        self.assertEqual(
            self.client.delete(f"/api/error-reports/{self.report.id}/").status_code,
            204,
        )
        self.assertEqual(
            list(ErrorReport.objects.values_list("id", flat=True)), [other.id]
        )
        self.assertEqual(self.client.delete("/api/error-reports/").status_code, 204)
        self.assertFalse(ErrorReport.objects.exists())

    def test_a_missing_report_is_404(self) -> None:
        self.assertEqual(
            self.client.post("/api/error-reports/999999/send/").status_code, 404
        )


class BrowserForwarderTest(TestCase):
    def setUp(self) -> None:
        cache.clear()
        self.user = create_test_user()
        create_test_person(name="Aunt Hildegard", cluster_owner=self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def post(self, envelope: str) -> int:
        with no_network(), inline_background():
            response = self.client.post(
                "/api/error-reports/browser/", {"envelope": envelope}, format="json"
            )
        return response.status_code

    def test_any_signed_in_user_forwards_scrubbed_errors_and_nothing_is_sent(
        self,
    ) -> None:
        self.assertEqual(self.post(browser_envelope("no Aunt Hildegard here")), 200)
        report = ErrorReport.objects.get()
        self.assertEqual(report.source, ErrorReport.SOURCE_BROWSER)
        self.assertIsNone(report.sent_at)
        stored = json.dumps(report.event)
        self.assertNotIn("Hildegard", stored)
        self.assertNotIn("photos.example.org", stored)

    def test_an_error_from_a_script_the_page_did_not_load_is_dropped(self) -> None:
        # A wallet extension or an in-app browser runs its own code in the
        # page; its only frame is the page itself. Ten such reports in 1.6.0.
        injected = browser_envelope(
            "undefined is not an object "
            "(evaluating 'window.ethereum.selectedAddress = undefined')",
            frames=[
                {
                    "filename": "https://photos.example.org/album/persons/22",
                    "function": "global code",
                    "lineno": 1,
                }
            ],
        )

        with no_network(), inline_background():
            response = self.client.post(
                "/api/error-reports/browser/", {"envelope": injected}, format="json"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"saved": 0})
        self.assertFalse(ErrorReport.objects.exists())

    def test_an_error_with_a_frame_of_the_web_app_is_kept(self) -> None:
        envelope = browser_envelope(
            frames=[
                {"filename": "https://photos.example.org/person/1", "lineno": 1},
                {
                    "filename": "https://photos.example.org/assets/index-BfX2a9.js",
                    "function": "PersonCard",
                    "lineno": 12,
                },
            ]
        )

        self.assertEqual(self.post(envelope), 200)
        self.assertEqual(ErrorReport.objects.count(), 1)

    def test_something_else_is_a_400(self) -> None:
        self.assertEqual(self.post("not an envelope"), 400)

    def test_a_huge_envelope_is_a_400(self) -> None:
        self.assertEqual(self.post(browser_envelope("x" * 250_000)), 400)

    def test_it_is_rate_limited(self) -> None:
        codes = [self.post(browser_envelope(f"error {i}")) for i in range(12)]
        self.assertIn(429, codes)
        self.assertLessEqual(ErrorReport.objects.count(), 10)

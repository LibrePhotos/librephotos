"""A fresh instance sends nothing, but keeps its errors scrubbed (#2938).

With the default site settings (error reporting off) an error in the backend
is captured, scrubbed and saved, and no connection leaves the process: not to
the maintainers' server, not to any other.
"""

import json
import logging

import sentry_sdk
from django.test import TestCase, override_settings

from api.models.error_report import ErrorReport
from api.tests.error_reports.harness import capturing, no_network
from api.tests.utils import create_test_person, create_test_user

LIBRARY = "/data/photos"

logger = logging.getLogger("api.views.photos")


@override_settings(
    DATA_ROOT=LIBRARY,
    SENTRY_DSN="",
    ERROR_REPORTING_MAINTAINERS_DSN="https://0123456789abcdef0123456789abcdef@errors.example.com/1",
)
class FreshInstanceSendsNothingTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user(
            username="gretchen", email="gretchen@example.org", scan_directory=LIBRARY
        )
        create_test_person(name="Aunt Hildegard", cluster_owner=self.user)

    def test_an_exception_is_saved_scrubbed_and_nothing_is_sent(self) -> None:
        with no_network() as outbound, capturing():
            try:
                open(f"{LIBRARY}/gretchen/Aunt Hildegard/IMG_0042.jpg", "rb")
            except FileNotFoundError:
                sentry_sdk.capture_exception()

        self.assertEqual(outbound.attempts, [])
        report = ErrorReport.objects.get()
        self.assertEqual(report.source, ErrorReport.SOURCE_SERVER)
        self.assertIsNone(report.sent_at)
        self.assertIn("FileNotFoundError", report.title)
        stored = json.dumps(report.event)
        for private in ("gretchen", "Hildegard", "IMG_0042", LIBRARY):
            self.assertNotIn(private, stored)

    def test_a_logged_error_is_saved_and_nothing_is_sent(self) -> None:
        # The test settings raise every logger to CRITICAL.
        logger.setLevel(logging.ERROR)
        self.addCleanup(logger.setLevel, logging.NOTSET)
        with no_network() as outbound, capturing():
            logger.error("Could not read %s for %s", "/data/photos/x.jpg", "gretchen")

        self.assertEqual(outbound.attempts, [])
        report = ErrorReport.objects.get()
        stored = json.dumps(report.event)
        self.assertNotIn("gretchen", stored)
        self.assertNotIn("/data/photos", stored)
        self.assertIn("Could not read", report.title)

import asyncio
import logging

from django.test import TestCase, override_settings

from api.models.error_report import ErrorReport
from api.tests.error_reports.harness import capturing, no_network

CONNECTION_LOST = (
    "Exception in callback _ProactorBasePipeTransport._call_connection_lost()"
)


@override_settings(SENTRY_DSN="")
class ClientDisconnectsAreNotReportsTest(TestCase):
    def setUp(self) -> None:
        log = logging.getLogger("asyncio")
        level = log.level
        log.setLevel(logging.ERROR)
        self.addCleanup(log.setLevel, level)

    def _reports(self, message: str, error: Exception) -> int:
        loop = asyncio.new_event_loop()
        self.addCleanup(loop.close)
        with no_network(), capturing():
            loop.call_exception_handler({"message": message, "exception": error})
        return ErrorReport.objects.count()

    def test_a_reset_connection_is_not_a_report(self) -> None:
        reset = ConnectionResetError(
            0, "An existing connection was forcibly closed", None, 10054
        )

        self.assertEqual(self._reports(CONNECTION_LOST, reset), 0)

    def test_a_socket_already_gone_is_not_a_report(self) -> None:
        invalid = OSError(0, "An invalid argument was supplied", None, 10022)

        self.assertEqual(self._reports(CONNECTION_LOST, invalid), 0)

    def test_another_callback_error_is_still_a_report(self) -> None:
        message = "Exception in callback Server._accept_connection()"

        self.assertEqual(self._reports(message, ValueError("bug")), 1)

    def test_a_bug_in_connection_lost_is_still_a_report(self) -> None:
        self.assertEqual(self._reports(CONNECTION_LOST, TypeError("bug")), 1)

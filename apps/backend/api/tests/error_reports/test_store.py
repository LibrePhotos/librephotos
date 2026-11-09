"""The saved list (#2938): repeats counted, at most 30 reports, none older than 30 days."""

import datetime

from django.test import TestCase
from django.utils import timezone

from api.error_reports.scrub import SOURCE_SERVER, JsonObject
from api.error_reports.store import MAX_EVENT_BYTES, MAX_REPORTS, fit, save_event
from api.models import ErrorReport
from api.tests.utils import create_test_error_report


def error_event(kind: str = "ValueError", value: str = "boom") -> JsonObject:
    return {
        "level": "error",
        "platform": "python",
        "exception": {
            "values": [
                {
                    "type": kind,
                    "value": value,
                    "stacktrace": {
                        "frames": [{"module": "api.views.photos", "function": "get"}]
                    },
                }
            ]
        },
    }


def log_event(message: str) -> JsonObject:
    """A log line without a stack, as django-q logs a pusher it restarted."""
    return {
        "level": "critical",
        "platform": "python",
        "logger": "django-q",
        "logentry": {"message": message, "formatted": message},
    }


class SaveEventTest(TestCase):
    def test_the_same_error_again_counts_as_an_occurrence(self) -> None:
        first, created = save_event(error_event(value="id 1"), SOURCE_SERVER)
        again, created_again = save_event(error_event(value="id 2"), SOURCE_SERVER)

        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(again.id, first.id)
        self.assertEqual(again.occurrences, 2)
        self.assertEqual(ErrorReport.objects.count(), 1)

    def test_a_log_line_repeats_whatever_ids_and_numbers_it_carries(self) -> None:
        # 17 reports of one restart loop, each naming another process.
        first, created = save_event(
            log_event(
                "reincarnated pusher Process-3f9c2e7a41d84b0c9e6a5d1f2b7c8e90 "
                "after sudden death"
            ),
            SOURCE_SERVER,
        )
        cases = [
            "reincarnated pusher Process-0a1b2c3d4e5f60718293a4b5c6d7e8f9 "
            "after sudden death",
            "reincarnated pusher Process-6f1d0c55-3a2e-4c7b-9d10-2e8f4b6a7c91 "
            "after sudden death",
            "reincarnated pusher Process-12 after sudden death",
        ]
        for message in cases:
            with self.subTest(message=message):
                again, created_again = save_event(log_event(message), SOURCE_SERVER)
                self.assertFalse(created_again)
                self.assertEqual(again.id, first.id)

        self.assertTrue(created)
        self.assertEqual(ErrorReport.objects.get().occurrences, 4)
        # Only the grouping ignores the id; the saved text keeps it.
        self.assertIn("Process-3f9c2e7a41d84b0c9e6a5d1f2b7c8e90", first.title)
        _, other = save_event(
            log_event("reincarnated worker Process-12 after sudden death"),
            SOURCE_SERVER,
        )
        self.assertTrue(other)

    def test_a_different_error_is_a_new_report(self) -> None:
        save_event(error_event("ValueError"), SOURCE_SERVER)
        save_event(error_event("KeyError"), SOURCE_SERVER)
        self.assertEqual(ErrorReport.objects.count(), 2)

    def test_the_same_error_a_day_later_is_a_new_report(self) -> None:
        first, _ = save_event(error_event(), SOURCE_SERVER)
        ErrorReport.objects.filter(id=first.id).update(
            last_seen=timezone.now() - datetime.timedelta(days=2)
        )
        _, created = save_event(error_event(), SOURCE_SERVER)
        self.assertTrue(created)

    def test_the_list_keeps_the_newest_reports(self) -> None:
        now = timezone.now()
        old = [
            create_test_error_report(last_seen=now - datetime.timedelta(minutes=i))
            for i in range(1, MAX_REPORTS + 1)
        ]

        newest, _ = save_event(error_event(), SOURCE_SERVER)

        self.assertEqual(ErrorReport.objects.count(), MAX_REPORTS)
        self.assertTrue(ErrorReport.objects.filter(id=newest.id).exists())
        self.assertFalse(ErrorReport.objects.filter(id=old[-1].id).exists())

    def test_reports_older_than_a_month_go(self) -> None:
        stale = create_test_error_report(
            last_seen=timezone.now() - datetime.timedelta(days=31)
        )
        save_event(error_event(), SOURCE_SERVER)
        self.assertFalse(ErrorReport.objects.filter(id=stale.id).exists())

    def test_a_huge_event_is_cut_to_size(self) -> None:
        frames: list[JsonObject] = [
            {
                "function": f"f{i}",
                "context_line": "x" * 300,
                "pre_context": ["y" * 300] * 5,
            }
            for i in range(200)
        ]
        event: JsonObject = {
            "exception": {"values": [{"type": "E", "stacktrace": {"frames": frames}}]}
        }
        self.assertLessEqual(len(str(fit(event))), MAX_EVENT_BYTES * 1.1)

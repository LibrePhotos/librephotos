"""The daily update check (#2311): what it asks GitHub, what it keeps, and
what admins are told."""

import datetime
import json
from io import StringIO
from unittest.mock import MagicMock, patch

import requests
from constance import config as site_config
from constance.test import override_config
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from django_q.models import Schedule

from api.updates import check
from api.updates.check import (
    RELEASES_URL,
    SCHEDULED_CHECK,
    WINDOWS_ASSET,
    CheckResult,
    check_for_updates,
    newest_release,
    skip_release,
    snooze_notice,
    update_status,
)


def release(tag, *, assets=(WINDOWS_ASSET,), draft=False, prerelease=False):
    return {
        "tag_name": tag,
        "html_url": f"https://github.com/LibrePhotos/librephotos/releases/tag/{tag}",
        "published_at": "2026-10-17T14:36:43Z",
        "draft": draft,
        "prerelease": prerelease,
        "assets": [{"name": name} for name in assets],
    }


# As GitHub lists them: newest first by date, with a pre-release and a release
# created without its zip yet (make_latest=false, #2318).
RELEASES = [
    release("windows-wheels-2026.10.22", prerelease=True),
    release("1.5.0", assets=()),
    release("1.4.0", assets=("librephotos-1.4.0-windows-x64.zip", WINDOWS_ASSET)),
    release("1.3.0"),
    release("2026w25", assets=()),
]


def session_answering(releases=RELEASES, *, status=200, error=None):
    session = MagicMock(spec=requests.Session)
    if error is not None:
        session.get.side_effect = error
        return session
    response = MagicMock(ok=200 <= status < 300, status_code=status)
    response.json.return_value = releases
    session.get.return_value = response
    return session


@override_settings(IMAGE_TAG="1.3.0", INSTALL_TYPE="docker", UPDATE_CHECK_ALLOWED=True)
class CheckForUpdatesTest(TestCase):
    def test_finds_the_newest_release_by_version_not_by_the_latest_flag(self):
        session = session_answering()
        status = check_for_updates(session)
        session.get.assert_called_once()
        self.assertEqual(session.get.call_args.args, (RELEASES_URL,))
        self.assertEqual(status["latest"], "1.5.0")
        self.assertTrue(status["update_available"])
        self.assertTrue(status["notice"])
        self.assertEqual(status["status"], "available")
        self.assertEqual(
            status["release_url"],
            "https://github.com/LibrePhotos/librephotos/releases/tag/1.5.0",
        )
        self.assertIsNotNone(status["checked_at"])
        self.assertIsNone(status["error"])

    def test_sends_nothing_about_this_server(self):
        session = session_answering()
        check_for_updates(session)
        kwargs = session.get.call_args.kwargs
        self.assertEqual(kwargs["params"], {"per_page": check.RELEASES_PER_PAGE})
        self.assertEqual(set(kwargs["headers"]), {"Accept"})
        self.assertNotIn("cookies", kwargs)
        self.assertNotIn("auth", kwargs)

    @override_settings(INSTALL_TYPE="windows")
    def test_the_windows_app_is_offered_only_a_release_with_its_zip(self):
        status = check_for_updates(session_answering())
        self.assertEqual(status["latest"], "1.4.0")
        self.assertEqual(
            status["how_to_update_url"],
            "https://docs.librephotos.com/docs/installation/windows-standalone#updating",
        )

    def test_docker_gets_the_upgrading_page(self):
        status = check_for_updates(session_answering())
        self.assertEqual(
            status["how_to_update_url"],
            "https://docs.librephotos.com/docs/installation/upgrading",
        )

    @override_settings(IMAGE_TAG="1.5.0")
    def test_the_newest_release_running_is_up_to_date(self):
        status = check_for_updates(session_answering())
        self.assertEqual(status["status"], "up_to_date")
        self.assertFalse(status["update_available"])
        self.assertFalse(status["notice"])

    def test_an_http_error_is_stored_not_raised_and_keeps_what_was_known(self):
        check_for_updates(session_answering())
        status = check_for_updates(session_answering(status=403))
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["error"], "http_403")
        self.assertEqual(status["latest"], "1.5.0")
        self.assertTrue(status["notice"])

    def test_a_timeout_is_stored(self):
        status = check_for_updates(session_answering(error=requests.Timeout()))
        self.assertEqual((status["status"], status["error"]), ("failed", "timeout"))
        self.assertIsNone(status["latest"])

    def test_no_connection_is_stored(self):
        status = check_for_updates(
            session_answering(error=requests.ConnectionError("no route"))
        )
        self.assertEqual(status["error"], "unreachable")

    def test_an_answer_that_is_not_a_list_is_stored(self):
        status = check_for_updates(session_answering({"message": "rate limited"}))
        self.assertEqual(status["error"], "bad_response")

    def test_an_answer_that_is_not_json_is_stored(self):
        session = session_answering()
        session.get.return_value.json.side_effect = ValueError("not json")
        self.assertEqual(check_for_updates(session)["error"], "bad_response")

    def test_no_release_at_all_is_up_to_date(self):
        status = check_for_updates(session_answering([]))
        self.assertEqual(status["status"], "up_to_date")
        self.assertIsNone(status["latest"])

    @override_config(UPDATE_CHECK=False)
    def test_the_site_setting_off_sends_nothing(self):
        session = session_answering()
        status = check_for_updates(session)
        session.get.assert_not_called()
        self.assertFalse(status["enabled"])
        self.assertEqual(status["status"], "off")

    @override_settings(UPDATE_CHECK_ALLOWED=False)
    def test_the_environment_variable_off_sends_nothing(self):
        session = session_answering()
        status = check_for_updates(session)
        session.get.assert_not_called()
        self.assertFalse(status["enabled"])
        self.assertTrue(status["locked"])
        self.assertEqual(status["status"], "locked")

    def test_a_development_build_sends_nothing(self):
        for tag in ("dev", "", "windows-wheels-2026.09.16"):
            with self.subTest(tag=tag), override_settings(IMAGE_TAG=tag):
                session = session_answering()
                status = check_for_updates(session)
                session.get.assert_not_called()
                self.assertEqual(status["status"], "development")
                self.assertFalse(status["update_available"])

    def test_without_a_session_it_opens_and_closes_its_own(self):
        answer = session_answering().get.return_value
        with patch.object(check.requests, "Session") as session_class:
            session = session_class.return_value.__enter__.return_value
            session.get.return_value = answer
            status = check_for_updates()
        self.assertEqual(status["latest"], "1.5.0")
        session_class.return_value.__exit__.assert_called_once()

    def test_a_stored_result_made_before_an_update_reads_as_up_to_date(self):
        check_for_updates(session_answering())
        with override_settings(IMAGE_TAG="1.5.0"):
            self.assertEqual(update_status()["status"], "up_to_date")


@override_settings(IMAGE_TAG="1.3.0", INSTALL_TYPE="docker", UPDATE_CHECK_ALLOWED=True)
class SkipAndSnoozeTest(TestCase):
    def setUp(self):
        check_for_updates(session_answering())

    def test_a_skipped_release_has_no_notice_until_a_newer_one(self):
        skip_release("1.5.0")
        status = update_status()
        self.assertEqual(status["status"], "skipped")
        self.assertTrue(status["update_available"])
        self.assertFalse(status["notice"])
        self.assertEqual(status["skipped_release"], "1.5.0")
        check_for_updates(session_answering([release("1.6.0"), *RELEASES]))
        self.assertTrue(update_status()["notice"])

    def test_an_empty_skip_shows_it_again(self):
        skip_release("1.5.0")
        skip_release("")
        self.assertTrue(update_status()["notice"])

    def test_closing_the_card_hides_it_for_a_week(self):
        now = timezone.now()
        snooze_notice(now)
        status = update_status(now + datetime.timedelta(days=6))
        self.assertFalse(status["notice"])
        self.assertEqual(status["status"], "available")
        self.assertIsNotNone(status["snoozed_until"])
        later = update_status(now + datetime.timedelta(days=8))
        self.assertTrue(later["notice"])
        self.assertIsNone(later["snoozed_until"])

    @override_config(UPDATE_CHECK_SNOOZED_UNTIL="not a time")
    def test_an_unreadable_snooze_is_no_snooze(self):
        self.assertTrue(update_status()["notice"])


class NewestReleaseTest(TestCase):
    def test_drafts_pre_releases_and_other_tags_are_left_out(self):
        releases = [
            release("2.0.0", draft=True),
            release("1.9.0", prerelease=True),
            release("windows-wheels-2026.10.22"),
            "not a release",
            {"tag_name": 5},
            release("1.2.0"),
        ]
        newest = newest_release(releases, windows=False)
        self.assertIsNotNone(newest)
        self.assertEqual(newest.latest, "1.2.0")

    def test_a_release_without_assets_is_not_offered_to_windows(self):
        self.assertIsNone(
            newest_release([{"tag_name": "1.2.0", "assets": None}], windows=True)
        )

    def test_missing_links_stay_empty(self):
        newest = newest_release([{"tag_name": "1.2.0"}], windows=False)
        self.assertEqual((newest.release_url, newest.published_at), (None, None))


class StoredResultTest(TestCase):
    def test_round_trip(self):
        result = CheckResult(checked_at="2026-10-22T10:00:00+00:00", latest="1.5.0")
        self.assertEqual(CheckResult.from_json(result.to_json()), result)

    def test_nothing_or_garbage_is_no_result(self):
        for text in ("", "[]", "{", json.dumps({"unknown": 1})):
            with self.subTest(text=text):
                self.assertIsNone(CheckResult.from_json(text))


class ScheduleTest(TestCase):
    def test_start_cleaning_service_schedules_the_daily_check_once(self):
        call_command("start_cleaning_service", stdout=StringIO())
        call_command("start_cleaning_service", stdout=StringIO())
        schedules = Schedule.objects.filter(func=SCHEDULED_CHECK)
        self.assertEqual(schedules.count(), 1)
        self.assertEqual(schedules.get().schedule_type, Schedule.DAILY)

    @override_settings(IMAGE_TAG="1.3.0", UPDATE_CHECK_ALLOWED=True)
    def test_the_scheduled_function_runs_without_arguments(self):
        with patch.object(check, "_run_check_in_new_session") as run:
            run.return_value = CheckResult(checked_at=timezone.now().isoformat())
            check_for_updates()
        run.assert_called_once_with()
        self.assertTrue(str(site_config.UPDATE_CHECK_RESULT))

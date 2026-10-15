"""The automatic library scan (#235, api/directory_watcher/scan_schedule.py).

An admin picks off, every hour, every day or custom days in the site settings.
That writes one django-q schedule; each run queues the Library page's
incremental scan for every user with a library, skips a user whose scan is
still running, and records what it did for the status line.
"""

import datetime
import json
import shutil
import tempfile
from unittest.mock import patch

from constance import config
from constance.test import override_config
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from django_q.models import Schedule
from rest_framework.test import APIClient

from api.directory_watcher.scan_schedule import (
    ALL_DAYS,
    CUSTOM,
    DAILY,
    HOURLY,
    OFF,
    SCHEDULED_SCANS,
    LastRun,
    ScanSchedule,
    parse_days,
    parse_time,
    scan_schedule_status,
    scheduled_library_scans,
    sync_scan_schedule,
)
from api.jobs.queue import Task, remove_schedule, replace_schedule
from api.models import LongRunningJob
from api.tests.utils import (
    api_error,
    create_test_job,
    create_test_user,
    patch_nextcloud_dns,
)

UTC = datetime.timezone.utc
# A Wednesday.
WEDNESDAY_NOON = datetime.datetime(2026, 10, 14, 12, 30, tzinfo=UTC)


def _config(frequency=OFF, at="03:00", days="0,1,2,3,4", last_run=""):
    return {
        "AUTO_SCAN": frequency,
        "AUTO_SCAN_TIME": at,
        "AUTO_SCAN_DAYS": days,
        "AUTO_SCAN_LAST_RUN": last_run,
    }


class ParsingTest(SimpleTestCase):
    def test_times(self):
        self.assertEqual(parse_time("22:30"), datetime.time(22, 30))
        self.assertEqual(parse_time(" 07:05 "), datetime.time(7, 5))
        for bad in ("", "24:00", "7:5", "noon", "12:60"):
            with self.subTest(value=bad):
                self.assertEqual(parse_time(bad), datetime.time(3, 0))

    def test_days(self):
        self.assertEqual(parse_days("0, 2,4"), frozenset({0, 2, 4}))
        self.assertEqual(parse_days("9,x,,-1,6"), frozenset({6}))
        self.assertEqual(parse_days(""), frozenset())

    def test_from_config(self):
        schedule = ScanSchedule.from_config(_config(CUSTOM, "22:30", "5,6"))
        self.assertEqual(schedule.frequency, CUSTOM)
        self.assertEqual(schedule.at, datetime.time(22, 30))
        self.assertEqual(schedule.days, frozenset({5, 6}))
        # Only a custom schedule keeps its days; an unknown frequency is off.
        self.assertEqual(ScanSchedule.from_config(_config(DAILY)).days, ALL_DAYS)
        self.assertEqual(ScanSchedule.from_config(_config("weekly")).frequency, OFF)

    def test_names_say_what_the_schedule_does(self):
        self.assertEqual(ScanSchedule(HOURLY).name, "Library scan: every hour")
        self.assertEqual(
            ScanSchedule(DAILY, datetime.time(3, 0)).name,
            "Library scan: every day at 03:00",
        )
        self.assertEqual(
            ScanSchedule(CUSTOM, datetime.time(22, 30), frozenset({4, 0})).name,
            "Library scan: Mon, Fri at 22:30",
        )


class NextRunTest(SimpleTestCase):
    def test_off_never_runs(self):
        self.assertIsNone(ScanSchedule(OFF).next_run(WEDNESDAY_NOON))
        self.assertFalse(ScanSchedule(OFF).runs_on(WEDNESDAY_NOON))

    def test_custom_without_a_day_never_runs(self):
        self.assertIsNone(
            ScanSchedule(CUSTOM, days=frozenset()).next_run(WEDNESDAY_NOON)
        )

    def test_hourly_runs_at_the_next_full_hour(self):
        self.assertEqual(
            ScanSchedule(HOURLY).next_run(WEDNESDAY_NOON),
            datetime.datetime(2026, 10, 14, 13, 0, tzinfo=UTC),
        )

    def test_daily_runs_today_when_the_time_is_ahead(self):
        schedule = ScanSchedule(DAILY, datetime.time(22, 30))
        self.assertEqual(
            schedule.next_run(WEDNESDAY_NOON),
            datetime.datetime(2026, 10, 14, 22, 30, tzinfo=UTC),
        )

    def test_daily_runs_tomorrow_when_the_time_is_past(self):
        schedule = ScanSchedule(DAILY, datetime.time(3, 0))
        self.assertEqual(
            schedule.next_run(WEDNESDAY_NOON),
            datetime.datetime(2026, 10, 15, 3, 0, tzinfo=UTC),
        )

    def test_custom_runs_on_the_next_picked_day(self):
        # Monday only, from a Wednesday: next Monday.
        schedule = ScanSchedule(CUSTOM, datetime.time(3, 0), frozenset({0}))
        self.assertEqual(
            schedule.next_run(WEDNESDAY_NOON),
            datetime.datetime(2026, 10, 19, 3, 0, tzinfo=UTC),
        )
        # Wednesday only, after today's time: a week later.
        schedule = ScanSchedule(CUSTOM, datetime.time(3, 0), frozenset({2}))
        self.assertEqual(
            schedule.next_run(WEDNESDAY_NOON),
            datetime.datetime(2026, 10, 21, 3, 0, tzinfo=UTC),
        )

    def test_custom_runs_only_on_its_days(self):
        schedule = ScanSchedule(CUSTOM, days=frozenset({2}))
        self.assertTrue(schedule.runs_on(WEDNESDAY_NOON))
        self.assertFalse(schedule.runs_on(WEDNESDAY_NOON + datetime.timedelta(days=1)))
        self.assertTrue(ScanSchedule(DAILY).runs_on(WEDNESDAY_NOON))


class LastRunRecordTest(SimpleTestCase):
    def test_round_trip(self):
        run = LastRun(
            at=WEDNESDAY_NOON, started={3: ["a", "b"]}, skipped=[4], failed=[5]
        )
        self.assertEqual(LastRun.from_json(run.to_json()), run)

    def test_nothing_or_garbage_is_no_run(self):
        for text in ("", "not json", "[]", json.dumps({"at": "x"})):
            with self.subTest(text=text):
                self.assertIsNone(LastRun.from_json(text))


class ScheduleRowTest(TestCase):
    def _rows(self):
        return list(Schedule.objects.filter(func=SCHEDULED_SCANS))

    def test_off_has_no_schedule(self):
        sync_scan_schedule(ScanSchedule(DAILY))
        self.assertTrue(sync_scan_schedule(ScanSchedule(OFF)))
        self.assertEqual(self._rows(), [])
        self.assertFalse(sync_scan_schedule(ScanSchedule(OFF)))

    def test_daily_schedule(self):
        self.assertTrue(sync_scan_schedule(ScanSchedule(DAILY, datetime.time(4, 15))))
        [row] = self._rows()
        self.assertEqual(row.schedule_type, Schedule.DAILY)
        self.assertEqual(row.name, "Library scan: every day at 04:15")
        self.assertEqual((row.next_run.hour, row.next_run.minute), (4, 15))
        self.assertEqual(row.intended_date_kwarg, "intended_at")
        self.assertEqual(row.repeats, -1)

    def test_an_unchanged_setting_keeps_its_next_run(self):
        sync_scan_schedule(ScanSchedule(DAILY))
        Schedule.objects.filter(func=SCHEDULED_SCANS).update(next_run=WEDNESDAY_NOON)
        self.assertFalse(sync_scan_schedule(ScanSchedule(DAILY)))
        [row] = self._rows()
        self.assertEqual(row.next_run, WEDNESDAY_NOON)

    def test_a_changed_setting_replaces_the_schedule(self):
        sync_scan_schedule(ScanSchedule(DAILY))
        self.assertTrue(sync_scan_schedule(ScanSchedule(HOURLY)))
        [row] = self._rows()
        self.assertEqual(row.schedule_type, Schedule.HOURLY)
        self.assertEqual(row.next_run.minute, 0)

    def test_custom_runs_daily_and_starts_on_a_picked_day(self):
        sync_scan_schedule(ScanSchedule(CUSTOM, days=frozenset({6})))
        [row] = self._rows()
        self.assertEqual(row.schedule_type, Schedule.DAILY)
        self.assertEqual(row.next_run.weekday(), 6)

    @override_config(AUTO_SCAN=HOURLY)
    def test_reads_the_site_setting(self):
        sync_scan_schedule()
        [row] = self._rows()
        self.assertEqual(row.schedule_type, Schedule.HOURLY)

    @override_config(AUTO_SCAN=DAILY)
    def test_start_cleaning_service_puts_the_schedule_back(self):
        call_command("start_cleaning_service")
        self.assertEqual(len(self._rows()), 1)
        with override_config(AUTO_SCAN=OFF):
            call_command("start_cleaning_service")
        self.assertEqual(self._rows(), [])


class ReplaceScheduleTest(TestCase):
    FUNC = "api.photos.retention.prune_deletion_log"

    def test_another_name_replaces_the_schedule(self):
        self.assertTrue(
            replace_schedule(self.FUNC, name="a", schedule_type=Schedule.DAILY)
        )
        self.assertFalse(
            replace_schedule(self.FUNC, name="a", schedule_type=Schedule.HOURLY)
        )
        self.assertTrue(
            replace_schedule(self.FUNC, name="b", schedule_type=Schedule.HOURLY)
        )
        [row] = Schedule.objects.filter(func=self.FUNC)
        self.assertEqual((row.name, row.schedule_type), ("b", Schedule.HOURLY))

    def test_remove_schedule(self):
        replace_schedule(self.FUNC, name="a", schedule_type=Schedule.DAILY)
        self.assertTrue(remove_schedule(self.FUNC))
        self.assertFalse(remove_schedule(self.FUNC))


@patch(
    "api.directory_watcher.scan_schedule.missing_models_prerequisites",
    return_value=[],
)
@patch("api.jobs.queue.Chain")
@patch("api.jobs.queue.AsyncTask")
class ScheduledScansTest(TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)

    def _library(self):
        return tempfile.mkdtemp(dir=self.root)

    def _run(self, intended_at=None):
        with self.captureOnCommitCallbacks(execute=True):
            return scheduled_library_scans(intended_at)

    def _last_run(self):
        return LastRun.from_json(config.AUTO_SCAN_LAST_RUN)

    @override_config(AUTO_SCAN=DAILY)
    def test_queues_an_incremental_scan_per_library(self, async_task, chain, models):
        anna = create_test_user(scan_directory=self._library())
        bob = create_test_user(scan_directory=self._library())
        create_test_user(scan_directory="")

        self.assertEqual(self._run(), {"started": 2, "skipped": 0, "failed": 0})

        jobs = LongRunningJob.objects.filter(job_type=LongRunningJob.JOB_SCAN_PHOTOS)
        self.assertEqual({job.started_by for job in jobs}, {anna, bob})
        self.assertEqual(async_task.call_count, 2)
        for call in async_task.call_args_list:
            user, full_scan = call.args[1:3]
            self.assertFalse(full_scan)
            self.assertEqual(call.kwargs["scan_directory"], user.scan_directory)
        run = self._last_run()
        self.assertEqual(set(run.started), {anna.id, bob.id})
        self.assertEqual(run.skipped, [])

    @override_config(AUTO_SCAN=HOURLY)
    def test_a_user_whose_scan_still_runs_is_skipped(self, async_task, chain, models):
        busy = create_test_user(scan_directory=self._library())
        running = create_test_job(busy, job_type=LongRunningJob.JOB_SCAN_PHOTOS)
        idle = create_test_user(scan_directory=self._library())

        self.assertEqual(self._run(), {"started": 1, "skipped": 1, "failed": 0})

        self.assertEqual(
            LongRunningJob.objects.owned_by(busy).get().job_id, running.job_id
        )
        run = self._last_run()
        self.assertEqual(run.skipped, [busy.id])
        self.assertEqual(list(run.started), [idle.id])

    @override_config(AUTO_SCAN=DAILY)
    def test_a_missing_scan_directory_fails_without_a_job(
        self, async_task, chain, models
    ):
        gone = create_test_user(scan_directory=f"{self.root}/gone")

        self.assertEqual(self._run(), {"started": 0, "skipped": 0, "failed": 1})

        self.assertFalse(LongRunningJob.objects.owned_by(gone).exists())
        self.assertEqual(self._last_run().failed, [gone.id])

    @override_config(AUTO_SCAN=DAILY)
    def test_a_queue_failure_counts_as_failed(self, async_task, chain, models):
        user = create_test_user(scan_directory=self._library())
        with patch(
            "api.directory_watcher.scan_schedule.enqueue_chain",
            side_effect=RuntimeError("broker down"),
        ):
            self.assertEqual(self._run(), {"started": 0, "skipped": 0, "failed": 1})
        self.assertEqual(self._last_run().failed, [user.id])

    @override_config(AUTO_SCAN=DAILY)
    def test_missing_models_download_once(self, async_task, chain, models):
        models.return_value = [Task(print)]
        create_test_user(scan_directory=self._library())
        create_test_user(scan_directory=self._library())

        self._run()

        models.assert_called_once()
        # The first scan waits for the download in a chain; the second is queued alone.
        chain.return_value.run.assert_called_once_with()
        async_task.assert_called_once()

    @override_config(AUTO_SCAN=CUSTOM, AUTO_SCAN_DAYS="0")
    def test_custom_skips_a_day_that_is_not_picked(self, async_task, chain, models):
        create_test_user(scan_directory=self._library())

        self.assertEqual(self._run(WEDNESDAY_NOON.isoformat()), {})

        self.assertFalse(LongRunningJob.objects.exists())
        self.assertEqual(config.AUTO_SCAN_LAST_RUN, "")

    @override_config(AUTO_SCAN=CUSTOM, AUTO_SCAN_DAYS="2")
    def test_custom_goes_by_the_intended_day(self, async_task, chain, models):
        create_test_user(scan_directory=self._library())
        # Due on Wednesday, picked up from a busy queue on Thursday.
        with patch(
            "api.directory_watcher.scan_schedule.timezone.now",
            return_value=WEDNESDAY_NOON + datetime.timedelta(days=1),
        ):
            result = self._run(WEDNESDAY_NOON.isoformat())
        self.assertEqual(result["started"], 1)

    @override_config(AUTO_SCAN=DAILY)
    def test_an_unreadable_intended_time_means_now(self, async_task, chain, models):
        create_test_user(scan_directory=self._library())
        self.assertEqual(self._run("yesterday")["started"], 1)

    @override_config(AUTO_SCAN=OFF)
    def test_off_does_nothing(self, async_task, chain, models):
        create_test_user(scan_directory=self._library())
        self.assertEqual(self._run(), {})
        self.assertFalse(LongRunningJob.objects.exists())

    @override_config(AUTO_SCAN=DAILY, NEXTCLOUD_ENABLED=True)
    def test_nextcloud_folders_are_scanned_after_the_local_one(
        self, async_task, chain, models
    ):
        both = create_test_user(
            scan_directory=self._library(),
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_scan_directory="/Photos",
        )
        with patch_nextcloud_dns():
            self.assertEqual(self._run()["started"], 1)

        self.assertEqual(LongRunningJob.objects.owned_by(both).count(), 2)
        # Both scans run one after the other in one chain.
        self.assertEqual(chain.return_value.append.call_count, 2)
        self.assertEqual(len(self._last_run().started[both.id]), 2)

    @override_config(AUTO_SCAN=DAILY, NEXTCLOUD_ENABLED=True)
    def test_an_unsafe_nextcloud_address_fails(self, async_task, chain, models):
        user = create_test_user(
            nextcloud_server_address="http://127.0.0.1",
            nextcloud_scan_directory="/Photos",
        )
        self.assertEqual(self._run(), {"started": 0, "skipped": 0, "failed": 1})
        self.assertEqual(self._last_run().failed, [user.id])

    @override_config(AUTO_SCAN=DAILY, NEXTCLOUD_ENABLED=True)
    def test_a_missing_scan_directory_still_scans_the_nextcloud_folder(
        self, async_task, chain, models
    ):
        user = create_test_user(
            scan_directory=f"{self.root}/gone",
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_scan_directory="/Photos",
        )
        with patch_nextcloud_dns():
            self.assertEqual(self._run(), {"started": 1, "skipped": 0, "failed": 1})
        self.assertEqual(len(self._last_run().started[user.id]), 1)
        self.assertEqual(self._last_run().failed, [user.id])

    @override_config(AUTO_SCAN=DAILY, NEXTCLOUD_ENABLED=False)
    def test_nextcloud_folders_wait_for_the_integration(
        self, async_task, chain, models
    ):
        create_test_user(
            nextcloud_server_address="https://cloud.example.com",
            nextcloud_scan_directory="/Photos",
        )
        self.assertEqual(self._run(), {"started": 0, "skipped": 0, "failed": 0})

    @override_config(AUTO_SCAN=DAILY)
    def test_inactive_users_are_not_scanned(self, async_task, chain, models):
        create_test_user(scan_directory=self._library(), is_active=False)
        self.assertEqual(self._run(), {"started": 0, "skipped": 0, "failed": 0})


class StatusTest(TestCase):
    def test_before_the_first_run(self):
        with patch(
            "api.directory_watcher.scan_schedule.timezone.now",
            return_value=WEDNESDAY_NOON,
        ):
            status = scan_schedule_status(_config(DAILY))
        self.assertIsNone(status["last_run_at"])
        self.assertEqual(
            status["next_run_at"], datetime.datetime(2026, 10, 15, 3, 0, tzinfo=UTC)
        )
        self.assertEqual(status["time_zone"], "UTC")
        self.assertEqual(status["scanned"], [])

    def test_off_has_no_next_run(self):
        self.assertIsNone(scan_schedule_status(_config(OFF))["next_run_at"])

    def test_outcomes_by_username(self):
        done, busy, broken, skipped, failed = (
            create_test_user(username=name)
            for name in ("done", "busy", "broken", "skipped", "failed")
        )
        finished = create_test_job(done, finished=True)
        running = create_test_job(busy)
        crashed = create_test_job(broken, finished=True, failed=True)
        run = LastRun(
            at=WEDNESDAY_NOON,
            started={
                done.id: [finished.job_id, "removed-by-the-cleanup"],
                busy.id: [running.job_id],
                broken.id: [crashed.job_id],
            },
            skipped=[skipped.id],
            failed=[failed.id, 999999],
        )

        status = scan_schedule_status(_config(DAILY, last_run=run.to_json()))

        self.assertEqual(status["last_run_at"], WEDNESDAY_NOON)
        self.assertEqual(status["scanned"], ["done"])
        self.assertEqual(status["running"], ["busy"])
        self.assertEqual(status["skipped"], ["skipped"])
        # A deleted user (999999) is left out.
        self.assertEqual(status["failed"], ["broken", "failed"])


class SiteSettingsAutoScanTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)

    def _post(self, body, user=None):
        self.client.force_authenticate(user=user or self.admin)
        return self.client.post("/api/sitesettings", body, format="json")

    def test_only_staff_see_the_schedule(self):
        for user in (None, create_test_user()):
            with self.subTest(user=user):
                self.client.force_authenticate(user=user)
                body = self.client.get("/api/sitesettings").json()
                for key in ("auto_scan", "auto_scan_time", "auto_scan_days"):
                    self.assertNotIn(key, body)
                self.assertNotIn("auto_scan_status", body)

    def test_staff_get_the_schedule_and_its_status(self):
        self.client.force_authenticate(user=self.admin)
        body = self.client.get("/api/sitesettings").json()
        self.assertEqual(body["auto_scan"], OFF)
        self.assertEqual(body["auto_scan_time"], "03:00")
        self.assertEqual(body["auto_scan_days"], [0, 1, 2, 3, 4])
        self.assertIsNone(body["auto_scan_status"]["last_run_at"])
        self.assertIsNone(body["auto_scan_status"]["next_run_at"])
        self.assertEqual(body["auto_scan_status"]["time_zone"], "UTC")

    def test_saving_the_schedule_writes_the_django_q_schedule(self):
        response = self._post(
            {
                "auto_scan": CUSTOM,
                "auto_scan_time": "22:30",
                "auto_scan_days": [4, 0, 4],
            }
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["auto_scan"], CUSTOM)
        self.assertEqual(body["auto_scan_days"], [0, 4])
        self.assertIsNotNone(body["auto_scan_status"]["next_run_at"])
        self.assertEqual(config.AUTO_SCAN_DAYS, "0,4")
        row = Schedule.objects.get(func=SCHEDULED_SCANS)
        self.assertEqual(row.name, "Library scan: Mon, Fri at 22:30")

        self.assertEqual(self._post({"auto_scan": OFF}).status_code, 200)
        self.assertFalse(Schedule.objects.filter(func=SCHEDULED_SCANS).exists())

    def test_other_settings_leave_the_schedule_alone(self):
        with patch("api.views.site_settings.sync_scan_schedule") as sync:
            self.assertEqual(self._post({"allow_upload": True}).status_code, 200)
        sync.assert_not_called()

    def test_invalid_schedules_are_refused(self):
        for body, field in (
            ({"auto_scan": "weekly"}, "auto_scan"),
            ({"auto_scan_time": "24:00"}, "auto_scan_time"),
            ({"auto_scan_time": "3:00"}, "auto_scan_time"),
            ({"auto_scan_days": []}, "auto_scan_days"),
            ({"auto_scan_days": [7]}, "auto_scan_days"),
            ({"auto_scan_days": ["1"]}, "auto_scan_days"),
        ):
            with self.subTest(body=body):
                response = self._post(body)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(api_error(response)["field"].startswith(field))
        self.assertEqual(config.AUTO_SCAN, OFF)
        self.assertEqual(config.AUTO_SCAN_DAYS, "0,1,2,3,4")

    def test_only_an_admin_may_change_it(self):
        response = self._post({"auto_scan": DAILY}, user=create_test_user())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(config.AUTO_SCAN, OFF)

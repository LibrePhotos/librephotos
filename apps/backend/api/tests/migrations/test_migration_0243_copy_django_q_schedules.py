import datetime
import importlib
from types import SimpleNamespace

from django.apps import apps as global_apps
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.utils import timezone

from api.models import TaskSchedule

migration_0243 = importlib.import_module("api.migrations.0243_copy_django_q_schedules")

COLUMNS = "name, func, hook, args, kwargs, schedule_type, minutes, repeats, next_run, cron, cluster, intended_date_kwarg"


AUTO_ID = "integer PRIMARY KEY" if connection.vendor == "sqlite" else "serial PRIMARY KEY"


class CopyDjangoQSchedulesTest(TestCase):
    def setUp(self):
        if (
            migration_0243.LEGACY_SCHEDULE_TABLE
            not in connection.introspection.table_names()
        ):
            with connection.cursor() as cursor:
                cursor.execute(
                    f"CREATE TABLE django_q_schedule (id {AUTO_ID}, name varchar(100) NULL, "
                    "func varchar(256), hook varchar(256) NULL, args text NULL, kwargs text NULL, "
                    "schedule_type varchar(1), minutes smallint NULL, repeats integer, next_run timestamp NULL, "
                    "cron varchar(100) NULL, cluster varchar(100) NULL, intended_date_kwarg varchar(100) NULL, task varchar(100) NULL)"
                )

    def _legacy(
        self,
        func,
        kind,
        *,
        name=None,
        args=None,
        kwargs=None,
        minutes=None,
        repeats=-1,
        next_run=None,
        intended=None,
    ):
        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO django_q_schedule ({COLUMNS}) VALUES (%s, %s, NULL, %s, %s, %s, %s, %s, %s, NULL, NULL, %s)",
                [
                    name,
                    func,
                    args,
                    kwargs,
                    kind,
                    minutes,
                    repeats,
                    connection.ops.adapt_datetimefield_value(
                        next_run or timezone.now()
                    ),
                    intended,
                ],
            )

    def _left(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM django_q_schedule")
            return cursor.fetchone()[0]

    def _migrate(self):
        migration_0243.forwards(global_apps, SimpleNamespace(connection=connection))

    def test_every_kind_is_copied_with_its_arguments_and_next_run(self):
        due = timezone.now() + datetime.timedelta(hours=5)
        self._legacy("api.services.check_services", "I", minutes=1)
        self._legacy(
            "api.photos.zip_downloads.delete_zip_file",
            "O",
            args="('archive.zip',)",
            next_run=due,
        )
        self._legacy(
            "api.jobs.upload_followups.run_upload_followups",
            "O",
            name="upload-followups-3",
            args="3",
        )
        self._legacy(
            "api.directory_watcher.scan_schedule.scheduled_library_scans",
            "D",
            name="Library scan: every day at 03:00",
            kwargs="flag=True",
            next_run=due,
            intended="intended_at",
        )

        self._migrate()

        rows = {row.func: row for row in TaskSchedule.objects.all()}
        self.assertEqual(0, self._left())
        self.assertEqual(
            TaskSchedule.MINUTES,
            rows["api.runtime.supervisor.check_services"].schedule_type,
        )
        self.assertEqual(
            ["archive.zip"], rows["api.photos.zip_downloads.delete_zip_file"].args
        )
        self.assertEqual(due, rows["api.photos.zip_downloads.delete_zip_file"].next_run)
        self.assertEqual(
            [3], rows["api.jobs.upload_followups.run_upload_followups"].args
        )
        scan = rows["api.directory_watcher.scan_schedule.scheduled_library_scans"]
        self.assertEqual(
            ("Library scan: every day at 03:00", {"flag": True}, "intended_at"),
            (scan.name, scan.kwargs, scan.intended_date_kwarg),
        )

    def test_finished_and_unknown_schedules_are_dropped(self):
        self._legacy("api.jobs.cleanup.fail_stuck_jobs", "H", repeats=0)
        self._legacy("api.jobs.cleanup.fail_stuck_jobs", "C")

        with self.assertLogs("api.migrations.0243_copy_django_q_schedules", "WARNING"):
            self._migrate()

        self.assertFalse(TaskSchedule.objects.exists())
        self.assertEqual(0, self._left())

    def test_the_boot_commands_then_add_no_second_schedule(self):
        self._legacy("api.photos.retention.cleanup_deleted_photos", "D")
        self._legacy("api.services.check_services", "I", minutes=1)
        self._legacy("api.jobs.cleanup.fail_stuck_jobs", "H")

        self._migrate()
        call_command("start_cleaning_service")
        call_command("start_job_cleanup_service")

        funcs = list(TaskSchedule.objects.values_list("func", flat=True))
        self.assertEqual(len(funcs), len(set(funcs)))
        self.assertIn("api.runtime.supervisor.check_services", funcs)

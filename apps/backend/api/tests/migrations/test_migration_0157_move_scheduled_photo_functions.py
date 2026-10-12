import importlib
from datetime import timedelta

from django.apps import apps as global_apps
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from django.utils.module_loading import import_string
from django_q.models import Schedule

# The module name starts with a digit, so a plain import cannot load it.
migration_0157 = importlib.import_module(
    "api.migrations.0157_move_scheduled_photo_functions"
)

OLD_CLEANUP = "api.services.cleanup_deleted_photos"
NEW_CLEANUP = "api.photos.retention.cleanup_deleted_photos"
OLD_PRUNE = "api.services.prune_deletion_log"
NEW_PRUNE = "api.photos.retention.prune_deletion_log"
OLD_ZIP = "api.all_tasks.delete_zip_file"
NEW_ZIP = "api.photos.zip_downloads.delete_zip_file"


class MoveScheduledPhotoFunctionsMigrationTest(TestCase):
    """Schedules an older version stored under the photo functions' old paths."""

    def _forwards(self):
        migration_0157.forwards(global_apps, None)

    def _backwards(self):
        migration_0157.backwards(global_apps, None)

    def _funcs(self):
        return sorted(Schedule.objects.values_list("func", flat=True))

    def test_daily_schedules_move_to_the_new_paths(self):
        cleanup = Schedule.objects.create(
            func=OLD_CLEANUP, schedule_type=Schedule.DAILY
        )
        prune = Schedule.objects.create(func=OLD_PRUNE, schedule_type=Schedule.DAILY)

        self._forwards()

        cleanup.refresh_from_db()
        prune.refresh_from_db()
        self.assertEqual(cleanup.func, NEW_CLEANUP)
        self.assertEqual(prune.func, NEW_PRUNE)
        self.assertEqual(cleanup.schedule_type, Schedule.DAILY)

    def test_pending_zip_deletions_keep_their_archive_and_time(self):
        at = timezone.now() + timedelta(hours=5)
        first = Schedule.objects.create(
            func=OLD_ZIP, args="'a.zip'", schedule_type=Schedule.ONCE, next_run=at
        )
        second = Schedule.objects.create(
            func=OLD_ZIP, args="'b.zip'", schedule_type=Schedule.ONCE, next_run=at
        )

        self._forwards()

        for row, args in ((first, "'a.zip'"), (second, "'b.zip'")):
            row.refresh_from_db()
            self.assertEqual(row.func, NEW_ZIP)
            self.assertEqual(row.args, args)
            self.assertEqual(row.next_run, at)

    def test_an_existing_new_schedule_is_not_duplicated(self):
        Schedule.objects.create(func=OLD_CLEANUP, schedule_type=Schedule.DAILY)
        kept = Schedule.objects.create(func=NEW_CLEANUP, schedule_type=Schedule.DAILY)

        self._forwards()

        self.assertEqual(list(Schedule.objects.values_list("pk", flat=True)), [kept.pk])

    def test_other_schedules_are_left_alone(self):
        Schedule.objects.create(
            func="api.services.check_services",
            schedule_type=Schedule.MINUTES,
            minutes=1,
        )

        self._forwards()

        self.assertEqual(self._funcs(), ["api.services.check_services"])

    def test_backwards_restores_the_old_paths(self):
        Schedule.objects.create(func=OLD_PRUNE, schedule_type=Schedule.DAILY)
        Schedule.objects.create(
            func=OLD_ZIP, args="'a.zip'", schedule_type=Schedule.ONCE
        )

        self._forwards()
        self._backwards()

        self.assertEqual(self._funcs(), [OLD_ZIP, OLD_PRUNE])

    def test_the_new_paths_name_the_functions(self):
        for new in migration_0157.MOVED.values():
            with self.subTest(new=new):
                self.assertTrue(callable(import_string(new)))

    def test_the_cleaning_service_then_adds_no_second_schedule(self):
        Schedule.objects.create(func=OLD_CLEANUP, schedule_type=Schedule.DAILY)
        Schedule.objects.create(func=OLD_PRUNE, schedule_type=Schedule.DAILY)

        self._forwards()
        call_command("start_cleaning_service")

        self.assertEqual(self._funcs(), [NEW_CLEANUP, NEW_PRUNE])

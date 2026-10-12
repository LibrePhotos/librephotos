import importlib
from io import StringIO
from unittest.mock import patch

from django.apps import apps as global_apps
from django.core.management import call_command
from django.test import TestCase
from django.utils.module_loading import import_string
from django_q.models import Schedule

# The module name starts with a digit, so a plain import cannot load it.
migration_0158 = importlib.import_module(
    "api.migrations.0158_move_scheduled_check_services"
)

OLD = "api.services.check_services"
NEW = "api.runtime.supervisor.check_services"


def _create_watchdog(func: str) -> Schedule:
    return Schedule.objects.create(
        func=func, schedule_type=Schedule.MINUTES, minutes=1
    )


class MoveScheduledCheckServicesMigrationTest(TestCase):
    """The watchdog schedule an older version stored under api.services."""

    def _forwards(self) -> None:
        migration_0158.forwards(global_apps, None)

    def _backwards(self) -> None:
        migration_0158.backwards(global_apps, None)

    def _funcs(self) -> list[str]:
        return sorted(Schedule.objects.values_list("func", flat=True))

    def test_the_watchdog_moves_to_the_new_path(self):
        watchdog = _create_watchdog(OLD)

        self._forwards()

        watchdog.refresh_from_db()
        self.assertEqual(watchdog.func, NEW)
        self.assertEqual(watchdog.schedule_type, Schedule.MINUTES)
        self.assertEqual(watchdog.minutes, 1)

    def test_an_existing_new_schedule_is_not_duplicated(self):
        _create_watchdog(OLD)
        kept = _create_watchdog(NEW)

        self._forwards()

        self.assertEqual(list(Schedule.objects.values_list("pk", flat=True)), [kept.pk])

    def test_other_schedules_are_left_alone(self):
        Schedule.objects.create(
            func="api.photos.retention.prune_deletion_log",
            schedule_type=Schedule.DAILY,
        )

        self._forwards()

        self.assertEqual(self._funcs(), ["api.photos.retention.prune_deletion_log"])

    def test_backwards_restores_the_old_path(self):
        _create_watchdog(OLD)

        self._forwards()
        self._backwards()

        self.assertEqual(self._funcs(), [OLD])

    def test_the_new_path_names_the_function(self):
        for new in migration_0158.MOVED.values():
            with self.subTest(new=new):
                self.assertTrue(callable(import_string(new)))

    def test_start_service_then_adds_no_second_schedule(self):
        _create_watchdog(OLD)

        self._forwards()
        with patch("api.management.commands.start_service.start_service"):
            call_command("start_service", "all", stdout=StringIO())

        self.assertEqual(self._funcs(), [NEW])

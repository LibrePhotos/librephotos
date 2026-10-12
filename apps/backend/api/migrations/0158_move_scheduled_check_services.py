"""Point the django-q schedule of the sidecar watchdog at its new path.

django-q stores a schedule's function as a dotted path. #2335 moved the sidecar
supervisor from ``api.services`` to ``api.runtime.supervisor``, and with it the
per-minute watchdog ``check_services``. Left alone, that row fails on every
run, and ``start_service all``, which now looks for the new path only, would
add a second schedule next to the broken one.

A schedule that already exists under the new path (nothing creates one before
this migration runs, but a hand-made one may) keeps that row, and the old one
is dropped instead of becoming a duplicate.
"""

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

MOVED = {
    "api.services.check_services": "api.runtime.supervisor.check_services",
}


def _rewrite(apps: Apps, renames: dict[str, str]) -> None:
    schedule = apps.get_model("django_q", "Schedule")
    for old, new in renames.items():
        rows = schedule.objects.filter(func=old)
        if schedule.objects.filter(func=new).exists():
            rows.delete()
        else:
            rows.update(func=new)


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _rewrite(apps, MOVED)


def backwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _rewrite(apps, {new: old for old, new in MOVED.items()})


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0157_move_scheduled_photo_functions"),
        ("django_q", "0019_alter_task_options_alter_ormq_key_alter_ormq_lock_and_more"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]

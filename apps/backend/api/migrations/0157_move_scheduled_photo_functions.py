"""Point the django-q schedules of the moved photo functions at their new paths.

django-q stores a schedule's function as a dotted path. #2335 moved the daily
cleanup (``api.services.cleanup_deleted_photos``), the sync tombstone pruning
(``api.services.prune_deletion_log``) and the zip archive cleanup
(``api.all_tasks.delete_zip_file``, one-off rows scheduled a day after each
download) into ``api.photos``. Left alone, those rows fail on every run, and
``start_cleaning_service``, which now looks for the new paths only, would add a
second daily schedule next to the broken one.

A recurring schedule that already exists under the new path (nothing creates
one before this migration runs, but a hand-made one may) keeps that row, and
the old one is dropped instead of becoming a duplicate.
"""

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

MOVED = {
    "api.services.cleanup_deleted_photos": "api.photos.retention.cleanup_deleted_photos",
    "api.services.prune_deletion_log": "api.photos.retention.prune_deletion_log",
    "api.all_tasks.delete_zip_file": "api.photos.zip_downloads.delete_zip_file",
}

# One-off rows: one per archive, each with its own file name argument.
ONE_OFF = {"api.all_tasks.delete_zip_file"}


def _rewrite(apps: Apps, renames: dict[str, str], one_off: set[str]) -> None:
    schedule = apps.get_model("django_q", "Schedule")
    for old, new in renames.items():
        rows = schedule.objects.filter(func=old)
        if old not in one_off and schedule.objects.filter(func=new).exists():
            rows.delete()
        else:
            rows.update(func=new)


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _rewrite(apps, MOVED, ONE_OFF)


def backwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    reverse = {new: old for old, new in MOVED.items()}
    _rewrite(apps, reverse, {MOVED[old] for old in ONE_OFF})


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0156_drop_user_face_recognition_model_and_stackreview"),
        ("django_q", "0019_alter_task_options_alter_ormq_key_alter_ormq_lock_and_more"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]

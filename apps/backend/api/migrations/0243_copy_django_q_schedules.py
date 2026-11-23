import ast
import datetime
import json
import logging

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.utils import timezone
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)

LEGACY_SCHEDULE_TABLE = "django_q_schedule"
TYPES = {"O", "I", "H", "D"}
MOVED = {
    "api.services.cleanup_deleted_photos": "api.photos.retention.cleanup_deleted_photos",
    "api.services.prune_deletion_log": "api.photos.retention.prune_deletion_log",
    "api.all_tasks.delete_zip_file": "api.photos.zip_downloads.delete_zip_file",
    "api.services.check_services": "api.runtime.supervisor.check_services",
}


def literal_args(text: object) -> list[object]:
    if not text:
        return []
    value = ast.literal_eval(str(text))
    return list(value) if isinstance(value, tuple | list) else [value]


def literal_kwargs(text: object) -> dict[str, object]:
    if not text:
        return {}
    try:
        value = ast.literal_eval(str(text))
    except SyntaxError, ValueError:
        call = ast.parse(f"f({text})").body[0]
        if not isinstance(call, ast.Expr) or not isinstance(call.value, ast.Call):
            raise ValueError(f"not keyword arguments: {text!r}") from None
        return {
            str(keyword.arg): ast.literal_eval(keyword.value)
            for keyword in call.value.keywords
        }
    if not isinstance(value, dict):
        raise ValueError(f"not a dict: {text!r}")
    return {str(key): item for key, item in value.items()}


def aware(value: object) -> datetime.datetime:
    moment = (
        value if isinstance(value, datetime.datetime) else parse_datetime(str(value))
    )
    if moment is None:
        return timezone.now()
    if timezone.is_naive(moment):
        return timezone.make_aware(moment, datetime.UTC)
    return moment


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    connection = schema_editor.connection
    if LEGACY_SCHEDULE_TABLE not in connection.introspection.table_names():
        return
    schedules = apps.get_model("api", "TaskSchedule")
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, name, func, args, kwargs, schedule_type, minutes, next_run, "
            f"repeats, intended_date_kwarg FROM {LEGACY_SCHEDULE_TABLE} ORDER BY id"
        )
        rows = cursor.fetchall()
    for (
        row_id,
        name,
        func,
        args,
        kwargs,
        kind,
        minutes,
        next_run,
        repeats,
        intended,
    ) in rows:
        path = MOVED.get(func, func)
        if repeats == 0 or kind not in TYPES:
            logger.warning(
                "Not copying django-q schedule %s (%s, type %s)", row_id, path, kind
            )
            continue
        if name and schedules.objects.filter(name=name).exists():
            continue
        if (
            kind != "O"
            and schedules.objects.filter(func=path).exclude(schedule_type="O").exists()
        ):
            continue
        try:
            copied_args = literal_args(args)
            copied_kwargs = literal_kwargs(kwargs)
            json.dumps([copied_args, copied_kwargs])
        except (SyntaxError, ValueError, TypeError) as error:
            logger.warning(
                "Not copying django-q schedule %s (%s): %s", row_id, path, error
            )
            continue
        schedules.objects.create(
            name=name or "",
            func=path,
            args=copied_args,
            kwargs=copied_kwargs,
            schedule_type=kind,
            minutes=minutes,
            next_run=aware(next_run),
            intended_date_kwarg=intended or "",
        )
    with connection.cursor() as cursor:
        cursor.execute(f"DELETE FROM {LEGACY_SCHEDULE_TABLE}")


class Migration(migrations.Migration):
    dependencies = [("api", "0242_task_queue")]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]

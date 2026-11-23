from __future__ import annotations

import io
import logging
import pickle
import zlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from django.conf import settings
from django.core.signing import BadSignature, TimestampSigner, b64_decode
from django.db import connection, transaction
from django.utils import timezone

from api.jobs import store
from api.models.long_running_job import LongRunningJob
from api.models.task_queue import QUEUED, WAITING

logger = logging.getLogger(__name__)

LEGACY_QUEUE_TABLE = "django_q_ormq"
LEGACY_CLUSTER_NAME = "DjangORM"
UNREADABLE = (
    "This job was queued before the upgrade and could not be carried over to "
    "the new task queue. Start it again."
)


class UnreadableTaskError(Exception):
    pass


class _MissingCode:
    def __init__(self, path: str) -> None:
        self.path = path

    def __call__(self, *args: object, **kwargs: object) -> _MissingCode:
        return self

    def __setstate__(self, state: object) -> None:
        pass


class _TolerantUnpickler(pickle.Unpickler):
    def __init__(self, data: bytes) -> None:
        super().__init__(io.BytesIO(data))
        self.missing: list[str] = []

    def find_class(self, module_name: str, global_name: str, /) -> object:
        try:
            found: object = super().find_class(module_name, global_name)
        except ImportError, AttributeError:
            path = f"{module_name}.{global_name}"
            self.missing.append(path)
            return _MissingCode(path)
        return found


@dataclass
class LegacyCall:
    func: Callable[..., object] | str
    args: tuple[object, ...]
    kwargs: dict[str, object]


def read_payload(
    signed: str, key: str, salt: str = LEGACY_CLUSTER_NAME
) -> dict[str, object]:
    try:
        value = TimestampSigner(key=key, salt=salt).unsign(signed)
    except BadSignature as error:
        raise UnreadableTaskError(f"bad signature: {error}") from error
    data = value.encode()
    compressed = data[:1] == b"."
    raw = b64_decode(data[1:] if compressed else data)
    if compressed:
        raw = zlib.decompress(raw)
    unpickler = _TolerantUnpickler(raw)
    try:
        task = unpickler.load()
    except Exception as error:
        raise UnreadableTaskError(f"{type(error).__name__}: {error}") from error
    if not isinstance(task, dict):
        raise UnreadableTaskError("not a django-q task")
    return task


def _call(func: object, args: object, kwargs: object) -> LegacyCall:
    if isinstance(func, _MissingCode):
        raise UnreadableTaskError(f"{func.path} no longer exists")
    if not (isinstance(func, str) or callable(func)):
        raise UnreadableTaskError("the task names no function")
    return LegacyCall(
        func=func,
        args=tuple(args) if isinstance(args, tuple | list) else (),
        kwargs=dict(kwargs) if isinstance(kwargs, dict) else {},
    )


def calls_of(task: dict[str, object]) -> list[LegacyCall]:
    calls = [_call(task.get("func"), task.get("args"), task.get("kwargs"))]
    chain = task.get("chain") or []
    if isinstance(chain, list | tuple):
        for step in chain:
            if isinstance(step, tuple | list) and len(step) == 3:
                calls.append(_call(*step))
    return calls


def enqueue_calls(calls: Sequence[LegacyCall]) -> None:
    previous = None
    for index, call in enumerate(calls):
        previous = store.add(
            call.func,
            call.args,
            call.kwargs,
            store.Placement(
                status=WAITING if index else QUEUED,
                after=previous,
                continue_on_error=True,
            ),
        )


def _job_ids(task: dict[str, object]) -> list[str]:
    steps: list[tuple[object, object, object]] = [
        (task.get("func"), task.get("args"), task.get("kwargs"))
    ]
    chain = task.get("chain") or []
    if isinstance(chain, list | tuple):
        steps += [
            tuple(step)
            for step in chain
            if isinstance(step, tuple | list) and len(step) == 3
        ]
    ids = []
    for func, args, kwargs in steps:
        named = kwargs if isinstance(kwargs, dict) else {}
        positional = tuple(args) if isinstance(args, tuple | list) else ()
        target = func if callable(func) and not isinstance(func, _MissingCode) else ""
        job_id = store.job_id_of(target, positional, named)
        if job_id is not None:
            ids.append(job_id)
    return ids


def legacy_table_exists() -> bool:
    return LEGACY_QUEUE_TABLE in connection.introspection.table_names()


def import_waiting_tasks() -> int:
    if not legacy_table_exists():
        return 0
    now = connection.ops.adapt_datetimefield_value(timezone.now())
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT id, payload FROM {LEGACY_QUEUE_TABLE} WHERE lock IS NULL OR lock <= %s ORDER BY id",
            [now],
        )
        rows = cursor.fetchall()
    imported = 0
    for row_id, signed in rows:
        imported += _import_row(int(row_id), str(signed), now)
    if rows:
        logger.info("Carried %s of %s tasks over from django-q", imported, len(rows))
    return imported


def _import_row(row_id: int, signed: str, now: str | None) -> int:
    task: dict[str, object] = {}
    try:
        task = read_payload(signed, settings.SECRET_KEY)
        with transaction.atomic():
            enqueue_calls(calls_of(task))
            if not _delete_row(row_id, now):
                transaction.set_rollback(True)
                return 0
        return 1
    except (UnreadableTaskError, TypeError) as error:
        logger.warning("Dropped django-q task %s: %s", row_id, error)
    with transaction.atomic():
        if _delete_row(row_id, now):
            for job_id in _job_ids(task):
                job = LongRunningJob.objects.filter(
                    job_id=job_id, finished=False, started_at__isnull=True
                ).first()
                if job is not None:
                    job.fail(error=UNREADABLE)
    return 0


def _delete_row(row_id: int, now: str | None) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            f"DELETE FROM {LEGACY_QUEUE_TABLE} WHERE id = %s AND (lock IS NULL OR lock <= %s)",
            [row_id, now],
        )
        return cursor.rowcount > 0

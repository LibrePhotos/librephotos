from __future__ import annotations

import functools
import inspect
import logging
import zlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.db import IntegrityError, connection, transaction
from django.db.models import Exists, F, OuterRef
from django.utils import timezone

from api.jobs import payload
from api.models.long_running_job import LongRunningJob
from api.models.task_queue import (
    CANCELLED,
    DEFAULT_QUEUE,
    FAILED,
    GEOCODE_QUEUE,
    OPEN_STATUSES,
    QUEUED,
    RUNNING,
    WAITING,
    QueuedTask,
    TaskGroup,
)

logger = logging.getLogger(__name__)

ROUTES = {
    "api.directory_watcher.processing_jobs.geolocation_job": GEOCODE_QUEUE,
}
CAPS = {GEOCODE_QUEUE: 1}

LEASE = timedelta(minutes=10)
RENEW_EVERY = timedelta(minutes=1)
RETRY_DELAY = timedelta(seconds=5)
KEEP_ENDED = timedelta(days=7)

TaskFunc = Callable[..., object]


def func_path(func: TaskFunc | str) -> str:
    if isinstance(func, str):
        return func
    qualname = getattr(func, "__qualname__", "")
    module = getattr(func, "__module__", "")
    if not qualname or not module or "<" in qualname:
        raise TypeError(f"{func!r} cannot be queued: it has no importable path")
    return f"{module}.{qualname}"


@functools.cache
def _signature(func: TaskFunc) -> inspect.Signature | None:
    try:
        return inspect.signature(func)
    except TypeError, ValueError:
        return None


def job_id_of(
    func: TaskFunc | str, args: Sequence[object], kwargs: Mapping[str, object]
) -> str | None:
    if "job_id" in kwargs:
        value = kwargs["job_id"]
        return None if value is None else str(value)
    if isinstance(func, str):
        return None
    signature = _signature(func)
    if signature is None or "job_id" not in signature.parameters:
        return None
    try:
        bound = signature.bind_partial(*args, **kwargs)
    except TypeError:
        return None
    value = bound.arguments.get("job_id")
    return None if value is None else str(value)


@dataclass(frozen=True)
class Placement:
    queue: str = DEFAULT_QUEUE
    priority: int = 0
    status: str = QUEUED
    after: QueuedTask | None = None
    continue_on_error: bool = False
    group: TaskGroup | None = None
    is_group_followup: bool = False
    dedupe_key: str = ""
    run_after: datetime | None = None


def add(
    func: TaskFunc | str,
    args: Sequence[object] = (),
    kwargs: Mapping[str, object] | None = None,
    placement: Placement | None = None,
) -> QueuedTask | None:
    kwargs = dict(kwargs or {})
    where = placement or Placement()
    path = func_path(func)
    queue = (
        where.queue if where.queue != DEFAULT_QUEUE else ROUTES.get(path, DEFAULT_QUEUE)
    )
    task = QueuedTask(
        func=path,
        args=payload.encode_args(args),
        kwargs=payload.encode_kwargs(kwargs),
        queue=queue,
        priority=where.priority,
        status=where.status,
        after=where.after,
        continue_on_error=where.continue_on_error,
        group=where.group,
        is_group_followup=where.is_group_followup,
        dedupe_key=where.dedupe_key,
        job_id=job_id_of(func, args, kwargs) or "",
        run_after=where.run_after or timezone.now(),
    )
    if not where.dedupe_key:
        task.save()
        return task
    try:
        with transaction.atomic():
            task.save()
    except IntegrityError:
        logger.info("a task with key %s is queued or running already", where.dedupe_key)
        return None
    return task


def _capped_queue_lock(queue: str) -> None:
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(%s, %s)",
                [0x4C50, zlib.crc32(queue.encode()) & 0x7FFFFFFF],
            )


def _allowed(queues: Sequence[str], caps: Mapping[str, int]) -> list[str]:
    allowed = []
    for queue in queues:
        cap = caps.get(queue)
        if cap is not None:
            _capped_queue_lock(queue)
            if QueuedTask.objects.filter(status=RUNNING, queue=queue).count() >= cap:
                continue
        allowed.append(queue)
    return allowed


def claim(
    worker: str, queues: Sequence[str], caps: Mapping[str, int] | None = None
) -> QueuedTask | None:
    now = timezone.now()
    with transaction.atomic():
        allowed = _allowed(queues, caps or {})
        if not allowed:
            return None
        task = (
            QueuedTask.objects.select_for_update(skip_locked=True)
            .filter(status=QUEUED, run_after__lte=now, queue__in=allowed)
            .order_by("-priority", "id")
            .first()
        )
        if task is None:
            return None
        claimed = QueuedTask.objects.filter(pk=task.pk, status=QUEUED).update(
            status=RUNNING,
            worker=worker,
            attempts=F("attempts") + 1,
            started_at=now,
            lease_until=now + LEASE,
        )
        if not claimed:
            return None
        task.refresh_from_db()
        return task


def renew(task_id: int, worker: str) -> bool:
    return bool(
        QueuedTask.objects.filter(pk=task_id, worker=worker, status=RUNNING).update(
            lease_until=timezone.now() + LEASE
        )
    )


def _job_went_through(job_id: str) -> bool:
    if not job_id:
        return True
    row = (
        LongRunningJob.objects.filter(job_id=job_id)
        .values("cancelled", "failed", "progress_current", "progress_target")
        .first()
    )
    if row is None:
        return True
    if row["cancelled"]:
        return False
    reached = (
        row["progress_target"] > 0 and row["progress_current"] >= row["progress_target"]
    )
    return not row["failed"] or reached


def succeed(task: QueuedTask) -> None:
    with transaction.atomic():
        ok = _job_went_through(task.job_id)
        _release_successors(task, ok)
        _member_ended(task)
        QueuedTask.objects.filter(pk=task.pk).delete()


def fail(task: QueuedTask, error: str) -> None:
    with transaction.atomic():
        _end(task, FAILED, error)


def _end(task: QueuedTask, status: str, error: str = "") -> None:
    updated = QueuedTask.objects.filter(pk=task.pk, status__in=OPEN_STATUSES).update(
        status=status,
        error=error[-10000:],
        finished_at=timezone.now(),
        lease_until=None,
    )
    if not updated:
        return
    _release_successors(task, ok=False)
    _member_ended(task)


def _release_successors(task: QueuedTask, ok: bool) -> None:
    for successor in QueuedTask.objects.filter(after_id=task.pk, status=WAITING):
        if ok or successor.continue_on_error:
            QueuedTask.objects.filter(pk=successor.pk, status=WAITING).update(
                status=QUEUED, run_after=timezone.now()
            )
        else:
            _cancel(successor)


def _cancel(task: QueuedTask) -> None:
    if task.job_id:
        job = LongRunningJob.objects.filter(job_id=task.job_id).first()
        if job is not None:
            job.cancel()
    _end(task, CANCELLED, "an earlier step did not finish")


def _member_ended(task: QueuedTask) -> None:
    if task.group_id is None or task.is_group_followup:
        return
    groups = TaskGroup.objects.filter(pk=task.group_id)
    groups.update(ended=F("ended") + 1)
    group = groups.values("ended", "total", "fired").first()
    if group is None or group["fired"] or group["ended"] < group["total"]:
        return
    if groups.filter(fired=False).update(fired=True):
        QueuedTask.objects.filter(
            group_id=task.group_id, is_group_followup=True, status=WAITING
        ).update(status=QUEUED, run_after=timezone.now())


def release(task: QueuedTask, *, count_attempt: bool) -> None:
    QueuedTask.objects.filter(pk=task.pk, status=RUNNING).update(
        status=QUEUED,
        worker="",
        lease_until=None,
        run_after=timezone.now(),
        attempts=F("attempts") if count_attempt else F("attempts") - 1,
    )


def _lost(task: QueuedTask, reason: str) -> None:
    with transaction.atomic():
        if task.attempts >= task.max_attempts:
            logger.warning(
                "task %s (%s) failed: %s, %s attempts",
                task.pk,
                task.func,
                reason,
                task.attempts,
            )
            _end(task, FAILED, f"{reason} after {task.attempts} attempts")
            return
        logger.info("task %s (%s): %s, queued again", task.pk, task.func, reason)
        QueuedTask.objects.filter(pk=task.pk, status=RUNNING).update(
            status=QUEUED,
            worker="",
            lease_until=None,
            run_after=timezone.now() + RETRY_DELAY,
            error=reason,
        )


def requeue_expired() -> int:
    expired = list(
        QueuedTask.objects.filter(status=RUNNING, lease_until__lt=timezone.now())
    )
    for task in expired:
        _lost(task, "its worker went away (lease expired)")
    return len(expired)


def requeue_worker(worker: str, reason: str) -> int:
    held = list(QueuedTask.objects.filter(status=RUNNING, worker=worker))
    for task in held:
        _lost(task, reason)
    return len(held)


def cancel_job_tasks(job_id: str) -> int:
    with transaction.atomic():
        waiting = QueuedTask.objects.of_job(job_id).filter(
            status__in=(WAITING, QUEUED), is_group_followup=False
        )
        simple = waiting.filter(group__isnull=True).exclude(
            Exists(QueuedTask.objects.filter(after_id=OuterRef("pk"), status=WAITING))
        )
        removed = simple.update(
            status=CANCELLED, finished_at=timezone.now(), error="cancelled"
        )
        for task in waiting.filter(status__in=(WAITING, QUEUED)):
            _end(task, CANCELLED, "cancelled")
            removed += 1
    return removed


def open_job_ids() -> set[str]:
    return set(
        QueuedTask.objects.open()
        .exclude(job_id="")
        .values_list("job_id", flat=True)
        .distinct()
    )


def tasks_are_waiting() -> bool:
    return QueuedTask.objects.filter(status=QUEUED).exists()


def delete_old_ended() -> int:
    deleted, _ = QueuedTask.objects.filter(
        status__in=(FAILED, CANCELLED),
        finished_at__lt=timezone.now() - KEEP_ENDED,
    ).delete()
    TaskGroup.objects.filter(fired=True, tasks__isnull=True).delete()
    return deleted

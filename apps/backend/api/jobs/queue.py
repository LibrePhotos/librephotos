from __future__ import annotations

import inspect
import logging
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from typing import NamedTuple

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from api.drf.exceptions import JobAlreadyRunning, QueueBusy
from api.jobs import store
from api.models.long_running_job import LongRunningJob
from api.models.task_queue import QUEUED, WAITING, QueuedTask, TaskSchedule
from api.models.user import User

logger = logging.getLogger(__name__)

TaskFunc = Callable[..., object]


class Task(NamedTuple):
    func: TaskFunc
    args: tuple[object, ...] = ()
    kwargs: Mapping[str, object] | None = None


class JobStep(NamedTuple):
    job_type: int
    func: TaskFunc
    args: tuple[object, ...] = ()
    kwargs: Mapping[str, object] | None = None


def _check_call(step: JobStep) -> None:
    signature = inspect.signature(step.func)
    name = f"{step.func.__module__}.{step.func.__qualname__}"
    if "job_id" not in signature.parameters:
        raise TypeError(
            f"{name} has no job_id parameter, so it cannot claim the job row "
            "queued for it"
        )
    try:
        signature.bind(*step.args, job_id="", **(step.kwargs or {}))
    except TypeError as error:
        raise TypeError(f"{name} cannot be called as queued: {error}") from error


def _refused_types(job_types: Sequence[int]) -> set[int]:
    types = set(job_types)
    for side, other in (
        (LongRunningJob.SCAN_JOB_TYPES, LongRunningJob.PATH_CHANGE_JOB_TYPES),
        (LongRunningJob.PATH_CHANGE_JOB_TYPES, LongRunningJob.SCAN_JOB_TYPES),
    ):
        if types.intersection(side):
            types.update(other)
    return types


def _lock_starts(user: User, job_types: Sequence[int]) -> None:
    if not LongRunningJob.INSTANCE_WIDE_JOB_TYPES.isdisjoint(job_types):
        lock_all_starts()
        return
    list(User.objects.select_for_update().filter(pk=user.pk).values_list("pk"))


def lock_all_starts() -> None:
    list(User.objects.select_for_update().order_by("pk").values_list("pk"))


def _refuse_running(user: User, job_types: Sequence[int]) -> None:
    types = _refused_types(job_types)
    instance_wide = types & LongRunningJob.INSTANCE_WIDE_JOB_TYPES
    jobs = LongRunningJob.objects
    running = (
        jobs.running()
        .filter(
            (jobs.owner_q(user) & Q(job_type__in=types - instance_wide))
            | Q(job_type__in=instance_wide)
        )
        .order_by("queued_at")
        .first()
    )
    if running is None:
        return
    if running.started_by_id != user.pk and not (user.is_staff or user.is_superuser):
        raise QueueBusy()
    raise JobAlreadyRunning(running.job_id, running.get_job_type_display())


def _add_in_order(
    prerequisites: Sequence[Task],
    steps: Sequence[JobStep],
    jobs: Sequence[LongRunningJob],
    continue_on_error: bool,
) -> None:
    previous: QueuedTask | None = None
    for prerequisite in prerequisites:
        previous = store.add(
            prerequisite.func,
            prerequisite.args,
            prerequisite.kwargs,
            store.Placement(
                status=WAITING if previous else QUEUED,
                after=previous,
                continue_on_error=True,
            ),
        )
    after_prerequisite = previous is not None
    for index, (step, job) in enumerate(zip(steps, jobs, strict=True)):
        previous = store.add(
            step.func,
            step.args,
            {**(step.kwargs or {}), "job_id": job.job_id},
            store.Placement(
                status=WAITING if previous else QUEUED,
                after=previous,
                continue_on_error=continue_on_error
                or (index == 0 and after_prerequisite),
            ),
        )


def enqueue_chain(
    user: User,
    steps: Sequence[JobStep],
    *,
    prerequisites: Sequence[Task] = (),
    exclusive: bool = True,
    continue_on_error: bool = False,
) -> list[LongRunningJob]:
    if not steps:
        raise ValueError("enqueue_chain needs at least one step")
    for step in steps:
        _check_call(step)

    with transaction.atomic():
        job_types = [step.job_type for step in steps]
        _lock_starts(user, job_types)
        if exclusive:
            _refuse_running(user, job_types)
        jobs = [
            LongRunningJob.create_job(user=user, job_type=step.job_type)
            for step in steps
        ]
        _add_in_order(prerequisites, steps, jobs, continue_on_error)
    return jobs


def enqueue_job(
    user: User,
    job_type: int,
    func: TaskFunc,
    *args: object,
    prerequisites: Sequence[Task] = (),
    exclusive: bool = True,
    **kwargs: object,
) -> LongRunningJob:
    [job] = enqueue_chain(
        user,
        [JobStep(job_type, func, args, kwargs)],
        prerequisites=prerequisites,
        exclusive=exclusive,
    )
    return job


def enqueue_followup(
    user: User,
    job_type: int,
    func: TaskFunc,
    *args: object,
    prerequisites: Sequence[Task] = (),
    **kwargs: object,
) -> LongRunningJob:
    return enqueue_job(
        user,
        job_type,
        func,
        *args,
        prerequisites=prerequisites,
        exclusive=False,
        **kwargs,
    )


def reserve_job(user: User, job_type: int) -> LongRunningJob:
    with transaction.atomic():
        _lock_starts(user, [job_type])
        _refuse_running(user, [job_type])
        return LongRunningJob.create_job(user=user, job_type=job_type)


def enqueue_task(func: TaskFunc, *args: object, **kwargs: object) -> None:
    store.add(func, args, kwargs)


def schedule_once(func: str, *args: object, at: datetime) -> None:
    TaskSchedule.objects.create(
        func=func, args=list(args), schedule_type=TaskSchedule.ONCE, next_run=at
    )


def schedule_once_by(name: str, func: str, *args: object, at: datetime) -> None:
    pending = TaskSchedule.objects.filter(name=name, func=func)
    pending.filter(next_run__gt=at).update(next_run=at)
    if pending.exists():
        return
    try:
        with transaction.atomic():
            TaskSchedule.objects.create(
                name=name,
                func=func,
                args=list(args),
                schedule_type=TaskSchedule.ONCE,
                next_run=at,
            )
    except IntegrityError:
        logger.info("schedule %s was created concurrently", name)


def next_scheduled_run(name: str, func: str) -> datetime | None:
    return (
        TaskSchedule.objects.filter(name=name, func=func)
        .order_by("next_run")
        .values_list("next_run", flat=True)
        .first()
    )


def ensure_schedule(
    func: str, *, schedule_type: str, minutes: int | None = None
) -> bool:
    if TaskSchedule.objects.filter(func=func).exists():
        return False
    TaskSchedule.objects.create(func=func, schedule_type=schedule_type, minutes=minutes)
    return True


def replace_schedule(
    func: str,
    *,
    name: str,
    schedule_type: str,
    next_run: datetime | None = None,
    intended_date_kwarg: str | None = None,
) -> bool:
    existing = TaskSchedule.objects.filter(func=func)
    if existing.filter(name=name).exists():
        return False
    with transaction.atomic():
        existing.delete()
        TaskSchedule.objects.filter(name=name).delete()
        TaskSchedule.objects.create(
            func=func,
            name=name,
            schedule_type=schedule_type,
            next_run=next_run or timezone.now(),
            intended_date_kwarg=intended_date_kwarg or "",
        )
    return True


def remove_schedule(func: str) -> bool:
    deleted, _ = TaskSchedule.objects.filter(func=func).delete()
    return deleted > 0


def tasks_are_waiting() -> bool:
    return store.tasks_are_waiting()


def remove_queued_tasks(job_id: str) -> int:
    return store.cancel_job_tasks(job_id)


def held_job_ids() -> set[str]:
    return store.open_job_ids()

"""The one place that queues background work; nothing else imports ``django_q.tasks``.

A job the user can see (``LongRunningJob``) gets its row in the request that
queues it, before the task is handed to django-q2, so ``/api/rqavailable/``,
the job list and cancellation know about it from the first moment. The task
receives the row's id as ``job_id`` and claims the row when it starts
(``LongRunningJob.claim``); a job cancelled while it waited is then skipped.

- ``enqueue_job``: a job started by a user. It refuses a second start while a
  job of the same type is queued or running for that user
  (``JobAlreadyRunning``, a 409 carrying the running job's ``job_id``).
- ``enqueue_followup``: a job queued by another job (the scan's follow-ups);
  the same without the refusal.
- ``enqueue_chain``: several jobs that run one after the other, each with its
  own row, all written up front.
- ``enqueue_task`` / ``enqueue_task_chain``: work without a row of its own,
  such as the per-photo pieces of a running job (they carry its ``job_id``)
  or untracked maintenance.
- ``schedule_once`` / ``ensure_schedule`` / ``replace_schedule`` /
  ``remove_schedule``: django-q schedules.

The ruff rule TID251 (``pyproject.toml``) fails any other module importing
``django_q.tasks``. ``transcode_cache`` fills its cache from a thread while a
video streams; that is not queued work and stays outside this module.
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from typing import NamedTuple

from django.db import transaction
from django.utils import timezone
from django_q.models import OrmQ, Schedule
from django_q.tasks import AsyncTask, Chain, schedule

from api.drf.exceptions import JobAlreadyRunning
from api.models.long_running_job import LongRunningJob
from api.models.user import User

logger = logging.getLogger(__name__)

TaskFunc = Callable[..., object]


class Task(NamedTuple):
    """A function and its arguments, queued without a job row of its own."""

    func: TaskFunc
    args: tuple[object, ...] = ()
    kwargs: Mapping[str, object] | None = None


class JobStep(NamedTuple):
    """One job of ``enqueue_chain``: its row's type, and the task that runs it."""

    job_type: int
    func: TaskFunc
    args: tuple[object, ...] = ()
    kwargs: Mapping[str, object] | None = None


def _check_call(step: JobStep) -> None:
    """Fail now, not in the worker, on a task that cannot run as queued.

    The task must take ``job_id`` (a task that cannot claim its row would leave
    it queued forever) and the arguments must fit with ``job_id`` passed by
    name: a positional argument landing on ``job_id`` is a ``TypeError``.
    """
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


def _refuse_running(user: User, job_types: Sequence[int]) -> None:
    running = (
        LongRunningJob.objects.running()
        .owned_by(user)
        .filter(job_type__in=job_types)
        .order_by("queued_at")
        .first()
    )
    if running is not None:
        raise JobAlreadyRunning(running.job_id, running.get_job_type_display())


def _queue_after_commit(
    jobs: Sequence[LongRunningJob], send: Callable[[], object]
) -> None:
    """Hand the work to django-q once the rows are committed.

    A worker could otherwise pick the task up before its row is visible. When
    queuing fails the rows are marked failed, so no unfinished orphan keeps the
    queue busy, and the error propagates to the caller.
    """

    def run() -> None:
        try:
            send()
        except Exception as error:
            for job in jobs:
                job.fail(f"Could not queue the job: {error}")
            raise

    transaction.on_commit(run)


def _chain(prerequisites: Sequence[Task]) -> Chain:
    chain = Chain()
    for prerequisite in prerequisites:
        chain.append(
            prerequisite.func, *prerequisite.args, **(prerequisite.kwargs or {})
        )
    return chain


def enqueue_chain(
    user: User,
    steps: Sequence[JobStep],
    *,
    prerequisites: Sequence[Task] = (),
    exclusive: bool = True,
) -> list[LongRunningJob]:
    """Queue ``steps`` to run in order, each with its row, after ``prerequisites``.

    Every row is written now, in one transaction that holds the user's row, so
    two concurrent starts cannot both pass the check. With ``exclusive`` the
    chain is refused (``JobAlreadyRunning``) when the user already has a
    queued or running job of one of the steps' types. Prerequisites are tasks
    without a row passed here, such as ``download_models`` when models are
    missing (it writes its own row when it runs). Returns the rows in order.
    """
    if not steps:
        raise ValueError("enqueue_chain needs at least one step")
    for step in steps:
        _check_call(step)

    with transaction.atomic():
        # Serialises concurrent starts by the same user on PostgreSQL. SQLite
        # has no row locks; its IMMEDIATE transactions (settings/_sqlite.py)
        # serialise the whole block instead.
        list(User.objects.select_for_update().filter(pk=user.pk).values_list("pk"))
        if exclusive:
            _refuse_running(user, [step.job_type for step in steps])
        jobs = [
            LongRunningJob.create_job(user=user, job_type=step.job_type)
            for step in steps
        ]

        def send() -> None:
            if not prerequisites and len(steps) == 1:
                step, job = steps[0], jobs[0]
                AsyncTask(
                    step.func, *step.args, job_id=job.job_id, **(step.kwargs or {})
                ).run()
                return
            chain = _chain(prerequisites)
            for step, job in zip(steps, jobs, strict=True):
                chain.append(
                    step.func, *step.args, job_id=job.job_id, **(step.kwargs or {})
                )
            chain.run()

        _queue_after_commit(jobs, send)
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
    """Write the job's row and queue ``func(*args, job_id=<its id>, **kwargs)``.

    Refused with ``JobAlreadyRunning`` when ``exclusive`` and the user already
    has a queued or running job of ``job_type``. ``func`` must take ``job_id``
    and the arguments must fit it with ``job_id`` passed by name (``TypeError``
    otherwise, before any row is written: pass the parameters after ``job_id``
    by name); it claims the row with ``LongRunningJob.claim``. See
    ``enqueue_chain`` for ``prerequisites``.
    """
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
    """``enqueue_job`` for a job queued by another job: never refused."""
    return enqueue_job(
        user,
        job_type,
        func,
        *args,
        prerequisites=prerequisites,
        exclusive=False,
        **kwargs,
    )


def enqueue_task(func: TaskFunc, *args: object, **kwargs: object) -> None:
    """Queue ``func(*args, **kwargs)`` now, without a job row of its own.

    For the pieces of a running job (they carry its ``job_id``) and untracked
    maintenance work. django-q options such as ``group=`` pass through.
    """
    AsyncTask(func, *args, **kwargs).run()


def enqueue_task_chain(tasks: Sequence[Task]) -> None:
    """Queue ``tasks`` to run one after the other, without job rows."""
    _chain(tasks).run()


def schedule_once(func: str, *args: object, at: datetime) -> None:
    """Run the function at dotted path ``func`` once, at ``at``."""
    schedule(func, *args, schedule_type=Schedule.ONCE, next_run=at)


def ensure_schedule(
    func: str, *, schedule_type: str, minutes: int | None = None
) -> bool:
    """Schedule the function at dotted path ``func`` unless it already is.

    Returns whether a schedule was created.
    """
    if Schedule.objects.filter(func=func).exists():
        return False
    schedule(func, schedule_type=schedule_type, minutes=minutes)
    return True


def replace_schedule(
    func: str,
    *,
    name: str,
    schedule_type: str,
    next_run: datetime | None = None,
    intended_date_kwarg: str | None = None,
) -> bool:
    """Make ``name`` the one schedule of the function at dotted path ``func``.

    For a schedule that follows a setting: the name says what it does (the
    automatic library scan's names its frequency and time), so a changed
    setting replaces the schedule, while a restart leaves it alone,
    ``next_run`` included. With ``intended_date_kwarg`` each run gets the time
    it was due under that keyword. Returns whether a schedule was written.
    """
    existing = Schedule.objects.filter(func=func)
    if existing.filter(name=name).exists():
        return False
    existing.delete()
    schedule(
        func,
        name=name,
        schedule_type=schedule_type,
        next_run=next_run or timezone.now(),
        intended_date_kwarg=intended_date_kwarg,
    )
    return True


def remove_schedule(func: str) -> bool:
    """Drop the schedules of the function at dotted path ``func``; whether there were any."""
    deleted, _ = Schedule.objects.filter(func=func).delete()
    return deleted > 0


def remove_queued_tasks(job_id: str) -> int:
    """Best effort: drop the queued tasks of job ``job_id`` from the ORM broker.

    The broker stores signed, pickled payloads, so each queued task is opened
    and its arguments compared with the id. This is bounded by
    ``Q_CLUSTER["queue_limit"]`` and runs only when a user cancels a job.
    Returns the number of tasks removed.
    """
    removed = 0
    try:
        for queued in OrmQ.objects.all():
            try:
                task = queued.task
                values = [*task.get("args", ()), *task.get("kwargs", {}).values()]
                if any(str(value) == job_id for value in values):
                    queued.delete()
                    removed += 1
            except Exception:
                logger.exception(
                    "Could not read queued task %s, skipping it", queued.id
                )
    except Exception:
        # Not critical: the task claims its row first and skips a cancelled job.
        logger.exception("Could not remove the queued tasks of job %s", job_id)
    return removed

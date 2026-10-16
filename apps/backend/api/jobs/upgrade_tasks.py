"""The work an upgrade leaves for this instance, and the admin card that shows it (#2322).

Each ``UpgradeTask`` names a job that brings data an older release left
behind up to date. The Admin page's **Finish the upgrade** card lists the
tasks this instance still needs (``task_overview``), with their progress, and
an admin starts, retries or (optional tasks only) dismisses them there.

- ``automatic`` tasks are required and run by themselves: the startup queues
  each once (``start_automatic_tasks``); after a failed run the card offers
  **Retry** instead of queueing it again. The semantic search conversion is
  queued by ``build_similarity_index`` on every start, as before.
- ``action`` tasks are optional: they wait for **Start** or **Not now**.

A task either applies only to data an upgrade brought along, and then its
``UpgradeTaskState`` row comes from the migration that saw that data
(``seeded``: a fresh install never gets one), or its check alone says whether
it is needed, and its row is made the first time it does. A task stops being
needed when its check says so; a seeded task whose check is "a clean run since
the row was made" ends with that run, whoever started it.

The title and sentence of each task live in the web app,
``upgradetasks.<key>.title`` and ``.description`` in ``locales/en``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, TypedDict

from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from api.directory_watcher.processing_jobs import probe_videos, unprobed_videos
from api.drf.exceptions import Conflict, JobAlreadyRunning
from api.jobs.queue import JobStep
from api.jobs.start import enqueue_for_request
from api.metadata.exposure_time_job import refresh_exposure_times_job
from api.models import LongRunningJob, UpgradeTaskState, User
from api.search.embedding_jobs import (
    batch_calculate_clip_embedding,
    photos_with_earlier_embeddings,
)
from api.thumbnails.metadata import strip_thumbnail_metadata_job
from api.video import color

logger = logging.getLogger(__name__)

TaskKind = Literal["automatic", "action"]
TaskStatus = Literal["pending", "running", "failed", "done"]

# How long a finished task stays on the card, as "Done", before it goes.
DONE_SHOWN_FOR = timedelta(days=1)

# Who a start queues which job for: some jobs work on one user's photos.
Start = Callable[[User], list[tuple[User, JobStep]]]


@dataclass(frozen=True)
class UpgradeTask:
    """One post-upgrade task: its job, when it is needed and what starting it queues.

    ``check(state)`` says whether the task still has work; it gets the task's
    row (``None`` when it has none) and must be a cheap query. ``count()`` is
    how many items the card names in the title (the videos to probe), when it
    names any.
    """

    key: str
    kind: TaskKind
    job_type: int
    check: Callable[[UpgradeTaskState | None], bool]
    start: Start
    seeded: bool = False
    autostart: bool = False
    count: Callable[[], int] | None = None

    @property
    def required(self) -> bool:
        """Automatic tasks are required: the card offers no Not now for them."""
        return self.kind == "automatic"


def _clean_run_since(job_type: int, since: datetime) -> bool:
    """Whether a ``job_type`` run queued since ``since`` finished without problems."""
    return LongRunningJob.objects.filter(
        job_type=job_type,
        queued_at__gte=since,
        finished=True,
        failed=False,
        cancelled=False,
    ).exists()


def _until_clean_run(job_type: int) -> Callable[[UpgradeTaskState | None], bool]:
    """A seeded task's check: needed until one run since its row finished cleanly."""

    def check(state: UpgradeTaskState | None) -> bool:
        return state is not None and not _clean_run_since(job_type, state.created_at)

    return check


def _as_admin(job_type: int, func: Callable[..., object]) -> Start:
    """A start that queues one instance-wide job for the admin who starts it."""

    def start(admin: User) -> list[tuple[User, JobStep]]:
        return [(admin, JobStep(job_type, func, (admin,)))]

    return start


def _videos_need_probing(state: UpgradeTaskState | None) -> bool:
    return color.can_probe() and unprobed_videos().exists()


def _probe_each_owner(admin: User) -> list[tuple[User, JobStep]]:
    """One Probe Videos job per user with unprobed videos, started as that user."""
    owner_ids = unprobed_videos().values_list("owner_id", flat=True).distinct()
    return [
        (owner, JobStep(LongRunningJob.JOB_PROBE_VIDEOS, probe_videos, (owner,)))
        for owner in User.objects.filter(pk__in=owner_ids).order_by("pk")
    ]


def _earlier_embeddings_exist(state: UpgradeTaskState | None) -> bool:
    return photos_with_earlier_embeddings().exists()


def _convert_each_owner(admin: User) -> list[tuple[User, JobStep]]:
    """One embedding job per user with an earlier model's embeddings."""
    owner_ids = (
        photos_with_earlier_embeddings().values_list("owner_id", flat=True).distinct()
    )
    return [
        (
            owner,
            JobStep(
                LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
                batch_calculate_clip_embedding,
                (owner,),
            ),
        )
        for owner in User.objects.filter(pk__in=owner_ids).order_by("pk")
    ]


UPGRADE_TASKS: tuple[UpgradeTask, ...] = (
    # Search answers from the new model's embeddings only; until every photo
    # has one, results are incomplete. build_similarity_index queues it.
    UpgradeTask(
        key="semantic_search_conversion",
        kind="automatic",
        job_type=LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
        check=_earlier_embeddings_exist,
        start=_convert_each_owner,
    ),
    # Thumbnails written by 1.2.1 or older carry the photo's EXIF and GPS
    # (#2140); seeded by migration 0185 when there are photos.
    UpgradeTask(
        key="strip_thumbnail_metadata",
        kind="automatic",
        job_type=LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA,
        check=_until_clean_run(LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA),
        start=_as_admin(
            LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA, strip_thumbnail_metadata_job
        ),
        seeded=True,
        autostart=True,
    ),
    # Shutter speeds stored as "0", "1/1000" or "5/2" by 1.3.0 or older
    # (#2275); seeded by migration 0185 when there are such rows.
    UpgradeTask(
        key="refresh_exposure_times",
        kind="automatic",
        job_type=LongRunningJob.JOB_REFRESH_EXPOSURE_TIMES,
        check=_until_clean_run(LongRunningJob.JOB_REFRESH_EXPOSURE_TIMES),
        start=_as_admin(
            LongRunningJob.JOB_REFRESH_EXPOSURE_TIMES, refresh_exposure_times_job
        ),
        seeded=True,
        autostart=True,
    ),
    # Videos indexed before the scan probed them (#2045): their HDR colours
    # and thumbnails are wrong until probed. Seeded by migration 0185 when
    # there are such videos, so a video a new scan could not read is not one.
    UpgradeTask(
        key="probe_videos",
        kind="action",
        job_type=LongRunningJob.JOB_PROBE_VIDEOS,
        check=_videos_need_probing,
        start=_probe_each_owner,
        seeded=True,
        count=lambda: unprobed_videos().count(),
    ),
)

TASKS_BY_KEY = {task.key: task for task in UPGRADE_TASKS}


def _needed(task: UpgradeTask, state: UpgradeTaskState | None) -> bool:
    if task.seeded and (state is None or state.completed_at is not None):
        return False
    return task.check(state)


def _sync_state(
    task: UpgradeTask, state: UpgradeTaskState | None, now: datetime
) -> UpgradeTaskState | None:
    """Make, finish or reopen the task's row from its check; returns the row."""
    needed = _needed(task, state)
    if state is None:
        return UpgradeTaskState.objects.create(key=task.key) if needed else None
    if needed and state.completed_at is not None:
        # A check-only task that has work again (a later model change).
        state.completed_at = None
        state.started_at = None
        state.created_at = now
        state.save(update_fields=["completed_at", "started_at", "created_at"])
    elif not needed and state.completed_at is None:
        state.completed_at = now
        state.save(update_fields=["completed_at"])
    return state


def sync_states() -> list[tuple[UpgradeTask, UpgradeTaskState]]:
    """Every task that has a row, with that row brought up to date."""
    states = {state.key: state for state in UpgradeTaskState.objects.all()}
    now = timezone.now()
    synced = []
    for task in UPGRADE_TASKS:
        state = _sync_state(task, states.get(task.key), now)
        if state is not None:
            synced.append((task, state))
    return synced


class TaskOverview(TypedDict):
    """One row of the card; ``UpgradeTaskSerializer`` describes the fields."""

    key: str
    kind: TaskKind
    optional: bool
    status: TaskStatus
    count: int | None
    progress_current: int | None
    progress_target: int | None
    latest_job_id: int | None
    error: str | None
    completed_at: datetime | None


class TaskList(TypedDict):
    """``GET /api/upgrade-tasks/`` (``UpgradeTaskListSerializer``)."""

    tasks: list[TaskOverview]


def _running_jobs(task: UpgradeTask) -> list[LongRunningJob]:
    return list(
        LongRunningJob.objects.running()
        .filter(job_type=task.job_type)
        .order_by("queued_at")
    )


def _latest_job(task: UpgradeTask, state: UpgradeTaskState) -> LongRunningJob | None:
    return (
        LongRunningJob.objects.filter(
            job_type=task.job_type, queued_at__gte=state.created_at
        )
        .order_by("-queued_at")
        .first()
    )


def _job_error(job: LongRunningJob) -> str | None:
    result = job.result if isinstance(job.result, dict) else {}
    error = result.get("error")
    return str(error) if error else None


def _overview(
    task: UpgradeTask,
    state: UpgradeTaskState,
    status: TaskStatus,
    job: LongRunningJob | None,
) -> TaskOverview:
    return {
        "key": task.key,
        "kind": task.kind,
        "optional": not task.required,
        "status": status,
        "count": task.count() if task.count and status != "done" else None,
        "progress_current": None,
        "progress_target": None,
        "latest_job_id": job.pk if job else None,
        "error": None,
        "completed_at": state.completed_at,
    }


def _running_overview(
    task: UpgradeTask, state: UpgradeTaskState, running: list[LongRunningJob]
) -> TaskOverview:
    """A running task: the progress of all its running jobs added up."""
    row = _overview(task, state, "running", running[0])
    totals = LongRunningJob.objects.filter(
        pk__in=[job.pk for job in running]
    ).aggregate(current=Sum("progress_current"), target=Sum("progress_target"))
    row["progress_current"] = totals["current"] or 0
    row["progress_target"] = totals["target"] or 0
    return row


def _describe(task: UpgradeTask, state: UpgradeTaskState) -> TaskOverview:
    if state.completed_at is not None:
        return _overview(task, state, "done", _latest_job(task, state))
    running = _running_jobs(task)
    if running:
        return _running_overview(task, state, running)
    latest = _latest_job(task, state)
    if latest is not None and (latest.failed or latest.cancelled):
        row = _overview(task, state, "failed", latest)
        row["error"] = _job_error(latest)
        return row
    return _overview(task, state, "pending", latest)


def _shown(state: UpgradeTaskState, now: datetime) -> bool:
    if state.dismissed_at is not None:
        return False
    return state.completed_at is None or now - state.completed_at < DONE_SHOWN_FOR


def task_overview() -> TaskList:
    """The card's rows: tasks still needed, and the ones done in the last day.

    Dismissed tasks are left out. Reading it also records which tasks have
    become needed or are done (``sync_states``).
    """
    now = timezone.now()
    rows = [
        _describe(task, state) for task, state in sync_states() if _shown(state, now)
    ]
    return {"tasks": rows}


def _state_of(task: UpgradeTask) -> UpgradeTaskState:
    """The task's row; ``Conflict`` (``task_not_needed``) when it has no work."""
    for synced, state in sync_states():
        if synced is task and state.completed_at is None:
            return state
    raise Conflict("This upgrade task has nothing left to do.", code="task_not_needed")


def _refuse_while_busy(task: UpgradeTask) -> None:
    """409 while any job is queued or running, as the card's Start says.

    Its own job running is ``job_already_running`` with that job's id, so the
    card follows it; another job is ``queue_busy``.
    """
    running = LongRunningJob.objects.running()
    own = running.filter(job_type=task.job_type).order_by("queued_at").first()
    if own is not None:
        raise JobAlreadyRunning(own.job_id, own.get_job_type_display())
    if not running.exists():
        return
    raise Conflict(
        "Another job is running. Start this task when it has finished.",
        code="queue_busy",
    )


def _queue(task: UpgradeTask, admin: User) -> list[LongRunningJob]:
    jobs: list[LongRunningJob] = []
    for user, step in task.start(admin):
        jobs += enqueue_for_request(user, [step], f"the upgrade task {task.key}")
    return jobs


def start_task(task: UpgradeTask, admin: User) -> list[LongRunningJob]:
    """Queue the task's jobs for ``admin``, refused while the queue is busy.

    ``Conflict`` (409): ``task_not_needed``, ``queue_busy`` or
    ``job_already_running``. Records the first start on the task's row.
    """
    state = _state_of(task)
    _refuse_while_busy(task)
    jobs = _queue(task, admin)
    if not jobs:
        raise Conflict(
            "This upgrade task has nothing left to do.", code="task_not_needed"
        )
    if state.started_at is None:
        state.started_at = timezone.now()
        state.save(update_fields=["started_at"])
    return jobs


def dismiss_task(task: UpgradeTask) -> None:
    """Hide an optional task for good (**Not now**); required ones cannot be."""
    if task.required:
        raise ValidationError(
            "This upgrade task is required and cannot be dismissed.",
            code="task_required",
        )
    UpgradeTaskState.objects.update_or_create(
        key=task.key, defaults={"dismissed_at": timezone.now()}
    )


def _first_admin() -> User | None:
    return User.objects.filter(is_superuser=True, is_active=True).order_by("pk").first()


def start_automatic_tasks() -> list[str]:
    """Queue each automatic task that has work and was never started; at startup.

    Started as the first admin; nothing without one. A task that ran and
    failed is not queued again: the card offers Retry. Returns the keys queued.
    """
    admin = _first_admin()
    if admin is None:
        return []
    queued = []
    for task, state in sync_states():
        if not task.autostart or state.completed_at is not None:
            continue
        if state.started_at is not None or _running_jobs(task):
            continue
        try:
            _queue(task, admin)
        except Exception:
            logger.exception("could not queue the upgrade task %s", task.key)
            continue
        state.started_at = timezone.now()
        state.save(update_fields=["started_at"])
        queued.append(task.key)
    return queued

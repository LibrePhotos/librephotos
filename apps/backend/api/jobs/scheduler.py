from __future__ import annotations

import logging
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from api.jobs import store
from api.models.task_queue import TaskSchedule

logger = logging.getLogger(__name__)

INTERVALS = {
    TaskSchedule.HOURLY: timedelta(hours=1),
    TaskSchedule.DAILY: timedelta(days=1),
}


def interval(schedule: TaskSchedule) -> timedelta | None:
    if schedule.schedule_type == TaskSchedule.MINUTES:
        return timedelta(minutes=max(1, schedule.minutes or 1))
    return INTERVALS.get(schedule.schedule_type)


def following(schedule: TaskSchedule, now: datetime) -> datetime | None:
    step = interval(schedule)
    if step is None:
        return None
    missed = max(0, (now - schedule.next_run) // step)
    return schedule.next_run + step * (missed + 1)


def fire(schedule: TaskSchedule, now: datetime) -> bool:
    upcoming = following(schedule, now)
    rows = TaskSchedule.objects.filter(pk=schedule.pk, next_run=schedule.next_run)
    with transaction.atomic():
        if upcoming is None:
            fired = rows.delete()[0] > 0
        else:
            fired = rows.update(next_run=upcoming, last_run=now) > 0
        if not fired:
            return False
        kwargs = dict(schedule.kwargs or {})
        if schedule.intended_date_kwarg:
            kwargs[schedule.intended_date_kwarg] = schedule.next_run.isoformat()
        store.add(
            schedule.func,
            list(schedule.args or []),
            kwargs,
            store.Placement(dedupe_key=f"schedule:{schedule.pk}"),
        )
    return True


def run_due(now: datetime | None = None) -> int:
    now = now or timezone.now()
    fired = 0
    for schedule in TaskSchedule.objects.filter(next_run__lte=now).order_by("next_run"):
        try:
            fired += fire(schedule, now)
        except Exception:
            logger.exception("Could not run the schedule of %s", schedule.func)
    return fired

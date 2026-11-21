from __future__ import annotations

import logging
import time
from dataclasses import asdict

from constance import config
from django.conf import settings
from django.db import connection

from api.models.long_running_job import LongRunningJob
from api.models.task_queue import OPEN_STATUSES, QueuedTask, WorkerProcess
from api.runtime import capacity
from api.runtime.capacity import BALANCED, FAST, INTENTIONS, Capacity, WorkerPlan

logger = logging.getLogger(__name__)

FAST_IDLE_SECONDS = 600.0


def intention() -> str:
    value = str(getattr(config, "PARALLEL_WORKERS", BALANCED))
    return value if value in INTENTIONS else BALANCED


def set_intention(value: str) -> None:
    if value not in INTENTIONS:
        raise ValueError(f"unknown intention {value!r}")
    config.PARALLEL_WORKERS = value


def override() -> int | None:
    workers: int | None = settings.TASK_WORKERS
    return workers


def plan_for(chosen: str, found: Capacity | None = None) -> WorkerPlan:
    return capacity.plan_workers(
        found or capacity.detect(),
        chosen,
        sqlite=connection.vendor == "sqlite",
        override=override(),
    )


def max_workers() -> int:
    return override() or plan_for(FAST).workers


class Sizer:
    def __init__(self, ceiling: int) -> None:
        self.ceiling = ceiling
        self.width = ceiling

    def __call__(self) -> tuple[int, int]:
        found = capacity.detect()
        planned = plan_for(intention(), found)
        width = min(self.ceiling, planned.workers)
        if capacity.low_on_memory(found):
            width = max(1, min(width, self.width - 1))
        if width != self.width:
            logger.info(
                "parallel workers: %s now (%s, %s MB available)",
                width,
                planned.intention,
                found.ram_available // capacity.MB,
            )
        self.width = width
        return width, min(width, planned.heavy_workers)


class FastFirstImport:
    def __init__(self, idle_seconds: float = FAST_IDLE_SECONDS) -> None:
        self.idle_seconds = idle_seconds
        self.idle_since: float | None = None

    def __call__(self) -> bool:
        if intention() != FAST:
            self.idle_since = None
            return False
        if QueuedTask.objects.filter(status__in=OPEN_STATUSES).exists():
            self.idle_since = None
            return False
        now = time.monotonic()
        self.idle_since = self.idle_since or now
        scanned = LongRunningJob.objects.filter(
            job_type=LongRunningJob.JOB_SCAN_PHOTOS, finished=True, failed=False
        ).filter(**{f"result__{LongRunningJob.LIBRARY_SCAN}": True})
        if now - self.idle_since < self.idle_seconds or not scanned.exists():
            return False
        set_intention(BALANCED)
        logger.info("parallel workers: the first import is done, back to balanced")
        return True


def status() -> dict[str, object]:
    found = capacity.detect()
    return {
        "capacity": {
            "cores": found.cores,
            "cpu_source": found.cpu_source,
            "ram_total_mb": found.ram_total // capacity.MB,
            "ram_available_mb": found.ram_available // capacity.MB,
            "ram_source": found.ram_source,
        },
        "intention": intention(),
        "override": override(),
        "plans": [asdict(plan_for(chosen, found)) for chosen in INTENTIONS],
        "workers": list(
            WorkerProcess.objects.order_by("host", "slot").values(
                "name",
                "slot",
                "active",
                "rss_mb",
                "heartbeat_at",
                "memory_recycles",
                "last_recycle",
            )
        ),
    }

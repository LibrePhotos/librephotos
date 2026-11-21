import os
import time
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

SQLITE_MODELS = ("QueuedTask", "TaskGroup", "WorkerProcess")


def configure(database: dict[str, object], lease_seconds: float) -> None:
    import django

    django.setup()
    from django.db import connections

    from api.jobs import store

    connections["default"].settings_dict.update(database)
    connections["default"].close()
    store.LEASE = timedelta(seconds=lease_seconds)
    store.RENEW_EVERY = timedelta(seconds=lease_seconds / 4)
    store.RETRY_DELAY = timedelta(0)


def prepare_sqlite(database: dict[str, object], tasks: int, out_dir: str) -> None:
    configure(database, 600)
    from django.apps import apps
    from django.db import connection

    with connection.schema_editor() as editor:
        for name in SQLITE_MODELS:
            editor.create_model(apps.get_model("api", name))
    enqueue(tasks, out_dir)


def enqueue(tasks: int, out_dir: str) -> None:
    from api.jobs import store

    for index in range(tasks):
        store.add(record_run, (index, out_dir))


def enqueue_crash(out_dir: str) -> None:
    from api.jobs import store

    store.add(crash_once, (out_dir,))


def record_run(index: int, out_dir: str) -> None:
    with open(Path(out_dir) / f"runs-{os.getpid()}.txt", "a", encoding="ascii") as runs:
        runs.write(f"{index}\n")


def crash_once(out_dir: str) -> None:
    marker = Path(out_dir) / "crashed"
    if not marker.exists():
        marker.write_text(str(os.getpid()), encoding="ascii")
        os._exit(9)
    record_run(-1, out_dir)


class UntilIdle:
    def __init__(self, seconds: float, idle_seconds: float) -> None:
        self.deadline = time.monotonic() + seconds
        self.idle_seconds = idle_seconds
        self.idle_since: float | None = None

    def is_set(self) -> bool:
        from api.models.task_queue import OPEN_STATUSES, QueuedTask

        now = time.monotonic()
        if now > self.deadline:
            return True
        if QueuedTask.objects.filter(status__in=OPEN_STATUSES).exists():
            self.idle_since = None
            return False
        self.idle_since = self.idle_since or now
        return now - self.idle_since > self.idle_seconds


def run_worker(
    database: dict[str, object], slot: int, seconds: float, lease_seconds: float
) -> None:
    configure(database, lease_seconds)
    from api.jobs import store
    from api.jobs.worker import Worker
    from api.jobs.worker_settings import WorkerSettings

    class ReapingWorker(Worker):
        def run_one(self) -> bool:
            store.requeue_expired()
            return super().run_one()

    stop = UntilIdle(seconds, idle_seconds=lease_seconds * 3)
    settings = WorkerSettings(poll_seconds=0.05)
    ReapingWorker(slot, stop, SimpleNamespace(value=64), settings).run()

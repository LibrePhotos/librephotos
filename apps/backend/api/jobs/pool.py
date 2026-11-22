from __future__ import annotations

import logging
import multiprocessing
import signal
import socket
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from multiprocessing.context import SpawnProcess
from pathlib import Path
from types import FrameType

import psutil
from django import db
from django.db.models import F

from api.jobs import legacy_import, scheduler, store
from api.jobs.worker import EXIT_MEMORY, EXIT_RECYCLE
from api.jobs.worker_entry import worker_main
from api.jobs.worker_settings import WorkerSettings
from api.models.task_queue import WorkerProcess

logger = logging.getLogger(__name__)

STOP_GRACE_SECONDS = 25.0
QUICK_EXIT_SECONDS = 30.0
MAX_RESTART_DELAY_SECONDS = 60.0


@dataclass
class Every:
    seconds: float
    action: Callable[[], object]
    due: float = 0.0


@dataclass
class PoolSettings:
    workers: int
    worker: WorkerSettings = field(default_factory=WorkerSettings)
    tick_seconds: float = 1.0


def kill_tree(pid: int) -> None:
    try:
        parent = psutil.Process(pid)
        processes = [*parent.children(recursive=True), parent]
    except psutil.Error:
        return
    for process in processes:
        try:
            process.kill()
        except psutil.Error:
            pass


class Pool:
    def __init__(self, settings: PoolSettings) -> None:
        self.settings = settings
        self.context = multiprocessing.get_context("spawn")
        self.stop_event = self.context.Event()
        self.width = self.context.Value("i", settings.workers)
        self.processes: dict[int, SpawnProcess] = {}
        self.started: dict[int, float] = {}
        self.quick_exits: dict[int, int] = {}
        self.restart_at: dict[int, float] = {}
        self.stopping = threading.Event()
        self.host = socket.gethostname()
        self.periodic = [
            Every(5, scheduler.run_due),
            Every(30, store.requeue_expired),
            Every(60, legacy_import.import_waiting_tasks),
            Every(3600, store.delete_old_ended),
        ]

    def request_stop(
        self, signum: int | None = None, frame: FrameType | None = None
    ) -> None:
        self.stopping.set()

    def install_signal_handlers(self) -> None:
        for name in ("SIGTERM", "SIGINT", "SIGBREAK"):
            number = getattr(signal, name, None)
            if number is not None:
                signal.signal(number, self.request_stop)

    def stop_when_file_appears(self, path: str) -> None:
        stop_file = Path(path)
        stop_file.unlink(missing_ok=True)

        def check() -> None:
            if stop_file.exists():
                stop_file.unlink(missing_ok=True)
                self.request_stop()

        self.periodic.append(Every(0.5, check))

    def worker_name(self, slot: int, pid: int | None) -> str:
        return f"{self.host}:{slot}:{pid}"

    def start_worker(self, slot: int) -> None:
        process = self.context.Process(
            target=worker_main,
            args=(slot, self.stop_event, self.width, self.settings.worker),
            name=f"librephotos-worker-{slot}",
            daemon=False,
        )
        process.start()
        self.processes[slot] = process
        self.started[slot] = time.monotonic()
        logger.info("worker %s started (pid %s)", slot, process.pid)

    def run(self) -> None:
        legacy_import.import_waiting_tasks()
        for slot in range(self.settings.workers):
            self.start_worker(slot)
        try:
            while not self.stopping.is_set():
                self.tick()
                self.stopping.wait(self.settings.tick_seconds)
        finally:
            self.shutdown()

    def tick(self) -> None:
        now = time.monotonic()
        for job in self.periodic:
            if now < job.due:
                continue
            job.due = now + job.seconds
            try:
                job.action()
            except Exception:
                logger.exception(
                    "the worker pool could not run %s", job.action.__name__
                )
        for slot, process in list(self.processes.items()):
            if not process.is_alive() and not self.stopping.is_set():
                self.replace(slot, process)
        for slot, due in list(self.restart_at.items()):
            if now >= due and not self.stopping.is_set():
                del self.restart_at[slot]
                self.start_worker(slot)
        db.close_old_connections()

    def replace(self, slot: int, process: SpawnProcess) -> None:
        code = process.exitcode
        process.join(0)
        reason = {
            EXIT_RECYCLE: "recycled",
            EXIT_MEMORY: "over its memory limit",
        }.get(code or 0, f"exited with {code}")
        try:
            store.requeue_worker(
                self.worker_name(slot, process.pid), f"its worker {reason}"
            )
            if code == EXIT_MEMORY:
                WorkerProcess.objects.filter(name=f"{self.host}:{slot}").update(
                    memory_recycles=F("memory_recycles") + 1, last_recycle=reason
                )
        except Exception:
            logger.exception("could not requeue the task of worker %s", slot)
        del self.processes[slot]
        lived = time.monotonic() - self.started.get(slot, 0.0)
        crashed = code not in (0, EXIT_RECYCLE, EXIT_MEMORY)
        quick = (
            self.quick_exits.get(slot, 0) + 1
            if crashed and lived < QUICK_EXIT_SECONDS
            else 0
        )
        self.quick_exits[slot] = quick
        delay = min(MAX_RESTART_DELAY_SECONDS, 2.0**quick) if quick else 0.0
        if crashed:
            logger.warning(
                "worker %s %s; starting a new one in %.0f s", slot, reason, delay
            )
        self.restart_at[slot] = time.monotonic() + delay

    def shutdown(self) -> None:
        self.stop_event.set()
        deadline = time.monotonic() + STOP_GRACE_SECONDS
        for process in self.processes.values():
            process.join(max(0.0, deadline - time.monotonic()))
        for slot, process in self.processes.items():
            if process.is_alive() and process.pid is not None:
                logger.warning("worker %s did not stop in time; killing it", slot)
                kill_tree(process.pid)
                process.join(5)
                try:
                    store.requeue_worker(
                        self.worker_name(slot, process.pid), "the workers were stopped"
                    )
                except Exception:
                    logger.exception("could not requeue the task of worker %s", slot)
        WorkerProcess.objects.filter(host=self.host).delete()
        db.connections.close_all()
        logger.info("workers stopped")

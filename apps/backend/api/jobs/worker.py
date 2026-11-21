from __future__ import annotations

import logging
import os
import pydoc
import socket
import threading
import time
import traceback
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from multiprocessing.sharedctypes import SynchronizedArray
from typing import Protocol

import psutil
from django import db
from django.utils import timezone

from api.jobs import payload, store
from api.jobs.release_guard import ReleaseGuard
from api.jobs.worker_settings import WorkerSettings
from api.models.task_queue import HEAVY_QUEUE, QUEUES, QueuedTask, WorkerProcess

logger = logging.getLogger(__name__)

EXIT_RECYCLE = 3
EXIT_MEMORY = 4
MB = 1024 * 1024


class Flag(Protocol):
    def is_set(self) -> bool: ...


class WorkerStoppingError(BaseException):
    pass


class GoneFunctionError(LookupError):
    pass


@dataclass
class _Running:
    task: QueuedTask | None = None
    drain: str = ""
    lock: threading.Lock = field(default_factory=threading.Lock)


_state: _Running | None = None
_stop: Flag | None = None


def checkpoint() -> None:
    if _state is None:
        return
    if _stop is not None and _stop.is_set():
        raise WorkerStoppingError("the workers are stopping")
    if _state.drain:
        raise WorkerStoppingError(_state.drain)


def resolve(path: str) -> Callable[..., object]:
    try:
        found = pydoc.locate(path)
    except pydoc.ErrorDuringImport as error:
        raise GoneFunctionError(f"{path} could not be imported: {error}") from error
    if not callable(found):
        raise GoneFunctionError(
            f"{path} no longer exists, so the task was removed from the queue. "
            "An older release queued it."
        )
    return found


def run_task(task: QueuedTask) -> None:
    try:
        func = resolve(task.func)
        args = payload.decode_args(task.args)
        kwargs = payload.decode_kwargs(task.kwargs)
    except (GoneFunctionError, payload.MissingArgumentError) as error:
        logger.warning("Removed queued task %s: %s", task.pk, error)
        store.fail(task, str(error))
        return
    except Exception:
        logger.exception(
            "Could not load the arguments of '%s' (task %s)", task.func, task.pk
        )
        store.fail(task, traceback.format_exc())
        return
    try:
        func(*args, **kwargs)
    except WorkerStoppingError:
        raise
    except Exception:
        logger.exception("Failed '%s' (task %s)", task.func, task.pk)
        store.fail(task, traceback.format_exc())
        return
    store.succeed(task)


def _close_old_connections() -> None:
    if not db.connection.in_atomic_block:
        db.close_old_connections()


def rss_mb() -> int:
    return int(psutil.Process().memory_info().rss // MB)


class Worker:
    def __init__(
        self,
        slot: int,
        stop: Flag,
        limits: Sequence[int] | SynchronizedArray[int],
        settings: WorkerSettings,
        exit_process: Callable[[int], None] = os._exit,
    ) -> None:
        self.slot = slot
        self.name = f"{socket.gethostname()}:{slot}:{os.getpid()}"
        self.stop = stop
        self.limits = limits
        self.settings = settings
        self.guard = ReleaseGuard()
        self.running = _Running()
        self.exit_process = exit_process

    def run(self) -> int:
        global _state, _stop
        _state, _stop = self.running, self.stop
        self._register()
        threading.Thread(
            target=self._renew_forever, name="task-lease", daemon=True
        ).start()
        if self.settings.memory_limit_mb:
            threading.Thread(
                target=self._watch_memory, name="memory-watchdog", daemon=True
            ).start()
        try:
            return self._loop()
        finally:
            _state, _stop = None, None

    def _loop(self) -> int:
        while not self.stop.is_set():
            if not self.run_one():
                time.sleep(self.settings.poll_seconds)
            if self.running.drain:
                return EXIT_RECYCLE
            recycle = self.settings.recycle_rss_mb
            if recycle and rss_mb() > recycle:
                logger.info("worker %s: %s MB, recycling", self.name, rss_mb())
                return EXIT_RECYCLE
        return 0

    def run_one(self) -> bool:
        if self.slot >= self.limits[0] or self.guard.database_is_newer():
            return False
        _close_old_connections()
        task = store.claim(
            self.name,
            self.settings.queues or QUEUES,
            {**store.CAPS, HEAVY_QUEUE: self.limits[1], **self.settings.caps},
        )
        if task is None:
            return False
        with self.running.lock:
            self.running.task = task
        try:
            run_task(task)
        except WorkerStoppingError as stopping:
            logger.info("worker %s: task %s paused (%s)", self.name, task.pk, stopping)
            store.release(task, count_attempt=False)
            self.running.drain = self.running.drain or str(stopping)
        finally:
            with self.running.lock:
                self.running.task = None
            _close_old_connections()
        return True

    def _register(self) -> None:
        WorkerProcess.objects.update_or_create(
            name=f"{socket.gethostname()}:{self.slot}",
            defaults={
                "host": socket.gethostname(),
                "pid": os.getpid(),
                "slot": self.slot,
                "started_at": timezone.now(),
                "heartbeat_at": timezone.now(),
                "rss_mb": rss_mb(),
            },
        )
        db.connections.close_all()

    def _renew_forever(self) -> None:
        while True:
            time.sleep(store.RENEW_EVERY.total_seconds())
            try:
                self._renew()
            except Exception:
                logger.exception("worker %s could not renew its lease", self.name)
            finally:
                db.connections.close_all()

    def _renew(self) -> None:
        with self.running.lock:
            task = self.running.task
        if task is not None:
            store.renew(task.pk, self.name)
        WorkerProcess.objects.filter(name=f"{socket.gethostname()}:{self.slot}").update(
            heartbeat_at=timezone.now(),
            rss_mb=rss_mb(),
            pid=os.getpid(),
            task_id=None if task is None else task.pk,
            active=self.slot < self.limits[0],
        )

    def _watch_memory(self) -> None:
        hard = self.settings.memory_limit_mb
        soft = int(hard * 0.75)
        while True:
            time.sleep(self.settings.watchdog_seconds)
            used = rss_mb()
            if used > hard:
                self._over_hard_limit(used)
                return
            if used > soft and not self.running.drain:
                logger.info(
                    "worker %s at %s MB (soft limit %s MB): draining",
                    self.name,
                    used,
                    soft,
                )
                self.running.drain = f"memory: {used} MB"

    def _over_hard_limit(self, used: int) -> None:
        logger.warning(
            "worker %s at %s MB, over its limit of %s MB: stopping it",
            self.name,
            used,
            self.settings.memory_limit_mb,
        )
        try:
            store.requeue_worker(self.name, f"its worker used {used} MB")
        finally:
            self.exit_process(EXIT_MEMORY)

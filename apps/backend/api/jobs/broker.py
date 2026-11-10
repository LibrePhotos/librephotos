"""The django-q2 broker: the ORM broker, except that a cluster holds the tasks
it took on a lease, and stops taking tasks once a newer release has migrated
the database.

The lease (#2852). The ORM broker locks a task it hands out for
``Q_CLUSTER["retry"]`` and deletes it once the task's result is saved.
LibrePhotos' retry has to exceed its task timeout, so a task whose cluster
went away (a restart, an image update, an OOM kill) stayed locked for about
231 days: a scan stopped at 99.97% and never queued its follow-ups. Here a
taken task is locked for ``LEASE``, and the pusher that took it renews the
lock every ``RENEW_EVERY`` for as long as it lives. Once the cluster is gone
its tasks are handed out again within ``LEASE``, to whichever cluster runs
next. A task whose cluster died while running it therefore runs again: a
task that starts a job skips the second delivery (``LongRunningJob.claim``),
and a per-item task counts its item once (``CountedJobItem``), so its job's
progress does not pass the work it queued.

A failed task is acknowledged too. Its failure is in the result table, and
under a lease that its cluster keeps renewing it would otherwise run again
after every restart.

A task that cannot be loaded fails at once (#2945). django-q stores a task as
a pickled reference to its function, so a task queued before an update that
removed or moved that function raises when it is opened. In the pusher that
ended the pusher, and the sentinel's next one took the same task: no queued
work ran again. Here such a task leaves the queue and goes into the result
table as a failure that names the missing code; the next tasks run.

The release guard. A rolling deploy (Coolify, a Kubernetes surge) keeps the
old container running while the new one migrates and writes its startup
schedules, which are due at once. The old cluster took their first run and
failed it, "Function api.updates.check.check_for_updates is not defined", and
it would run any other task against a schema it does not know. With this
broker it leaves the queue to the new release. "Newer" is librephotos.E002's
test: an applied migration this code has no file for
(``api.checks.unknown_applied_migrations``).
"""

from __future__ import annotations

import io
import logging
import os
import pickle
import threading
import time
import uuid
from datetime import datetime, timedelta

from django.db import DatabaseError, connections
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.db.models import Count, Max
from django.utils import timezone
from django_q import core_signing
from django_q.brokers.orm import ORM
from django_q.conf import Conf
from django_q.models import OrmQ
from django_q.monitor import save_task
from django_q.signing import BadSignature, SignedPackage

from api.checks import unknown_applied_migrations

logger = logging.getLogger(__name__)

# How long a taken task stays with its cluster without a renewal. Generous,
# because a graceful stop ends the pusher, and with it the renewals, before
# the workers have finished the tasks it had taken.
LEASE = timedelta(minutes=10)
# How often the pusher renews the leases of the tasks it holds.
RENEW_EVERY = timedelta(minutes=1)


class ReleaseGuardedORM(ORM):
    """``Q_CLUSTER["broker_class"]``: the ORM broker with leases and the release guard."""

    def __init__(self, list_key: str | None = None) -> None:
        super().__init__(list_key=list_key)
        self._start_guard()

    def __setstate__(self, state: tuple[str, str | None]) -> None:
        # The cluster pickles its broker into the pusher process where fork is
        # not available (Windows), and Broker.__setstate__ restores only the
        # queue name: each process checks the migrations afresh.
        super().__setstate__(state)
        self._start_guard()

    def _start_guard(self) -> None:
        # Every enqueue builds a broker, so the disk migrations load on the
        # first dequeue, which only a cluster's pusher calls.
        self._loader: MigrationLoader | None = None
        # Kept, so that it remembers the migrations table exists.
        self._recorder: MigrationRecorder | None = None
        self._seen_migrations: dict[str, int | None] | None = None
        self._database_is_newer = False
        # The tasks this process took whose rows were still there at the last
        # renewal; the monitor deletes a row once the task's result is saved.
        self._held: set[int] = set()
        self._held_lock = threading.Lock()
        self._renewing_in_pid: int | None = None

    def timeout(self, task: OrmQ | None = None) -> datetime:
        """The lock of a task taken or renewed now: the end of its lease."""
        return timezone.now() + LEASE

    def dequeue(self) -> list[tuple[int, str]] | None:
        # A cluster of an older release still renews what it took, so the
        # tasks it is running do not go to the newer one as well.
        if self.database_is_newer():
            # The same idle wait as the ORM broker's on an empty queue.
            time.sleep(Conf.POLL)
            return None
        tasks: list[tuple[int, str]] | None = super().dequeue()
        if not tasks:
            return tasks
        loaded: list[tuple[int, str]] = []
        for pk, payload in tasks:
            try:
                loaded.append((pk, acknowledged_when_failed(payload)))
            except Exception as error:
                # Anything else that unpickling raises: the pusher would die
                # on it. An empty list sends the pusher straight back here.
                logger.exception(
                    "Removed queued task %s, which this release cannot load", pk
                )
                self.fail_unloadable(pk, payload, error)
        with self._held_lock:
            self._held.update(pk for pk, _payload in loaded)
        if loaded:
            self._keep_renewing()
        return loaded

    def fail_unloadable(self, pk: int, payload: str, error: Exception) -> None:
        """Take task ``pk`` off the queue and record it as failed.

        The record is best effort: a failure to write it must not stop the
        pusher, which is what dropping the task is for.
        """
        self.delete(pk)
        try:
            save_task(unloadable_failure(payload, error), self)
        except Exception:
            logger.exception("Could not record removed queued task %s as failed", pk)

    def renew_leases(self) -> None:
        """Extend the lease of every task this process holds.

        Also cuts every lock of the queue longer than one lease down to one.
        That releases the tasks a cluster took before leases, locked for
        ``Q_CLUSTER["retry"]``, unless a live cluster renews them meanwhile.
        """
        queue = OrmQ.objects.using(Conf.ORM)
        until = self.timeout()
        with self._held_lock:
            held = set(self._held)
        if held:
            still_held = set(queue.filter(pk__in=held).values_list("pk", flat=True))
            queue.filter(pk__in=still_held).update(lock=until)
            with self._held_lock:
                self._held -= held - still_held
        queue.filter(key=self.list_key, lock__gt=until).update(lock=until)

    def _keep_renewing(self) -> None:
        """Renew the leases from a thread of this process, from now on.

        Started by the first dequeue, so it runs in the pusher, the one
        process that dequeues; not in the web workers, whose enqueues build a
        broker too. A thread, because the pusher blocks while the workers'
        queue is full. It ends with the pusher, and so do the leases.
        """
        if Conf.TESTING or self._renewing_in_pid == os.getpid():
            return
        self._renewing_in_pid = os.getpid()
        threading.Thread(
            target=self._renew_forever, name="task-leases", daemon=True
        ).start()

    def _renew_forever(self) -> None:
        while True:
            time.sleep(RENEW_EVERY.total_seconds())
            try:
                self.renew_leases()
            except Exception:
                # The next round tries again: a lease outlasts nine misses.
                logger.exception("Could not renew the leases of the taken tasks")
            finally:
                connections[Conf.ORM].close()

    def database_is_newer(self) -> bool:
        """Whether the database has a migration this code has no file for.

        Asked before every dequeue: the new release queues its first tasks
        seconds after its migrate, so an answer kept for a while would let the
        old cluster take them. One count of the migration rows says whether
        anything was applied since the last look; only then are the names
        compared.
        """
        if self._recorder is None:
            self._recorder = MigrationRecorder(connections[Conf.ORM])
        recorder = self._recorder
        try:
            if not recorder.has_table():
                return self._database_is_newer
            seen = recorder.migration_qs.aggregate(count=Count("id"), last=Max("id"))
            if seen == self._seen_migrations:
                return self._database_is_newer
            applied = set(recorder.applied_migrations())
        except DatabaseError:
            # An unreachable database is the ORM broker's own error to report.
            return self._database_is_newer
        self._seen_migrations = seen
        if self._loader is None:
            loader = MigrationLoader(None, load=False)
            loader.load_disk()
            self._loader = loader
        unknown = unknown_applied_migrations(applied, self._loader)
        if unknown and not self._database_is_newer:
            app_label, name = max(unknown, key=lambda key: key[1])
            logger.warning(
                "A newer LibrePhotos release migrated the database (%s.%s), so "
                "this cluster takes no more tasks and leaves them to that release",
                app_label,
                name,
            )
        self._database_is_newer = bool(unknown)
        return self._database_is_newer


def acknowledged_when_failed(payload: str) -> str:
    """The task ``payload`` with ``ack_failure`` on, unless it sets the flag.

    django-q2 copies ``Q_CLUSTER["ack_failures"]`` into a task when it is
    queued, so that setting would miss the tasks already in the queue at an
    upgrade.
    """
    try:
        task = SignedPackage.loads(payload)
    except TypeError, BadSignature:
        # The pusher logs it and deletes it.
        return payload
    if not isinstance(task, dict) or "ack_failure" in task:
        return payload
    task["ack_failure"] = True
    signed: str = SignedPackage.dumps(task)
    return signed


class _MissingCode:
    """Stands in for a function or class a queued task names that this code lacks."""

    def __init__(self, path: str) -> None:
        self.path = path

    def __call__(self, *args: object, **kwargs: object) -> _MissingCode:
        # A missing class rebuilt from its arguments: still the stand-in.
        return self

    def __setstate__(self, state: object) -> None:
        # The rebuilt object's state, which has nowhere to go.
        pass


class _TolerantUnpickler(pickle.Unpickler):
    """Opens a task whose code is gone, noting each missing name."""

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


class _TolerantSerializer:
    """``core_signing``'s serializer, reading with ``_TolerantUnpickler``."""

    def __init__(self) -> None:
        self.missing: list[str] = []

    def loads(self, data: bytes) -> object:
        unpickler = _TolerantUnpickler(data)
        # Shared, so the names missed before a later error are known too.
        self.missing = unpickler.missing
        loaded: object = unpickler.load()
        return loaded


def unloadable_failure(payload: str, error: Exception) -> dict[str, object]:
    """The failed-task record of ``payload``, which raised ``error`` when loaded.

    What it can be read with the missing code stood in for: its id, name,
    function and arguments. Never its chain, which would queue the next step.
    """
    serializer = _TolerantSerializer()
    try:
        # core_signing builds its serializer by calling the argument.
        task = core_signing.loads(
            payload,
            key=Conf.SECRET_KEY,
            salt=Conf.PREFIX,
            serializer=lambda: serializer,
        )
    except Exception:
        # An old pickle can raise anything while it rebuilds an object, such
        # as getattr() on a method that was removed: then the reason is generic.
        logger.exception("Read a removed queued task without its fields")
        task = {}
    if not isinstance(task, dict):
        task = {}
    missing = serializer.missing
    if missing:
        reason = (
            f"{', '.join(dict.fromkeys(missing))} no longer exists, so the task "
            "was removed from the queue. An older release queued it."
        )
    else:
        reason = (
            f"The task could not be loaded ({type(error).__name__}: {error}), "
            "so it was removed from the queue."
        )
    func = task.get("func")
    now = timezone.now()
    return {
        "id": str(task.get("id") or uuid.uuid4().hex),
        "name": str(task.get("name") or "unloadable task"),
        "func": func.path if isinstance(func, _MissingCode) else func or "unknown",
        "args": task.get("args") or (),
        "kwargs": task.get("kwargs") or {},
        "group": task.get("group"),
        "cluster": Conf.CLUSTER_NAME,
        "started": now,
        "stopped": now,
        "result": reason,
        "success": False,
    }

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
and the per-item tasks are safe to repeat.

A failed task is acknowledged too. Its failure is in the result table, and
under a lease that its cluster keeps renewing it would otherwise run again
after every restart.

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

import logging
import os
import threading
import time
from datetime import datetime, timedelta

from django.db import DatabaseError, connections
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.db.models import Count, Max
from django.utils import timezone
from django_q.brokers.orm import ORM
from django_q.conf import Conf
from django_q.models import OrmQ
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
        with self._held_lock:
            self._held.update(pk for pk, _payload in tasks)
        self._keep_renewing()
        return [(pk, acknowledged_when_failed(payload)) for pk, payload in tasks]

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

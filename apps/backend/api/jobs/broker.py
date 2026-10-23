"""The django-q2 broker: the ORM broker, except that a cluster stops taking
tasks once a newer release has migrated the database.

A rolling deploy (Coolify, a Kubernetes surge) keeps the old container running
while the new one migrates and writes its startup schedules, which are due at
once. The old cluster took their first run and failed it, "Function
api.updates.check.check_for_updates is not defined", and it would run any other
task against a schema it does not know. With this broker it leaves the queue
to the new release. "Newer" is librephotos.E002's test: an applied migration
this code has no file for (``api.checks.unknown_applied_migrations``).
"""

from __future__ import annotations

import logging
import time

from django.db import DatabaseError, connections
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.db.models import Count, Max
from django_q.brokers.orm import ORM
from django_q.conf import Conf

from api.checks import unknown_applied_migrations

logger = logging.getLogger(__name__)


class ReleaseGuardedORM(ORM):
    """``Q_CLUSTER["broker_class"]``: the ORM broker with the release guard."""

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

    def dequeue(self) -> list[tuple[int, str]] | None:
        if self.database_is_newer():
            # The same idle wait as the ORM broker's on an empty queue.
            time.sleep(Conf.POLL)
            return None
        tasks: list[tuple[int, str]] | None = super().dequeue()
        return tasks

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

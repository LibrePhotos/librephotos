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
import math
import time

from django.db import DatabaseError, connections
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django_q.brokers.orm import ORM
from django_q.conf import Conf

from api.checks import unknown_applied_migrations

logger = logging.getLogger(__name__)

# How often a cluster looks at the applied migrations again. The pusher asks
# for work every Q_CLUSTER["poll"] second; this keeps that to one cheap query
# per half minute. A newer release's schedules wait at most this long, while
# its own cluster is still starting.
RECHECK_SECONDS = 30.0


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
        self._checked_at = -math.inf
        self._database_is_newer = False

    def dequeue(self) -> list[tuple[int, str]] | None:
        if self.database_is_newer():
            # The same idle wait as the ORM broker's on an empty queue.
            time.sleep(Conf.POLL)
            return None
        tasks: list[tuple[int, str]] | None = super().dequeue()
        return tasks

    def database_is_newer(self) -> bool:
        """Whether the database has a migration this code has no file for."""
        now = time.monotonic()
        if now - self._checked_at < RECHECK_SECONDS:
            return self._database_is_newer
        self._checked_at = now
        if self._loader is None:
            loader = MigrationLoader(None, load=False)
            loader.load_disk()
            self._loader = loader
        try:
            applied = set(MigrationRecorder(connections[Conf.ORM]).applied_migrations())
        except DatabaseError:
            # An unreachable database is the ORM broker's own error to report.
            return self._database_is_newer
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

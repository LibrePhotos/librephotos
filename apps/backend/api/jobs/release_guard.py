from __future__ import annotations

import logging

from django.db import DatabaseError, connection
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.db.models import Count, Max

from api.checks import unknown_applied_migrations

logger = logging.getLogger(__name__)


class ReleaseGuard:
    def __init__(self) -> None:
        self._loader: MigrationLoader | None = None
        self._seen: dict[str, int | None] | None = None
        self._newer = False

    def database_is_newer(self) -> bool:
        recorder = MigrationRecorder(connection)
        try:
            if not recorder.has_table():
                return self._newer
            seen = recorder.migration_qs.aggregate(count=Count("id"), last=Max("id"))
            if seen == self._seen:
                return self._newer
            applied = set(recorder.applied_migrations())
        except DatabaseError:
            return self._newer
        self._seen = seen
        if self._loader is None:
            loader = MigrationLoader(None, load=False)
            loader.load_disk()
            self._loader = loader
        unknown = unknown_applied_migrations(applied, self._loader)
        if unknown and not self._newer:
            app_label, name = max(unknown, key=lambda key: key[1])
            logger.warning(
                "A newer LibrePhotos release migrated the database (%s.%s), so "
                "these workers take no more tasks and leave them to that release",
                app_label,
                name,
            )
        self._newer = bool(unknown)
        return self._newer

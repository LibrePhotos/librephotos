import logging
import time
from dataclasses import dataclass
from typing import Any

from django.apps import AppConfig, apps
from django.db import DEFAULT_DB_ALIAS, DatabaseError, connections
from django.db.backends.base.base import BaseDatabaseWrapper
from django.db.models.signals import post_migrate

logger = logging.getLogger(__name__)

WATCHED_MODELS = (
    "api.Photo",
    "api.File",
    "api.Thumbnail",
    "api.Face",
    "api.Person",
    "api.Cluster",
    "api.AlbumUser",
    "api.AlbumThing",
    "api.AlbumPlace",
    "api.AlbumAuto",
)
MIN_CHANGED_ROWS = 500
CHANGED_SHARE = 0.1


@dataclass(frozen=True)
class StaleTable:
    name: str
    analyzed_rows: int | None
    rows: int


def watched_tables() -> list[str]:
    tables: list[str] = []
    for label in WATCHED_MODELS:
        model = apps.get_model(label)
        tables.append(model._meta.db_table)
        tables.extend(
            field.remote_field.through._meta.db_table
            for field in model._meta.local_many_to_many
        )
    return list(dict.fromkeys(tables))


def is_stale(analyzed_rows: int | None, rows: int) -> bool:
    changed = abs(rows - (analyzed_rows or 0))
    return changed >= max(MIN_CHANGED_ROWS, CHANGED_SHARE * (analyzed_rows or 0))


def _analyzed_rows(connection: BaseDatabaseWrapper) -> dict[str, int]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'"
        )
        if not cursor.fetchone()[0]:
            return {}
        cursor.execute("SELECT tbl, stat FROM sqlite_stat1")
        rows: dict[str, int] = {}
        for table, stat in cursor.fetchall():
            first = str(stat or "").split(" ", 1)[0]
            if first.isdigit():
                rows[table] = max(rows.get(table, 0), int(first))
        return rows


def stale_tables(using: str = DEFAULT_DB_ALIAS) -> list[StaleTable]:
    connection = connections[using]
    if connection.vendor != "sqlite":
        return []
    analyzed = _analyzed_rows(connection)
    existing = set(connection.introspection.table_names())
    stale = []
    with connection.cursor() as cursor:
        for table in watched_tables():
            if table not in existing:
                continue
            cursor.execute(f"SELECT count(*) FROM {connection.ops.quote_name(table)}")
            rows = int(cursor.fetchone()[0])
            if is_stale(analyzed.get(table), rows):
                stale.append(StaleTable(table, analyzed.get(table), rows))
    return stale


def _describe(stale: list[StaleTable]) -> str:
    return ", ".join(
        f"{table.name} {table.analyzed_rows or 0} -> {table.rows} rows"
        for table in stale
    )


def refresh_planner_stats(
    using: str = DEFAULT_DB_ALIAS, reload: bool = False
) -> list[StaleTable]:
    connection = connections[using]
    if connection.vendor != "sqlite":
        return []
    try:
        stale = stale_tables(using)
        with connection.cursor() as cursor:
            if stale:
                started = time.monotonic()
                cursor.execute("PRAGMA analysis_limit = 0")
                cursor.execute("ANALYZE")
                logger.info(
                    "SQLite planner statistics refreshed in %.1f s: %s",
                    time.monotonic() - started,
                    _describe(stale),
                )
            elif reload and _analyzed_rows(connection):
                cursor.execute("ANALYZE sqlite_schema")
    except DatabaseError:
        logger.warning("Could not refresh the SQLite planner statistics", exc_info=True)
        return []
    return stale


def refresh_after_migrate(
    sender: AppConfig, using: str = DEFAULT_DB_ALIAS, **kwargs: Any
) -> None:
    refresh_planner_stats(using)


def register() -> None:
    post_migrate.connect(
        refresh_after_migrate,
        sender=apps.get_app_config("api"),
        dispatch_uid="api.runtime.planner_stats.refresh_after_migrate",
    )

"""Back up the SQLite database before migrations change it (issue #2314).

The standalone build and the SQLite mode of the unified image migrate on every
start. Some migrations are destructive, so when a start brings migrations the
``backup_database`` command (run before ``migrate``) first copies the database
to ``backups/librephotos-<release>-<UTC time>.sqlite3`` next to it, with a JSON
file saying where it came from, and keeps the newest few.

The folder sits next to the database (``BASE_DATA/db/backups``) rather than
directly under ``BASE_DATA``: the unified image's documented volumes are
``/db``, ``/protected_media`` and ``/logs``, so a ``/backups`` folder would
live in the container and be gone with it.

The copy is one step of SQLite's online backup API. An incremental backup
(``pages=100``) starts over on every write from another connection and was
measured not to finish at all under a busy writer; one step copies the whole
database under a single read lock in well under a second for tens of MB.

PostgreSQL is backed up with ``pg_dump``; the command says so and does nothing.
"""

import json
import os
import re
import shutil
import sqlite3
from contextlib import closing
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from django.conf import settings
from django.core import checks
from django.db.backends.base.base import BaseDatabaseWrapper
from django.db.migrations.executor import MigrationExecutor

BACKUP_DIR_NAME = "backups"
BACKUP_PREFIX = "librephotos-"
BACKUP_SUFFIX = ".sqlite3"
SIDECAR_SUFFIX = ".json"
# Room for the copy plus the same again for whatever the migration writes.
FREE_SPACE_FACTOR = 2
# SQLite's own companions of a database file.
SQLITE_COMPANIONS = ("-wal", "-shm", "-journal")
_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


class BackupError(Exception):
    """No backup was made. The message is meant for the person running LibrePhotos."""


@dataclass(frozen=True)
class BackupInfo:
    """What the JSON file next to a backup records."""

    version: str
    git_hash: str
    reason: str
    applied_migrations: int
    pending_migrations: list[str] = field(default_factory=list)


def backup_dir(source: Path) -> Path:
    return source.parent / BACKUP_DIR_NAME


def sqlite_file(connection: BaseDatabaseWrapper) -> Path | None:
    """The file behind an SQLite connection; None for an in-memory database."""
    name = str(connection.settings_dict["NAME"])
    if name == ":memory:" or name.startswith("file:"):
        return None
    return Path(name)


def migration_state(connection: BaseDatabaseWrapper) -> tuple[list[str], int]:
    """The migrations ``migrate`` would apply, as ``app.name``, and how many are applied."""
    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    pending = [f"{migration.app_label}.{migration.name}" for migration, _ in plan]
    return pending, len(executor.loader.applied_migrations)


def migrate_will_refuse(alias: str) -> bool:
    """A database check (librephotos.E001, E002) will stop ``migrate`` before it changes anything.

    Nothing will be migrated then, so there is nothing to back up, and the
    migration graph of such a database may not even load: ``migrate`` gets to
    report the problem in its own words.
    """
    found = checks.run_checks(databases=[alias], tags=[checks.Tags.database])
    return any(message.is_serious() for message in found)


def database_size(source: Path) -> int:
    """Bytes of the database including its write-ahead log, which a backup folds in."""
    wal = source.with_name(source.name + "-wal")
    return source.stat().st_size + (wal.stat().st_size if wal.exists() else 0)


def human_size(size: int) -> str:
    if size >= 1024**3:
        return f"{size / 1024**3:.1f} GB"
    return f"{max(1, round(size / 1024**2))} MB"


def disk_label(directory: Path) -> str:
    """'drive C:' on Windows, the folder elsewhere: where the user has to make room."""
    drive = os.path.splitdrive(str(directory.resolve()))[0]
    return f"drive {drive}" if drive else f"the disk that holds {directory}"


def ensure_free_space(source: Path, directory: Path) -> None:
    needed = FREE_SPACE_FACTOR * database_size(source)
    free = shutil.disk_usage(directory).free
    if free >= needed:
        return
    where = disk_label(directory)
    raise BackupError(
        f"There is not enough free disk space to back up the database before "
        f"updating it: {human_size(needed)} is needed on {where} and "
        f"{human_size(free)} is free. Free some disk space on {where} and "
        f"start LibrePhotos again."
    )


def backup_name(directory: Path, version: str, now: datetime) -> Path:
    """``librephotos-<release>-<UTC time>.sqlite3``, numbered when that name is taken."""
    release = _UNSAFE_NAME_CHARS.sub("-", version).strip("-") or "unknown"
    stem = f"{BACKUP_PREFIX}{release}-{now.astimezone(UTC):%Y%m%dT%H%M%SZ}"
    candidate = directory / f"{stem}{BACKUP_SUFFIX}"
    number = 1
    while candidate.exists():
        candidate = directory / f"{stem}-{number}{BACKUP_SUFFIX}"
        number += 1
    return candidate


def copy_database(source: Path, target: Path) -> None:
    """One-step online backup of ``source`` into a new file ``target``.

    Readers and writers of the source may carry on meanwhile; the copy is the
    database as of one moment. It is switched to the rollback journal so the
    backup is a single file that can be copied back as it is.
    """
    timeout = 30
    with (
        closing(sqlite3.connect(source, timeout=timeout)) as src,
        closing(sqlite3.connect(target, timeout=timeout)) as dst,
    ):
        # pages=-1: everything in one step. Never incremental, see the module docstring.
        src.backup(dst, pages=-1)
        dst.execute("PRAGMA journal_mode=DELETE")


def verify_database(path: Path) -> None:
    with closing(sqlite3.connect(path)) as db:
        rows = db.execute("PRAGMA integrity_check").fetchall()
    if rows != [("ok",)]:
        raise BackupError(
            f"The backup of the database failed SQLite's integrity check "
            f"({rows[0][0] if rows else 'no answer'}), so it was not kept. "
            f"The database itself was not changed."
        )


def remove_database_file(path: Path) -> None:
    for candidate in (
        path,
        *(path.with_name(path.name + s) for s in SQLITE_COMPANIONS),
    ):
        candidate.unlink(missing_ok=True)


def write_sidecar(backup: Path, source: Path, info: BackupInfo, now: datetime) -> None:
    record = {
        **asdict(info),
        "created_at": now.astimezone(UTC).isoformat(),
        "source": str(source),
        "size_bytes": backup.stat().st_size,
    }
    backup.with_suffix(SIDECAR_SUFFIX).write_text(
        json.dumps(record, indent=2), encoding="utf-8"
    )


def prune_backups(directory: Path, keep: int) -> list[Path]:
    """Delete all but the newest ``keep`` backups (at least one stays) and their JSON files."""
    backups = sorted(
        directory.glob(f"{BACKUP_PREFIX}*{BACKUP_SUFFIX}"),
        key=lambda path: (path.stat().st_mtime, path.name),
        reverse=True,
    )
    removed = backups[max(1, keep) :]
    for old in removed:
        remove_database_file(old)
        old.with_suffix(SIDECAR_SUFFIX).unlink(missing_ok=True)
    return removed


def backup_sqlite(
    source: Path,
    directory: Path,
    info: BackupInfo,
    keep: int,
    now: datetime | None = None,
) -> Path:
    """Copy ``source`` into ``directory``, check the copy, record it and prune old ones.

    Raises BackupError, leaving no partial file behind, when there is not
    enough disk space or the copy is not sound.
    """
    now = now or datetime.now(UTC)
    directory.mkdir(parents=True, exist_ok=True)
    ensure_free_space(source, directory)
    target = backup_name(directory, info.version, now)
    partial = target.with_name(target.name + ".partial")
    try:
        copy_database(source, partial)
        verify_database(partial)
        os.replace(partial, target)
    except sqlite3.Error as error:
        raise BackupError(
            f"The database could not be backed up ({error}). It was not changed."
        ) from error
    finally:
        remove_database_file(partial)
    write_sidecar(target, source, info, now)
    prune_backups(directory, keep)
    return target


def backup_database(
    connection: BaseDatabaseWrapper, *, only_if_pending: bool, keep: int
) -> str:
    """Back up the database of ``connection`` when that is needed; returns what happened.

    Not SQLite, a database without any migration applied yet (a first
    start), a database ``migrate`` will refuse, or (with ``only_if_pending``)
    nothing to migrate: nothing is written.
    """
    if connection.vendor != "sqlite":
        return (
            f"LibrePhotos only backs up SQLite databases. Back up "
            f"{connection.display_name} with its own tools (pg_dump, see the "
            f"upgrading docs)."
        )
    source = sqlite_file(connection)
    if source is None or not source.exists():
        return "There is no database file yet: nothing to back up."
    if migrate_will_refuse(connection.alias):
        return "Not backing up: migrate will stop on this database and say why."
    pending, applied = migration_state(connection)
    # Release Django's own handle before the copy reads the file.
    connection.close()
    if not applied:
        return "The database is new: nothing to back up."
    if only_if_pending and not pending:
        return "No pending migrations: no backup needed."
    info = BackupInfo(
        version=settings.IMAGE_TAG or "dev",
        git_hash=settings.GIT_HASH,
        reason="before migrating" if pending else "on request",
        applied_migrations=applied,
        pending_migrations=pending,
    )
    target = backup_sqlite(source, backup_dir(source), info, keep)
    # The standalone build reads the count for its tray status (#2316).
    applying = f" before applying {len(pending)} pending migrations" if pending else ""
    return f"Backed up the database to {target}{applying}"

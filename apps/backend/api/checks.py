"""Django system checks for deployment configuration.

Registered from ``ApiConfig.ready``. Warnings surface wherever system checks
run, which includes the ``manage.py migrate`` every entrypoint runs on start;
checks tagged ``database`` run there too, before any migration is loaded.
"""

from collections.abc import Collection, Sequence
from importlib import import_module
from typing import Any

from django.apps import AppConfig
from django.conf import settings
from django.core import checks
from django.core.checks import CheckMessage
from django.db import DatabaseError, connections, router
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder


def check_default_db_password(
    app_configs: Sequence[AppConfig] | None, **kwargs: Any
) -> list[CheckMessage]:
    """Warn when PostgreSQL is reached with the fallback password.

    ``DB_PASS`` falls back to the password shipped in librephotos.env so that
    old hand-written setups keep connecting (see the settings module); this
    makes sure that fallback is never silent.
    """
    if getattr(settings, "DB_PASS_FROM_ENV", True):
        return []
    database = settings.DATABASES.get("default", {})
    if "postgresql" not in str(database.get("ENGINE", "")):
        return []
    if database.get("PASSWORD") != getattr(
        settings, "INSECURE_DEFAULT_DB_PASSWORD", None
    ):
        return []
    return [
        checks.Warning(
            "DB_PASS is not set, so the database password falls back to the "
            "built-in default shared by every LibrePhotos install.",
            hint=(
                "Set DB_PASS (dbPass in librephotos.env) to the password of your "
                "PostgreSQL user. The fallback is kept only so existing installs "
                "keep working and may be removed in a future release."
            ),
            id="librephotos.W001",
        )
    ]


# api migrations 0001-0100 were squashed into this migration and deleted. See
# docs/installation/upgrading.md in apps/docs for the release rule below.
SQUASHED_MIGRATION = "0001_squashed_0100"
# The first release whose database has every one of 0001-0100 applied.
FIRST_RELEASE_WITH_ALL_SQUASHED_MIGRATIONS = "2026w10"
# The last release that still ships 0001-0100 as individual migrations.
LAST_RELEASE_WITH_INDIVIDUAL_MIGRATIONS = "1.1.0"
UPGRADE_DOCS_URL = (
    "https://docs.librephotos.com/docs/installation/upgrading#old-releases"
)


def check_squashed_migration_history(
    app_configs: Sequence[AppConfig] | None,
    databases: Collection[str] | None = None,
    **kwargs: Any,
) -> list[CheckMessage]:
    """Stop ``migrate`` on a database older than the squashed migrations.

    A database with some, but not all, of the migrations 0001_squashed_0100
    replaces applied comes from an install older than
    FIRST_RELEASE_WITH_ALL_SQUASHED_MIGRATIONS. The migrations it still needs
    are gone, and left alone Django fails with an obscure migration graph
    error (or tries 0101 on the old schema), so name the upgrade path instead.

    Fresh databases (none of them applied) and current ones (all applied) pass.
    Registered with the database tag: it runs at the start of every
    ``manage.py migrate`` and with ``manage.py check --database default``.
    """
    if not databases:
        return []
    squashed = import_module(f"api.migrations.{SQUASHED_MIGRATION}").Migration
    replaced = {name for app_label, name in squashed.replaces}

    errors: list[CheckMessage] = []
    for alias in databases:
        if not router.allow_migrate(alias, "api"):
            continue
        recorder = MigrationRecorder(connections[alias])
        try:
            if not recorder.has_table():
                continue
            applied = {
                name
                for app_label, name in recorder.applied_migrations()
                if app_label == "api"
            }
        except DatabaseError:
            # An unreachable database is migrate's own error to report.
            continue
        done = replaced & applied
        if not done or done == replaced:
            continue
        errors.append(
            checks.Error(
                f"The database '{alias}' was created by a LibrePhotos release "
                f"older than {FIRST_RELEASE_WITH_ALL_SQUASHED_MIGRATIONS}: its "
                f"newest applied migration is api.{max(done)}, and "
                f"{len(replaced - done)} of the migrations this release "
                f"expects to have run are missing. This release cannot upgrade "
                f"it directly.",
                hint=(
                    f"Upgrade in two steps. First run any release from "
                    f"{FIRST_RELEASE_WITH_ALL_SQUASHED_MIGRATIONS} up to "
                    f"{LAST_RELEASE_WITH_INDIVIDUAL_MIGRATIONS} (for example "
                    f"the reallibrephotos/librephotos:"
                    f"{LAST_RELEASE_WITH_INDIVIDUAL_MIGRATIONS} image) and "
                    f"start it once so its migrations run, then upgrade to "
                    f"this release. Back up the database first (with SQLite, "
                    f"copy the db folder of the data directory: the "
                    f"intermediate release makes no backup of its own). "
                    f"See {UPGRADE_DOCS_URL}"
                ),
                id="librephotos.E001",
            )
        )
    return errors


# The apps whose migrations this repository writes. Third-party apps are left
# out: their migrations come and go with the pinned package versions.
OWN_MIGRATION_APPS = ("api", "chunked_upload")
DOWNGRADE_DOCS_URL = (
    "https://docs.librephotos.com/docs/installation/upgrading#downgrade"
)


def unknown_applied_migrations(
    applied: Collection[tuple[str, str]], loader: MigrationLoader
) -> list[tuple[str, str]]:
    """Applied migrations of OWN_MIGRATION_APPS that this code has no file for.

    A name some migration on disk ``replaces`` is known. So is any name at or
    below the newest name a squash replaced for that app: that history is
    librephotos.E001's to judge, and early development builds recorded a few
    migrations under names that were renamed before release.
    """
    known = set(loader.disk_migrations)
    squashed_up_to: dict[str, str] = {}
    for migration in loader.disk_migrations.values():
        for app_label, name in migration.replaces:
            known.add((app_label, name))
            squashed_up_to[app_label] = max(squashed_up_to.get(app_label, ""), name)
    return sorted(
        (app_label, name)
        for app_label, name in applied
        if app_label in OWN_MIGRATION_APPS
        and (app_label, name) not in known
        and name[:4] > squashed_up_to.get(app_label, "")[:4]
    )


def check_database_not_newer(
    app_configs: Sequence[AppConfig] | None,
    databases: Collection[str] | None = None,
    **kwargs: Any,
) -> list[CheckMessage]:
    """Stop ``migrate`` on a database a newer release has migrated (issue #2315).

    Django ignores applied migrations it has no file for: an older release
    started on a newer database migrates nothing, starts, and then fails on
    the first write that meets a column it does not know. Name the problem
    instead, before anything runs. Registered with the database tag, like E001.
    """
    if not databases:
        return []
    loader = MigrationLoader(None, load=False)
    loader.load_disk()

    errors: list[CheckMessage] = []
    for alias in databases:
        recorder = MigrationRecorder(connections[alias])
        try:
            if not recorder.has_table():
                continue
            applied = {
                key
                for key in recorder.applied_migrations()
                if router.allow_migrate(alias, key[0])
            }
        except DatabaseError:
            # An unreachable database is migrate's own error to report.
            continue
        unknown = unknown_applied_migrations(applied, loader)
        if unknown:
            errors.append(_newer_database_error(alias, unknown))
    return errors


def _newer_database_error(alias: str, unknown: list[tuple[str, str]]) -> CheckMessage:
    newest_name, newest_app = max((name, app_label) for app_label, name in unknown)
    newest = f"{newest_app}.{newest_name}"
    if len(unknown) == 1:
        what = f"it has migration {newest}, which this release does not know"
    else:
        what = (
            f"it has {len(unknown)} migrations this release does not know, "
            f"the newest {newest}"
        )
    return checks.Error(
        f"The database '{alias}' was last used by a newer LibrePhotos release "
        f"({what}). Running this older release on it could damage it.",
        hint=(
            "Start the newer release again, or restore the backup made before "
            "that upgrade (SQLite installs keep them in db/backups in the data "
            f"directory). See {DOWNGRADE_DOCS_URL}"
        ),
        id="librephotos.E002",
    )

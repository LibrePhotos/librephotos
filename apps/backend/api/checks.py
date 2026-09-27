"""Django system checks for deployment configuration.

Registered from ``ApiConfig.ready``. Warnings surface wherever system checks
run, which includes the ``manage.py migrate`` every entrypoint runs on start;
checks tagged ``database`` run there too, before any migration is loaded.
"""

from importlib import import_module

from django.conf import settings
from django.core import checks
from django.db import DatabaseError, connections, router
from django.db.migrations.recorder import MigrationRecorder


def check_default_db_password(app_configs, **kwargs):
    """Warn when PostgreSQL is reached with the fallback password.

    ``DB_PASS`` falls back to the password shipped in librephotos.env so that
    old hand-written setups keep connecting (see the settings module); this
    makes sure that fallback is never silent.
    """
    if getattr(settings, "DB_PASS_FROM_ENV", True):
        return []
    database = settings.DATABASES.get("default", {})
    if "postgresql" not in database.get("ENGINE", ""):
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


def check_squashed_migration_history(app_configs, databases=None, **kwargs):
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

    errors = []
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
                    f"this release. Back up the database first. "
                    f"See {UPGRADE_DOCS_URL}"
                ),
                id="librephotos.E001",
            )
        )
    return errors

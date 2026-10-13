from argparse import ArgumentParser
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import DEFAULT_DB_ALIAS, connections

from api.runtime.db_backup import BackupError, backup_database


class Command(BaseCommand):
    """Back up the SQLite database into BASE_DATA/backups (issue #2314).

    The standalone build and the container entrypoint run it with
    ``--if-pending-migrations`` right before ``migrate``. On PostgreSQL it only
    says to use pg_dump, so it is safe to run everywhere.
    """

    help = (
        "Back up the SQLite database into the backups folder of the data "
        "directory and keep the newest few. Does nothing on PostgreSQL."
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument(
            "--if-pending-migrations",
            action="store_true",
            help="only back up when migrate has migrations to apply",
        )
        parser.add_argument(
            "--keep",
            type=int,
            default=None,
            help="how many backups to keep (default: DB_BACKUP_KEEP, 3)",
        )
        parser.add_argument(
            "--database",
            default=DEFAULT_DB_ALIAS,
            help="the database to back up (default: default)",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        keep = (
            options["keep"] if options["keep"] is not None else settings.DB_BACKUP_KEEP
        )
        if keep < 1:
            raise CommandError("--keep must be at least 1.")
        try:
            message = backup_database(
                connections[options["database"]],
                only_if_pending=options["if_pending_migrations"],
                keep=keep,
            )
        except BackupError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(message)

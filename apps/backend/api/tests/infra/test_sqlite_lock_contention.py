"""Two writers on one SQLite file wait for each other instead of failing.

1.6.0 reported "database is locked" from SQLite deployments: Scan Faces
marking a photo scanned, django-q's scheduler opening its transaction, and a
thumbnail insert. The suite runs on an in-memory database without the
deployment's connection options, so these tests open a file database with
``sqlite_database()``, the entry every SQLite deployment uses, and write to it
from two threads.
"""

import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from django.contrib.contenttypes.models import ContentType
from django.db import DatabaseError, connections, transaction
from django.db.utils import ConnectionHandler, load_backend
from django.test import SimpleTestCase

from librephotos.settings._sqlite import sqlite_database

# Not in settings.DATABASES: Django lets a test open a connection it made itself.
ALIAS = "lock_contention"


def _connect(path: str) -> None:
    """Open this thread's connection to the file at ``path``, as deployed."""
    entry = ConnectionHandler({"default": sqlite_database(path)}).settings["default"]
    connections[ALIAS] = load_backend(entry["ENGINE"]).DatabaseWrapper(entry, ALIAS)


def _disconnect() -> None:
    connections[ALIAS].close()
    del connections[ALIAS]


def _in_thread(path: str, work: Callable[[], None]) -> None:
    """Run ``work`` on a connection of its own, as another worker would."""
    errors: list[DatabaseError] = []

    def run() -> None:
        _connect(path)
        try:
            work()
        except DatabaseError as error:
            errors.append(error)
        finally:
            _disconnect()

    thread = threading.Thread(target=run)
    thread.start()
    thread.join(timeout=60)
    if errors:
        raise errors[0]


def _rename(model: str, new_model: str) -> None:
    ContentType.objects.using(ALIAS).filter(model=model).update(model=new_model)


class SqliteLockContentionTest(SimpleTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "db.sqlite3")
        _connect(self.path)
        self.addCleanup(_disconnect)
        with connections[ALIAS].schema_editor() as editor:
            editor.create_model(ContentType)
        ContentType.objects.using(ALIAS).bulk_create(
            ContentType(app_label="probe", model=f"m{number}") for number in range(5)
        )

    def test_a_write_inside_an_iterator_loop_after_another_commit(self):
        # A write while the loop's SELECT is still open upgrades its read to a
        # write; once another connection committed, SQLite refuses that at
        # once (SQLITE_BUSY_SNAPSHOT), whatever the busy timeout.
        seen = []
        for row in ContentType.objects.using(ALIAS).order_by("pk").iterator(2):
            if not seen:
                _in_thread(self.path, lambda: _rename("m4", "other"))
            row.model = f"{row.model}-seen"
            row.save(using=ALIAS)
            seen.append(row.pk)

        self.assertEqual(len(seen), 5)

    def test_a_transaction_that_reads_first_waits_for_the_other_writer(self):
        # BEGIN DEFERRED would take a read lock here and fail on the write
        # once the other connection has written; IMMEDIATE waits up front.
        holding = threading.Event()

        def hold_the_write_lock() -> None:
            with transaction.atomic(using=ALIAS):
                _rename("m0", "held")
                holding.set()
                time.sleep(0.5)

        holder = threading.Thread(
            target=lambda: _in_thread(self.path, hold_the_write_lock)
        )
        holder.start()
        holding.wait(timeout=10)
        with transaction.atomic(using=ALIAS):
            count = ContentType.objects.using(ALIAS).count()
            _rename("m1", "waited")
        holder.join(timeout=10)

        self.assertEqual(count, 5)
        renamed = ContentType.objects.using(ALIAS).filter(model__in=["held", "waited"])
        self.assertEqual(renamed.count(), 2)

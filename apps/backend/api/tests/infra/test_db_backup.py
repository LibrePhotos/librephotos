"""The SQLite backup made before migrating (api/runtime/db_backup.py, issue #2314)
and the ``backup_database`` command that runs it."""

import json
import os
import sqlite3
import tempfile
import threading
from collections import namedtuple
from contextlib import closing
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings

from api.runtime import db_backup
from api.runtime.db_backup import BackupError, BackupInfo

NOW = datetime(2026, 10, 13, 8, 30, 0, tzinfo=timezone.utc)
INFO = BackupInfo(
    version="1.3.0",
    git_hash="abc1234",
    reason="before migrating",
    applied_migrations=160,
    pending_migrations=["api.0159_new"],
)
DiskUsage = namedtuple("DiskUsage", "total used free")


def make_database(path: Path, rows: int = 50) -> None:
    """A WAL-mode database with one table, like the production settings make."""
    with closing(sqlite3.connect(path)) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE photo (id INTEGER PRIMARY KEY, caption TEXT)")
        db.executemany(
            "INSERT INTO photo (caption) VALUES (?)",
            [(f"photo {n}" * 20,) for n in range(rows)],
        )
        db.commit()


def tables(path: Path) -> list[str]:
    with closing(sqlite3.connect(path)) as db:
        return [
            row[0]
            for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            )
        ]


class BackupTestCase(SimpleTestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / "librephotos.sqlite3"
        self.backups = self.root / "backups"
        make_database(self.source)

    def backup(self, now=NOW, keep=3, info=INFO):
        return db_backup.backup_sqlite(self.source, self.backups, info, keep, now=now)


class BackupSqliteTest(BackupTestCase):
    def test_the_copy_holds_the_database_and_passes_the_integrity_check(self):
        target = self.backup()

        self.assertEqual(target.parent, self.backups)
        self.assertEqual(target.name, "librephotos-1.3.0-20261013T083000Z.sqlite3")
        self.assertEqual(tables(target), ["photo"])
        with closing(sqlite3.connect(target)) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            self.assertEqual(db.execute("SELECT count(*) FROM photo").fetchone(), (50,))
            # A single file that can be copied back as it is.
            self.assertEqual(db.execute("PRAGMA journal_mode").fetchone(), ("delete",))
        self.assertEqual(
            sorted(p.name for p in self.backups.iterdir()),
            [
                "librephotos-1.3.0-20261013T083000Z.json",
                "librephotos-1.3.0-20261013T083000Z.sqlite3",
            ],
        )

    def test_the_json_file_says_where_the_backup_came_from(self):
        target = self.backup()

        record = json.loads(target.with_suffix(".json").read_text(encoding="utf-8"))

        self.assertEqual(record["version"], "1.3.0")
        self.assertEqual(record["git_hash"], "abc1234")
        self.assertEqual(record["reason"], "before migrating")
        self.assertEqual(record["applied_migrations"], 160)
        self.assertEqual(record["pending_migrations"], ["api.0159_new"])
        self.assertEqual(record["created_at"], "2026-10-13T08:30:00+00:00")
        self.assertEqual(record["source"], str(self.source))
        self.assertEqual(record["size_bytes"], target.stat().st_size)

    def test_only_the_newest_backups_are_kept(self):
        made = []
        for minute in range(5):
            target = self.backup(now=NOW + timedelta(minutes=minute), keep=3)
            stamp = 1_000_000 + minute
            os.utime(target, (stamp, stamp))
            made.append(target)

        left = sorted(self.backups.glob("*.sqlite3"))
        self.assertEqual(left, sorted(made[2:]))
        self.assertEqual(
            sorted(self.backups.glob("*.json")),
            sorted(path.with_suffix(".json") for path in made[2:]),
        )

    def test_a_backup_while_another_connection_writes_completes(self):
        stop = threading.Event()
        written = []

        def writer():
            with closing(sqlite3.connect(self.source, timeout=30)) as db:
                while not stop.is_set():
                    db.execute("INSERT INTO photo (caption) VALUES ('busy')")
                    db.commit()
                    written.append(1)

        thread = threading.Thread(target=writer)
        thread.start()
        try:
            while not written:
                pass
            target = self.backup()
        finally:
            stop.set()
            thread.join()

        with closing(sqlite3.connect(target)) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchall(), [("ok",)])
            (count,) = db.execute("SELECT count(*) FROM photo").fetchone()
        self.assertGreaterEqual(count, 50)

    def test_not_enough_free_space_is_refused_in_plain_words(self):
        with patch.object(
            db_backup.shutil, "disk_usage", return_value=DiskUsage(10, 10, 1024)
        ):
            with self.assertRaises(BackupError) as raised:
                self.backup()

        message = str(raised.exception)
        self.assertIn("not enough free disk space", message)
        self.assertIn("Free some disk space on", message)
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_a_copy_that_fails_the_integrity_check_is_not_kept(self):
        with patch.object(
            db_backup,
            "verify_database",
            side_effect=BackupError("failed SQLite's integrity check"),
        ):
            with self.assertRaises(BackupError):
                self.backup()

        self.assertEqual(list(self.backups.iterdir()), [])

    def test_an_sqlite_error_becomes_a_backup_error(self):
        with patch.object(
            db_backup, "copy_database", side_effect=sqlite3.OperationalError("locked")
        ):
            with self.assertRaises(BackupError) as raised:
                self.backup()

        self.assertIn("locked", str(raised.exception))
        self.assertEqual(list(self.backups.iterdir()), [])


class VerifyDatabaseTest(SimpleTestCase):
    def fake_connect(self, rows):
        database = MagicMock()
        database.execute.return_value.fetchall.return_value = rows
        return patch.object(db_backup.sqlite3, "connect", return_value=database)

    def test_a_report_other_than_ok_is_refused(self):
        with self.fake_connect([("row 3 missing from index",)]):
            with self.assertRaises(BackupError) as raised:
                db_backup.verify_database(Path("copy.sqlite3"))
        self.assertIn("row 3 missing from index", str(raised.exception))

    def test_no_report_at_all_is_refused(self):
        with self.fake_connect([]):
            with self.assertRaises(BackupError) as raised:
                db_backup.verify_database(Path("copy.sqlite3"))
        self.assertIn("no answer", str(raised.exception))


class NamingTest(BackupTestCase):
    def test_a_taken_name_gets_a_number(self):
        first = self.backup()
        second = self.backup()

        self.assertEqual(second.name, "librephotos-1.3.0-20261013T083000Z-1.sqlite3")
        self.assertNotEqual(first, second)

    def test_the_release_is_made_safe_for_a_file_name(self):
        name = db_backup.backup_name(self.root, "feat/x y:z", NOW)
        self.assertEqual(name.name, "librephotos-feat-x-y-z-20261013T083000Z.sqlite3")
        name = db_backup.backup_name(self.root, "///", NOW)
        self.assertEqual(name.name, "librephotos-unknown-20261013T083000Z.sqlite3")

    def test_sizes_read_like_a_file_manager(self):
        self.assertEqual(db_backup.human_size(10), "1 MB")
        self.assertEqual(db_backup.human_size(300 * 1024**2), "300 MB")
        self.assertEqual(db_backup.human_size(3 * 1024**3), "3.0 GB")

    def test_the_disk_is_named_by_its_drive_letter_where_there_is_one(self):
        label = db_backup.disk_label(self.root)
        drive = os.path.splitdrive(str(self.root.resolve()))[0]
        if drive:
            self.assertEqual(label, f"drive {drive}")
        else:
            self.assertEqual(label, f"the disk that holds {self.root}")

    def test_the_write_ahead_log_counts_towards_the_size(self):
        wal = self.source.with_name(self.source.name + "-wal")
        wal.write_bytes(b"x" * 1000)
        self.assertEqual(
            db_backup.database_size(self.source), self.source.stat().st_size + 1000
        )


def sqlite_connection(name, vendor="sqlite"):
    fake = MagicMock(vendor=vendor, alias="default", display_name="PostgreSQL")
    fake.settings_dict = {"NAME": name}
    return fake


class BackupDatabaseTest(BackupTestCase):
    def run_backup(
        self, fake, *, only_if_pending=True, pending=("api.0159_new",), applied=160
    ):
        with (
            patch.object(db_backup, "migrate_will_refuse", return_value=False),
            patch.object(
                db_backup, "migration_state", return_value=(list(pending), applied)
            ),
        ):
            return db_backup.backup_database(
                fake, only_if_pending=only_if_pending, keep=3
            )

    def test_pending_migrations_back_up_into_the_folder_next_to_the_database(self):
        fake = sqlite_connection(str(self.source))
        with override_settings(IMAGE_TAG="1.3.0", GIT_HASH="abc1234"):
            message = self.run_backup(fake)

        [backup] = (self.root / "backups").glob("*.sqlite3")
        self.assertIn(str(backup), message)
        self.assertTrue(backup.name.startswith("librephotos-1.3.0-"))
        fake.close.assert_called_once_with()
        record = json.loads(backup.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertEqual(record["pending_migrations"], ["api.0159_new"])

    def test_nothing_is_written_without_pending_migrations(self):
        message = self.run_backup(sqlite_connection(str(self.source)), pending=())

        self.assertIn("No pending migrations", message)
        self.assertFalse((self.root / "backups").exists())

    def test_on_request_a_backup_is_made_without_pending_migrations(self):
        with override_settings(IMAGE_TAG="", GIT_HASH=""):
            self.run_backup(
                sqlite_connection(str(self.source)), only_if_pending=False, pending=()
            )

        [backup] = (self.root / "backups").glob("*.sqlite3")
        self.assertTrue(backup.name.startswith("librephotos-dev-"))
        record = json.loads(backup.with_suffix(".json").read_text(encoding="utf-8"))
        self.assertEqual(record["reason"], "on request")

    def test_postgresql_is_left_to_pg_dump(self):
        message = self.run_backup(sqlite_connection("db", vendor="postgresql"))
        self.assertIn("pg_dump", message)

    def test_no_database_file_yet_means_nothing_to_back_up(self):
        for name in (":memory:", str(self.root / "missing.sqlite3")):
            message = self.run_backup(sqlite_connection(name))
            self.assertIn("nothing to back up", message)

    def test_a_first_start_has_nothing_to_back_up(self):
        # Opening the settings already writes the file header of a new database.
        message = self.run_backup(
            sqlite_connection(str(self.source)),
            pending=("api.0001_squashed_0100",),
            applied=0,
        )

        self.assertIn("nothing to back up", message)
        self.assertFalse((self.root / "backups").exists())

    def test_a_database_migrate_will_refuse_is_left_to_migrate(self):
        with patch.object(db_backup, "migrate_will_refuse", return_value=True):
            message = db_backup.backup_database(
                sqlite_connection(str(self.source)), only_if_pending=True, keep=3
            )
        self.assertIn("migrate will stop", message)
        self.assertFalse((self.root / "backups").exists())


class MigrationStateTest(TestCase):
    """Against the test database, which is fully migrated."""

    def test_nothing_is_pending_and_everything_is_applied(self):
        pending, applied = db_backup.migration_state(connection)
        self.assertEqual(pending, [])
        self.assertGreater(applied, 0)

    def test_migrate_will_not_refuse_a_current_database(self):
        self.assertFalse(db_backup.migrate_will_refuse("default"))

    def test_the_file_behind_a_connection(self):
        self.assertIsNone(db_backup.sqlite_file(sqlite_connection(":memory:")))
        self.assertIsNone(
            db_backup.sqlite_file(sqlite_connection("file:x?mode=memory"))
        )
        self.assertEqual(
            db_backup.sqlite_file(sqlite_connection("/data/db/x.sqlite3")),
            Path("/data/db/x.sqlite3"),
        )


class BackupDatabaseCommandTest(SimpleTestCase):
    def run_command(self, *args):
        output = StringIO()
        call_command("backup_database", *args, stdout=output)
        return output.getvalue()

    @patch("api.management.commands.backup_database.backup_database")
    def test_reports_what_happened(self, backup):
        backup.return_value = "Backed up the database to x"

        output = self.run_command("--if-pending-migrations", "--keep", "5")

        self.assertIn("Backed up the database to x", output)
        self.assertEqual(backup.call_args.kwargs, {"only_if_pending": True, "keep": 5})

    @override_settings(DB_BACKUP_KEEP=7)
    @patch("api.management.commands.backup_database.backup_database")
    def test_keeps_db_backup_keep_backups_by_default(self, backup):
        backup.return_value = "ok"
        self.run_command()
        self.assertEqual(backup.call_args.kwargs, {"only_if_pending": False, "keep": 7})

    def test_keep_must_be_positive(self):
        with self.assertRaises(CommandError):
            self.run_command("--keep", "0")

    @patch(
        "api.management.commands.backup_database.backup_database",
        side_effect=BackupError("Free some disk space on drive C:"),
    )
    def test_a_failed_backup_is_a_command_error_with_the_reason(self, backup):
        with self.assertRaises(CommandError) as raised:
            self.run_command("--if-pending-migrations")
        self.assertEqual(str(raised.exception), "Free some disk space on drive C:")

    def test_the_test_database_is_in_memory_so_nothing_is_written(self):
        output = self.run_command("--if-pending-migrations")
        self.assertIn("nothing to back up", output)

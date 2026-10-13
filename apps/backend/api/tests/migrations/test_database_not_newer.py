"""librephotos.E002: an older release refuses a database a newer one migrated (issue #2315)."""

from importlib import import_module
from io import StringIO
from unittest.mock import patch

from django.core import checks
from django.core.management import call_command
from django.core.management.base import SystemCheckError
from django.db import DatabaseError, connection
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.test import SimpleTestCase, TestCase

from api import checks as api_checks

squashed = import_module("api.migrations.0001_squashed_0100").Migration
FROM_THE_FUTURE = ("api", "9001_from_a_newer_release")


def disk_loader():
    loader = MigrationLoader(None, load=False)
    loader.load_disk()
    return loader


class DatabaseNotNewerCheckTest(TestCase):
    """The test database is fully migrated by this code."""

    def record(self, *keys):
        recorder = MigrationRecorder(connection)
        for app_label, name in keys:
            recorder.record_applied(app_label, name)

    def run_check(self):
        return api_checks.check_database_not_newer(None, databases=["default"])

    def test_quiet_on_a_database_this_release_migrated(self):
        self.assertEqual(self.run_check(), [])

    def test_errors_on_a_migration_this_release_does_not_know(self):
        self.record(FROM_THE_FUTURE)

        [error] = self.run_check()

        self.assertEqual(error.id, "librephotos.E002")
        self.assertEqual(error.level, checks.ERROR)
        self.assertIn("newer LibrePhotos release", error.msg)
        self.assertIn("api.9001_from_a_newer_release", error.msg)
        self.assertIn(api_checks.DOWNGRADE_DOCS_URL, error.hint)
        self.assertIn("db/backups", error.hint)

    def test_several_unknown_migrations_name_the_newest(self):
        self.record(
            FROM_THE_FUTURE,
            ("api", "9002_even_newer"),
            ("chunked_upload", "0002_newer_upload"),
        )

        [error] = self.run_check()

        self.assertIn("3 migrations this release does not know", error.msg)
        self.assertIn("api.9002_even_newer", error.msg)

    def test_the_names_the_squash_replaced_are_known(self):
        # What a database migrated before the squash has recorded.
        self.record(*squashed.replaces)
        self.assertEqual(self.run_check(), [])

    def test_third_party_apps_are_left_alone(self):
        self.record(("django_q", "9999_from_a_newer_package"))
        self.assertEqual(self.run_check(), [])

    def test_quiet_without_a_migrations_table(self):
        self.record(FROM_THE_FUTURE)
        with patch.object(MigrationRecorder, "has_table", return_value=False):
            self.assertEqual(self.run_check(), [])

    def test_quiet_when_the_database_is_unreachable(self):
        with patch.object(
            MigrationRecorder, "has_table", side_effect=DatabaseError("down")
        ):
            self.assertEqual(self.run_check(), [])

    def test_quiet_without_databases(self):
        self.record(FROM_THE_FUTURE)
        self.assertEqual(api_checks.check_database_not_newer(None, databases=None), [])

    def test_runs_with_the_database_checks_and_stops_migrate(self):
        self.record(FROM_THE_FUTURE)

        errors = checks.run_checks(databases=["default"], tags=[checks.Tags.database])
        self.assertIn("librephotos.E002", [error.id for error in errors])

        with (
            patch(
                "django.core.management.commands.migrate.MigrationExecutor"
            ) as executor,
            self.assertRaises(SystemCheckError) as raised,
        ):
            call_command("migrate", "--noinput", skip_checks=False, stdout=StringIO())
        self.assertIn("librephotos.E002", str(raised.exception))
        executor.assert_not_called()

    def test_check_database_reports_it(self):
        self.record(FROM_THE_FUTURE)
        with self.assertRaises(SystemCheckError) as raised:
            call_command("check", "--database", "default", stdout=StringIO())
        self.assertIn("librephotos.E002", str(raised.exception))


class UnknownAppliedMigrationsTest(SimpleTestCase):
    def test_a_fresh_database_has_none(self):
        self.assertEqual(
            api_checks.unknown_applied_migrations(set(), disk_loader()), []
        )

    def test_every_migration_on_disk_is_known(self):
        loader = disk_loader()
        self.assertEqual(
            api_checks.unknown_applied_migrations(set(loader.disk_migrations), loader),
            [],
        )

    def test_unknown_names_inside_the_squashed_range_are_e001s_business(self):
        # Development builds of 2023 recorded 0044_add_embedded_media, later renamed.
        applied = {("api", "0044_add_embedded_media"), FROM_THE_FUTURE}
        self.assertEqual(
            api_checks.unknown_applied_migrations(applied, disk_loader()),
            [FROM_THE_FUTURE],
        )

    def test_an_app_without_a_squash_flags_every_unknown_name(self):
        applied = {("chunked_upload", "0001_initial"), ("chunked_upload", "0002_x")}
        self.assertEqual(
            api_checks.unknown_applied_migrations(applied, disk_loader()),
            [("chunked_upload", "0002_x")],
        )

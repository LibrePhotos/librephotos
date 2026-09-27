"""
Tests for the squash of api migrations 0001-0100 into 0001_squashed_0100.

Covers the migration itself (what it replaces, what depends on it, the
deferred-SQL flush it needs before the 0099 code) and the system check that
stops ``migrate`` on a database from an install older than 2026w10.
"""

import re
from importlib import import_module
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.core import checks
from django.db import DatabaseError
from django.db.migrations.recorder import MigrationRecorder
from django.test import SimpleTestCase, TestCase

from api import checks as api_checks

squashed = import_module("api.migrations.0001_squashed_0100")
MIGRATIONS_DIR = Path(squashed.__file__).parent


def replaced_names():
    return [name for _app_label, name in squashed.Migration.replaces]


class SquashedMigrationTest(SimpleTestCase):
    def test_replaces_every_migration_up_to_0100(self):
        names = replaced_names()
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(len(names), 103)
        self.assertEqual(names[0], "0001_initial")
        self.assertIn(
            "0100_metadataedit_metadatafile_photometadata_stackreview_and_more",
            names,
        )
        # 0001-0100 plus the two 0009s and 0011_a/_b/_c.
        numbers = {int(name[:4]) for name in names}
        self.assertEqual(numbers, set(range(1, 101)))

    def test_replaced_migration_files_are_gone(self):
        leftovers = [
            path.name
            for path in MIGRATIONS_DIR.glob("0*.py")
            if int(path.name[:4]) <= 100 and path.stem != "0001_squashed_0100"
        ]
        self.assertEqual(leftovers, [])

    def test_no_migration_depends_on_a_replaced_name(self):
        replaced = set(replaced_names())
        dependency = re.compile(r"\(\s*[\"']api[\"']\s*,\s*[\"']([^\"']+)[\"']\s*\)")
        for path in MIGRATIONS_DIR.glob("0*.py"):
            if path.stem == "0001_squashed_0100":
                continue
            for name in dependency.findall(path.read_text(encoding="utf-8")):
                self.assertNotIn(name, replaced, f"{path.name} depends on {name}")

    def test_flush_runs_and_clears_deferred_sql(self):
        editor = MagicMock()
        editor.deferred_sql = ["CREATE INDEX a", "CREATE INDEX b"]

        squashed.flush_deferred_schema_sql(None, editor)

        self.assertEqual(
            [call.args[0] for call in editor.execute.call_args_list],
            ["CREATE INDEX a", "CREATE INDEX b"],
        )
        self.assertEqual(editor.deferred_sql, [])


class SquashedMigrationHistoryCheckTest(TestCase):
    """The test database is fully migrated, so every replaced name is recorded."""

    def forget(self, names):
        MigrationRecorder.Migration.objects.filter(app="api", name__in=names).delete()

    def run_check(self):
        return api_checks.check_squashed_migration_history(
            None, databases=["default"]
        )

    def test_quiet_on_a_fully_migrated_database(self):
        self.assertEqual(self.run_check(), [])

    def test_quiet_when_none_of_the_replaced_migrations_ran(self):
        self.forget(replaced_names())
        self.assertEqual(self.run_check(), [])

    def test_quiet_without_a_migrations_table(self):
        with patch.object(MigrationRecorder, "has_table", return_value=False):
            self.assertEqual(self.run_check(), [])

    def test_quiet_when_the_database_is_unreachable(self):
        with patch.object(
            MigrationRecorder, "has_table", side_effect=DatabaseError("down")
        ):
            self.assertEqual(self.run_check(), [])

    def test_quiet_without_databases(self):
        self.assertEqual(
            api_checks.check_squashed_migration_history(None, databases=None), []
        )

    def test_errors_on_an_install_older_than_2026w10(self):
        # Where the 2024 e2e seed database stood: 0001-0058 applied.
        names = replaced_names()
        cut = names.index(
            "0058_alter_user_avatar_alter_user_nextcloud_app_password_and_more"
        )
        self.forget(names[cut + 1 :])

        [error] = self.run_check()

        self.assertEqual(error.id, "librephotos.E001")
        self.assertEqual(error.level, checks.ERROR)
        self.assertIn("older than 2026w10", error.msg)
        self.assertIn(
            "api.0058_alter_user_avatar_alter_user_nextcloud_app_password_and_more",
            error.msg,
        )
        self.assertIn(f"{len(names) - cut - 1} of the migrations", error.msg)
        self.assertIn("from 2026w10 up to 1.1.0", error.hint)
        self.assertIn(api_checks.UPGRADE_DOCS_URL, error.hint)

    def test_runs_with_the_database_checks_migrate_runs(self):
        self.forget(replaced_names()[-1:])

        errors = checks.run_checks(databases=["default"], tags=[checks.Tags.database])

        self.assertIn("librephotos.E001", [error.id for error in errors])

    def test_not_run_without_databases(self):
        # Plain `manage.py check` and runserver must not touch the database.
        self.forget(replaced_names()[-1:])

        errors = checks.run_checks(tags=[checks.Tags.database])

        self.assertNotIn("librephotos.E001", [error.id for error in errors])

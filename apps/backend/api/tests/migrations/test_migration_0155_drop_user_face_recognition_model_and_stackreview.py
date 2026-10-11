"""Tests for the migration that drops two unused leftovers (0155).

The test database already ran 0155, so each test first takes the schema back
to 0154 with the real migration executor, puts rows into it as an install
would have them, and then runs 0155 forward. Migrating needs a real schema
editor, which SQLite will not open inside a ``TestCase`` transaction, hence
``TransactionTestCase``. Nothing here is specific to one database, so the same
tests cover PostgreSQL when the suite runs on it.
"""

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = ("api", "0154_metadata_edit_json_encoder")
AFTER = ("api", "0155_drop_user_face_recognition_model_and_stackreview")


def table_names() -> set[str]:
    with connection.cursor() as cursor:
        return set(connection.introspection.table_names(cursor))


def user_columns() -> set[str]:
    with connection.cursor() as cursor:
        return {
            column.name
            for column in connection.introspection.get_table_description(
                cursor, "api_user"
            )
        }


class DropUnusedLeftoversMigrationTest(TransactionTestCase):
    def migrate(self, target: tuple[str, str]) -> MigrationExecutor:
        executor = MigrationExecutor(connection)
        executor.migrate([target])
        # A fresh executor, so the next caller sees the graph as applied now.
        return MigrationExecutor(connection)

    def setUp(self) -> None:
        super().setUp()
        # Whatever happens below, leave the schema the rest of the suite expects.
        self.addCleanup(self.migrate, AFTER)
        executor = self.migrate(BEFORE)
        self.old_apps = executor.loader.project_state(BEFORE).apps

    def test_drops_the_column_and_the_table_and_keeps_the_rest(self) -> None:
        User = self.old_apps.get_model("api", "User")
        PhotoStack = self.old_apps.get_model("api", "PhotoStack")
        StackReview = self.old_apps.get_model("api", "StackReview")
        # Historical models as of 0154, which the factories cannot build.
        user = User.objects.create(  # raw-create: historical model at 0154
            username="old", face_recognition_model="CNN"
        )
        stack = PhotoStack.objects.create(  # raw-create: historical model at 0154
            owner=user, stack_type="manual"
        )
        StackReview.objects.create(  # raw-create: historical model at 0154
            stack=stack, reviewer=user
        )
        self.assertIn("api_stackreview", table_names())
        self.assertIn("face_recognition_model", user_columns())

        self.migrate(AFTER)

        self.assertNotIn("api_stackreview", table_names())
        self.assertNotIn("face_recognition_model", user_columns())
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT username FROM api_user WHERE id = %s", [user.pk]
            )
            self.assertEqual(cursor.fetchall(), [("old",)])
            cursor.execute(
                "SELECT COUNT(*) FROM api_photostack WHERE id = %s",
                [stack.pk.hex if connection.vendor == "sqlite" else stack.pk],
            )
            self.assertEqual(cursor.fetchone(), (1,))

    def test_reverses_cleanly(self) -> None:
        self.migrate(AFTER)
        self.migrate(BEFORE)

        self.assertIn("api_stackreview", table_names())
        self.assertIn("face_recognition_model", user_columns())

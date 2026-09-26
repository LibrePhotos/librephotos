"""Tests for the album M2M ``photo_id`` index migration (0139).

``0099_photo_uuid_primary_key`` recreated the ``photo_id`` indexes its
PostgreSQL path had to drop, but missed the six album M2M tables. Those are
auto-created through tables, so they never appear in Django's migration state
and ``makemigrations`` cannot detect the omission.

The test database here is SQLite, whose path through 0099 kept its indexes, so
asserting that the indexes exist would pass with or without the fix. These
tests instead drop an index to reproduce the state a PostgreSQL install is
actually in, and check that the migration repairs it and leaves a healthy
table alone.
"""

import importlib

from django.db import connection
from django.test import TestCase

from api.models import AlbumAuto, AlbumDate, AlbumPlace, AlbumThing, AlbumUser

migration_module = importlib.import_module(
    "api.migrations.0139_album_m2m_photo_id_indexes"
)


def through_table(model, field_name):
    return model._meta.get_field(field_name).remote_field.through._meta.db_table


# Derived from the models rather than copied from the migration, so a rename
# that leaves the migration's hardcoded table names behind fails here.
M2M_TABLES = [
    through_table(AlbumUser, "photos"),
    through_table(AlbumThing, "photos"),
    through_table(AlbumThing, "cover_photos"),
    through_table(AlbumPlace, "photos"),
    through_table(AlbumDate, "photos"),
    through_table(AlbumAuto, "photos"),
]


class CursorExecutor:
    """Stand-in for a schema editor; the migration only needs these two.

    SQLite's real schema editor refuses to open inside the transaction a
    ``TestCase`` runs in, and nothing here needs more than a cursor.
    """

    connection = connection

    def execute(self, sql, params=()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params or None)


def photo_id_indexes(table):
    """Names of indexes on *table* whose leading column is ``photo_id``."""
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, table)
    return [
        name
        for name, details in constraints.items()
        if details.get("index")
        and details.get("columns")
        and details["columns"][0] == "photo_id"
    ]


class AlbumM2MPhotoIdIndexTest(TestCase):
    def drop_photo_id_indexes(self, table):
        with connection.cursor() as cursor:
            for name in photo_id_indexes(table):
                cursor.execute(f'DROP INDEX "{name}"')

    def test_migration_covers_exactly_the_album_m2m_tables(self):
        self.assertEqual(
            sorted(table for _, table in migration_module.INDEXES),
            sorted(M2M_TABLES),
        )

    def test_restores_an_index_that_0099_dropped(self):
        for table in M2M_TABLES:
            with self.subTest(table=table):
                self.drop_photo_id_indexes(table)
                self.assertEqual(photo_id_indexes(table), [])

        migration_module.create_indexes(None, CursorExecutor())

        for index_name, table in migration_module.INDEXES:
            with self.subTest(table=table):
                self.assertEqual(photo_id_indexes(table), [index_name])

    def test_leaves_an_existing_index_alone(self):
        # Installs whose index survived, and every SQLite install, must not
        # end up with a second index over the same column.
        before = {table: photo_id_indexes(table) for table in M2M_TABLES}
        self.assertTrue(all(before.values()), before)

        migration_module.create_indexes(None, CursorExecutor())

        self.assertEqual(
            {table: photo_id_indexes(table) for table in M2M_TABLES}, before
        )

    def test_reverse_removes_only_what_it_created(self):
        self.drop_photo_id_indexes(M2M_TABLES[0])
        migration_module.create_indexes(None, CursorExecutor())

        migration_module.drop_indexes(None, CursorExecutor())

        # The one it created is gone; the ones Django made are untouched.
        self.assertEqual(photo_id_indexes(M2M_TABLES[0]), [])
        for table in M2M_TABLES[1:]:
            with self.subTest(table=table):
                self.assertTrue(photo_id_indexes(table))

"""Tests for the album M2M unique-constraint migration (0140).

``0099_photo_uuid_primary_key`` dropped the ``(album_id, photo_id)`` unique
constraints on PostgreSQL and never put them back, so installs have been
accumulating duplicate membership rows. 0139 restored the plain ``photo_id``
indexes; this migration restores the unique ones and removes the duplicates
they cannot be created over.

As in the 0139 tests, the database here is SQLite, whose path through 0099
kept the constraint -- so asserting that it exists would pass with or without
the fix. These tests drop it to reproduce the state a PostgreSQL install is
in, and only then look at what the migration does.
"""

import datetime
import importlib
import uuid

from django.db import connection
from django.test import TestCase
from django.utils import timezone

from api.models import AlbumAuto, AlbumDate, AlbumPlace, AlbumThing, AlbumUser

from ..utils import create_test_photo, create_test_user

migration_module = importlib.import_module(
    "api.migrations.0140_album_m2m_unique_constraints"
)


def through_model(model, field_name):
    return model._meta.get_field(field_name).remote_field.through


class CursorExecutor:
    """Stand-in for a schema editor; the migration only needs these two.

    SQLite's real schema editor refuses to open inside the transaction a
    ``TestCase`` runs in, and nothing here needs more than a cursor.
    """

    connection = connection

    def execute(self, sql, params=()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params or None)


def unique_indexes(table, album_column):
    """Names of the indexes on *table* that enforce the pair's uniqueness."""
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, table)
    wanted = {album_column, "photo_id"}
    return sorted(
        name
        for name, details in constraints.items()
        if details.get("unique") and set(details.get("columns") or ()) == wanted
    )


class AlbumM2MUniqueConstraintTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = create_test_user()
        cls.photo = create_test_photo(owner=cls.user)
        now = timezone.now()
        # One album per M2M the migration covers, in the migration's order.
        cls.relations = [
            (AlbumUser.objects.create(title="Trip", owner=cls.user), "photos"),
            (
                AlbumThing.objects.create(
                    title="Dog", thing_type="tag", owner=cls.user
                ),
                "photos",
            ),
            (
                AlbumThing.objects.create(
                    title="Cat", thing_type="tag", owner=cls.user
                ),
                "cover_photos",
            ),
            (AlbumPlace.objects.create(title="Haifa", owner=cls.user), "photos"),
            (
                AlbumDate.objects.create(
                    date=datetime.date(2020, 1, 1), owner=cls.user
                ),
                "photos",
            ),
            (
                AlbumAuto.objects.create(timestamp=now, created_on=now, owner=cls.user),
                "photos",
            ),
        ]

    def album_for(self, table):
        """The album instance whose M2M is stored in *table*."""
        for album, field_name in self.relations:
            if through_model(type(album), field_name)._meta.db_table == table:
                return album, field_name
        raise AssertionError(f"no album set up for {table}")

    def drop_unique_indexes(self, table, album_column):
        with connection.cursor() as cursor:
            for name in unique_indexes(table, album_column):
                cursor.execute(f'DROP INDEX "{name}"')

    def link_rows(self, table, album_column, album):
        """The through rows for *album*, oldest first."""
        with connection.cursor() as cursor:
            cursor.execute(
                f'SELECT "id", "photo_id" FROM "{table}" '
                f'WHERE "{album_column}" = %s ORDER BY "id"',
                [album.pk],
            )
            return cursor.fetchall()

    def test_migration_covers_exactly_the_album_m2m_tables(self):
        # Derived from the models, so a rename that leaves the migration's
        # hardcoded names behind fails here.
        expected = set()
        for album, field_name in self.relations:
            through = through_model(type(album), field_name)
            album_field = through._meta.get_field(type(album).__name__.lower())
            expected.add((through._meta.db_table, album_field.column))

        self.assertEqual(
            {(table, column) for _, table, column in migration_module.UNIQUE_INDEXES},
            expected,
        )

    def test_restores_a_constraint_that_0099_dropped(self):
        for _, table, album_column in migration_module.UNIQUE_INDEXES:
            with self.subTest(table=table):
                self.drop_unique_indexes(table, album_column)
                self.assertEqual(unique_indexes(table, album_column), [])

        migration_module.add_unique_indexes(None, CursorExecutor())

        for index_name, table, album_column in migration_module.UNIQUE_INDEXES:
            with self.subTest(table=table):
                self.assertEqual(unique_indexes(table, album_column), [index_name])

    def test_leaves_an_existing_constraint_alone(self):
        # Installs whose constraint survived, and every SQLite install, must
        # not end up with a second index over the same pair.
        before = {
            table: unique_indexes(table, album_column)
            for _, table, album_column in migration_module.UNIQUE_INDEXES
        }
        self.assertTrue(all(before.values()), before)

        migration_module.add_unique_indexes(None, CursorExecutor())

        self.assertEqual(
            {
                table: unique_indexes(table, album_column)
                for _, table, album_column in migration_module.UNIQUE_INDEXES
            },
            before,
        )

    def test_collapses_duplicate_rows_and_keeps_the_oldest(self):
        for _, table, album_column in migration_module.UNIQUE_INDEXES:
            with self.subTest(table=table):
                album, field_name = self.album_for(table)
                through = through_model(type(album), field_name)
                album_attr = type(album).__name__.lower()
                self.drop_unique_indexes(table, album_column)

                # The state a PostgreSQL install is in: the same pair twice.
                for _ in range(2):
                    through.objects.create(**{album_attr: album, "photo": self.photo})
                rows = self.link_rows(table, album_column, album)
                self.assertEqual(len(rows), 2)
                oldest_id = rows[0][0]

                migration_module.add_unique_indexes(None, CursorExecutor())

                rows = self.link_rows(table, album_column, album)
                self.assertEqual(
                    [(oldest_id, self.photo.pk.hex)],
                    # SQLite stores the UUID without its dashes.
                    [
                        (row_id, uuid.UUID(str(photo_id)).hex)
                        for row_id, photo_id in rows
                    ],
                )
                # And the album still shows the photo, exactly once.
                self.assertEqual(list(getattr(album, field_name).all()), [self.photo])

    def test_add_stops_duplicating_once_the_constraint_is_back(self):
        # Why the constraint matters rather than merely being tidy: adding to
        # an auto-created M2M inserts with ``ignore_conflicts=True``, and
        # nothing to conflict against means nothing is ignored. ``add()`` only
        # looks at what is already there while ``m2m_changed`` has a listener
        # (the delta-sync signals in api/sync_signals.py connect one), so the
        # duplicate is seeded through the through model, the way an install
        # that predates those signals got it.
        album, field_name = self.album_for("api_albumuser_photos")
        table, album_column = "api_albumuser_photos", "albumuser_id"
        self.drop_unique_indexes(table, album_column)
        through = through_model(type(album), field_name)

        for _ in range(2):
            through.objects.create(albumuser=album, photo=self.photo)
        self.assertEqual(len(self.link_rows(table, album_column, album)), 2)

        migration_module.add_unique_indexes(None, CursorExecutor())
        self.assertEqual(len(self.link_rows(table, album_column, album)), 1)

        getattr(album, field_name).add(self.photo)
        self.assertEqual(len(self.link_rows(table, album_column, album)), 1)

    def test_reverse_removes_only_what_it_created(self):
        _, first_table, first_column = migration_module.UNIQUE_INDEXES[0]
        self.drop_unique_indexes(first_table, first_column)
        migration_module.add_unique_indexes(None, CursorExecutor())

        migration_module.drop_unique_indexes(None, CursorExecutor())

        # The one it created is gone; the ones Django made are untouched.
        self.assertEqual(unique_indexes(first_table, first_column), [])
        for _, table, album_column in migration_module.UNIQUE_INDEXES[1:]:
            with self.subTest(table=table):
                self.assertTrue(unique_indexes(table, album_column))

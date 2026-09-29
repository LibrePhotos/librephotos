"""Tests for the migration that restores what 0099 dropped on SQLite (0144).

``0099_photo_uuid_primary_key`` (inlined into ``0001_squashed_0100``) moved
photo references to the new UUID by recreating the tables that held one, built
from ``PRAGMA table_info``. That listing carries no foreign keys, no
AUTOINCREMENT and no CHECK constraints, and the rebuild made the photo column
nullable, so every SQLite database -- the test database included -- came out
of it with twelve tables missing all of those.

The test database runs 0144 like any other, so the first tests check nothing
is left over. The others put tables back into 0099's shape with 0099's own
rebuild code and run the migration against them. They need a real schema
editor, which SQLite will not open inside a ``TestCase`` transaction, hence
``TransactionTestCase``.
"""

import importlib
import uuid
from unittest import skipUnless
from unittest.mock import MagicMock, patch

from django.apps import apps as django_apps
from django.db import connection, models
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase, TransactionTestCase

from api.models import AlbumUser, Cluster, Face, Person

from ..utils import create_test_face, create_test_photo, create_test_user

MIGRATION_NAME = "0144_sqlite_restore_foreign_keys"
migration = importlib.import_module(f"api.migrations.{MIGRATION_NAME}")
squashed = importlib.import_module("api.migrations.0001_squashed_0100")

requires_sqlite = skipUnless(
    connection.vendor == "sqlite", "only 0099's SQLite path rebuilt the tables"
)

REBUILT_BY_0099 = sorted({table for table, _ in squashed.SQLITE_FK_COLUMNS})

# An image_hash as pre-UUID LibrePhotos wrote them: an MD5 plus the owner id.
PRE_0099_IMAGE_HASH = "0123456789abcdef0123456789abcdef1"

# The plain indexes 0099 added next to Django's own (the non-unique entries of
# squashed._sqlite_create_indexes, named "<table>_<column>_idx").
EXTRA_INDEXES_0099 = {
    ("api_face", "photo_id"),
    ("api_photo_shared_to", "photo_id"),
    ("api_photo_files", "photo_id"),
    ("api_person", "cover_photo_id"),
    ("api_albumuser", "cover_photo_id"),
    ("api_photostack", "primary_photo_id"),
}


def models_by_table():
    return {
        model._meta.db_table: model
        for model in django_apps.get_models(include_auto_created=True)
    }


def definitions(create_table_sql):
    """The column and constraint definitions of a CREATE TABLE, in any order.

    Tables that grew through AddField list their columns in a different order
    than a freshly created one; that is harmless and not what these tests are
    about.
    """
    body = create_table_sql[
        create_table_sql.index("(") + 1 : create_table_sql.rindex(")")
    ]
    parts, depth, current = [], 0, ""
    for char in body:
        depth += {"(": 1, ")": -1}.get(char, 0)
        if char == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    parts.append(current)
    return {" ".join(part.replace('"', "").lower().split()) for part in parts}


def table_sql(table):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = %s",
            [table],
        )
        return cursor.fetchone()[0]


def model_sql(model):
    """The CREATE TABLE Django would run for *model* today."""
    with connection.schema_editor(collect_sql=True) as editor:
        sql, _ = editor.table_sql(model)
    return sql


def unconstrained_foreign_keys(model):
    """Columns of *model* the model constrains and the table does not."""
    with connection.cursor() as cursor:
        cursor.execute(f'PRAGMA foreign_key_list("{model._meta.db_table}")')
        constrained = {(row[3], row[2]) for row in cursor.fetchall()}
    return sorted(
        field.column
        for field in model._meta.local_concrete_fields
        if field.remote_field
        and field.db_constraint
        and (field.column, field.related_model._meta.db_table) not in constrained
    )


def index_signatures(table):
    """(columns, unique) of every index on *table*, whatever its name."""
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, table)
    return {
        (tuple(details["columns"]), bool(details["unique"]))
        for details in constraints.values()
        if details["index"] or details["unique"]
        if not details["primary_key"]
    }


def schema_objects():
    """name -> (rootpage, sql) of everything in the schema; a rebuild moves rootpage."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT name, rootpage, sql FROM sqlite_master")
        return {name: (rootpage, sql) for name, rootpage, sql in cursor.fetchall()}


def as_left_by_0099(*tables):
    """Rebuild *tables* with 0099's own SQLite code, as every install ran it.

    With an empty mapping it translates no values; what it does to the table
    itself is exactly what it did to a real one. 0099's extra indexes are
    added only to the tables named, so none outlives the test elsewhere.
    """
    connection.ensure_connection()
    with connection.constraint_checks_disabled():
        cursor = connection.connection.cursor()
        try:
            for table, column in squashed.SQLITE_FK_COLUMNS:
                if table not in tables:
                    continue
                squashed._sqlite_update_fk_table(cursor, table, column, {})
                if (table, column) in EXTRA_INDEXES_0099:
                    cursor.execute(
                        f'CREATE INDEX IF NOT EXISTS "{table}_{column}_idx" '
                        f'ON "{table}" ("{column}")'
                    )
        finally:
            cursor.close()


def rows(table):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT * FROM "{table}"')
        names = [column[0] for column in cursor.description]
        return sorted(
            (tuple(sorted(zip(names, row))) for row in cursor.fetchall()),
            key=repr,
        )


@requires_sqlite
class RestoreForeignKeysTest(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        loader = MigrationLoader(connection)
        cls.state_apps = loader.project_state(("api", MIGRATION_NAME)).apps

    def tearDown(self):
        # Put back whatever a test left in 0099's shape, so that a failure
        # here cannot leak a broken table into the rest of the suite.
        self.run_migration()
        super().tearDown()

    def run_migration(self):
        with connection.schema_editor() as editor:
            migration.restore_foreign_keys(self.state_apps, editor)

    # -- the migrated test database ------------------------------------------

    def test_no_api_table_is_missing_a_foreign_key(self):
        for model in django_apps.get_app_config("api").get_models(
            include_auto_created=True
        ):
            with self.subTest(table=model._meta.db_table):
                self.assertEqual(unconstrained_foreign_keys(model), [])

    def test_tables_0099_rebuilt_match_their_models(self):
        tables = models_by_table()
        for table in REBUILT_BY_0099:
            with self.subTest(table=table):
                self.assertEqual(
                    definitions(table_sql(table)),
                    definitions(model_sql(tables[table])),
                )

    # -- the migration against tables in 0099's shape --------------------------

    def test_restores_everything_0099_dropped(self):
        tables = models_by_table()
        as_left_by_0099(*REBUILT_BY_0099)
        self.assertEqual(
            unconstrained_foreign_keys(Face),
            [
                "classification_person_id",
                "cluster_id",
                "cluster_person_id",
                "person_id",
                "photo_id",
            ],
        )
        self.assertIn(
            'id" integer primary key', table_sql("api_albumuser_photos").lower()
        )

        self.run_migration()

        for table in REBUILT_BY_0099:
            with self.subTest(table=table):
                self.assertEqual(unconstrained_foreign_keys(tables[table]), [])
                self.assertEqual(
                    definitions(table_sql(table)),
                    definitions(model_sql(tables[table])),
                )

    def test_keeps_every_row_and_index(self):
        user = create_test_user()
        photos = [
            create_test_photo(owner=user, captions_json={"user_caption": "x"})
            for _ in range(3)
        ]
        for photo in photos:
            create_test_face(photo=photo)
        album = AlbumUser.objects.create(
            title="Trip", owner=user, cover_photo=photos[0]
        )
        album.photos.add(*photos)
        photos[0].shared_to.add(create_test_user())
        before = {table: rows(table) for table in REBUILT_BY_0099}
        indexes = {table: index_signatures(table) for table in REBUILT_BY_0099}
        as_left_by_0099(*REBUILT_BY_0099)

        self.run_migration()

        for table in REBUILT_BY_0099:
            with self.subTest(table=table):
                self.assertEqual(rows(table), before[table])
                self.assertEqual(index_signatures(table), indexes[table])
        self.assertIn(
            (("albumuser_id", "photo_id"), True),
            index_signatures("api_albumuser_photos"),
        )

    def test_ids_of_deleted_rows_are_not_handed_out_again(self):
        user = create_test_user()
        photos = [create_test_photo(owner=user) for _ in range(4)]
        album = AlbumUser.objects.create(title="Trip", owner=user)
        through = AlbumUser.photos.through
        as_left_by_0099("api_albumuser_photos")

        # 0099 dropped AUTOINCREMENT: the next row takes the deleted one's id.
        album.photos.add(photos[0])
        deleted_id = through.objects.get(photo=photos[0]).pk
        through.objects.filter(pk=deleted_id).delete()
        album.photos.add(photos[1])
        self.assertEqual(through.objects.get(photo=photos[1]).pk, deleted_id)

        self.run_migration()

        deleted_id = through.objects.get(photo=photos[1]).pk
        through.objects.filter(pk=deleted_id).delete()
        album.photos.add(photos[2])
        self.assertGreater(through.objects.get(photo=photos[2]).pk, deleted_id)

    def test_album_links_that_point_nowhere_are_removed(self):
        user = create_test_user()
        photo = create_test_photo(owner=user)
        album = AlbumUser.objects.create(title="Trip", owner=user)
        album.photos.add(photo)
        as_left_by_0099("api_albumuser_photos")
        with connection.cursor() as cursor:
            # The column is nullable since 0099, and nothing checked either end.
            cursor.executemany(
                'INSERT INTO "api_albumuser_photos" ("albumuser_id", "photo_id") '
                "VALUES (%s, %s)",
                [
                    (album.pk, None),
                    (album.pk, uuid.uuid4().hex),
                    (album.pk + 1000, photo.pk.hex),
                ],
            )

        self.run_migration()

        self.assertEqual(
            list(AlbumUser.photos.through.objects.values_list("albumuser", "photo")),
            [(album.pk, photo.pk)],
        )

    def test_faces_that_point_nowhere_follow_on_delete(self):
        user = create_test_user()
        photo = create_test_photo(owner=user)
        kept = create_test_face(photo=photo)
        cluster = Cluster.objects.create(owner=user)
        as_left_by_0099("api_face")
        # CASCADE: the photo is gone, so its face goes too -- and the person
        # using it as cover gets NULL, as the collector would have done.
        orphan = create_test_face(photo=photo)
        Face.objects.filter(pk=orphan.pk).update(photo_id=uuid.uuid4())
        person = Person.objects.create(
            name="Ada", kind=Person.KIND_USER, cluster_owner=user, cover_face=orphan
        )
        # DO_NOTHING (reset by Person's post_delete) and SET_NULL: NULL.
        lost_person = create_test_face(photo=photo, person=person)
        lost_cluster = create_test_face(photo=photo, cluster=cluster)
        Face.objects.filter(pk=lost_person.pk).update(person_id=person.pk + 1000)
        Face.objects.filter(pk=lost_cluster.pk).update(cluster_id=cluster.pk + 1000)
        # A face whose photo was already gone when 0099 ran: its mapping had no
        # entry, so the column still holds the old image_hash -- not a UUID,
        # and a crash for anything that loads the row as a Face.
        pre_0099 = create_test_face(photo=photo)
        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE "api_face" SET "photo_id" = %s WHERE "id" = %s',
                [PRE_0099_IMAGE_HASH, pre_0099.pk],
            )

        self.run_migration()

        self.assertFalse(Face.objects.filter(pk=orphan.pk).exists())
        self.assertFalse(Face.objects.filter(pk=pre_0099.pk).exists())
        person.refresh_from_db()
        self.assertIsNone(person.cover_face_id)
        self.assertIsNone(Face.objects.get(pk=lost_person.pk).person_id)
        self.assertIsNone(Face.objects.get(pk=lost_cluster.pk).cluster_id)
        self.assertEqual(Face.objects.get(pk=kept.pk).photo_id, photo.pk)

    def test_rows_holding_a_pre_0099_image_hash_are_removed(self):
        # Rows whose photo was gone when 0099 ran kept their image_hash; the
        # tables keyed by the photo (thumbnail, caption, search) have them too.
        user = create_test_user()
        photo = create_test_photo(owner=user, captions_json={"user_caption": "x"})
        as_left_by_0099("api_thumbnail", "api_photo_caption")
        with connection.cursor() as cursor:
            for table in ("api_thumbnail", "api_photo_caption"):
                # A copy of the photo's own row, keyed by the old hash instead.
                columns = [
                    column.name
                    for column in connection.introspection.get_table_description(
                        cursor, table
                    )
                ]
                values = ", ".join(
                    "%s" if column == "photo_id" else f'"{column}"'
                    for column in columns
                )
                cursor.execute(
                    f'INSERT INTO "{table}" ({", ".join(columns)}) '
                    f'SELECT {values} FROM "{table}" WHERE "photo_id" = %s',
                    [PRE_0099_IMAGE_HASH, photo.pk.hex],
                )

        self.run_migration()

        for table in ("api_thumbnail", "api_photo_caption"):
            with self.subTest(table=table):
                with connection.cursor() as cursor:
                    cursor.execute(f'SELECT "photo_id" FROM "{table}"')
                    self.assertEqual(cursor.fetchall(), [(photo.pk.hex,)])

    def test_only_rebuilds_tables_missing_a_foreign_key(self):
        as_left_by_0099("api_thumbnail")
        before = schema_objects()

        self.run_migration()

        after = schema_objects()
        changed = {
            name
            for name in before.keys() | after.keys()
            if before.get(name) != after.get(name)
        }
        self.assertIn("api_thumbnail", changed)
        # The table and its own indexes ("sqlite_autoindex_api_thumbnail_1").
        self.assertEqual(
            {name for name in changed if "api_thumbnail" not in name}, set()
        )

    def test_running_it_again_changes_nothing(self):
        before = schema_objects()

        self.run_migration()

        self.assertEqual(schema_objects(), before)


class RestoreForeignKeysOtherBackendsTest(SimpleTestCase):
    def test_does_nothing_on_postgresql(self):
        # 0099's PostgreSQL path re-added the foreign keys it dropped.
        schema_editor = MagicMock()
        schema_editor.connection.vendor = "postgresql"

        migration.restore_foreign_keys(django_apps, schema_editor)

        schema_editor.connection.cursor.assert_not_called()
        schema_editor.alter_field.assert_not_called()

    def test_reversing_keeps_the_constraints(self):
        [operation] = migration.Migration.operations
        self.assertIs(operation.reverse_code, operation.noop)

    def test_refuses_to_guess_for_a_not_null_field_that_does_not_cascade(self):
        # Every constrained field of the twelve tables cascades or is
        # nullable. A NOT NULL PROTECT or SET(...) reference to nothing has no
        # faithful repair, so the migration stops rather than invent one --
        # but only when such rows exist.
        field = MagicMock(null=False)
        field.remote_field.on_delete = models.PROTECT
        rows = MagicMock()

        with patch.object(migration, "dangling_rows", return_value=rows):
            rows.exists.return_value = False
            migration.settle_dangling_rows(MagicMock(), field)

            rows.exists.return_value = True
            with self.assertRaises(RuntimeError):
                migration.settle_dangling_rows(MagicMock(), field)

        rows.delete.assert_not_called()
        rows.update.assert_not_called()

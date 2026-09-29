"""Tests for the SQLite photo-id repair migration (0143).

``0099_photo_uuid_primary_key`` (inlined into ``0001_squashed_0100``) gave
every photo that existed at the time a new primary key. Its SQLite path wrote
``str(uuid.uuid4())`` -- 36 characters with dashes -- into ``api_photo.id``
and into every column that pointed at the photo. Django's ``UUIDField`` has no
native column type on SQLite and stores and compares ``uuid.hex`` there: 32
characters, no dashes. So on every SQLite install that had photos when it
migrated past 0099, Django cannot find those photos by primary key, and every
row it has written for one of them since holds a value that joins to nothing.

The test database is freshly migrated, so its photos already use the hex
form. Each test first puts a photo back into the state 0099 left it in,
checks that it is broken the way a real install is, and only then runs the
migration.
"""

import importlib
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import MagicMock

from django.apps import apps as django_apps
from django.db import IntegrityError, connection
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase, TestCase

from api.models import AlbumUser, DeletionLog, Face, Photo, Tag
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import PhotoMetadata
from api.models.photo_search import PhotoSearch
from api.models.thumbnail import Thumbnail
from api.sync_signals import _write_tombstones

from ..utils import create_test_face, create_test_photo, create_test_user

MIGRATION_NAME = "0143_sqlite_photo_ids_hex"
migration = importlib.import_module(f"api.migrations.{MIGRATION_NAME}")
squashed = importlib.import_module("api.migrations.0001_squashed_0100")

requires_sqlite = skipUnless(
    connection.vendor == "sqlite", "only 0099's SQLite path wrote dashed ids"
)

# Every column that stores a photo's primary key as of 0143. Frozen here
# rather than derived, so the test keeps describing what this migration has to
# cover even after later migrations add or drop tables.
PHOTO_ID_COLUMNS_AT_0143 = {
    ("api_photo", "id"),
    # The fifteen 0099 rebuilt on SQLite; the twelve that kept no REFERENCES
    # clause are invisible to foreign-key introspection.
    ("api_face", "photo_id"),
    ("api_photo_shared_to", "photo_id"),
    ("api_photo_files", "photo_id"),
    ("api_albumuser_photos", "photo_id"),
    ("api_albumthing_photos", "photo_id"),
    ("api_albumplace_photos", "photo_id"),
    ("api_albumdate_photos", "photo_id"),
    ("api_albumauto_photos", "photo_id"),
    ("api_albumthing_cover_photos", "photo_id"),
    ("api_person", "cover_photo_id"),
    ("api_albumuser", "cover_photo_id"),
    ("api_photostack", "primary_photo_id"),
    ("api_thumbnail", "photo_id"),
    ("api_photo_caption", "photo_id"),
    ("api_photo_search", "photo_id"),
    # Created by Django after 0099, with a real foreign key.
    ("api_photo_stacks", "photo_id"),
    ("api_photo_duplicates", "photo_id"),
    ("api_duplicate", "kept_photo_id"),
    ("api_stackreview", "kept_photo_id"),
    ("api_tag_photos", "photo_id"),
    ("api_metadatafile", "photo_id"),
    ("api_metadataedit", "photo_id"),
    ("api_photometadata", "photo_id"),
    ("api_photo_ocr", "photo_id"),
    ("api_photoshare", "photo_id"),
}


def photo_id_columns_of_models():
    """(table, column) of every field of the current models that holds a photo id."""
    columns = {(Photo._meta.db_table, Photo._meta.pk.column)}
    for model in django_apps.get_models(include_auto_created=True):
        for field in model._meta.local_fields:
            if field.is_relation and field.related_model is Photo:
                columns.add((model._meta.db_table, field.column))
    return columns


def as_left_by_0099(photo):
    """Store *photo*'s id everywhere in the dashed form 0099 wrote on SQLite."""
    dashed = str(photo.pk)
    with connection.cursor() as cursor:
        for table, column in sorted(photo_id_columns_of_models()):
            cursor.execute(
                f'UPDATE "{table}" SET "{column}" = %s WHERE "{column}" = %s',
                [dashed, photo.pk.hex],
            )
    return dashed


def stored_values(table, column, *values):
    """The raw values of *column* in *table* equal to any of *values*."""
    placeholders = ", ".join(["%s"] * len(values))
    with connection.cursor() as cursor:
        cursor.execute(
            f'SELECT "{column}" FROM "{table}" WHERE "{column}" IN ({placeholders})',
            list(values),
        )
        return [row[0] for row in cursor.fetchall()]


def snapshot():
    """Every stored photo id, per column, in a stable order."""
    result = {}
    with connection.cursor() as cursor:
        for table, column in sorted(photo_id_columns_of_models()):
            cursor.execute(f'SELECT "{column}" FROM "{table}" ORDER BY rowid')
            result[(table, column)] = [row[0] for row in cursor.fetchall()]
    return result


def run_migration():
    # SQLite's real schema editor refuses to open inside the transaction a
    # TestCase runs in, and the migration only needs its connection.
    migration.rewrite_dashed_photo_ids(
        django_apps, SimpleNamespace(connection=connection)
    )


@requires_sqlite
class SqlitePhotoIdsHexTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = create_test_user()
        cls.photo = create_test_photo(
            owner=cls.user,
            captions_json={"user_caption": "Beach"},
            search_captions="beach",
            camera="X100V",
        )
        create_test_face(photo=cls.photo)
        cls.album = AlbumUser.objects.create(title="Trip", owner=cls.user)
        cls.album.photos.add(cls.photo)
        cls.tag = Tag.objects.create(name="sea", owner=cls.user)
        cls.tag.photos.add(cls.photo)
        # Added after the upgrade: Django wrote it, so it is hex already.
        cls.new_photo = create_test_photo(owner=cls.user)
        cls.album.photos.add(cls.new_photo)

    def legacy_photo(self):
        """self.photo as 0099 left it, loaded the way the app still can."""
        as_left_by_0099(self.photo)
        return Photo.objects.get(image_hash=self.photo.image_hash)

    def test_photo_can_be_fetched_by_its_primary_key_again(self):
        legacy = self.legacy_photo()
        # Reading parses either form, which is how this went unnoticed: the
        # photo still shows up in lists, it just cannot be fetched by id.
        self.assertEqual(legacy.pk, self.photo.pk)
        self.assertEqual(
            stored_values("api_photo", "id", str(self.photo.pk)), [str(self.photo.pk)]
        )
        self.assertFalse(Photo.objects.filter(pk=self.photo.pk).exists())
        self.assertFalse(Photo.objects.filter(pk=str(self.photo.pk)).exists())

        run_migration()

        self.assertEqual(Photo.objects.get(pk=self.photo.pk), legacy)
        self.assertEqual(
            stored_values("api_photo", "id", self.photo.pk.hex), [self.photo.pk.hex]
        )

    def test_rows_that_point_at_the_photo_are_found_again(self):
        self.legacy_photo()
        lookups = [
            Face.objects.filter(photo_id=self.photo.pk),
            Thumbnail.objects.filter(photo_id=self.photo.pk),
            PhotoCaption.objects.filter(photo_id=self.photo.pk),
            PhotoSearch.objects.filter(photo_id=self.photo.pk),
            PhotoMetadata.objects.filter(photo_id=self.photo.pk),
            self.album.photos.filter(pk=self.photo.pk),
            self.tag.photos.filter(pk=self.photo.pk),
        ]
        for lookup in lookups:
            with self.subTest(model=lookup.model.__name__):
                self.assertEqual(lookup.count(), 0)

        run_migration()

        for lookup in lookups:
            with self.subTest(model=lookup.model.__name__):
                self.assertEqual(lookup.count(), 1)

    def test_album_links_written_after_the_upgrade_join_again(self):
        legacy = self.legacy_photo()
        album = AlbumUser.objects.create(title="After the upgrade", owner=self.user)
        album.photos.add(legacy)
        # api_albumuser_photos lost its REFERENCES clause in 0099's rebuild,
        # so nothing stops the hex row -- it just never matches the photo.
        self.assertEqual(
            stored_values("api_albumuser_photos", "photo_id", self.photo.pk.hex),
            [self.photo.pk.hex],
        )
        self.assertEqual(album.photos.count(), 0)
        # The link that existed at 0099 was rewritten with the photo and joins.
        self.assertIn(legacy, self.album.photos.all())

        run_migration()

        self.assertEqual(list(album.photos.all()), [legacy])
        self.assertEqual(set(self.album.photos.all()), {legacy, self.new_photo})

    def test_writes_to_a_real_foreign_key_stop_failing(self):
        legacy = self.legacy_photo()
        tag = Tag.objects.create(name="after the upgrade", owner=self.user)
        tag.photos.add(legacy)
        # api_tag_photos has a real (deferred) foreign key: this is the
        # "FOREIGN KEY constraint failed" an install gets on commit.
        with self.assertRaises(IntegrityError):
            connection.check_constraints(table_names=["api_tag_photos"])

        run_migration()

        connection.check_constraints()
        self.assertEqual(list(tag.photos.all()), [legacy])

    def test_rewrites_every_column_that_stores_a_photo_id(self):
        self.legacy_photo()

        run_migration()

        for table, column in sorted(photo_id_columns_of_models()):
            with self.subTest(table=table, column=column):
                self.assertEqual(stored_values(table, column, str(self.photo.pk)), [])
        self.assertEqual(
            stored_values("api_face", "photo_id", self.photo.pk.hex),
            [self.photo.pk.hex],
        )

    def test_rewrites_a_foreign_key_only_the_database_knows_about(self):
        # A table outside the migration state -- left behind by a removed
        # model, say -- is found through its REFERENCES clause.
        dashed = as_left_by_0099(self.photo)
        with connection.cursor() as cursor:
            cursor.execute(
                'CREATE TABLE "leftover_photo_ref" ('
                '"id" integer NOT NULL PRIMARY KEY, '
                '"photo_id" char(32) NOT NULL REFERENCES "api_photo" ("id") '
                "DEFERRABLE INITIALLY DEFERRED)"
            )
            cursor.execute(
                'INSERT INTO "leftover_photo_ref" ("id", "photo_id") VALUES (1, %s)',
                [dashed],
            )

        run_migration()

        self.assertEqual(
            stored_values("leftover_photo_ref", "photo_id", dashed, self.photo.pk.hex),
            [self.photo.pk.hex],
        )

    def test_keeps_the_row_written_after_the_upgrade_when_both_exist(self):
        legacy = self.legacy_photo()
        # After the upgrade Django looked the thumbnail up by the hex id,
        # found nothing and created a second one; re-adding the photo to its
        # album did the same to the link. Neither collides with the dashed
        # row until the migration rewrites it.
        Thumbnail.objects.create(
            photo=legacy,
            aspect_ratio=2.0,
            thumbnail_big="thumbnails_big/new.webp",
            square_thumbnail="square_thumbnails/new.webp",
            square_thumbnail_small="square_thumbnails_small/new.webp",
        )
        self.album.photos.add(legacy)
        through = AlbumUser.photos.through
        self.assertEqual(
            through.objects.filter(albumuser=self.album)
            .exclude(photo=self.new_photo)
            .count(),
            2,
        )

        run_migration()

        both_forms = (str(self.photo.pk), self.photo.pk.hex)
        self.assertEqual(
            stored_values("api_thumbnail", "photo_id", *both_forms),
            [self.photo.pk.hex],
        )
        thumbnail = Thumbnail.objects.get(photo_id=self.photo.pk)
        self.assertEqual(thumbnail.aspect_ratio, 2.0)
        self.assertEqual(thumbnail.thumbnail_big, "thumbnails_big/new.webp")
        self.assertEqual(
            stored_values("api_albumuser_photos", "photo_id", *both_forms),
            [self.photo.pk.hex],
        )
        self.assertEqual(list(self.album.photos.filter(pk=legacy.pk)), [legacy])

    def test_running_it_again_changes_nothing(self):
        self.legacy_photo()
        run_migration()
        once = snapshot()

        run_migration()

        self.assertEqual(snapshot(), once)

    def test_leaves_a_database_without_dashed_ids_alone(self):
        before = snapshot()

        run_migration()

        self.assertEqual(snapshot(), before)

    def test_deletion_log_keeps_the_form_the_sync_api_uses(self):
        # Tombstones hold str(pk) for every photo, dashed by design: that is
        # what the API serialises and what clear_tombstones and the mobile
        # client compare against. They are not photo-id columns.
        _write_tombstones(DeletionLog.ENTITY_PHOTO, self.photo.pk, [self.user.pk])
        tombstone = DeletionLog.objects.get(entity=DeletionLog.ENTITY_PHOTO)
        self.assertEqual(tombstone.entity_id, str(self.photo.pk))
        self.legacy_photo()

        run_migration()

        tombstone.refresh_from_db()
        self.assertEqual(tombstone.entity_id, str(self.photo.pk))

    def test_finds_every_column_that_stores_a_photo_id(self):
        state = MigrationLoader(connection).project_state(("api", MIGRATION_NAME))

        columns = migration.photo_id_columns(state.apps, connection)

        self.assertLessEqual(PHOTO_ID_COLUMNS_AT_0143, columns)
        self.assertLessEqual(photo_id_columns_of_models(), columns)
        self.assertLessEqual(set(squashed.SQLITE_FK_COLUMNS), columns)


class SqlitePhotoIdsHexOtherBackendsTest(SimpleTestCase):
    def test_does_nothing_on_postgresql(self):
        # A native uuid column has no string form to get wrong.
        schema_editor = MagicMock()
        schema_editor.connection.vendor = "postgresql"

        migration.rewrite_dashed_photo_ids(django_apps, schema_editor)

        schema_editor.connection.cursor.assert_not_called()
        schema_editor.execute.assert_not_called()

    def test_reversing_keeps_the_hex_ids(self):
        # Going back must not bring the unreadable ids back.
        [operation] = migration.Migration.operations
        self.assertIs(operation.reverse_code, operation.noop)

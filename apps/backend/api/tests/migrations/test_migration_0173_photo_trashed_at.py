import datetime
import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration = importlib.import_module("api.migrations.0173_photo_trashed_at")

TRASHED = datetime.datetime(2025, 3, 4, 12, 0, tzinfo=datetime.timezone.utc)


class PhotoTrashedAtMigrationTest(TestCase):
    """Photos already in the trash get a trashed_at (#2203)."""

    def setUp(self) -> None:
        self.user = create_test_user()

    def photo(self, **fields: object) -> Photo:
        photo = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=photo.pk).update(
            last_modified=TRASHED, trashed_at=None, **fields
        )
        return photo

    def trashed_at(self, photo: Photo) -> datetime.datetime | None:
        return Photo.objects.get(pk=photo.pk).trashed_at

    def test_a_trashed_photo_gets_its_last_change(self) -> None:
        photo = self.photo(in_trashcan=True)

        migration.forwards(global_apps, None)

        self.assertEqual(self.trashed_at(photo), TRASHED)

    def test_a_photo_outside_the_trash_gets_none(self) -> None:
        photo = self.photo()

        migration.forwards(global_apps, None)

        self.assertIsNone(self.trashed_at(photo))

    def test_a_date_already_set_is_kept(self) -> None:
        earlier = TRASHED - datetime.timedelta(days=3)
        photo = self.photo(in_trashcan=True)
        Photo.objects.filter(pk=photo.pk).update(trashed_at=earlier)

        migration.forwards(global_apps, None)

        self.assertEqual(self.trashed_at(photo), earlier)

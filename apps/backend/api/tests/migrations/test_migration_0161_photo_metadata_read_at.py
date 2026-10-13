import datetime
import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models import Photo
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0161 = importlib.import_module("api.migrations.0161_photo_metadata_read_at")

ADDED_ON = datetime.datetime(2024, 5, 6, 7, 8, 9, tzinfo=datetime.timezone.utc)


class PhotoMetadataReadAtMigrationTest(TestCase):
    """Which photos of an existing library count as read (#2271)."""

    def setUp(self) -> None:
        self.user = create_test_user()

    def photo(self, with_metadata: bool) -> Photo:
        # A metadata field makes the factory create the PhotoMetadata row.
        fields = {"camera": "Cam"} if with_metadata else {}
        photo = create_test_photo(owner=self.user, added_on=ADDED_ON, **fields)
        self.assertEqual(
            with_metadata, PhotoMetadata.objects.filter(photo=photo).exists()
        )
        Photo.objects.filter(pk=photo.pk).update(metadata_read_at=None)
        return photo

    def read_at(self, photo: Photo) -> datetime.datetime | None:
        return Photo.objects.get(pk=photo.pk).metadata_read_at

    def test_a_photo_with_metadata_was_read_when_it_was_added(self) -> None:
        photo = self.photo(with_metadata=True)

        migration_0161.forwards(global_apps, None)

        self.assertEqual(ADDED_ON, self.read_at(photo))

    def test_a_photo_without_metadata_was_never_read(self) -> None:
        photo = self.photo(with_metadata=False)

        migration_0161.forwards(global_apps, None)

        self.assertIsNone(self.read_at(photo))

import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models import Photo
from api.models.photo_metadata import PhotoMetadata
from api.models.thumbnail import Thumbnail
from api.tests.utils import create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0171 = importlib.import_module("api.migrations.0171_shown_photo_size")


class ShownPhotoSizeMigrationTest(TestCase):
    """Rows scanned before #2568 get the size their thumbnail shows."""

    def setUp(self) -> None:
        self.user = create_test_user()

    def photo(self, width: int | None, height: int | None, aspect_ratio: float | None) -> Photo:
        photo = create_test_photo(owner=self.user, width=width, height=height)
        Thumbnail.objects.filter(photo=photo).update(aspect_ratio=aspect_ratio)
        return photo

    def size(self, photo: Photo) -> tuple[int | None, int | None]:
        metadata = PhotoMetadata.objects.get(photo=photo)
        return metadata.width, metadata.height

    def test_a_stored_size_the_thumbnail_shows_turned_is_swapped(self) -> None:
        portrait = self.photo(4000, 3000, 0.75)
        landscape = self.photo(3000, 4000, 1.33)

        migration_0171.forwards(global_apps, None)

        self.assertEqual((3000, 4000), self.size(portrait))
        self.assertEqual((4000, 3000), self.size(landscape))

    def test_a_size_that_matches_its_thumbnail_is_kept(self) -> None:
        upright = self.photo(4000, 3000, 1.33)
        square = self.photo(1001, 1000, 1.0)
        no_thumbnail_ratio = self.photo(4000, 3000, None)
        no_size = self.photo(None, None, 0.75)

        migration_0171.forwards(global_apps, None)

        self.assertEqual((4000, 3000), self.size(upright))
        self.assertEqual((1001, 1000), self.size(square))
        self.assertEqual((4000, 3000), self.size(no_thumbnail_ratio))
        self.assertEqual((None, None), self.size(no_size))

import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models import AlbumUser, AlbumUserShare, Photo, PhotoShare
from api.models.user import get_deleted_user

from ..utils import create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0147 = importlib.import_module(
    "api.migrations.0147_turn_off_public_links_of_deleted_users"
)


class TurnOffPublicLinksOfDeletedUsersMigrationTest(TestCase):
    """Links that users deleted by an older version left under ``deleted``."""

    def _links(self, owner):
        photo = create_test_photo(owner=owner, public=True)
        album = AlbumUser.objects.create(owner=owner, title="Trip")
        album.photos.add(photo)
        album_share = AlbumUserShare.objects.create(album=album, enabled=True)
        photo_share = PhotoShare.objects.create(photo=photo, enabled=True)
        return photo, album_share, photo_share

    def _run(self):
        migration_0147.turn_off_public_links_of_deleted_users(global_apps, None)

    def test_turns_off_the_links_held_by_deleted(self):
        photo, album_share, photo_share = self._links(get_deleted_user())

        self._run()

        photo.refresh_from_db()
        album_share.refresh_from_db()
        photo_share.refresh_from_db()
        self.assertFalse(photo.public)
        self.assertFalse(album_share.is_active())
        self.assertIsNone(album_share.slug)
        self.assertFalse(photo_share.is_active())
        self.assertIsNone(photo_share.slug)

    def test_leaves_every_other_users_links_alone(self):
        get_deleted_user()
        photo, album_share, photo_share = self._links(create_test_user())

        self._run()

        self.assertTrue(Photo.objects.get(pk=photo.pk).public)
        self.assertTrue(AlbumUserShare.objects.get(pk=album_share.pk).is_active())
        self.assertTrue(PhotoShare.objects.get(pk=photo_share.pk).is_active())

    def test_without_a_deleted_account_there_is_nothing_to_do(self):
        photo, _, _ = self._links(create_test_user())

        self._run()

        self.assertTrue(Photo.objects.get(pk=photo.pk).public)

import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models import AlbumUser, AlbumUserPhoto
from api.tests.utils import create_test_album_user, create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration = importlib.import_module("api.migrations.0211_collaborative_albums")


class DropLinksToOtherUsersPhotosTest(TestCase):
    """Albums only hold photos their owner or a current contributor added
    (#464): a link to another user's photo from before contributors existed
    is removed, and so is a cover that is another user's photo."""

    def setUp(self) -> None:
        self.anna = create_test_user()
        self.vera = create_test_user()
        self.ben = create_test_user()
        self.own = create_test_photo(owner=self.anna)
        self.foreign = create_test_photo(owner=self.vera)
        self.contributed = create_test_photo(owner=self.ben)
        self.album = create_test_album_user(owner=self.anna, cover_photo=self.foreign)
        AlbumUserPhoto.objects.create(albumuser=self.album, photo=self.own)
        AlbumUserPhoto.objects.create(albumuser=self.album, photo=self.foreign)
        AlbumUserPhoto.objects.create(
            albumuser=self.album, photo=self.contributed, added_by=self.ben
        )

    def test_only_the_old_foreign_link_and_cover_go(self) -> None:
        migration.drop_links_to_other_users_photos(global_apps, None)

        kept = set(
            AlbumUserPhoto.objects.filter(albumuser=self.album).values_list(
                "photo_id", flat=True
            )
        )
        self.assertEqual(kept, {self.own.pk, self.contributed.pk})
        self.assertIsNone(AlbumUser.objects.get(pk=self.album.pk).cover_photo)

    def test_an_own_cover_stays(self) -> None:
        AlbumUser.objects.filter(pk=self.album.pk).update(cover_photo=self.own)

        migration.drop_links_to_other_users_photos(global_apps, None)

        self.assertEqual(AlbumUser.objects.get(pk=self.album.pk).cover_photo, self.own)

"""``api.models.album_thing.update_photo_count`` from both sides of the m2m.

On the reverse side (``photo.albumthing_set``) Django hands the receiver the
Photo as ``instance`` and the album pks in ``pk_set``. The receiver read
``instance.photos`` there, so a reverse add raised AttributeError and a
reverse remove left the album's ``photo_count`` stale.
"""

from django.test import TestCase

from api.models.album_thing import AlbumThing
from api.tests.utils import create_test_photo, create_test_user


class AlbumThingPhotoCountReceiverTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.first = AlbumThing.objects.create(
            title="first", thing_type="thing", owner=self.user
        )
        self.second = AlbumThing.objects.create(
            title="second", thing_type="thing", owner=self.user
        )
        self.photo = create_test_photo(owner=self.user)

    def test_forward_add_and_remove_recount(self):
        self.first.photos.add(self.photo)
        self.first.refresh_from_db()
        self.assertEqual(self.first.photo_count, 1)

        self.first.photos.remove(self.photo)
        self.first.refresh_from_db()
        self.assertEqual(self.first.photo_count, 0)

    def test_reverse_add_recounts_every_album(self):
        self.photo.albumthing_set.add(self.first, self.second)

        for album in (self.first, self.second):
            album.refresh_from_db()
            self.assertEqual(album.photo_count, 1)
            self.assertEqual(
                list(album.cover_photos.values_list("pk", flat=True)),
                [self.photo.pk],
            )

    def test_reverse_remove_recounts_every_album(self):
        self.first.photos.add(self.photo)
        self.second.photos.add(self.photo)

        self.photo.albumthing_set.remove(self.first, self.second)

        for album in (self.first, self.second):
            album.refresh_from_db()
            self.assertEqual(album.photo_count, 0)

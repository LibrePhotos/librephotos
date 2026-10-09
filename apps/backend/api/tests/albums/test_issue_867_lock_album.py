"""Issue #867 - lock a user album so its photo set is read-only."""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumUser
from api.tests.utils import create_test_photo, create_test_user


class LockAlbumTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.p1 = create_test_photo(owner=self.user)
        self.p2 = create_test_photo(owner=self.user)
        self.album = AlbumUser.objects.create(title="Trip", owner=self.user)
        self.album.photos.add(self.p1)
        self.url = f"/api/albums/user/edit/{self.album.id}/"

    def _patch(self, data):
        return self.client.patch(self.url, data, format="json")

    def test_unlocked_by_default(self):
        self.assertFalse(self.album.locked)

    def test_locked_album_refuses_adding_photos(self):
        self.album.locked = True
        self.album.save()
        res = self._patch({"photos": [str(self.p2.id)]})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.album.photos.count(), 1)

    def test_locked_album_refuses_removing_photos(self):
        self.album.locked = True
        self.album.save()
        res = self._patch({"removedPhotos": [self.p1.image_hash]})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.album.photos.count(), 1)

    def test_locked_album_can_still_be_renamed(self):
        self.album.locked = True
        self.album.save()
        res = self._patch({"title": "Trip 2024"})
        self.assertEqual(res.status_code, 200)

    def test_lock_then_unlock(self):
        self.assertEqual(self._patch({"locked": True}).status_code, 200)
        self.album.refresh_from_db()
        self.assertTrue(self.album.locked)
        res = self._patch({"locked": False, "photos": [str(self.p2.id)]})
        self.assertEqual(res.status_code, 200)
        self.album.refresh_from_db()
        self.assertFalse(self.album.locked)
        self.assertEqual(self.album.photos.count(), 2)

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

    def test_locked_album_refuses_select_all_add(self):
        self.album.locked = True
        self.album.save()
        res = self._patch({"select_all": True, "query": {}})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.album.photos.count(), 1)

    def test_select_all_add_works_when_unlocked(self):
        res = self._patch({"select_all": True, "query": {}})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.album.photos.count(), 2)

    def test_create_with_existing_title_cannot_add_to_locked_album(self):
        self.album.locked = True
        self.album.save()
        for body in (
            {"title": "Trip", "photos": [str(self.p2.id)]},
            {"title": "Trip", "photos": [], "select_all": True, "query": {}},
        ):
            with self.subTest(body=body):
                res = self.client.post("/api/albums/user/edit/", body, format="json")
                self.assertEqual(res.status_code, 400)
                self.assertEqual(self.album.photos.count(), 1)
        self.assertEqual(AlbumUser.objects.filter(owner=self.user).count(), 1)

    def test_create_can_start_locked(self):
        res = self.client.post(
            "/api/albums/user/edit/",
            {"title": "Archive", "photos": [str(self.p2.id)], "locked": True},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        album = AlbumUser.objects.get(owner=self.user, title="Archive")
        self.assertTrue(album.locked)
        self.assertEqual(list(album.photos.all()), [self.p2])

    def test_locked_album_can_still_be_deleted_and_change_cover(self):
        self.album.locked = True
        self.album.save()
        res = self._patch({"cover_photo": str(self.p1.id)})
        self.assertEqual(res.status_code, 200)
        res = self.client.delete(f"/api/albums/user/{self.album.id}/")
        self.assertIn(res.status_code, (200, 204))
        self.assertFalse(AlbumUser.objects.filter(id=self.album.id).exists())

    def test_other_user_cannot_toggle_the_lock(self):
        other = create_test_user()
        client = APIClient()
        client.force_authenticate(other)
        res = client.patch(self.url, {"locked": True}, format="json")
        self.assertIn(res.status_code, (403, 404))
        self.album.refresh_from_db()
        self.assertFalse(self.album.locked)

    def test_serializers_expose_locked(self):
        self.album.locked = True
        self.album.save()
        res = self.client.get("/api/albums/user/list/")
        self.assertEqual(res.status_code, 200)
        rows = res.data["results"] if isinstance(res.data, dict) else res.data
        self.assertTrue(next(r for r in rows if r["id"] == self.album.id)["locked"])
        res = self.client.get(f"/api/albums/user/{self.album.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["locked"])

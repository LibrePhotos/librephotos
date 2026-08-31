"""Media-type (photo / video) filtering on the album detail endpoints.

The search and album-date endpoints already honor ``?video=true`` / ``?photo=true``
(PRs #1862 / #1051). These tests cover the same convention extended to the user,
place and thing album endpoints, plus the shared ``filter_photos_by_media_type``
helper that backs them.
"""

from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumPlace, AlbumThing, AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.serializers.PhotosGroupedByDate import filter_photos_by_media_type
from api.tests.utils import create_test_photo, create_test_user


class FilterPhotosByMediaTypeHelperTest(SimpleTestCase):
    """Unit tests for the pure helper (no DB)."""

    def setUp(self):
        self.photo_a = SimpleNamespace(video=False)
        self.photo_b = SimpleNamespace(video=False)
        self.video_a = SimpleNamespace(video=True)
        self.items = [self.photo_a, self.video_a, self.photo_b]

    def _request(self, **params):
        return SimpleNamespace(query_params=params)

    def test_no_request_returns_unchanged(self):
        self.assertIs(filter_photos_by_media_type(self.items, None), self.items)

    def test_no_params_returns_unchanged(self):
        result = filter_photos_by_media_type(self.items, self._request())
        self.assertIs(result, self.items)

    def test_video_keeps_only_videos(self):
        result = filter_photos_by_media_type(self.items, self._request(video="true"))
        self.assertEqual(result, [self.video_a])

    def test_photo_keeps_only_photos(self):
        result = filter_photos_by_media_type(self.items, self._request(photo="true"))
        self.assertEqual(result, [self.photo_a, self.photo_b])

    def test_video_wins_when_both_present(self):
        result = filter_photos_by_media_type(
            self.items, self._request(video="true", photo="true")
        )
        self.assertEqual(result, [self.video_a])

    def test_order_is_preserved(self):
        result = filter_photos_by_media_type(self.items, self._request(photo="true"))
        self.assertEqual(result, [self.photo_a, self.photo_b])


class AlbumMediaTypeFilterEndpointTest(TestCase):
    """Each album detail endpoint must honor ?video=true / ?photo=true."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        # two photos, one video
        self.photo1 = create_test_photo(
            owner=self.user, video=False, exif_timestamp=now
        )
        self.photo2 = create_test_photo(
            owner=self.user, video=False, exif_timestamp=now
        )
        self.video1 = create_test_photo(owner=self.user, video=True, exif_timestamp=now)
        self.all_hashes = {self.photo1.image_hash, self.photo2.image_hash}
        self.video_hashes = {self.video1.image_hash}

    @staticmethod
    def _hashes(response):
        data = response.json()
        groups = data.get("grouped_photos")
        if groups is None:
            groups = data.get("results", {}).get("grouped_photos", [])
        return {item["image_hash"] for group in groups for item in group["items"]}

    def _assert_filtering(self, url):
        # no filter -> everything
        self.assertEqual(
            self._hashes(self.client.get(url)),
            self.all_hashes | self.video_hashes,
        )
        # photos only
        self.assertEqual(
            self._hashes(self.client.get(url, {"photo": "true"})),
            self.all_hashes,
        )
        # videos only
        self.assertEqual(
            self._hashes(self.client.get(url, {"video": "true"})),
            self.video_hashes,
        )

    def test_user_album(self):
        album = AlbumUser.objects.create(title="My Album", owner=self.user)
        album.photos.add(self.photo1, self.photo2, self.video1)
        self._assert_filtering(f"/api/albums/user/{album.id}/")

    def test_user_album_public(self):
        album = AlbumUser.objects.create(title="Shared Album", owner=self.user)
        album.photos.add(self.photo1, self.photo2, self.video1)
        AlbumUserShare.objects.create(album=album, enabled=True)
        anon = APIClient()
        base = f"/api/albums/user/{album.id}/"
        self.assertEqual(
            self._hashes(anon.get(base, {"public": "1"})),
            self.all_hashes | self.video_hashes,
        )
        self.assertEqual(
            self._hashes(anon.get(base, {"public": "1", "photo": "true"})),
            self.all_hashes,
        )
        self.assertEqual(
            self._hashes(anon.get(base, {"public": "1", "video": "true"})),
            self.video_hashes,
        )

    def test_place_album(self):
        album = AlbumPlace.objects.create(title="Lisbon", owner=self.user)
        album.photos.add(self.photo1, self.photo2, self.video1)
        self._assert_filtering(f"/api/albums/place/{album.id}/")

    def test_thing_album(self):
        album = AlbumThing.objects.create(
            title="beach", owner=self.user, thing_type="hashtag_attribute"
        )
        album.photos.add(self.photo1, self.photo2, self.video1)
        self._assert_filtering(f"/api/albums/thing/{album.id}/")

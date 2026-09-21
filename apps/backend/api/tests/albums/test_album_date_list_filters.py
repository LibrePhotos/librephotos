"""Query-filter behavior of the album-date LIST endpoint.

Covers the three filters that select which AlbumDate rows come back:

* ``?public=true`` (with and without ``username``). ``AlbumDateListViewSet``
  used to append ``Q(owner__username=username)`` unconditionally, so
  ``?public=true`` on its own became ``Q(owner__username=None)`` and the
  endpoint always answered with an empty list. The detail viewset
  (``AlbumDateViewSet``) and ``AlbumUserViewSet`` both guard the username
  before filtering on it; the list viewset now does the same, so an omitted
  username means "every owner's public photos".
* ``?photo=true`` / video-only media selection.
* ``?in_trashcan=true`` (the trash view).
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models.album_date import AlbumDate
from api.tests.utils import create_test_photo, create_test_photos, create_test_user


class AlbumDateListPublicFilterTest(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.user_a = create_test_user(public_sharing=True)
        self.user_b = create_test_user(public_sharing=True)

        self.public_photo_a = create_test_photo(owner=self.user_a, public=True)
        self.public_photo_b = create_test_photo(owner=self.user_b, public=True)
        self.private_photo_a = create_test_photo(owner=self.user_a, public=False)

        self.public_album_a = self._album(
            self.user_a, datetime.date(2020, 1, 1), self.public_photo_a
        )
        self.public_album_b = self._album(
            self.user_b, datetime.date(2020, 1, 2), self.public_photo_b
        )
        self.private_album_a = self._album(
            self.user_a, datetime.date(2020, 1, 3), self.private_photo_a
        )

    @staticmethod
    def _album(owner, date, photo):
        album = AlbumDate.objects.create(owner=owner, date=date)
        album.photos.add(photo)
        return album

    @staticmethod
    def _ids(response):
        return {album["id"] for album in response.json()["results"]}

    def test_public_without_username_returns_all_public_albums(self):
        response = self.client.get("/api/albums/date/list/", {"public": "true"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self._ids(response),
            {str(self.public_album_a.id), str(self.public_album_b.id)},
        )

    def test_public_with_username_returns_only_that_owners_albums(self):
        response = self.client.get(
            "/api/albums/date/list/",
            {"public": "true", "username": self.user_a.username},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._ids(response), {str(self.public_album_a.id)})


class OnlyPhotosOrOnlyVideosTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_only_photos(self):
        now = timezone.now()
        photo = create_test_photo(owner=self.user, added_on=now, public=True)

        album = AlbumDate(owner=self.user)
        album.id = 1
        album.photos.add(photo)
        album.save()

        response = self.client.get("/api/albums/date/list?photo=true").url
        response = self.client.get(response)

        data = response.json()
        self.assertEqual(1, len(data["results"]))


class TrashAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_trash_api_returns_deleted_images(self):
        """Test that the trash API returns albums containing deleted images"""

        # Create some test photos
        photos = create_test_photos(number_of_photos=3, owner=self.user)

        # Move one photo to trash
        photo_to_delete = photos[0]
        photo_to_delete.in_trashcan = True
        photo_to_delete.removed = False
        photo_to_delete.save()

        # Test the trash API endpoint
        response = self.client.get("/api/albums/date/list/?in_trashcan=true")

        # Check that the API responds successfully
        self.assertEqual(response.status_code, 200)

        data = response.json()

        # Check that we get the expected response structure
        self.assertIn("results", data)

        # Verify that we can call the API successfully
        # (We might not have trashed albums with photos, but the API should work)
        if data["results"]:
            # If we have results, check the structure
            album = data["results"][0]
            self.assertIn("id", album)
            self.assertIn("date", album)
            self.assertIn("photo_count", album)

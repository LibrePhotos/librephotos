"""``?public=true`` on the album-date list endpoint without a ``username``.

``AlbumDateListViewSet`` used to append ``Q(owner__username=username)``
unconditionally, so ``?public=true`` on its own became
``Q(owner__username=None)`` and the endpoint always answered with an empty
list. The detail viewset (``AlbumDateViewSet``) and ``AlbumUserViewSet`` both
guard the username before filtering on it; the list viewset now does the same,
so an omitted username means "every owner's public photos".
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.album_date import AlbumDate
from api.tests.utils import create_test_photo, create_test_user


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

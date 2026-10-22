"""My Albums can be sorted by when the photos were taken (#620).

The album card carries ``first_photo_date``: when the album's oldest photo was
taken, over the photos the album shows. A trashed or hidden photo must not
move the album, and an album without a dated photo has none.
"""

from datetime import UTC, datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_album_user, create_test_photo, create_test_user


def _at(year: int) -> datetime:
    return datetime(year, 6, 1, 12, 0, tzinfo=UTC)


class UserAlbumFirstPhotoDateTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def _cards(self):
        response = self.client.get("/api/albums/user/list/")
        self.assertEqual(response.status_code, 200, response.content)
        return {card["title"]: card for card in response.json()["results"]}

    def _photo(self, **fields):
        return create_test_photo(owner=self.owner, **fields)

    def test_the_card_has_the_oldest_photos_date(self):
        album = create_test_album_user(owner=self.owner, title="Trip")
        album.photos.add(
            self._photo(exif_timestamp=_at(2019)),
            self._photo(exif_timestamp=_at(2015)),
            self._photo(exif_timestamp=None),
        )

        self.assertEqual(
            self._cards()["Trip"]["first_photo_date"], "2015-06-01T12:00:00Z"
        )

    def test_trashed_and_hidden_photos_do_not_count(self):
        album = create_test_album_user(owner=self.owner, title="Trip")
        album.photos.add(
            self._photo(exif_timestamp=_at(2020)),
            self._photo(exif_timestamp=_at(2001), in_trashcan=True),
            self._photo(exif_timestamp=_at(2002), hidden=True),
        )

        self.assertEqual(
            self._cards()["Trip"]["first_photo_date"], "2020-06-01T12:00:00Z"
        )

    def test_an_album_without_a_dated_photo_has_none(self):
        create_test_album_user(owner=self.owner, title="Empty")
        undated = create_test_album_user(owner=self.owner, title="Undated")
        undated.photos.add(self._photo(exif_timestamp=None))

        cards = self._cards()

        self.assertIsNone(cards["Empty"]["first_photo_date"])
        self.assertIsNone(cards["Undated"]["first_photo_date"])

    def test_the_list_keeps_its_title_order(self):
        # The web sorts on its own; the server's order is what mobile reads
        create_test_album_user(owner=self.owner, title="B").photos.add(
            self._photo(exif_timestamp=_at(2001))
        )
        create_test_album_user(owner=self.owner, title="A").photos.add(
            self._photo(exif_timestamp=_at(2020))
        )

        self.assertEqual(list(self._cards()), ["A", "B"])

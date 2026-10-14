"""An album can be made empty and is listed while it is (#612).

My Albums used to hide every album without photos, so an album created to be
filled by an upload, or one whose last photo was removed, vanished from its
owner's list. The owner's list now holds every album they own.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.album_user import AlbumUser
from api.tests.utils import (
    create_test_album_collection,
    create_test_album_user,
    create_test_photo,
    create_test_user,
)


class EmptyUserAlbumTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def _list(self, client=None):
        response = (client or self.client).get("/api/albums/user/list/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def test_an_album_is_created_without_photos(self):
        response = self.client.post(
            "/api/albums/user/edit/",
            {"title": "Iceland 2026", "photos": []},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        album = AlbumUser.objects.get(id=response.json()["id"])
        self.assertEqual(album.owner, self.owner)
        self.assertEqual(album.photos.count(), 0)

    def test_the_owners_list_shows_an_empty_album(self):
        empty = create_test_album_user(owner=self.owner, title="Empty")
        full = create_test_album_user(owner=self.owner, title="Full")
        full.photos.add(create_test_photo(owner=self.owner))

        cards = {card["id"]: card for card in self._list()}

        self.assertEqual(set(cards), {empty.id, full.id})
        self.assertEqual(cards[empty.id]["photo_count"], 0)
        self.assertEqual(cards[full.id]["photo_count"], 1)
        # No cover rather than one with blank fields
        self.assertIsNone(cards[empty.id]["cover_photo"])
        self.assertIsNotNone(cards[full.id]["cover_photo"])

    def test_an_album_whose_last_photo_left_stays_listed(self):
        photo = create_test_photo(owner=self.owner)
        album = create_test_album_user(owner=self.owner, title="Emptied")
        album.photos.add(photo)
        album.photos.remove(photo)

        self.assertEqual([card["id"] for card in self._list()], [album.id])

    def test_an_empty_album_in_a_collection_is_listed_under_it(self):
        empty = create_test_album_user(owner=self.owner, title="Empty")
        create_test_album_user(owner=self.owner, title="Elsewhere")
        travel = create_test_album_collection(owner=self.owner, albums=[empty])

        response = self.client.get(f"/api/albums/user/list/?collection={travel.id}")

        self.assertEqual(response.status_code, 200, response.content)
        cards = response.json()["results"]
        self.assertEqual([card["id"] for card in cards], [empty.id])
        self.assertEqual(cards[0]["collection_ids"], [travel.id])

    def test_another_users_empty_album_is_not_listed(self):
        create_test_album_user(owner=self.other, title="Not mine")

        self.assertEqual(self._list(), [])

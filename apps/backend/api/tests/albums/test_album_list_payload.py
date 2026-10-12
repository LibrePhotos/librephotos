"""The cover and count of an album card, pinned on every endpoint that renders one (#2331).

``AlbumUserListSerializer`` fell back to ``obj.photos.first()`` and
``obj.photos.count()`` whenever its caller had not prefetched the cover or
annotated the count, and ``AlbumAutoListSerializer`` to the count. They read
only what ``with_album_user_list_relations`` and the event list's queryset
load now; these tests hold each endpoint to the values the fallbacks returned.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import (
    create_test_album_auto,
    create_test_album_user,
    create_test_photo,
    create_test_user,
)


class AlbumUserCardPayloadTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.friend = create_test_user()
        self.photos = sorted(
            (create_test_photo(owner=self.owner) for _ in range(3)),
            key=lambda photo: photo.pk,
        )
        self.album = create_test_album_user(owner=self.owner, title="pinned")
        self.album.photos.add(*self.photos)
        self.album.shared_to.add(self.friend)

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _assert_card(self, card, cover=None):
        cover = cover or self.photos[0]
        self.assertEqual(card["id"], self.album.id)
        self.assertEqual(card["title"], "pinned")
        self.assertEqual(card["photo_count"], 3)
        self.assertEqual(card["cover_photo"]["image_hash"], cover.image_hash)
        self.assertEqual(card["owner"]["id"], self.owner.id)
        self.assertEqual([user["id"] for user in card["shared_to"]], [self.friend.id])

    def _card(self, url, user=None):
        response = self._client(user or self.owner).get(url)
        self.assertEqual(response.status_code, 200, response.content)
        (card,) = (c for c in response.json()["results"] if c["id"] == self.album.id)
        return card

    def test_list(self):
        self._assert_card(self._card("/api/albums/user/list/"))

    def test_shared_to_me(self):
        self._assert_card(self._card("/api/albums/user/shared/tome/", self.friend))

    def test_shared_from_me(self):
        self._assert_card(self._card("/api/albums/user/shared/fromme/"))

    def test_albums_of_a_photo(self):
        self._assert_card(self._card(f"/api/photos/{self.photos[1].id}/albums/"))

    def test_explicit_cover(self):
        self.album.cover_photo = self.photos[2]
        self.album.save()
        self._assert_card(self._card("/api/albums/user/list/"), cover=self.photos[2])
        self._assert_card(
            self._card("/api/albums/user/shared/tome/", self.friend),
            cover=self.photos[2],
        )

    def test_share_response(self):
        other = create_test_user()
        response = self._client(self.owner).post(
            "/api/useralbum/share/",
            {"shared": True, "target_user_id": other.id, "album_id": self.album.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        card = response.json()
        self.assertEqual(card["photo_count"], 3)
        self.assertEqual(card["cover_photo"]["image_hash"], self.photos[0].image_hash)
        self.assertEqual(
            sorted(user["id"] for user in card["shared_to"]),
            sorted([self.friend.id, other.id]),
        )

    def test_make_public_response(self):
        response = self._client(self.owner).post(
            "/api/useralbum/makepublic/",
            {"album_id": self.album.id, "val_public": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        card = response.json()["album"]
        self.assertEqual(card["photo_count"], 3)
        self.assertEqual(card["cover_photo"]["image_hash"], self.photos[0].image_hash)
        self.assertIs(card["public"], True)
        self.assertTrue(card["public_slug"])

    def test_every_card_counts_the_photos_the_album_shows(self):
        # The album detail leaves hidden and trashed photos out, also for the
        # users it is shared to. Only the owner's album list counted that way;
        # the shared lists, a photo's albums and the share responses counted
        # every photo.
        hidden = create_test_photo(owner=self.owner, hidden=True)
        trashed = create_test_photo(owner=self.owner, in_trashcan=True)
        self.album.photos.add(hidden, trashed)

        cards = {
            "list": self._card("/api/albums/user/list/"),
            "shared to me": self._card("/api/albums/user/shared/tome/", self.friend),
            "shared from me": self._card("/api/albums/user/shared/fromme/"),
            "albums of a photo": self._card(f"/api/photos/{self.photos[1].id}/albums/"),
        }
        owner = self._client(self.owner)
        cards["share response"] = owner.post(
            "/api/useralbum/share/",
            {
                "shared": True,
                "target_user_id": self.friend.id,
                "album_id": self.album.id,
            },
            format="json",
        ).json()
        cards["make public response"] = owner.post(
            "/api/useralbum/makepublic/",
            {"album_id": self.album.id, "val_public": True},
            format="json",
        ).json()["album"]
        for name, card in cards.items():
            with self.subTest(name):
                self.assertEqual(card["photo_count"], 3)


class AlbumAutoCardPayloadTest(TestCase):
    def test_list_count(self):
        user = create_test_user()
        album = create_test_album_auto(owner=user, timestamp=timezone.now())
        album.photos.add(*(create_test_photo(owner=user) for _ in range(3)))
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.get("/api/albums/auto/list/")
        self.assertEqual(response.status_code, 200)
        (card,) = response.json()["results"]
        self.assertEqual(card["id"], album.id)
        self.assertEqual(card["photo_count"], 3)

"""Album cards count and cover with the photos the album shows.

The place and event lists only left hidden photos out, so trashed ones were
still counted and could be the cover, and the place grid still showed them.
Thing albums store their count and covers, which were refreshed only when the
album's photos changed, not when one of them was hidden or trashed later.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumAuto, AlbumPlace, AlbumThing, Photo
from api.models.album_thing import refresh_album_thing_photo_counts
from api.tests.utils import create_test_photo, create_test_user


class AlbumListVisiblePhotosTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        self.kept = create_test_photo(owner=self.user, exif_timestamp=now)
        self.gone = create_test_photo(owner=self.user, exif_timestamp=now)

    def _trash(self, deleted=True):
        response = self.client.post(
            "/api/photosedit/setdeleted/",
            {"image_hashes": [self.gone.image_hash], "deleted": deleted},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def _hide(self, hidden=True):
        response = self.client.post(
            "/api/photosedit/hide/",
            {"image_hashes": [self.gone.image_hash], "hidden": hidden},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def _thing(self, *photos):
        album = AlbumThing.objects.create(
            title="beach", owner=self.user, thing_type="hashtag_attribute"
        )
        album.photos.add(*photos)
        return album

    def _thing_ids(self):
        results = self.client.get("/api/albums/thing/list/").json()["results"]
        return [row["id"] for row in results]

    def _card(self, url, album):
        results = self.client.get(url).json()["results"]
        return next(row for row in results if row["id"] == album.id)

    @staticmethod
    def _cover_hashes(card, key="cover_photos"):
        return {photo["image_hash"] for photo in card[key]}

    def test_a_trashed_photo_leaves_the_place_card_and_grid(self):
        album = AlbumPlace.objects.create(title="Lisbon", owner=self.user)
        album.photos.add(self.kept, self.gone)
        self._trash()

        card = self._card("/api/albums/place/list/", album)
        self.assertEqual(card["photo_count"], 1)
        self.assertEqual(self._cover_hashes(card), {self.kept.image_hash})

        groups = self.client.get(f"/api/albums/place/{album.id}/").json()["results"][
            "grouped_photos"
        ]
        hashes = {item["image_hash"] for group in groups for item in group["items"]}
        self.assertEqual(hashes, {self.kept.image_hash})

    def test_a_trashed_photo_leaves_the_event_card(self):
        album = AlbumAuto.objects.create(
            title="Sunday",
            owner=self.user,
            timestamp=timezone.now(),
            created_on=timezone.now(),
        )
        album.photos.add(self.kept, self.gone)
        self._trash()

        card = self._card("/api/albums/auto/list/", album)
        self.assertEqual(card["photo_count"], 1)
        self.assertEqual(card["photos"]["image_hash"], self.kept.image_hash)

    def test_a_photo_hidden_later_leaves_the_thing_card(self):
        album = AlbumThing.objects.create(
            title="beach", owner=self.user, thing_type="hashtag_attribute"
        )
        album.photos.add(self.kept, self.gone)
        self.assertEqual(album.cover_photos.count(), 2)
        self._hide()

        card = self._card("/api/albums/thing/list/", album)
        self.assertEqual(card["photo_count"], 1)
        self.assertEqual(self._cover_hashes(card), {self.kept.image_hash})

    def test_a_thing_whose_photos_are_all_trashed_has_no_card(self):
        album = self._thing(self.gone)
        self._trash()

        self.assertNotIn(album.id, self._thing_ids())

    def test_trashing_and_restoring_recount_the_thing_card(self):
        album = self._thing(self.kept, self.gone)
        self._trash()
        self.assertEqual(self._card("/api/albums/thing/list/", album)["photo_count"], 1)
        self._trash(deleted=False)
        self.assertEqual(self._card("/api/albums/thing/list/", album)["photo_count"], 2)

    def test_unhiding_recounts_the_thing_card(self):
        album = self._thing(self.kept, self.gone)
        self._hide()
        self._hide(hidden=False)
        self.assertEqual(self._card("/api/albums/thing/list/", album)["photo_count"], 2)

    def test_a_listed_thing_card_opens(self):
        # The stored count can lag (e.g. a photo restored by a path that does
        # not recount): the list and the detail still agree on what is shown.
        album = self._thing(self.kept)
        AlbumThing.objects.filter(pk=album.pk).update(photo_count=0)

        self.assertIn(album.id, self._thing_ids())
        response = self.client.get(f"/api/albums/thing/{album.id}/")
        self.assertEqual(response.status_code, 200)

    def test_a_thing_showing_no_photo_is_neither_listed_nor_opened(self):
        album = self._thing(self.gone)
        # Hidden behind the stored count's back: it still says 1.
        Photo.objects.filter(pk=self.gone.pk).update(hidden=True)

        self.assertNotIn(album.id, self._thing_ids())
        response = self.client.get(f"/api/albums/thing/{album.id}/")
        self.assertEqual(response.status_code, 404)

    def test_the_recount_costs_the_same_for_one_album_or_many(self):
        albums = [
            AlbumThing.objects.create(
                title=f"thing-{i}", owner=self.user, thing_type="hashtag_attribute"
            )
            for i in range(5)
        ]
        for album in albums:
            album.photos.add(self.kept, self.gone)
        Photo.objects.filter(pk=self.gone.pk).update(in_trashcan=True)

        # The grouped count, the albums, one UPDATE.
        with self.assertNumQueries(3):
            refresh_album_thing_photo_counts([albums[0].pk])
        with self.assertNumQueries(3):
            refresh_album_thing_photo_counts([album.pk for album in albums])
        self.assertEqual(
            set(
                AlbumThing.objects.filter(owner=self.user).values_list(
                    "photo_count", flat=True
                )
            ),
            {1},
        )

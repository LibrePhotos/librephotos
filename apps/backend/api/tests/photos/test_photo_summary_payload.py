"""The stacks and RAW flag of a photo tile, pinned on every endpoint that renders one (#2331).

``PhotoSummarySerializer`` used to count a stack's photos and look for a RAW
file with a query of its own whenever the view had not prefetched them. It
reads only what ``with_photo_summary_relations`` loads now; these tests hold
each endpoint to the values those queries returned.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import File
from api.models.photo_stack import PhotoStack
from api.tests.utils import (
    create_test_album_date,
    create_test_file,
    create_test_photo,
    create_test_stack,
    create_test_user,
    share_test_photos,
)


class PhotoSummaryPayloadTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.friend = create_test_user()
        self.now = timezone.now()
        fields = {"owner": self.owner, "search_captions": "beach"}
        self.primary = create_test_photo(exif_timestamp=self.now, **fields)
        self.member = create_test_photo(exif_timestamp=self.now, **fields)
        self.single = create_test_photo(exif_timestamp=self.now, **fields)
        self.stack = create_test_stack(
            owner=self.owner,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=self.primary,
        )
        self.stack.photos.add(self.primary, self.member)
        # A deprecated stack type the tile leaves out.
        legacy = create_test_stack(
            owner=self.owner, stack_type=PhotoStack.StackType.RAW_JPEG_PAIR
        )
        legacy.photos.add(self.single)
        self.primary.files.add(
            create_test_file(None, self.owner, file_type=File.RAW_FILE)
        )
        self.single.files.add(create_test_file(None, self.owner))
        # A photo sphere (#483): the tile carries its projection for the 360° badge.
        self.single.projection_type = "equirectangular"
        self.single.save(update_fields=["projection_type"])
        self.photos = (self.primary, self.member, self.single)

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _get(self, url, user=None, params=None):
        response = self._client(user or self.owner).get(url, params or {})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def _assert_tiles(self, tiles):
        by_id = {tile["id"]: tile for tile in tiles}
        self.assertEqual(set(by_id), {str(photo.id) for photo in self.photos})
        self.assertEqual(
            by_id[str(self.primary.id)]["stacks"],
            [
                {
                    "id": str(self.stack.id),
                    "type": "manual",
                    "photo_count": 2,
                    "is_primary": True,
                }
            ],
        )
        self.assertEqual(by_id[str(self.member.id)]["stacks"][0]["is_primary"], False)
        self.assertEqual(by_id[str(self.member.id)]["stacks"][0]["photo_count"], 2)
        # RAW_JPEG_PAIR is still listed on the tile, with its own count.
        self.assertEqual(by_id[str(self.single.id)]["stacks"][0]["photo_count"], 1)
        self.assertIs(by_id[str(self.primary.id)]["has_raw_variant"], True)
        self.assertIs(by_id[str(self.member.id)]["has_raw_variant"], False)
        self.assertIs(by_id[str(self.single.id)]["has_raw_variant"], False)
        self.assertEqual(
            by_id[str(self.single.id)]["projection_type"], "equirectangular"
        )
        self.assertIsNone(by_id[str(self.primary.id)]["projection_type"])

    def test_no_timestamp_list(self):
        for photo in self.photos:
            photo.exif_timestamp = None
            photo.save(update_fields=["exif_timestamp"])
        self._assert_tiles(self._get("/api/photos/notimestamp/")["results"])

    def test_no_location_list(self):
        # The fixture photos have no GPS coordinates.
        self._assert_tiles(self._get("/api/photos/nolocation/")["results"])

    def test_recently_added(self):
        self._assert_tiles(self._get("/api/photos/recentlyadded/")["results"])

    def test_search(self):
        groups = self._get("/api/photos/searchlist/", params={"search": "beach"})
        self._assert_tiles(
            [tile for group in groups["results"] for tile in group["items"]]
        )

    def test_shared_to_me(self):
        share_test_photos([photo.pk for photo in self.photos], self.friend)
        self._assert_tiles(
            self._get("/api/photos/shared/tome/", self.friend)["results"]
        )

    def test_shared_from_me(self):
        share_test_photos([photo.pk for photo in self.photos], self.friend)
        rows = self._get("/api/photos/shared/fromme/")["results"]
        self.assertEqual({row["user_id"] for row in rows}, {self.friend.id})
        self._assert_tiles([row["photo"] for row in rows])

    def test_photo_summary_action(self):
        tiles = [
            self._get(f"/api/photos/{photo.id}/summary/")["photo_summary"]
            for photo in self.photos
        ]
        self._assert_tiles(tiles)

    def test_date_album(self):
        album = create_test_album_date(owner=self.owner, date=self.now.date())
        album.photos.add(*self.photos)
        payload = self._get(
            f"/api/albums/date/{album.id}/", params={"show_all_stack_photos": "true"}
        )
        self._assert_tiles(payload["results"]["items"])

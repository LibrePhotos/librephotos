"""A public album must honour its own sharing settings in the photo grid.

An album share has privacy switches (share_location, share_timestamps, ...),
all off unless the owner opts in. The per-photo detail endpoint
(/api/public/albums/s/<slug>/photos/<id>/) respected them, but the album
payload itself did not: every photo in ``grouped_photos`` was serialized with
PhotoSummarySerializer, which carries the exact GPS coordinates, the place
name and the capture time, and the album's own ``date``/``location`` and the
date groups were filled from the same data. So anyone holding the link, with
no account, read the coordinates of every photo in an album whose owner had
chosen not to share locations. Both anonymous album routes had it: the slug
page and ``/api/albums/user/<id>/?public=true``.
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import create_test_photo, create_test_user

LAT, LON = 52.520008, 13.404954
PLACE = "Alexanderplatz, Berlin"
TAKEN = datetime.datetime(2021, 6, 5, 14, 30, tzinfo=datetime.timezone.utc)


class PublicAlbumSharingSettingsTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.photo = create_test_photo(
            owner=self.owner,
            exif_gps_lat=LAT,
            exif_gps_lon=LON,
            exif_timestamp=TAKEN,
            search_location=PLACE,
        )
        self.album = AlbumUser.objects.create(title="holiday", owner=self.owner)
        self.album.photos.add(self.photo)
        self.share = AlbumUserShare.objects.create(album=self.album, enabled=True)
        self.anonymous = APIClient()
        self.anonymous.force_authenticate(user=None)

    def _slug_payload(self):
        response = self.anonymous.get(f"/api/public/albums/s/{self.share.slug}/")
        self.assertEqual(200, response.status_code)
        return response.json()["results"]

    def _public_retrieve_payload(self):
        response = self.anonymous.get(f"/api/albums/user/{self.album.id}/?public=true")
        self.assertEqual(200, response.status_code)
        return response.json()

    def _items(self, album):
        return [item for group in album["grouped_photos"] for item in group["items"]]

    def assertNothingWithheldIsSent(self, album):
        # The photo itself is still listed: the album is public.
        items = self._items(album)
        self.assertEqual([self.photo.image_hash], [i["image_hash"] for i in items])
        for item in items:
            self.assertIsNone(item["exif_gps_lat"])
            self.assertIsNone(item["exif_gps_lon"])
            self.assertEqual("", item["location"])
            self.assertEqual("", item["date"])
            self.assertEqual("", item["birthTime"])
        for group in album["grouped_photos"]:
            self.assertIsNone(group["date"])
            self.assertEqual("", group["location"])
        self.assertEqual("", album["location"])
        self.assertEqual("", album["date"])
        # Belt and braces: none of the withheld values appears anywhere.
        text = str(album)
        self.assertNotIn(str(LAT), text)
        self.assertNotIn("Alexanderplatz", text)
        self.assertNotIn("2021-06-05", text)

    def test_slug_page_withholds_location_and_time_by_default(self):
        self.assertNothingWithheldIsSent(self._slug_payload())

    def test_public_album_retrieve_withholds_location_and_time_by_default(self):
        self.assertNothingWithheldIsSent(self._public_retrieve_payload())

    def test_owner_defaults_are_honoured(self):
        # Opting out at the album level beats an owner default that shares.
        self.owner.public_sharing_defaults = {
            "share_location": True,
            "share_timestamps": True,
        }
        self.owner.save()
        self.share.share_location = False
        self.share.share_timestamps = False
        self.share.save()

        self.assertNothingWithheldIsSent(self._slug_payload())

    def test_opted_in_album_still_shares_location_and_time(self):
        self.share.share_location = True
        self.share.share_timestamps = True
        self.share.save()

        album = self._slug_payload()

        (item,) = self._items(album)
        self.assertAlmostEqual(LAT, item["exif_gps_lat"])
        self.assertAlmostEqual(LON, item["exif_gps_lon"])
        self.assertEqual(PLACE, item["location"])
        self.assertTrue(item["date"].startswith("2021-06-05"))
        self.assertTrue(album["grouped_photos"][0]["date"].startswith("2021-06-05"))
        self.assertEqual(PLACE, album["location"])

    def test_location_and_time_are_switched_independently(self):
        self.share.share_location = True
        self.share.save()

        (item,) = self._items(self._slug_payload())
        self.assertAlmostEqual(LAT, item["exif_gps_lat"])
        self.assertEqual(PLACE, item["location"])
        self.assertEqual("", item["date"])

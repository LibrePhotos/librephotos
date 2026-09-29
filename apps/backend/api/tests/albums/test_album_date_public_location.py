"""The public timeline must not name places from a day's private photos.

A day album's ``location`` is the city list the geocoder collects from every
photo of that day (``add_location_to_album_dates``), private ones included.
``/api/albums/date/list/?public=true`` and ``/api/albums/date/<id>/?public=true``
are open to anonymous callers and returned that stored value as the day's
``location``. So as soon as a user made a single photo of a day public, anyone
without an account could read where they were that day according to their
private photos, even when the public photo itself carries no location at all.

In the public view the place is now taken from the day's public photos only.
"""

import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.geocode.photo_location import add_location_to_album_dates
from api.models.album_date import AlbumDate
from api.tests.utils import create_test_photo, create_test_user


def geolocation(city):
    return {"places": ["Main Street 1", city, "Country"], "features": []}


class AlbumDatePublicLocationTest(TestCase):
    def setUp(self):
        self.owner = create_test_user(public_sharing=True)
        taken = timezone.make_aware(datetime.datetime(2021, 6, 5, 14, 30))
        self.day = AlbumDate.objects.create(
            owner=self.owner, date=datetime.date(2021, 6, 5)
        )
        self.private_photo = create_test_photo(
            owner=self.owner,
            exif_timestamp=taken,
            public=False,
            geolocation_json=geolocation("SecretTown"),
        )
        self.public_photo = create_test_photo(
            owner=self.owner, exif_timestamp=taken, public=True
        )
        self.day.photos.add(self.private_photo, self.public_photo)
        # What the geolocation job stores for the day: the private photo's city.
        add_location_to_album_dates(self.private_photo)
        self.day.refresh_from_db()
        self.assertEqual({"places": ["SecretTown"]}, self.day.location)

        self.anonymous = APIClient()
        self.anonymous.force_authenticate(user=None)

    def _public_list_location(self):
        response = self.anonymous.get(
            "/api/albums/date/list/",
            {"public": "true", "username": self.owner.username},
        )
        self.assertEqual(200, response.status_code)
        (day,) = response.json()["results"]
        self.assertEqual(str(self.day.id), day["id"])
        return day["location"]

    def _public_detail_location(self):
        response = self.anonymous.get(
            f"/api/albums/date/{self.day.id}/",
            {"public": "true", "username": self.owner.username},
        )
        self.assertEqual(200, response.status_code)
        results = response.json()["results"]
        self.assertEqual(
            [str(self.public_photo.id)], [i["id"] for i in results["items"]]
        )
        return results["location"]

    def test_public_list_does_not_name_the_private_photos_place(self):
        self.assertEqual("", self._public_list_location())

    def test_public_detail_does_not_name_the_private_photos_place(self):
        self.assertEqual("", self._public_detail_location())

    def test_public_view_names_the_public_photos_place(self):
        self.public_photo.geolocation_json = geolocation("PublicTown")
        self.public_photo.save()
        add_location_to_album_dates(self.public_photo)

        self.assertEqual("PublicTown", self._public_list_location())
        self.assertEqual("PublicTown", self._public_detail_location())

    def test_owner_still_sees_the_stored_place(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)

        listed = client.get("/api/albums/date/list/").json()["results"]
        detail = client.get(f"/api/albums/date/{self.day.id}/").json()["results"]

        self.assertEqual(["SecretTown"], [day["location"] for day in listed])
        self.assertEqual("SecretTown", detail["location"])

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_photos, create_test_user


class PhotoListWithoutLocationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def _listed_ids(self, url="/api/photos/nolocation/"):
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        return {photo["id"] for photo in response.json()["results"]}

    def test_lists_photos_without_gps_coordinates(self):
        without = create_test_photo(owner=self.user)
        create_test_photo(owner=self.user, exif_gps_lat=52.52, exif_gps_lon=13.40)

        self.assertEqual(self._listed_ids(), {str(without.pk)})

    def test_a_photo_missing_one_coordinate_has_no_location(self):
        no_lon = create_test_photo(owner=self.user, exif_gps_lat=52.52)
        no_lat = create_test_photo(owner=self.user, exif_gps_lon=13.40)

        self.assertEqual(self._listed_ids(), {str(no_lon.pk), str(no_lat.pk)})

    def test_coordinates_that_did_not_geocode_still_count_as_a_location(self):
        create_test_photo(
            owner=self.user, exif_gps_lat=0.0, exif_gps_lon=0.0, geolocation_json={}
        )

        self.assertEqual(self._listed_ids(), set())

    def test_leaves_out_other_users_photos(self):
        create_test_photo(owner=create_test_user())

        self.assertEqual(self._listed_ids(), set())

    def test_leaves_out_hidden_and_trashed_photos(self):
        create_test_photo(owner=self.user, hidden=True)
        create_test_photo(owner=self.user, in_trashcan=True)

        self.assertEqual(self._listed_ids(), set())

    def test_lists_the_oldest_added_first(self):
        now = timezone.now()
        newer = create_test_photo(owner=self.user, added_on=now)
        older = create_test_photo(owner=self.user, added_on=now - timedelta(days=1))

        response = self.client.get("/api/photos/nolocation/")

        self.assertEqual(
            [photo["id"] for photo in response.json()["results"]],
            [str(older.pk), str(newer.pk)],
        )

    def test_searches_the_captions(self):
        beach = create_test_photo(owner=self.user, search_captions="beach")
        create_test_photo(owner=self.user, search_captions="mountain")

        self.assertEqual(
            self._listed_ids("/api/photos/nolocation/?search=beach"), {str(beach.pk)}
        )

    def test_pages_the_list(self):
        create_test_photos(number_of_photos=3, owner=self.user)

        response = self.client.get("/api/photos/nolocation/?page=2&page_size=2")
        json = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json["count"], 3)
        self.assertEqual(len(json["results"]), 1)

    def test_needs_a_signed_in_user(self):
        response = APIClient().get("/api/photos/nolocation/")

        self.assertEqual(response.status_code, 401)

from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models.album_place import AlbumPlace
from api.models.photo_search import PhotoSearch
from api.tests.utils import create_test_photo, create_test_user


class EditPhotoDetailsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    @patch("api.metadata.edits.extract_date_time", autospec=True)
    def test_should_update_timestamp(self, extract_date_time_from_exif_mock):
        photo = create_test_photo(owner=self.user1)

        payload = {"exif_timestamp": "1970-01-01T00:00:00.001Z"}
        headers = {"Content-Type": "application/json"}
        response = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertEqual(200, response.status_code)
        self.assertEqual("1970-01-01T00:00:00.001000Z", data["timestamp"])
        self.assertEqual(photo.image_hash, data["image_hash"])
        self.assertIsNone(data["exif_timestamp"])
        self.assertEqual(0, data["rating"])
        self.assertFalse(data["hidden"])
        self.assertFalse(data["in_trashcan"])
        self.assertFalse(data["video"])
        extract_date_time_from_exif_mock.assert_called()

    @patch("api.metadata.edits.extract_date_time", autospec=True)
    def test_should_not_update_other_properties(self, extract_date_time_from_exif_mock):
        photo = create_test_photo(owner=self.user1)

        payload = {
            "timestamp": "1970-01-01T00:00:00.001Z",
            "image_hash": "BLAH-BLAH-BLAH-BLAH",
            "rating": 100,
            "deleted": True,
            "hidden": True,
            "in_trashcan": True,
            "video": True,
        }
        headers = {"Content-Type": "application/json"}
        response = self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertEqual(200, response.status_code)
        self.assertNotEqual(payload["timestamp"], data["timestamp"])
        self.assertNotEqual(payload["image_hash"], data["image_hash"])
        # Deliberately ignored: ratings go through /api/photosedit/rating/, which
        # bumps last_modified for the mobile delta sync and writes the rating to
        # disk like a favorite (test_photo_rating_endpoint).
        self.assertNotEqual(payload["rating"], data["rating"])
        self.assertNotEqual(payload["hidden"], data["hidden"])
        self.assertNotEqual(payload["in_trashcan"], data["in_trashcan"])
        self.assertNotEqual(payload["video"], data["video"])
        extract_date_time_from_exif_mock.assert_not_called()


LISBON = {
    "features": [{"text": "Lisbon"}, {"text": "Portugal"}],
    "places": ["Lisbon", "Portugal"],
    "address": "Lisbon, Portugal",
}
MADRID = {
    "features": [{"text": "Madrid"}, {"text": "Spain"}],
    "places": ["Madrid", "Spain"],
    "address": "Madrid, Spain",
}


class MoveLocationWithoutGeocodeTest(TestCase):
    """#2253: a moved photo kept its old place when the geocoder gave nothing.

    The new coordinates were saved, but the address, the search location and
    the Places albums stayed those of the old coordinates, and the response
    said nothing about it.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        with patch("api.metadata.edits.reverse_geocode", return_value=dict(LISBON)):
            response = self._move(38.7, -9.1)
        self.assertTrue(response.json()["geocoded"])
        self.lisbon = AlbumPlace.objects.get(owner=self.user, title="Lisbon")

    def _move(self, lat, lon):
        response = self.client.patch(
            f"/api/photos/edit/{self.photo.image_hash}/",
            {"exif_gps_lat": lat, "exif_gps_lon": lon},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        return response

    def _search_location(self):
        return PhotoSearch.objects.get(photo=self.photo).search_location

    def assert_old_place_forgotten(self, response):
        self.photo.refresh_from_db()
        self.assertEqual(
            (self.photo.exif_gps_lat, self.photo.exif_gps_lon), (36.5, -6.3)
        )
        self.assertEqual(self.photo.geolocation_json, {})
        self.assertEqual(self._search_location(), "")
        self.assertFalse(self.lisbon.photos.filter(pk=self.photo.pk).exists())
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())
        self.assertIs(response.json()["geocoded"], False)

    def test_an_empty_geocode_result_forgets_the_old_place(self):
        with patch("api.metadata.edits.reverse_geocode", return_value={}):
            response = self._move(36.5, -6.3)

        self.assert_old_place_forgotten(response)

    def test_a_geocoder_error_forgets_the_old_place(self):
        with patch(
            "api.metadata.edits.reverse_geocode", side_effect=RuntimeError("boom")
        ):
            response = self._move(36.5, -6.3)

        self.assert_old_place_forgotten(response)

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    def test_reverse_geocoding_turned_off_forgets_the_old_place(self):
        response = self._move(36.5, -6.3)

        self.assert_old_place_forgotten(response)

    def test_a_geocoded_move_sets_the_new_place(self):
        with patch("api.metadata.edits.reverse_geocode", return_value=dict(MADRID)):
            response = self._move(40.4, -3.7)

        self.assertIs(response.json()["geocoded"], True)
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.geolocation_json["address"], "Madrid, Spain")
        self.assertEqual(self._search_location(), "Madrid, Spain")
        self.assertEqual(
            set(
                AlbumPlace.objects.filter(photos=self.photo).values_list(
                    "title", flat=True
                )
            ),
            {"Madrid", "Spain"},
        )

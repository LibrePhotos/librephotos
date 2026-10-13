from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.geocode.geocode import no_place
from api.models.album_place import AlbumPlace
from api.models.photo_metadata import MetadataEdit
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


class RemoveLocationTest(TestCase):
    """#2209: both coordinates null removes the location; the place goes too."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        with patch("api.metadata.edits.reverse_geocode", return_value=dict(LISBON)):
            self._patch({"exif_gps_lat": 38.7, "exif_gps_lon": -9.1})
        self.photo.refresh_from_db()

    def _patch(self, data, photo=None):
        photo = photo or self.photo
        return self.client.patch(
            f"/api/photos/edit/{photo.image_hash}/", data, format="json"
        )

    def _place_titles(self):
        response = self.client.get("/api/albums/place/list/")
        return {album["title"] for album in response.json()["results"]}

    def test_both_null_removes_the_location_and_its_place(self):
        self.assertEqual(self._place_titles(), {"Lisbon", "Portugal"})

        response = self._patch({"exif_gps_lat": None, "exif_gps_lon": None})

        self.assertEqual(response.status_code, 200)
        self.assertIs(response.json()["geocoded"], False)
        self.photo.refresh_from_db()
        self.assertIsNone(self.photo.exif_gps_lat)
        self.assertIsNone(self.photo.exif_gps_lon)
        self.assertIsNone(self.photo.geolocation_json)
        self.assertEqual(self.photo.location_source, "user")
        self.assertEqual(PhotoSearch.objects.get(photo=self.photo).search_location, "")
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())
        # The emptied Places albums are not listed.
        self.assertEqual(self._place_titles(), set())
        edit = MetadataEdit.objects.filter(photo=self.photo).first()
        assert edit is not None
        self.assertEqual(edit.field_name, "location")
        self.assertEqual(edit.old_value, {"latitude": 38.7, "longitude": -9.1})
        self.assertIsNone(edit.new_value)

    def test_a_patch_without_the_coordinates_keeps_the_location(self):
        response = self._patch({"hidden": True})

        self.assertEqual(response.status_code, 200)
        self.photo.refresh_from_db()
        self.assertEqual(
            (self.photo.exif_gps_lat, self.photo.exif_gps_lon), (38.7, -9.1)
        )

    def test_half_an_edit_is_a_400(self):
        for data in (
            {"exif_gps_lat": None, "exif_gps_lon": -9.0},
            {"exif_gps_lat": 38.0, "exif_gps_lon": None},
            {"exif_gps_lat": None},
            {"exif_gps_lon": 10.0},
        ):
            with self.subTest(data=data):
                self.assertEqual(self._patch(data).status_code, 400)
        self.photo.refresh_from_db()
        self.assertEqual(
            (self.photo.exif_gps_lat, self.photo.exif_gps_lon), (38.7, -9.1)
        )

    def test_coordinates_out_of_range_are_a_400(self):
        for data in (
            {"exif_gps_lat": 90.5, "exif_gps_lon": 0},
            {"exif_gps_lat": 0, "exif_gps_lon": -180.5},
        ):
            with self.subTest(data=data):
                self.assertEqual(self._patch(data).status_code, 400)

    def test_removing_no_location_changes_nothing(self):
        photo = create_test_photo(owner=self.user)

        response = self._patch({"exif_gps_lat": None, "exif_gps_lon": None}, photo)

        self.assertEqual(response.status_code, 200)
        photo.refresh_from_db()
        # The file may still give it one on the next scan.
        self.assertIsNone(photo.location_source)
        self.assertFalse(MetadataEdit.objects.filter(photo=photo).exists())

    def test_another_users_photo_keeps_its_location(self):
        other = create_test_user()
        photo = create_test_photo(owner=other, exif_gps_lat=1.0, exif_gps_lon=2.0)

        response = self._patch({"exif_gps_lat": None, "exif_gps_lon": None}, photo)

        self.assertEqual(response.status_code, 404)
        photo.refresh_from_db()
        self.assertEqual((photo.exif_gps_lat, photo.exif_gps_lon), (1.0, 2.0))


class GeocodeStatusTest(TestCase):
    """A location edit says how the place lookup went (#2589).

    ``geocoded`` is False both when the lookup failed and when it worked but
    the provider has no place at the position (open sea, ``no_place()``), so
    the web app warned "the place name could not be looked up" about a lookup
    that had worked. ``geocode_status`` tells the two apart.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    def _patch(self, data):
        response = self.client.patch(
            f"/api/photos/edit/{self.photo.image_hash}/", data, format="json"
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def _move(self, geocode_result):
        with patch("api.metadata.edits.reverse_geocode", return_value=geocode_result):
            return self._patch({"exif_gps_lat": 0.5, "exif_gps_lon": -30.0})

    def test_a_place_found(self):
        data = self._move(dict(MADRID))

        self.assertEqual("found", data["geocode_status"])
        self.assertIs(True, data["geocoded"])

    def test_a_position_with_no_place_is_not_a_failed_lookup(self):
        data = self._move(no_place())

        self.assertEqual("no_place", data["geocode_status"])
        self.assertIs(False, data["geocoded"])

    def test_a_failed_lookup(self):
        data = self._move({})

        self.assertEqual("failed", data["geocode_status"])
        self.assertIs(False, data["geocoded"])

    def test_a_photo_without_a_position_has_no_status(self):
        data = self._patch({"hidden": False})

        self.assertIsNone(data["geocode_status"])

    def test_a_removed_location_has_no_status(self):
        self._move(dict(MADRID))

        data = self._patch({"exif_gps_lat": None, "exif_gps_lon": None})

        self.assertIsNone(data["geocode_status"])

"""Setting the location of selected photos at once (#2279)."""

import datetime
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.geocode.geocode import no_place
from api.metadata import edits
from api.metadata.jobs import write_photo_fields
from api.models import Photo, User
from api.models.album_place import AlbumPlace
from api.models.photo import LocationSource
from api.models.photo_metadata import MetadataEdit
from api.models.photo_search import PhotoSearch
from api.tests.utils import create_test_photo, create_test_user

PORTO = {
    "features": [{"text": "Ribeira"}, {"text": "Porto"}, {"text": "Portugal"}],
    "places": ["Ribeira", "Porto", "Portugal"],
    "address": "Ribeira, Porto, Portugal",
}
LISBON = {
    "features": [{"text": "Lisbon"}, {"text": "Portugal"}],
    "places": ["Lisbon", "Portugal"],
    "address": "Lisbon, Portugal",
}
URL = "/api/photosedit/location/"


def geocoder(result):
    return patch("api.metadata.edits.reverse_geocode", return_value=dict(result))


class BulkSetLocationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photos = [create_test_photo(owner=self.user) for _ in range(3)]

    def _hashes(self, photos):
        return [photo.image_hash for photo in photos]

    def _post(self, body):
        return self.client.post(URL, body, format="json")

    def _locate(self, photo, place, lat=38.7, lon=-9.1):
        with geocoder(place):
            edits.set_location(photo, lat, lon, self.user)

    def test_every_photo_gets_the_location_its_place_and_search_location(self):
        with geocoder(PORTO) as reverse:
            response = self._post(
                {"image_hashes": self._hashes(self.photos), "lat": 41.14, "lon": -8.61}
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"count": 3, "skipped_with_location": 0, "geocoded": True},
        )
        reverse.assert_called_once_with(41.14, -8.61)
        porto = AlbumPlace.objects.get(owner=self.user, title="Porto")
        self.assertEqual(porto.geolocation_level, 2)
        for photo in self.photos:
            photo.refresh_from_db()
            self.assertEqual((photo.exif_gps_lat, photo.exif_gps_lon), (41.14, -8.61))
            self.assertEqual((photo.geocoded_lat, photo.geocoded_lon), (41.14, -8.61))
            self.assertEqual(photo.location_source, LocationSource.USER)
            self.assertEqual(photo.geolocation_json["address"], PORTO["address"])
            self.assertEqual(
                PhotoSearch.objects.get(photo=photo).search_location,
                "Ribeira, Porto, Portugal",
            )
            self.assertTrue(porto.photos.filter(pk=photo.pk).exists())

    def test_each_moved_photo_is_in_the_edit_history(self):
        with geocoder(PORTO):
            self._post(
                {"image_hashes": self._hashes(self.photos), "lat": 41.14, "lon": -8.61}
            )

        edits_made = MetadataEdit.objects.filter(field_name="location")
        self.assertEqual(
            {edit.photo_id for edit in edits_made}, {p.id for p in self.photos}
        )
        for edit in edits_made:
            self.assertIsNone(edit.old_value)
            self.assertEqual(edit.new_value, {"latitude": 41.14, "longitude": -8.61})

    def test_one_write_back_job_takes_every_moved_photo(self):
        User.objects.filter(pk=self.user.pk).update(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        self.user.refresh_from_db()
        located = self.photos[0]
        self._locate(located, LISBON)

        with (
            geocoder(PORTO),
            patch("api.metadata.jobs.enqueue_task") as queued,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post(
                {"image_hashes": self._hashes(self.photos), "lat": 41.14, "lon": -8.61}
            )

        queued.assert_called_once()
        task, photo_ids, field, use_sidecar = queued.call_args.args
        self.assertEqual(
            (task, field, use_sidecar), (write_photo_fields, "location", True)
        )
        self.assertEqual(set(photo_ids), {p.id for p in self.photos[1:]})

    def test_without_overwrite_a_located_photo_keeps_its_location(self):
        located = self.photos[0]
        self._locate(located, LISBON)

        with geocoder(PORTO):
            response = self._post(
                {"image_hashes": self._hashes(self.photos), "lat": 41.14, "lon": -8.61}
            )

        self.assertEqual(
            response.json(),
            {"count": 2, "skipped_with_location": 1, "geocoded": True},
        )
        located.refresh_from_db()
        self.assertEqual((located.exif_gps_lat, located.exif_gps_lon), (38.7, -9.1))
        self.assertTrue(
            AlbumPlace.objects.get(title="Lisbon").photos.filter(pk=located.pk).exists()
        )

    def test_overwrite_moves_a_located_photo_and_its_place_goes(self):
        located = self.photos[0]
        self._locate(located, LISBON)

        with geocoder(PORTO):
            response = self._post(
                {
                    "image_hashes": self._hashes(self.photos),
                    "lat": 41.14,
                    "lon": -8.61,
                    "overwrite": True,
                }
            )

        self.assertEqual(
            response.json(),
            {"count": 3, "skipped_with_location": 0, "geocoded": True},
        )
        located.refresh_from_db()
        self.assertEqual((located.exif_gps_lat, located.exif_gps_lon), (41.14, -8.61))
        self.assertFalse(
            AlbumPlace.objects.filter(title="Lisbon").get().photos.exists()
        )
        # Portugal stays: the new place names it too.
        portugal = AlbumPlace.objects.get(title="Portugal")
        self.assertEqual(portugal.photos.count(), 3)
        self.assertIn(
            {"latitude": 38.7, "longitude": -9.1},
            [
                edit.old_value
                for edit in MetadataEdit.objects.filter(
                    photo=located, field_name="location"
                )
            ],
        )

    def test_another_users_photo_is_untouched(self):
        theirs = create_test_photo(owner=self.other)

        with geocoder(PORTO):
            response = self._post(
                {"image_hashes": [theirs.image_hash], "lat": 41.14, "lon": -8.61}
            )

        self.assertEqual(response.json()["count"], 0)
        theirs.refresh_from_db()
        self.assertIsNone(theirs.exif_gps_lat)
        self.assertFalse(MetadataEdit.objects.exists())

    def test_select_all_takes_the_query_minus_the_excluded_photos(self):
        hidden = create_test_photo(owner=self.user, hidden=True)
        excluded = self.photos[2]

        with geocoder(PORTO):
            response = self._post(
                {
                    "select_all": True,
                    "query": {"hidden": False},
                    "excluded_hashes": [excluded.image_hash],
                    "lat": 41.14,
                    "lon": -8.61,
                }
            )

        self.assertEqual(response.json()["count"], 2)
        moved = set(
            Photo.objects.filter(exif_gps_lat=41.14).values_list("pk", flat=True)
        )
        self.assertEqual(moved, {self.photos[0].pk, self.photos[1].pk})
        self.assertNotIn(hidden.pk, moved)

    def test_a_failed_lookup_keeps_the_coordinates_and_says_so(self):
        with patch(
            "api.metadata.edits.reverse_geocode", side_effect=RuntimeError("down")
        ):
            response = self._post(
                {"image_hashes": self._hashes(self.photos), "lat": 41.14, "lon": -8.61}
            )

        self.assertEqual(
            response.json(),
            {"count": 3, "skipped_with_location": 0, "geocoded": False},
        )
        photo = Photo.objects.get(pk=self.photos[0].pk)
        self.assertEqual((photo.exif_gps_lat, photo.exif_gps_lon), (41.14, -8.61))
        self.assertIsNone(photo.geocoded_lat)
        self.assertEqual(photo.geolocation_json, {})
        self.assertFalse(AlbumPlace.objects.exists())

    def test_a_spot_without_a_place_is_looked_up_not_failed(self):
        with geocoder(no_place()):
            response = self._post(
                {"image_hashes": self._hashes(self.photos), "lat": 30.0, "lon": -40.0}
            )

        self.assertIs(response.json()["geocoded"], True)
        photo = Photo.objects.get(pk=self.photos[0].pk)
        self.assertEqual((photo.geocoded_lat, photo.geocoded_lon), (30.0, -40.0))

    def test_nothing_to_move_does_not_look_up(self):
        for photo in self.photos:
            self._locate(photo, LISBON)

        with geocoder(PORTO) as reverse:
            response = self._post(
                {"image_hashes": self._hashes(self.photos), "lat": 41.14, "lon": -8.61}
            )

        self.assertEqual(
            response.json(),
            {"count": 0, "skipped_with_location": 3, "geocoded": False},
        )
        reverse.assert_not_called()

    def test_the_query_count_does_not_grow_with_the_photos(self):
        few = [create_test_photo(owner=self.user) for _ in range(2)]
        many = [create_test_photo(owner=self.user) for _ in range(8)]

        def queries(photos):
            with geocoder(PORTO), CaptureQueriesContext(connection) as context:
                self._post(
                    {"image_hashes": self._hashes(photos), "lat": 41.14, "lon": -8.61}
                )
            return len(context.captured_queries)

        queries(self.photos)  # Creates the Places albums.
        self.assertEqual(queries(few), queries(many))

    def test_invalid_coordinates_are_a_400(self):
        hashes = self._hashes(self.photos)
        bodies = [
            {"image_hashes": hashes, "lat": 91, "lon": 0},
            {"image_hashes": hashes, "lat": 0, "lon": -180.5},
            {"image_hashes": hashes, "lat": "41.1", "lon": 0},
            {"image_hashes": hashes, "lat": True, "lon": 0},
            {"image_hashes": hashes, "lon": 0},
            {"image_hashes": hashes, "lat": 0, "lon": 0, "overwrite": "true"},
            {"lat": 0, "lon": 0},
        ]
        for body in bodies:
            with self.subTest(body=body):
                self.assertEqual(self._post(body).status_code, 400)
        not_a_number = self.client.post(
            URL,
            '{"image_hashes": [], "lat": NaN, "lon": 0}',
            content_type="application/json",
        )
        self.assertEqual(not_a_number.status_code, 400)
        self.assertFalse(Photo.objects.filter(exif_gps_lat__isnull=False).exists())

    def test_anonymous_is_a_401(self):
        self.client.force_authenticate(user=None)
        response = self._post({"image_hashes": [], "lat": 0, "lon": 0})
        self.assertEqual(response.status_code, 401)


class LocationSummaryTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.taken = timezone.now() - datetime.timedelta(days=30)

    def _photo(self, hours, **kwargs):
        return create_test_photo(
            owner=self.user,
            exif_timestamp=self.taken + datetime.timedelta(hours=hours),
            **kwargs,
        )

    def _summary(self, body):
        response = self.client.post(
            "/api/photos/location-summary/", body, format="json"
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_counts_places_and_the_time_span(self):
        porto = [
            self._photo(
                h, exif_gps_lat=41.1, exif_gps_lon=-8.6, geolocation_json=dict(PORTO)
            )
            for h in (1, 2)
        ]
        lisbon = self._photo(
            3, exif_gps_lat=38.7, exif_gps_lon=-9.1, geolocation_json=dict(LISBON)
        )
        # Coordinates whose place was never looked up name no place.
        unnamed = self._photo(
            4, exif_gps_lat=1.0, exif_gps_lon=1.0, geolocation_json={}
        )
        bare = [self._photo(h) for h in (0, 5)]
        theirs = create_test_photo(
            owner=create_test_user(), exif_gps_lat=1.0, exif_gps_lon=1.0
        )

        summary = self._summary(
            {
                "image_hashes": [
                    p.image_hash for p in [*porto, lisbon, unnamed, *bare, theirs]
                ]
            }
        )

        self.assertEqual(summary["count"], 6)
        self.assertEqual(summary["with_location"], 4)
        self.assertEqual(
            summary["places"],
            [{"place": "Porto", "count": 2}, {"place": "Lisbon", "count": 1}],
        )
        first = datetime.datetime.fromisoformat(summary["first_taken"])
        last = datetime.datetime.fromisoformat(summary["last_taken"])
        self.assertEqual(first, bare[0].exif_timestamp)
        self.assertEqual(last, bare[1].exif_timestamp)

    def test_select_all_counts_each_photo_once(self):
        for hours in range(3):
            self._photo(hours)

        summary = self._summary({"select_all": True, "query": {}})

        self.assertEqual(summary["count"], 3)
        self.assertEqual(summary["with_location"], 0)
        self.assertEqual(summary["places"], [])


class LocatedNearbyInTimeTest(TestCase):
    URL = "/api/photos/located-nearby-in-time/"

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.middle = timezone.now() - datetime.timedelta(days=30)

    def _photo(self, hours, located=True, **kwargs):
        position = {"exif_gps_lat": 41.1, "exif_gps_lon": -8.6} if located else {}
        return create_test_photo(
            owner=kwargs.pop("owner", self.user),
            exif_timestamp=self.middle + datetime.timedelta(hours=hours),
            **position,
            **kwargs,
        )

    def _get(self, start_hours=-24, end_hours=24):
        return self.client.get(
            self.URL,
            {
                "from": (
                    self.middle + datetime.timedelta(hours=start_hours)
                ).isoformat(),
                "to": (self.middle + datetime.timedelta(hours=end_hours)).isoformat(),
            },
        )

    def test_only_own_located_photos_inside_the_window_nearest_first(self):
        far = self._photo(-20)
        near = self._photo(
            2, search_location="Ribeira, Porto", geolocation_json=dict(PORTO)
        )
        nearer = self._photo(-1)
        self._photo(1, located=False)
        self._photo(30)
        self._photo(0, owner=create_test_user())
        self._photo(0, hidden=True)

        response = self._get()

        self.assertEqual(response.status_code, 200)
        rows = response.json()
        self.assertEqual(
            [row["id"] for row in rows], [str(nearer.pk), str(near.pk), str(far.pk)]
        )
        self.assertEqual(rows[1]["place"], "Ribeira, Porto")
        self.assertEqual(rows[1]["short_place"], "Porto")
        self.assertIsNone(rows[0]["short_place"])
        self.assertEqual(rows[1]["image_hash"], near.image_hash)
        self.assertEqual(rows[1]["exif_gps_lat"], 41.1)

    def test_at_most_twenty(self):
        for hours in range(-15, 15):
            self._photo(hours)

        rows = self._get().json()

        self.assertEqual(len(rows), 20)
        offsets = [
            abs(datetime.datetime.fromisoformat(row["exif_timestamp"]) - self.middle)
            for row in rows
        ]
        self.assertEqual(offsets, sorted(offsets))
        self.assertLessEqual(max(offsets), datetime.timedelta(hours=10))

    def test_a_bad_window_is_a_400(self):
        self.assertEqual(self._get(5, -5).status_code, 400)
        self.assertEqual(self.client.get(self.URL, {"from": "x"}).status_code, 400)

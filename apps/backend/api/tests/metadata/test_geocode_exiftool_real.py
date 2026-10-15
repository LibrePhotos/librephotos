"""The exif sidecar's ``/geolocate`` against the real ExifTool (#2302).

The option and tag names are ExifTool's (``GeolocFeature``, ``GeolocMaxDist``,
``GeolocationCity``, ...), and a wrong one is silently ignored, so only the
real database can say the lookup asks what it means to. The places below
come from the database ExifTool 13.57 ships (GeoNames, 2026-04-07).
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import exiftool
import PIL.Image
from constance.test import override_config
from django.test import SimpleTestCase, TestCase

from api.geocode.photo_location import geocode_status, geolocate_photo, needs_geocoding
from api.models import Photo
from api.models.album_place import AlbumPlace
from api.models.photo_search import PhotoSearch
from api.tests.utils import create_test_photo, create_test_user
from service.exif import main as exif_main

EXIFTOOL = shutil.which("exiftool")
ZERMATT = (46.0207, 7.7591)
BERLIN_CENTRE = (52.5172, 13.4146)
MID_ATLANTIC = (40.0, -35.0)


class RealExifToolMixin:
    """The sidecar's Flask app on a real ExifTool process of its own."""

    et: exiftool.ExifTool

    @classmethod
    def start_exiftool(cls) -> None:
        cls.et = exiftool.ExifTool(EXIFTOOL)
        cls.et.start()

    def route_to_sidecar(self) -> None:
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()
        patcher = patch.object(exif_main, "static_et", self.et)
        patcher.start()
        self.addCleanup(patcher.stop)

    def geolocate(self, *points: tuple[float, float], **options: object) -> list:
        response = self.client.post(
            "/geolocate",
            json={"points": [{"lat": lat, "lon": lon} for lat, lon in points]}
            | options,
        )
        assert response.status_code == 200, response.get_json()
        return response.get_json()["places"]


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class GeolocateRealExifToolTest(RealExifToolMixin, SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.start_exiftool()
        cls.addClassCleanup(cls.et.terminate)

    def setUp(self):
        self.route_to_sidecar()

    def test_zermatt_has_every_level(self):
        (place,) = self.geolocate(ZERMATT, max_distance_km=50)
        self.assertEqual(place["GeolocationCity"], "Zermatt")
        self.assertEqual(place["GeolocationSubregion"], "Visp District")
        self.assertEqual(place["GeolocationRegion"], "Valais")
        self.assertEqual(place["GeolocationCountry"], "Switzerland")
        self.assertEqual(place["GeolocationCountryCode"], "CH")
        # -n: the distance is a number of km, the position "<lat> <lon>".
        self.assertLess(place["GeolocationDistance"], 2)
        lat, lon = (float(part) for part in place["GeolocationPosition"].split())
        self.assertAlmostEqual(lat, 46.02, places=1)
        self.assertAlmostEqual(lon, 7.75, places=1)

    def test_central_berlin_is_berlin_not_a_section_of_it(self):
        (place,) = self.geolocate(BERLIN_CENTRE)
        self.assertEqual(place["GeolocationCity"], "Berlin")
        self.assertNotEqual(place["GeolocationFeatureCode"], "PPLX")

    def test_no_town_within_the_cap_is_null_and_without_it_the_nearest(self):
        self.assertEqual(self.geolocate(MID_ATLANTIC, max_distance_km=50), [None])
        # The cap of one request does not stay on the process.
        (place,) = self.geolocate(MID_ATLANTIC)
        self.assertEqual(place["GeolocationCountry"], "Portugal")

    def test_a_batch_answers_in_order(self):
        places = self.geolocate(
            BERLIN_CENTRE, MID_ATLANTIC, ZERMATT, max_distance_km=50
        )
        self.assertEqual(
            [place and place["GeolocationCity"] for place in places],
            ["Berlin", None, "Zermatt"],
        )

    def test_a_latitude_out_of_range_is_a_400(self):
        response = self.client.post(
            "/geolocate", json={"points": [{"lat": 91, "lon": 0}]}
        )
        self.assertEqual(response.status_code, 400)

    def test_a_tag_read_after_a_lookup_has_no_geolocation(self):
        self.geolocate(ZERMATT)
        directory = tempfile.mkdtemp(prefix="librephotos-geolocate-")
        self.addCleanup(shutil.rmtree, directory, True)
        photo = os.path.join(directory, "a.jpg")
        PIL.Image.new("RGB", (8, 8)).save(photo)

        answer = self.et.execute_json("-Geolocation*", "-FileType", photo)

        self.assertEqual(answer[0].get("File:FileType"), "JPEG")
        self.assertFalse([key for key in answer[0] if "Geolocation" in key])
        # Without the feature filter of the lookup, central Berlin is Mitte.
        (place,) = self.et.execute_json(
            "-api", "geolocation=52.5172,13.4146", "-GeolocationCity"
        )
        self.assertEqual(place["ExifTool:GeolocationCity"], "Mitte")


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
@override_config(MAP_API_PROVIDER="exiftool")
class GeolocatePhotoRealExifToolTest(RealExifToolMixin, TestCase):
    """``geolocate_photo`` with the offline provider, through the real sidecar route."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.start_exiftool()
        cls.addClassCleanup(cls.et.terminate)

    def setUp(self):
        self.route_to_sidecar()
        patcher = patch(
            "api.geocode.exiftool_provider.sidecars.post", side_effect=self.post
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = create_test_user()

    def post(
        self, service: str, path: str, *, json: object, timeout: object
    ) -> MagicMock:
        """The backend's sidecar call, answered by the Flask app in-process."""
        self.assertEqual(service, "exif")
        response = self.client.post(path, json=json)
        self.assertEqual(response.status_code, 200, response.get_json())
        return MagicMock(json=MagicMock(return_value=response.get_json()))

    def photo_at(self, position: tuple[float, float]) -> Photo:
        return create_test_photo(
            owner=self.user, exif_gps_lat=position[0], exif_gps_lon=position[1]
        )

    def test_a_photo_joins_the_places_albums_of_its_town(self):
        photo = self.photo_at(ZERMATT)

        geolocate_photo(photo)
        photo.refresh_from_db()

        levels = dict(
            AlbumPlace.objects.filter(photos=photo).values_list(
                "title", "geolocation_level"
            )
        )
        self.assertEqual(
            levels,
            {"Zermatt": 4, "Visp District": 3, "Valais": 2, "Switzerland": 1},
        )
        self.assertEqual(photo.geolocation_json["provider"], "exiftool")
        self.assertEqual(photo.geolocation_json["country_code"], "CH")
        self.assertEqual(
            PhotoSearch.objects.get(photo=photo).search_location,
            "Zermatt, Visp District, Valais, Switzerland",
        )
        self.assertEqual(geocode_status(photo), "found")

    def test_a_photo_far_offshore_keeps_its_position_and_gets_no_place(self):
        photo = self.photo_at(MID_ATLANTIC)

        geolocate_photo(photo)
        photo.refresh_from_db()

        self.assertEqual((photo.exif_gps_lat, photo.exif_gps_lon), MID_ATLANTIC)
        self.assertEqual(photo.geolocation_json["places"], [])
        self.assertFalse(AlbumPlace.objects.filter(photos=photo).exists())
        self.assertEqual(geocode_status(photo), "no_place")
        # Looked up: the geolocation job does not ask for it again (#2264).
        self.assertFalse(Photo.objects.filter(needs_geocoding(), pk=photo.pk).exists())

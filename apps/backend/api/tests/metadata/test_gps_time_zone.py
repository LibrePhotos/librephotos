import csv
import io
import json
import shutil
import subprocess
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

import requests
from django.test import SimpleTestCase

from api.metadata.exiftool_client import ExifTool
from api.metadata.gps_time_zone import (
    MAX_DISTANCE_KM,
    nautical_time_zone,
    time_zone_name_at,
)
from api.metadata.reader import MetadataReadError
from api.models.time_zones import time_zone
from api.runtime import sidecars
from api.tests.metadata.exiftool_harness import _exif_service_post
from api.tests.sidecar_client import test_client

EXIFTOOL = shutil.which("exiftool")
FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "time_zones"
    / "timezonefinder_points.json"
)
COMPARED_AT = (datetime(2025, 1, 15, 12), datetime(2025, 7, 15, 12))
DIFFERENCES = {
    "little_diomede_us": "Asia/Anadyr",
    "kiritimati": "Etc/GMT+10",
    "northern_territory_outback": "Etc/GMT-9",
    "greenland_interior": "Etc/GMT+3",
    "canadian_arctic": "Etc/GMT+7",
    "wrangel_island": "Etc/GMT+12",
    "florida_straits": "America/New_York",
    "english_channel_mid": "Europe/London",
    "caspian_sea": "Asia/Baku",
    "south_pole": "Etc/GMT",
    "near_south_pole": "Etc/GMT-12",
}


def _offsets(name: str) -> tuple[timedelta | None, ...]:
    zone = ZoneInfo(name)
    return tuple(moment.replace(tzinfo=zone).utcoffset() for moment in COMPARED_AT)


def _answer(payload: object) -> MagicMock:
    response = MagicMock()
    response.json.return_value = payload
    return response


class NauticalTimeZoneTest(SimpleTestCase):
    def test_fifteen_degree_bands_centred_on_the_meridians(self):
        cases = {
            0.0: "Etc/GMT",
            7.49: "Etc/GMT",
            -7.5: "Etc/GMT",
            7.5: "Etc/GMT-1",
            -7.51: "Etc/GMT+1",
            100.0: "Etc/GMT-7",
            -40.0: "Etc/GMT+3",
            172.5: "Etc/GMT-12",
            180.0: "Etc/GMT-12",
            -179.99: "Etc/GMT+12",
        }
        for lon, expected in cases.items():
            with self.subTest(lon=lon):
                self.assertEqual(expected, nautical_time_zone(lon))

    def test_minus_180_is_the_antimeridian_east_of_it(self):
        self.assertEqual("Etc/GMT-12", nautical_time_zone(-180.0))

    def test_every_band_is_a_known_zone(self):
        for degrees in range(-180, 181):
            with self.subTest(lon=degrees):
                time_zone(nautical_time_zone(float(degrees)))


class TimeZoneNameAtTest(SimpleTestCase):
    def setUp(self):
        patcher = patch("api.metadata.gps_time_zone.sidecars.post")
        self.post = patcher.start()
        self.addCleanup(patcher.stop)

    def test_asks_the_exif_service_for_the_nearest_town_within_the_cutoff(self):
        self.post.return_value = _answer({"time_zones": ["Europe/Berlin"]})

        self.assertEqual("Europe/Berlin", time_zone_name_at(52.52, 13.4))

        self.post.assert_called_once()
        service, path = self.post.call_args.args
        self.assertEqual(("exif", "/time-zones"), (service, path))
        self.assertEqual(
            {
                "points": [{"lat": 52.52, "lon": 13.4}],
                "max_distance_km": MAX_DISTANCE_KM,
            },
            self.post.call_args.kwargs["json"],
        )

    def test_no_town_within_the_cutoff_is_the_nautical_zone(self):
        self.post.return_value = _answer({"time_zones": [None]})

        self.assertEqual("Etc/GMT+3", time_zone_name_at(30.0, -40.0))

    def test_an_unreachable_service_is_a_read_error(self):
        self.post.side_effect = requests.ConnectionError("refused")

        with self.assertRaises(MetadataReadError):
            time_zone_name_at(52.52, 13.4)

    def test_an_unusable_answer_is_a_read_error(self):
        for payload in (
            {},
            {"time_zones": "Europe/Berlin"},
            {"time_zones": []},
            {"time_zones": ["Europe/Berlin", "Europe/Paris"]},
            {"time_zones": [7]},
            ["Europe/Berlin"],
        ):
            with self.subTest(payload=payload):
                self.post.return_value = _answer(payload)
                with self.assertRaises(MetadataReadError):
                    time_zone_name_at(52.52, 13.4)


class TimeZonesRouteTest(SimpleTestCase):
    def setUp(self):
        from service.exif.main import app

        self.client = test_client(app)

    def test_rejects_points_it_cannot_look_up(self):
        for body in (
            {"points": "52,13"},
            {"points": [{"lat": 91, "lon": 0}]},
            {"points": [{"lat": "52.5", "lon": 13.4}]},
            {"points": [{"lat": 52.5, "lon": 13.4}], "max_distance_km": 0},
        ):
            with self.subTest(body=body):
                self.assertEqual(
                    400, self.client.post("/time-zones", json=body).status_code
                )

    def test_answers_one_zone_per_point_in_order(self):
        from service.exif import main as exif_service

        stand_in = MagicMock(running=True)
        stand_in.execute_json.side_effect = [
            [{"ExifTool:GeolocationTimeZone": "Europe/Berlin"}],
            [{"SourceFile": "-"}],
        ]
        with patch.object(exif_service, "static_et", stand_in):
            response = self.client.post(
                "/time-zones",
                json={
                    "points": [{"lat": 52.52, "lon": 13.4}, {"lat": 30, "lon": -40}],
                    "max_distance_km": 200,
                },
            )

        self.assertEqual(200, response.status_code)
        self.assertEqual({"time_zones": ["Europe/Berlin", None]}, response.get_json())
        first = stand_in.execute_json.call_args_list[0].args
        self.assertIn("geolocation=52.520000,13.400000", first)
        self.assertIn("GeolocMaxDist=200.000", first)
        self.assertIn("-GeolocationTimeZone", first)


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class TimezonefinderGoldenSetTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from service.exif import main as exif_service

        cls.exiftool = ExifTool()
        cls.exiftool.start()
        cls.addClassCleanup(cls.exiftool.terminate)
        in_process = SimpleNamespace(
            post=_exif_service_post, error_detail=sidecars.error_detail
        )
        for patcher in (
            patch("api.metadata.gps_time_zone.sidecars", in_process),
            patch.object(exif_service, "static_et", cls.exiftool),
        ):
            patcher.start()
            cls.addClassCleanup(patcher.stop)
        cls.golden = json.loads(FIXTURE.read_text(encoding="utf-8"))["points"]

    def test_offsets_match_timezonefinder_except_the_documented_differences(self):
        found = {
            point["name"]: time_zone_name_at(point["lat"], point["lon"])
            for point in self.golden
        }
        for point in self.golden:
            name = point["name"]
            with self.subTest(name):
                if name in DIFFERENCES:
                    self.assertEqual(DIFFERENCES[name], found[name])
                else:
                    self.assertEqual(
                        _offsets(point["timezonefinder"]), _offsets(found[name])
                    )

    def test_every_difference_is_a_point_of_the_golden_set(self):
        self.assertLessEqual(set(DIFFERENCES), {point["name"] for point in self.golden})

    def test_every_zone_of_the_database_is_known(self):
        listing = subprocess.run(
            [EXIFTOOL, "-listgeo"],
            capture_output=True,
            check=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        ).stdout
        rows = csv.reader(io.StringIO(listing.split("\n", 2)[2]))
        zones = {row[5] for row in rows if len(row) > 5}
        self.assertGreater(len(zones), 300)
        for zone in sorted(zones):
            with self.subTest(zone=zone):
                time_zone(zone)

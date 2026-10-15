"""The offline Map Provider, ExifTool's Geolocation database (#2302).

The sidecar route runs on a fake ExifTool here; ``test_geocode_exiftool_real``
asks the real one. The backend's provider is tested against a mocked sidecar
client, so nothing goes over the network.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import requests
from constance.test import override_config
from django.conf import settings
from django.test import SimpleTestCase, TestCase, override_settings

from api.geocode import EXIFTOOL_PROVIDER, GEOCODE_VERSION, exiftool_provider
from api.geocode.config import MAP_API_PROVIDERS, _get_config
from api.geocode.exiftool_provider import GeolocateError, lookup
from api.geocode.geocode import reverse_geocode, search_location, search_provider
from api.geocode.parsers.exiftool import no_place, parse
from api.geocode.rate_limit import _delay_for
from service.exif import main as exif_main
from service.exif.geolocate import lookup_args, parse_max_distance, parse_points

ZERMATT = {
    "GeolocationCity": "Zermatt",
    "GeolocationSubregion": "Visp District",
    "GeolocationRegion": "Valais",
    "GeolocationCountry": "Switzerland",
    "GeolocationCountryCode": "CH",
    "GeolocationPosition": "46.0200 7.7488",
    "GeolocationDistance": 0.8,
    "GeolocationFeatureCode": "PPL",
}
LISBON = {
    "GeolocationCity": "Lisbon",
    "GeolocationSubregion": "Lisbon",
    "GeolocationRegion": "Lisbon",
    "GeolocationCountry": "Portugal",
    "GeolocationCountryCode": "PT",
    "GeolocationPosition": "38.7251 -9.1499",
    "GeolocationDistance": 0.16,
    "GeolocationFeatureCode": "PPLC",
}
BERLIN = {
    "GeolocationCity": "Berlin",
    "GeolocationRegion": "State of Berlin",
    "GeolocationCountry": "Germany",
    "GeolocationCountryCode": "DE",
    "GeolocationPosition": "52.5244 13.4105",
    "GeolocationDistance": 0.85,
    "GeolocationFeatureCode": "PPLC",
}


class ExifToolParserTest(SimpleTestCase):
    def test_every_level_finest_first_with_its_type(self):
        center = [46.02, 7.7488]
        self.assertEqual(
            parse(ZERMATT, 46.0207, 7.7591),
            {
                "features": [
                    {"text": "Zermatt", "center": center, "place_type": "city"},
                    {
                        "text": "Visp District",
                        "center": center,
                        "place_type": "subregion",
                    },
                    {"text": "Valais", "center": center, "place_type": "region"},
                    {"text": "Switzerland", "center": center, "place_type": "country"},
                ],
                "places": ["Zermatt", "Visp District", "Valais", "Switzerland"],
                "address": "Zermatt, Visp District, Valais, Switzerland",
                "center": center,
                "provider": "exiftool",
                "country_code": "CH",
                "distance_km": 0.8,
                "_v": GEOCODE_VERSION,
            },
        )

    def test_a_repeated_name_is_one_feature_filed_as_the_finest_level(self):
        result = parse(LISBON, 38.7237, -9.1492)
        self.assertEqual(result["places"], ["Lisbon", "Portugal"])
        self.assertEqual(
            [feature["place_type"] for feature in result["features"]],
            ["city", "country"],
        )
        self.assertEqual(result["address"], "Lisbon, Portugal")

    def test_a_missing_level_is_left_out(self):
        result = parse(BERLIN, 52.5172, 13.4146)
        self.assertEqual(result["places"], ["Berlin", "State of Berlin", "Germany"])
        self.assertEqual(
            [feature["place_type"] for feature in result["features"]],
            ["city", "region", "country"],
        )

    def test_the_center_is_the_town_or_else_the_point_looked_up(self):
        self.assertEqual(parse(BERLIN, 52.5, 13.4)["center"], [52.5244, 13.4105])
        for position in (None, "", "52.5", "north east", 7):
            with self.subTest(position=position):
                answer = {**BERLIN, "GeolocationPosition": position}
                self.assertEqual(parse(answer, 52.5, 13.4)["center"], [52.5, 13.4])

    def test_no_town_within_reach_is_no_place(self):
        self.assertEqual(
            parse(None, 40, -35),
            {
                "features": [],
                "places": [],
                "address": "",
                "provider": "exiftool",
                "_v": GEOCODE_VERSION,
            },
        )
        self.assertEqual(parse({"GeolocationCity": " "}, 40, -35), no_place())
        # Stored, unlike a failed lookup ({}): the geolocation job keeps it.
        self.assertTrue(no_place())

    def test_a_country_code_or_distance_of_another_type_is_left_out(self):
        answer = {**BERLIN, "GeolocationCountryCode": 3, "GeolocationDistance": "far"}
        result = parse(answer, 52.5, 13.4)
        self.assertNotIn("country_code", result)
        self.assertNotIn("distance_km", result)
        result = parse({**BERLIN, "GeolocationDistance": True}, 52.5, 13.4)
        self.assertNotIn("distance_km", result)


def sidecar_answer(places: object) -> MagicMock:
    response = MagicMock()
    response.json.return_value = {"places": places}
    return response


@patch("api.geocode.exiftool_provider.sidecars.post")
class ExifToolProviderTest(SimpleTestCase):
    def test_asks_the_exif_sidecar_with_the_distance_cap(self, post):
        post.return_value = sidecar_answer([ZERMATT, None])

        self.assertEqual(lookup([(46.0, 7.7), (40.0, -35.0)]), [ZERMATT, None])

        post.assert_called_once()
        service, path = post.call_args.args
        self.assertEqual((service, path), ("exif", "/geolocate"))
        self.assertEqual(
            post.call_args.kwargs["json"],
            {
                "points": [{"lat": 46.0, "lon": 7.7}, {"lat": 40.0, "lon": -35.0}],
                "max_distance_km": 50,
            },
        )

    def test_reverse_parses_the_one_answer(self, post):
        post.return_value = sidecar_answer([BERLIN])
        self.assertEqual(
            exiftool_provider.reverse(52.5, 13.4), parse(BERLIN, 52.5, 13.4)
        )
        post.return_value = sidecar_answer([None])
        self.assertEqual(exiftool_provider.reverse(40, -35), no_place())

    def test_a_failed_call_or_an_unusable_answer_is_an_error(self, post):
        for failure in (
            requests.ConnectionError("refused"),
            requests.HTTPError("500"),
        ):
            with self.subTest(failure=failure):
                post.side_effect = failure
                with self.assertRaises(GeolocateError):
                    lookup([(1.0, 2.0)])
        post.side_effect = None
        for places in ([], [None, None], "Berlin", [["Berlin"]], None):
            with self.subTest(places=places):
                post.return_value = sidecar_answer(places)
                with self.assertRaises(GeolocateError):
                    lookup([(1.0, 2.0)])
        post.return_value = MagicMock(json=MagicMock(side_effect=ValueError("html")))
        with self.assertRaises(GeolocateError):
            lookup([(1.0, 2.0)])


@override_config(MAP_API_PROVIDER="exiftool")
@patch("api.geocode.exiftool_provider.sidecars.post")
class ExifToolReverseGeocodeTest(TestCase):
    @patch("api.geocode.rate_limit._sleep")
    @patch("geopy.get_geocoder_for_service")
    def test_answers_without_geopy_or_waiting(self, get_geocoder, sleep, post):
        post.return_value = sidecar_answer([ZERMATT])

        for _ in range(3):
            self.assertEqual(
                reverse_geocode(46.0207, 7.7591), parse(ZERMATT, 46.0207, 7.7591)
            )

        get_geocoder.assert_not_called()
        sleep.assert_not_called()
        self.assertEqual(_delay_for(EXIFTOOL_PROVIDER), 0)

    def test_no_town_is_no_place_and_a_failure_is_empty(self, post):
        post.return_value = sidecar_answer([None])
        self.assertEqual(reverse_geocode(40, -35), no_place())

        post.side_effect = requests.ConnectionError("exif sidecar is down")
        with self.assertLogs("api.geocode.geocode", "WARNING"):
            self.assertEqual(reverse_geocode(40, -35), {})

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    def test_reverse_geocoding_off_asks_nothing(self, post):
        self.assertEqual(reverse_geocode(46.0, 7.7), {})
        post.assert_not_called()


class ExifToolSearchTest(TestCase):
    @override_config(MAP_API_PROVIDER="exiftool")
    @patch("api.geocode.geocode.wait_for_provider")
    @patch("geopy.get_geocoder_for_service")
    def test_place_search_asks_nominatim_at_its_rate(self, get_geocoder, wait):
        geocoder = get_geocoder.return_value.return_value
        geocoder.geocode.return_value = [
            MagicMock(address="Lisboa, Portugal", latitude=38.72, longitude=-9.14)
        ]

        results = search_location("Lisbon", limit=3)

        self.assertEqual(
            results, [{"display_name": "Lisboa, Portugal", "lat": 38.72, "lon": -9.14}]
        )
        get_geocoder.assert_called_once_with("nominatim")
        wait.assert_called_once_with("nominatim")
        geocoder.geocode.assert_called_once_with("Lisbon", exactly_one=False, limit=3)

    def test_other_providers_search_themselves(self):
        for provider in ("nominatim", "mapbox", "tomtom"):
            with self.subTest(provider=provider):
                self.assertEqual(search_provider(provider), provider)
        self.assertEqual(search_provider("exiftool"), "nominatim")


class MapApiProvidersTest(TestCase):
    def test_the_admin_form_offers_every_provider_reverse_geocode_answers_for(self):
        field = settings.CONSTANCE_ADDITIONAL_FIELDS["map_api_provider"]
        choices = {value for value, _label in field[1]["choices"]}
        self.assertEqual(choices, set(MAP_API_PROVIDERS))
        self.assertEqual(set(MAP_API_PROVIDERS), {*_get_config(), EXIFTOOL_PROVIDER})


class FakeExifTool:
    """Answers each lookup from ``answers`` in turn and records its arguments."""

    def __init__(self, *answers: object) -> None:
        self.answers = list(answers)
        self.running = True
        self.calls: list[tuple[str, ...]] = []

    def execute_json(self, *params: str) -> object:
        self.calls.append(params)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def grouped(tags: dict[str, object]) -> list[dict[str, object]]:
    """``tags`` as ExifTool's ``-j -G`` answers them for a lookup."""
    return [{"SourceFile": " ", **{f"ExifTool:{k}": v for k, v in tags.items()}}]


class GeolocateRouteTest(SimpleTestCase):
    def setUp(self):
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()

    def use(self, fake: FakeExifTool) -> None:
        patcher = patch.object(exif_main, "static_et", fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_answers_one_place_per_point_in_order(self):
        fake = FakeExifTool(grouped(BERLIN), [{"SourceFile": " "}])
        self.use(fake)

        response = self.client.post(
            "/geolocate",
            json={
                "points": [{"lat": 52.5172, "lon": 13.4146}, {"lat": 40, "lon": -35}],
                "max_distance_km": 50,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"places": [BERLIN, None]})
        self.assertEqual(fake.calls[0], tuple(lookup_args((52.5172, 13.4146), 50)))
        self.assertIn("geolocation=40.000000,-35.000000", fake.calls[1])

    def test_malformed_points_are_a_400_and_reach_no_exiftool(self):
        fake = FakeExifTool()
        self.use(fake)
        for body in (
            {},
            {"points": {"lat": 1, "lon": 2}},
            {"points": [{"lat": 91, "lon": 0}]},
            {"points": [{"lat": 0, "lon": 180.5}]},
            {"points": [{"lat": "52.5", "lon": "13.4"}]},
            {"points": [{"lat": True, "lon": 0}]},
            {"points": [{"lat": 1}]},
            {"points": ["52.5,13.4"]},
            {"points": [{"lat": 1, "lon": 2}] * 1001},
            {"points": [{"lat": 1, "lon": 2}], "max_distance_km": 0},
            {"points": [{"lat": 1, "lon": 2}], "max_distance_km": "50"},
        ):
            with self.subTest(body=str(body)[:60]):
                response = self.client.post("/geolocate", json=body)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(fake.calls, [])

    def test_no_points_is_no_places(self):
        self.use(FakeExifTool())
        response = self.client.post("/geolocate", json={"points": []})
        self.assertEqual(response.get_json(), {"places": []})

    def test_an_exiftool_failure_is_a_500(self):
        for answer in (RuntimeError("broken pipe"), [], [1], {"a": 1}):
            with self.subTest(answer=answer):
                self.use(FakeExifTool(answer))
                with self.assertLogs("exif", level="ERROR"):
                    response = self.client.post(
                        "/geolocate", json={"points": [{"lat": 1, "lon": 2}]}
                    )
                self.assertEqual(response.status_code, 500)
                self.assertIn("error", response.get_json())


class GeolocateArgumentsTest(SimpleTestCase):
    def test_the_lookup_filters_town_sections_and_caps_the_distance(self):
        self.assertEqual(
            lookup_args((46.0207, -7.7591), 50),
            [
                "-api",
                "geolocation=46.020700,-7.759100",
                "-api",
                "GeolocFeature=-PPLX",
                "-api",
                "GeolocMaxDist=50.000",
                "-GeolocationCity",
                "-GeolocationSubregion",
                "-GeolocationRegion",
                "-GeolocationCountry",
                "-GeolocationCountryCode",
                "-GeolocationPosition",
                "-GeolocationDistance",
                "-GeolocationFeatureCode",
            ],
        )
        self.assertNotIn("GeolocMaxDist", " ".join(lookup_args((1e-9, 0), None)))
        self.assertIn("geolocation=0.000000,0.000000", lookup_args((1e-9, 0), None))

    def test_points_and_cap_are_read_as_numbers(self):
        self.assertEqual(
            parse_points([{"lat": -90, "lon": 180}, {"lat": 1.5, "lon": -2}]),
            [(-90.0, 180.0), (1.5, -2.0)],
        )
        self.assertIsNone(parse_max_distance(None))
        self.assertEqual(parse_max_distance(25), 25.0)
        for cap in (-1, float("inf"), float("nan"), False):
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                parse_max_distance(cap)

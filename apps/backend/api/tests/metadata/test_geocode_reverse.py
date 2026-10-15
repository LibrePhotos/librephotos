"""GET /api/geocode/reverse: the place name at a spot, before saving (#2283)."""

from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.geocode.geocode import reverse_geocode_label
from api.models.photo_search import place_label
from api.tests.utils import create_test_user

URL = "/api/geocode/reverse/"
BERLIN = {
    "features": [{"text": "Brandenburger Tor"}, {"text": "Berlin"}],
    "places": ["Brandenburger Tor", "Berlin"],
    "address": "Brandenburger Tor, Pariser Platz, Berlin",
}


@patch("api.geocode.geocode.reverse_geocode", return_value=dict(BERLIN))
class GeocodeReverseViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=create_test_user())

    def test_a_spot_answers_the_label_search_would_store(self, reverse):
        response = self.client.get(URL, {"lat": "52.5163", "lon": "13.3777"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"enabled": True, "place": "Brandenburger Tor, Pariser Platz, Berlin"},
        )
        reverse.assert_called_once_with(52.5163, 13.3777)

    def test_a_spot_without_a_name_answers_null(self, reverse):
        reverse.return_value = {}

        response = self.client.get(URL, {"lat": "0", "lon": "0"})

        self.assertEqual(response.json(), {"enabled": True, "place": None})

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    def test_reverse_geocoding_turned_off_asks_no_provider(self, reverse):
        response = self.client.get(URL, {"lat": "52.5", "lon": "13.4"})

        self.assertEqual(response.json(), {"enabled": False, "place": None})
        reverse.assert_not_called()

    def test_missing_or_out_of_range_coordinates_are_a_400(self, reverse):
        for query in (
            {},
            {"lat": "52.5"},
            {"lon": "13.4"},
            {"lat": "90.1", "lon": "0"},
            {"lat": "0", "lon": "-180.1"},
            {"lat": "nan", "lon": "0"},
            {"lat": "north", "lon": "0"},
        ):
            with self.subTest(query=query):
                response = self.client.get(URL, query)
                self.assertEqual(response.status_code, 400)
        reverse.assert_not_called()

    def test_anonymous_requests_are_refused(self, reverse):
        response = APIClient().get(URL, {"lat": "52.5", "lon": "13.4"})

        self.assertEqual(response.status_code, 401)
        reverse.assert_not_called()


class ReverseGeocodeLabelTest(TestCase):
    @override_config(MAP_API_PROVIDER="nominatim")
    @patch("api.geocode.geocode.wait_for_provider")
    @patch("api.geocode.geocode.Geocode")
    def test_the_provider_is_rate_limited_like_the_geolocation_job(self, geocode, wait):
        geocode.return_value.reverse.return_value = dict(BERLIN)

        label = reverse_geocode_label(52.5, 13.4)

        self.assertEqual(label, "Brandenburger Tor, Pariser Platz, Berlin")
        wait.assert_called_once()

    def test_place_label_falls_back_to_the_feature_names(self):
        self.assertEqual(
            place_label({"features": [{"text": "Lisbon"}, {}, {"text": "Portugal"}]}),
            "Lisbon, Portugal",
        )
        self.assertEqual(place_label(None), "")
        self.assertEqual(place_label({}), "")

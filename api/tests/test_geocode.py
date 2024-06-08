from unittest import TestCase
from unittest.mock import patch

from constance.test import override_config

from api.geocode.geocode import reverse_geocode
from api.geocode.parsers.mapbox import parse as parse_mapbox
from api.geocode.parsers.nominatim import parse as parse_nominatim
from api.geocode.parsers.opencage import parse as parse_opencage
from api.geocode.parsers.photon import parse as parse_photon
from api.geocode.parsers.tomtom import parse as parse_tomtom
from api.tests.fixtures.geocode.expectations.mapbox import (
    expectations as mapbox_expectations,
)
from api.tests.fixtures.geocode.expectations.nominatim import (
    expectations as nominatim_expectations,
)
from api.tests.fixtures.geocode.expectations.opencage import (
    expectations as opencage_expectations,
)
from api.tests.fixtures.geocode.expectations.photon import (
    expectations as photon_expectations,
)
from api.tests.fixtures.geocode.expectations.tomtom import (
    expectations as tomtom_expectations,
)
from api.tests.fixtures.geocode.responses.mapbox import responses as mapbox_responses
from api.tests.fixtures.geocode.responses.nominatim import (
    responses as nominatim_responses,
)
from api.tests.fixtures.geocode.responses.opencage import (
    responses as opencage_responses,
)
from api.tests.fixtures.geocode.responses.photon import responses as photon_responses
from api.tests.fixtures.geocode.responses.tomtom import responses as tomtom_responses


class MapboxLocation:
    def __init__(self, raw):
        self.raw = raw
        self.address = raw["place_name"]


class TomTomLocation:
    def __init__(self, raw):
        self.raw = raw
        self.address = raw["address"]["freeformAddress"]


class PhotonLocation:
    def __init__(self, raw):
        self.raw = raw
        self.address = self._get_address()

    def _get_address(self):
        data = self.raw["properties"]
        props = [
            "name",
            "housenumber",
            "street",
            "postcode",
            "street",  # yes, twice
            "city",
            "state",
            "country",
        ]
        return ", ".join([data[prop] for prop in props if prop in data])


class NominatimLocation:
    def __init__(self, raw):
        self.raw = raw
        self.address = raw["display_name"]


class OpenCageLocation:
    def __init__(self, raw):
        self.raw = raw
        self.address = raw["formatted"]


class TestGeocodeParsers(TestCase):
    def test_mapbox_parser(self):
        for index, raw in enumerate(mapbox_responses):
            self.assertEqual(
                parse_mapbox(MapboxLocation(raw)), mapbox_expectations[index]
            )

    def test_tomtom_parser(self):
        for index, raw in enumerate(tomtom_responses):
            self.assertEqual(
                parse_tomtom(TomTomLocation(raw)), tomtom_expectations[index]
            )

    def test_photon_parser(self):
        for index, raw in enumerate(photon_responses):
            self.assertEqual(
                parse_photon(PhotonLocation(raw)), photon_expectations[index]
            )

    def test_nominatim_parser(self):
        for index, raw in enumerate(nominatim_responses):
            self.assertEqual(
                parse_nominatim(NominatimLocation(raw)), nominatim_expectations[index]
            )

    def test_opencage_parser(self):
        for index, raw in enumerate(opencage_responses):
            self.assertEqual(
                parse_opencage(OpenCageLocation(raw)), opencage_expectations[index]
            )


class FakeLocation:
    raw = None
    address = None

    def __init__(self, location):
        self.raw = location
        self.address = location["place_name"]


class FakeProvider:
    def __init__(self, response):
        self.response = response

    def reverse(self, _):
        return FakeLocation(self.response)


def fake_geocoder(response):
    return lambda **_: FakeProvider(response)


class TestGeocoder(TestCase):
    @override_config(MAP_API_PROVIDER="mapbox")
    @patch("geopy.get_geocoder_for_service", autospec=True)
    def test_reverse_geocode(self, get_geocoder_for_service_mock):
        get_geocoder_for_service_mock.return_value = fake_geocoder(mapbox_responses[1])
        result = reverse_geocode(0, 0)
        self.assertEqual(result, mapbox_expectations[1])

    @override_config(MAP_API_PROVIDER="mapbox")
    @override_config(MAP_API_KEY="")
    def test_reverse_geocode_no_api_key(self):
        result = reverse_geocode(0, 0)
        print(result)
        self.assertEqual(result, {})

"""The keyword arguments the location search sends each online map provider.

geopy's ``geocode`` methods differ per provider: only Nominatim and TomTom
take ``limit``. OpenCage, Mapbox and MapTiler raise a TypeError for it, which
``search_location`` swallowed, so the location picker's search found nothing
with them. Each test patches the real geopy class's ``geocode`` with
``autospec``, so a keyword that provider does not take fails here as it does
against the real service.
"""

from unittest.mock import ANY, patch

import geopy
from constance.test import override_config
from django.test import TestCase
from geopy.location import Location

from api.geocode.geocode import search_location

ONLINE_PROVIDERS = ("nominatim", "tomtom", "opencage", "mapbox", "maptiler")


def places(count: int) -> list[Location]:
    return [Location(f"Place {n}", (48.0 + n, 2.0 + n), {}) for n in range(count)]


@patch("api.geocode.geocode.wait_for_provider")
class SearchArgsPerProviderTest(TestCase):
    def search(self, provider: str, limit: int, found: int):
        """Search ``Paris`` with ``provider`` answering ``found`` places;
        the results and the mocked ``geocode``."""
        service = geopy.get_geocoder_for_service(provider)
        with (
            override_config(
                MAP_API_PROVIDER=provider, MAP_API_KEY="test-key", GEOCODE_LANGUAGE=""
            ),
            patch.object(
                service, "geocode", autospec=True, return_value=places(found)
            ) as geocode,
        ):
            results = search_location("Paris", limit=limit)
        return results, geocode

    def test_nominatim_is_asked_for_the_limit(self, _wait):
        results, geocode = self.search("nominatim", 3, 3)
        geocode.assert_called_once_with(ANY, "Paris", exactly_one=False, limit=3)
        self.assertEqual(len(results), 3)

    def test_tomtom_is_asked_for_the_limit(self, _wait):
        results, geocode = self.search("tomtom", 3, 3)
        geocode.assert_called_once_with(ANY, "Paris", exactly_one=False, limit=3)
        self.assertEqual(len(results), 3)

    def test_opencage_gets_no_limit_and_the_answer_is_cut_to_it(self, _wait):
        results, geocode = self.search("opencage", 3, 10)
        geocode.assert_called_once_with(ANY, "Paris", exactly_one=False)
        self.assertEqual(
            [r["display_name"] for r in results], ["Place 0", "Place 1", "Place 2"]
        )

    def test_mapbox_gets_no_limit_and_the_answer_is_cut_to_it(self, _wait):
        results, geocode = self.search("mapbox", 2, 5)
        geocode.assert_called_once_with(ANY, "Paris", exactly_one=False)
        self.assertEqual(len(results), 2)

    def test_maptiler_gets_no_limit_and_the_answer_is_cut_to_it(self, _wait):
        results, geocode = self.search("maptiler", 2, 5)
        geocode.assert_called_once_with(ANY, "Paris", exactly_one=False)
        self.assertEqual(len(results), 2)

    def test_every_provider_returns_the_places_it_found(self, _wait):
        for provider in ONLINE_PROVIDERS:
            with self.subTest(provider=provider):
                results, _ = self.search(provider, 5, 1)
                self.assertEqual(
                    results, [{"display_name": "Place 0", "lat": 48.0, "lon": 2.0}]
                )

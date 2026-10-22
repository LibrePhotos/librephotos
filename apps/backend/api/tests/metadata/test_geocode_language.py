"""The place-name language of online map providers (GEOCODE_LANGUAGE, #2745).

geopy is mocked: each test reads the keyword arguments a provider's
``reverse`` and ``geocode`` were called with.
"""

from unittest.mock import MagicMock, patch

from constance.test import override_config
from django.test import SimpleTestCase, TestCase

from api.geocode.config import LANGUAGE_PROVIDERS, language_args
from api.geocode.geocode import reverse_geocode, search_location

ONE_LANGUAGE_PROVIDERS = ("opencage", "tomtom", "maptiler")


class LanguageArgsTest(SimpleTestCase):
    def test_an_empty_setting_asks_for_nothing(self):
        for provider in LANGUAGE_PROVIDERS:
            with self.subTest(provider=provider):
                self.assertEqual(language_args(provider, ""), {})

    def test_nominatim_takes_the_whole_list(self):
        self.assertEqual(language_args("nominatim", "de,en"), {"language": "de,en"})

    def test_the_others_take_the_first_language(self):
        for provider in ONE_LANGUAGE_PROVIDERS:
            with self.subTest(provider=provider):
                self.assertEqual(
                    language_args(provider, "pt-BR,en"), {"language": "pt-BR"}
                )
                self.assertEqual(language_args(provider, "de"), {"language": "de"})

    def test_mapbox_and_exiftool_cannot_be_asked(self):
        for provider in ("mapbox", "exiftool"):
            with self.subTest(provider=provider):
                self.assertEqual(language_args(provider, "de"), {})


@patch("api.geocode.geocode.wait_for_provider")
@patch("geopy.get_geocoder_for_service", autospec=True)
class GeocodeLanguageTest(TestCase):
    def _geocoder(self, get_geocoder_for_service: MagicMock) -> MagicMock:
        geocoder = get_geocoder_for_service.return_value.return_value
        # Nothing there: the parser is not needed to read the call
        geocoder.reverse.return_value = None
        geocoder.geocode.return_value = []
        return geocoder

    def test_reverse_asks_each_provider_in_its_form(self, get_geocoder, _wait):
        expected = {
            "nominatim": {"language": "de,en"},
            "opencage": {"language": "de"},
            "tomtom": {"language": "de"},
            "maptiler": {"language": "de"},
            "mapbox": {},
        }
        geocoder = self._geocoder(get_geocoder)
        for provider, kwargs in expected.items():
            with (
                self.subTest(provider=provider),
                override_config(
                    MAP_API_PROVIDER=provider,
                    MAP_API_KEY="test-key",
                    GEOCODE_LANGUAGE="de,en",
                ),
            ):
                geocoder.reverse.reset_mock()
                reverse_geocode(52.52, 13.4)
                geocoder.reverse.assert_called_once_with("52.52,13.4", **kwargs)

    @override_config(MAP_API_PROVIDER="nominatim", GEOCODE_LANGUAGE="")
    def test_an_empty_setting_sends_what_it_sent_before(self, get_geocoder, _wait):
        geocoder = self._geocoder(get_geocoder)
        reverse_geocode(52.52, 13.4)
        search_location("Berlin")
        geocoder.reverse.assert_called_once_with("52.52,13.4")
        geocoder.geocode.assert_called_once_with("Berlin", exactly_one=False, limit=5)

    @override_config(MAP_API_PROVIDER="tomtom", MAP_API_KEY="k", GEOCODE_LANGUAGE="fr")
    def test_search_asks_in_the_language_too(self, get_geocoder, _wait):
        geocoder = self._geocoder(get_geocoder)
        search_location("Paris")
        geocoder.geocode.assert_called_once_with(
            "Paris", exactly_one=False, limit=5, language="fr"
        )

    @override_config(MAP_API_PROVIDER="exiftool", GEOCODE_LANGUAGE="de")
    def test_the_offline_provider_works_with_a_language_set(self, get_geocoder, _wait):
        place = {"features": [], "places": ["Berlin"]}
        with patch(
            "api.geocode.geocode.exiftool_provider.reverse", return_value=place
        ) as offline:
            self.assertEqual(reverse_geocode(52.52, 13.4), place)
        offline.assert_called_once_with(52.52, 13.4)
        get_geocoder.assert_not_called()

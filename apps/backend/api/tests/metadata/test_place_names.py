"""One level of a reverse-geocoded place, for every Map Provider (#2302).

The day albums, the event titles, the location sunburst and the location
timeline used to pick a name by its position in ``features``/``places``. The
parsers stop at different depths, so a position named the town for one
provider and the region for another: ExifTool's Zermatt row put "Valais" on
the day album, and its Lisbon row (two names) was skipped by the sunburst.
``place_name`` reads the level each parser now types its features with, and
reads rows stored before that by position, as each consumer did.

The typed rows come from each parser run on its fixtures, the untyped ones are
copied from rows a Nominatim install stored.
"""

from __future__ import annotations

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from api.dataviz.stats import get_location_sunburst
from api.geocode.parsers.exiftool import parse as parse_exiftool
from api.geocode.parsers.mapbox import parse as parse_mapbox
from api.geocode.parsers.nominatim import parse as parse_nominatim
from api.geocode.parsers.opencage import parse as parse_opencage
from api.geocode.parsers.tomtom import parse as parse_tomtom
from api.geocode.photo_location import add_location_to_album_dates
from api.models.place_names import place_name, short_place_name, town_name
from api.serializers.album_date import _public_place
from api.tests.fixtures.geocode.responses.mapbox import responses as mapbox_responses
from api.tests.fixtures.geocode.responses.nominatim import (
    responses as nominatim_responses,
)
from api.tests.fixtures.geocode.responses.opencage import (
    responses as opencage_responses,
)
from api.tests.fixtures.geocode.responses.tomtom import responses as tomtom_responses
from api.tests.metadata.test_geocode_exiftool import BERLIN, LISBON, ZERMATT
from api.tests.metadata.test_geocode_providers import (
    MapboxLocation,
    NominatimLocation,
    OpenCageLocation,
    TomTomLocation,
)
from api.tests.utils import (
    create_test_album_auto,
    create_test_album_date,
    create_test_photo,
    create_test_user,
)


def _untyped(*names: str) -> dict[str, object]:
    """A row as every parser stored it before #2302: names only, finest first."""
    return {
        "_v": "1",
        "features": [{"text": name, "center": [46.0, 7.7]} for name in names],
        "places": list(names),
        "address": ", ".join(names),
        "center": [46.0, 7.7],
    }


# What a Nominatim install stored for a photo in Zermatt (issue #2302).
STORED_NOMINATIM_ZERMATT = _untyped(
    "Vispastrasse",
    "Zermatt",
    "Visp",
    "Valais/Wallis",
    "Schweiz/Suisse/Svizzera/Svizra",
)
EXIFTOOL_ZERMATT = parse_exiftool(ZERMATT, 46.0207, 7.7591)
EXIFTOOL_LISBON = parse_exiftool(LISBON, 38.7237, -9.1492)
EXIFTOOL_BERLIN = parse_exiftool(BERLIN, 52.5172, 13.4146)


def _levels(geolocation_json: object) -> tuple[str | None, str | None, str | None]:
    return (
        place_name(geolocation_json, "city"),
        place_name(geolocation_json, "region"),
        place_name(geolocation_json, "country"),
    )


class PlaceNameEveryProviderTest(SimpleTestCase):
    def test_exiftool(self):
        self.assertEqual(
            _levels(EXIFTOOL_ZERMATT), ("Zermatt", "Valais", "Switzerland")
        )
        self.assertEqual(
            _levels(EXIFTOOL_BERLIN), ("Berlin", "State of Berlin", "Germany")
        )
        # City, subregion and region are all "Lisbon": the region is the city.
        self.assertEqual(_levels(EXIFTOOL_LISBON), ("Lisbon", "Lisbon", "Portugal"))

    def test_geopy_parsers_on_their_fixtures(self):
        # Bondi Beach, Sydney; Kreuzberg, Berlin (index 2 of every fixture).
        cases = {
            "nominatim": (parse_nominatim, NominatimLocation, nominatim_responses),
            "mapbox": (parse_mapbox, MapboxLocation, mapbox_responses),
            "opencage": (parse_opencage, OpenCageLocation, opencage_responses),
            "tomtom": (parse_tomtom, TomTomLocation, tomtom_responses),
        }
        sydney = {
            "nominatim": ("Sydney", "New South Wales", "Australia"),
            "mapbox": ("Sydney", "New South Wales", "Australia"),
            "opencage": ("Sydney", "New South Wales", "Australia"),
            "tomtom": ("Sydney", "New South Wales", "Australia"),
        }
        berlin = {
            # No state in Nominatim's answer: the region is the city.
            "nominatim": ("Berlin", "Berlin", "Deutschland"),
            "mapbox": ("Berlin", "Berlin", "Germany"),
            "opencage": ("Berlin", "Berlin", "Germany"),
            "tomtom": ("Berlin", "Berlin", "Deutschland"),
        }
        for provider, (parse, location, responses) in cases.items():
            with self.subTest(provider):
                first = parse(location(responses[0]))
                self.assertEqual(first["provider"], provider)
                self.assertEqual(_levels(first), sydney[provider])
                self.assertEqual(
                    _levels(parse(location(responses[2]))), berlin[provider]
                )

    def test_the_town_of_a_place_without_one_is_the_nearest_finer_level(self):
        # Nominatim's Ladakh camp site: a hamlet, no town.
        spangmik = parse_nominatim(NominatimLocation(nominatim_responses[3]))
        self.assertEqual(town_name(spangmik), "Spangmik")

    def test_then_the_nearest_coarser_one_never_a_street(self):
        row = {
            "features": [
                {"text": "Fire Route 47", "place_type": "street"},
                {"text": "Peterborough County", "place_type": "subregion"},
                {"text": "Canada", "place_type": "country"},
            ]
        }
        self.assertEqual(
            _levels(row), ("Peterborough County", "Peterborough County", "Canada")
        )

    def test_older_mapbox_rows_with_type_lists(self):
        row = {
            "features": [
                {"text": "Kreuzberg", "place_type": ["neighborhood"]},
                # A region and a place: the finer type counts.
                {"text": "Berlin", "place_type": ["region", "place"]},
                {"text": "Germany", "place_type": ["country"]},
            ]
        }
        self.assertEqual(_levels(row), ("Berlin", "Berlin", "Germany"))


class PlaceNameUntypedRowsTest(SimpleTestCase):
    """Rows stored before #2302 keep the names each consumer read."""

    def test_by_position(self):
        self.assertEqual(
            _levels(STORED_NOMINATIM_ZERMATT),
            ("Visp", "Valais/Wallis", "Schweiz/Suisse/Svizzera/Svizra"),
        )
        # The day albums read the next to last name.
        self.assertEqual(town_name(STORED_NOMINATIM_ZERMATT), "Valais/Wallis")

    def test_too_short_rows_have_no_name_at_that_position(self):
        row = _untyped("Valais", "Switzerland")
        self.assertEqual(_levels(row), (None, "Valais", "Switzerland"))
        self.assertIsNone(town_name(_untyped("Iceland")))

    def test_places_only_rows(self):
        self.assertEqual(town_name({"places": ["Berlin", "Germany"]}), "Berlin")

    def test_rows_with_only_streets_typed_are_read_by_position(self):
        row = {
            "features": [
                {"text": "Main St", "place_type": "street"},
                {"text": "Berlin"},
                {"text": "Germany"},
            ]
        }
        self.assertEqual(town_name(row), "Berlin")

    def test_no_place(self):
        for value in (None, {}, [], "Berlin", {"features": "x"}, {"places": None}):
            with self.subTest(value=value):
                self.assertIsNone(place_name(value, "city"))
                self.assertIsNone(short_place_name(value))
        self.assertIsNone(town_name({"features": [{"text": ""}, {"text": " "}]}))

    def test_short_place_name_takes_a_sole_name(self):
        self.assertEqual(short_place_name(_untyped("Iceland")), "Iceland")
        self.assertEqual(short_place_name(EXIFTOOL_LISBON), "Lisbon")
        self.assertEqual(short_place_name(STORED_NOMINATIM_ZERMATT), "Valais/Wallis")
        self.assertIsNone(short_place_name({"places": [""]}))


class PlaceNameConsumersTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _photo(self, geolocation_json: object, **fields: object):
        return create_test_photo(
            owner=self.user,
            exif_timestamp=timezone.now(),
            geolocation_json=geolocation_json,
            **fields,
        )

    def test_day_album_names_the_town(self):
        photo = self._photo(EXIFTOOL_ZERMATT)
        album_date = create_test_album_date(
            owner=self.user, date=photo.exif_timestamp.date()
        )
        album_date.photos.add(photo)

        add_location_to_album_dates(photo)

        album_date.refresh_from_db()
        self.assertEqual(album_date.location, {"places": ["Zermatt"]})

    def test_day_album_of_a_stored_row_is_unchanged(self):
        photo = self._photo(STORED_NOMINATIM_ZERMATT)
        album_date = create_test_album_date(
            owner=self.user, date=photo.exif_timestamp.date()
        )
        album_date.photos.add(photo)

        add_location_to_album_dates(photo)

        album_date.refresh_from_db()
        self.assertEqual(album_date.location, {"places": ["Valais/Wallis"]})

    def test_public_day_place_names_the_town(self):
        photo = self._photo(EXIFTOOL_ZERMATT, public=True)
        album_date = create_test_album_date(
            owner=self.user, date=photo.exif_timestamp.date()
        )
        album_date.photos.add(photo)

        self.assertEqual(_public_place(album_date), "Zermatt")

    def test_sunburst_keeps_two_level_places(self):
        self._photo(EXIFTOOL_LISBON)
        self._photo(EXIFTOOL_ZERMATT)
        self._photo(STORED_NOMINATIM_ZERMATT)
        self._photo(_untyped("Valais", "Switzerland"))

        tree = get_location_sunburst(self.user)

        paths = {
            (country["name"], region["name"], city["name"], city["value"])
            for country in tree["children"]
            for region in country["children"]
            for city in region["children"]
        }
        self.assertEqual(
            paths,
            {
                ("Portugal", "Lisbon", "Lisbon", 1),
                ("Switzerland", "Valais", "Zermatt", 1),
                ("Schweiz/Suisse/Svizzera/Svizra", "Valais/Wallis", "Visp", 1),
            },
        )

    def test_event_title_names_the_most_frequent_towns(self):
        album = create_test_album_auto(owner=self.user, timestamp=timezone.now())
        for geolocation in (EXIFTOOL_ZERMATT, EXIFTOOL_ZERMATT, EXIFTOOL_LISBON, None):
            album.photos.add(self._photo(geolocation))

        album._generate_title()

        self.assertEqual(album.title_parts["places"], ["Zermatt", "Lisbon"])

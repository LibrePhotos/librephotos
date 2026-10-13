"""A position the reverse geocoder has no place for is looked up once (#2567).

geopy answers ``None`` when the provider knows no place at a position (open
sea, a remote area) and raises when the lookup fails. Only a failed lookup
leaves the position to the next geolocation job; "nothing there" is recorded
for the position, so it is asked again only when the position changes.

The geocoder is mocked at geopy's service lookup, so ``reverse_geocode`` and
the provider's parser run as they do against a real provider; nothing goes
over the network.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from constance.test import override_config
from django.test import TestCase
from geopy.exc import GeocoderTimedOut

from api.geocode.photo_location import (
    geocode_status,
    geolocate_photo,
    has_place,
    needs_geocoding,
)
from api.metadata import edits
from api.models import Photo
from api.models.album_place import AlbumPlace, get_album_place
from api.models.photo_search import PhotoSearch
from api.tests.utils import create_test_photo, create_test_user

MID_ATLANTIC = (0.5, -30.0)
BERLIN = (52.5, 13.4)
BERLIN_PLACE = {
    "_v": "1",
    "places": ["Berlin", "Germany"],
    "features": [{"text": "Berlin"}, {"text": "Germany"}],
    "address": "Berlin, Germany",
}


@override_config(MAP_API_PROVIDER="nominatim")
@patch("api.geocode.geocode.wait_for_provider")
@patch("geopy.get_geocoder_for_service", autospec=True)
class GeolocateNoPlaceTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def provider(self, get_geocoder: MagicMock) -> MagicMock:
        """The geopy geocoder ``reverse_geocode`` builds."""
        geocoder = MagicMock()
        get_geocoder.return_value = MagicMock(return_value=geocoder)
        return geocoder

    def at(self, position: tuple[float, float], **fields: object) -> None:
        Photo.objects.filter(pk=self.photo.pk).update(
            exif_gps_lat=position[0], exif_gps_lon=position[1], **fields
        )
        self.photo.refresh_from_db()

    def still_to_geocode(self) -> bool:
        return Photo.objects.filter(needs_geocoding(), pk=self.photo.pk).exists()

    def test_a_position_without_a_place_is_not_looked_up_again(
        self, get_geocoder: MagicMock, _wait: MagicMock
    ) -> None:
        geocoder = self.provider(get_geocoder)
        geocoder.reverse.return_value = None  # Nominatim: "Unable to geocode"
        self.at(MID_ATLANTIC)

        geolocate_photo(self.photo)
        self.photo.refresh_from_db()

        self.assertFalse(self.still_to_geocode())
        self.assertEqual(
            MID_ATLANTIC, (self.photo.geocoded_lat, self.photo.geocoded_lon)
        )
        self.assertFalse(has_place(self.photo))
        # Asked directly again (an upload, a full scan): no second request.
        geolocate_photo(self.photo)
        geocoder.reverse.assert_called_once()

    def test_a_failed_lookup_is_looked_up_again(
        self, get_geocoder: MagicMock, _wait: MagicMock
    ) -> None:
        self.provider(get_geocoder).reverse.side_effect = GeocoderTimedOut()
        self.at(MID_ATLANTIC)

        geolocate_photo(self.photo)
        self.photo.refresh_from_db()

        self.assertTrue(self.still_to_geocode())
        self.assertEqual(
            (None, None), (self.photo.geocoded_lat, self.photo.geocoded_lon)
        )

    def test_a_position_moved_to_no_place_drops_the_old_place(
        self, get_geocoder: MagicMock, _wait: MagicMock
    ) -> None:
        self.provider(get_geocoder).reverse.return_value = None
        self.at(
            BERLIN,
            geocoded_lat=BERLIN[0],
            geocoded_lon=BERLIN[1],
            geolocation_json=BERLIN_PLACE,
        )
        get_album_place("Berlin", owner=self.user).photos.add(self.photo)
        PhotoSearch.objects.update_or_create(
            photo=self.photo, defaults={"search_location": "Berlin, Germany"}
        )
        self.at(MID_ATLANTIC)

        geolocate_photo(self.photo)
        self.photo.refresh_from_db()

        self.assertFalse(self.still_to_geocode())
        self.assertFalse(has_place(self.photo))
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())
        self.assertEqual("", PhotoSearch.objects.get(photo=self.photo).search_location)

    def test_a_new_position_is_looked_up_again(
        self, get_geocoder: MagicMock, _wait: MagicMock
    ) -> None:
        geocoder = self.provider(get_geocoder)
        geocoder.reverse.return_value = None
        self.at(MID_ATLANTIC)
        geolocate_photo(self.photo)

        self.at((0.6, -30.0))

        self.assertTrue(self.still_to_geocode())

    def test_a_location_edit_to_no_place_is_not_looked_up_again(
        self, get_geocoder: MagicMock, _wait: MagicMock
    ) -> None:
        self.provider(get_geocoder).reverse.return_value = None

        edits.set_location(self.photo, *MID_ATLANTIC, self.user)
        self.photo.refresh_from_db()

        self.assertFalse(self.still_to_geocode())
        self.assertFalse(has_place(self.photo))
        # The edit response says so: not a failed lookup (#2589).
        self.assertEqual("no_place", geocode_status(self.photo))

    def test_a_failed_location_edit_lookup_is_looked_up_again(
        self, get_geocoder: MagicMock, _wait: MagicMock
    ) -> None:
        self.provider(get_geocoder).reverse.side_effect = GeocoderTimedOut()

        edits.set_location(self.photo, *MID_ATLANTIC, self.user)
        self.photo.refresh_from_db()

        self.assertTrue(self.still_to_geocode())
        self.assertEqual("failed", geocode_status(self.photo))

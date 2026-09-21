"""
Regression tests for zero-valued metadata being dropped by truthiness checks.

Several EXIF-derived values are legitimately ``0``: a photo on the equator or
prime meridian (one GPS axis == 0.0), an explicit 0-star rating, and the first
frame of a burst (ImageNumber == 0). Guards written as ``if value:`` silently
discarded all of these. These tests pin the corrected ``is not None`` behaviour
while keeping the ``(0, 0)`` "null island" coordinate rejected.
"""

from unittest.mock import patch

from django.test import TestCase

from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user


class GeolocateZeroCoordinateTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    @patch("api.models.photo.reverse_geocode", return_value={})
    @patch("api.models.photo.get_metadata", return_value=(0.0, 11.5))
    def test_geolocate_keeps_zero_latitude(self, _get_metadata, reverse_geocode):
        """A photo on the equator (lat == 0.0) must still be geocoded."""
        self.photo._geolocate(commit=False)

        reverse_geocode.assert_called_once()
        self.assertEqual(self.photo.exif_gps_lat, 0.0)
        self.assertEqual(self.photo.exif_gps_lon, 11.5)

    @patch("api.models.photo.reverse_geocode", return_value={})
    @patch("api.models.photo.get_metadata", return_value=(51.48, 0.0))
    def test_geolocate_keeps_zero_longitude(self, _get_metadata, reverse_geocode):
        """A photo on the prime meridian (lon == 0.0) must still be geocoded."""
        self.photo._geolocate(commit=False)

        reverse_geocode.assert_called_once()
        self.assertEqual(self.photo.exif_gps_lat, 51.48)
        self.assertEqual(self.photo.exif_gps_lon, 0.0)

    @patch("api.models.photo.reverse_geocode", return_value={})
    @patch("api.models.photo.get_metadata", return_value=(0.0, 0.0))
    def test_geolocate_skips_null_island(self, _get_metadata, reverse_geocode):
        """The (0, 0) default written when there is no GPS fix is rejected."""
        self.photo._geolocate(commit=False)

        reverse_geocode.assert_not_called()
        self.assertIsNone(self.photo.exif_gps_lat)
        self.assertIsNone(self.photo.exif_gps_lon)


class ZeroRatingAndImageNumberTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_zero_rating_and_image_number_are_kept(self):
        """rating == 0 and ImageNumber == 0 must be recorded, not dropped."""
        # 18-element tuple matching the tags requested in extract_exif_data.
        mock_values = [None] * 18
        mock_values[13] = 0  # RATING (explicit 0 stars)
        mock_values[15] = 0  # IMAGE_NUMBER (first frame of a burst)

        with patch("api.models.photo_metadata.get_metadata", return_value=mock_values):
            metadata = PhotoMetadata.extract_exif_data(self.photo, commit=True)

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.image_sequence_number, 0)
        self.assertEqual(self.photo.rating, 0)
        self.assertEqual(metadata.rating, 0)

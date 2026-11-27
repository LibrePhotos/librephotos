from unittest.mock import patch

from django.test import TestCase

from api.metadata.photo_reader import EXIF_VALUE_NAMES, extract_exif_data
from api.tests.utils import create_test_photo, create_test_user

TOO_BIG = 0xFFFFFFFF
TOO_SMALL = -(2**31) - 1


class OutOfRangeExifIntegersTest(TestCase):
    def setUp(self) -> None:
        self.photo = create_test_photo(owner=create_test_user())

    def _extract(self, **named_values: object):
        values = [named_values.get(name) for name in EXIF_VALUE_NAMES]
        with patch("api.metadata.photo_reader.get_metadata", return_value=values):
            return extract_exif_data(self.photo, commit=True)

    def test_an_image_number_past_the_integer_column_is_dropped(self) -> None:
        self._extract(image_number=TOO_BIG)

        self.photo.refresh_from_db()
        self.assertIsNone(self.photo.image_sequence_number)

    def test_metadata_integers_past_the_column_are_dropped(self) -> None:
        metadata = self._extract(
            iso=TOO_BIG,
            focal_length_35mm=TOO_BIG,
            width=TOO_BIG,
            height=TOO_BIG,
            orientation=TOO_SMALL,
            bits_per_sample=TOO_BIG,
            rating=TOO_BIG,
        )

        self.assertEqual(
            [None] * 7,
            [
                metadata.iso,
                metadata.focal_length_35mm,
                metadata.width,
                metadata.height,
                metadata.orientation,
                metadata.bit_depth,
                metadata.file_rating,
            ],
        )
        self.photo.refresh_from_db()
        self.assertEqual(0, self.photo.rating)

    def test_values_in_range_are_kept(self) -> None:
        metadata = self._extract(
            image_number=2**31 - 1, iso=6400, width=6000, height=4000, rating=5
        )

        self.photo.refresh_from_db()
        self.assertEqual(2**31 - 1, self.photo.image_sequence_number)
        self.assertEqual(
            (6400, 6000, 4000), (metadata.iso, metadata.width, metadata.height)
        )
        self.assertEqual(5, self.photo.rating)

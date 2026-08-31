"""Characterization tests for ``AlbumAuto._generate_title`` (unit 19).

These pin the CURRENT behavior of
``api/models/album_auto.py::AlbumAuto._generate_title`` before refactoring.
They are deliberately descriptive, not aspirational: where the current
implementation has quirks or outright bugs (documented inline), the tests
assert the quirky behavior so a refactor that silently changes it is caught.
"""

from datetime import datetime, timedelta
from unittest.mock import patch

import pytz
from django.test import TestCase

from api.models import AlbumAuto
from api.models.person import Person
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def utc(*args):
    return datetime(*args).replace(tzinfo=pytz.utc)


class GenerateTitleTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def make_album(self, timestamp):
        return AlbumAuto.objects.create(
            timestamp=timestamp, created_on=timestamp, owner=self.user
        )

    def add_photo(self, album, exif_timestamp=None, geolocation_json=None):
        photo = create_test_photo(
            owner=self.user,
            exif_timestamp=exif_timestamp,
            geolocation_json=geolocation_json,
        )
        album.photos.add(photo)
        return photo

    # ------------------------------------------------------------------
    # weekday / time-of-day branches (no photos attached)
    # ------------------------------------------------------------------

    def test_midnight_hour_yields_weekday_only(self):
        """hour == 0 matches no time-of-day branch (the check is ``hour > 0``)."""
        album = self.make_album(utc(2022, 1, 2, 0, 0))
        album._generate_title()
        self.assertEqual(album.title, "Sunday")

    def test_early_morning(self):
        album = self.make_album(utc(2022, 1, 3, 3, 0))
        album._generate_title()
        self.assertEqual(album.title, "Monday Early Morning")

    def test_morning_lower_boundary(self):
        album = self.make_album(utc(2022, 1, 4, 5, 0))
        album._generate_title()
        self.assertEqual(album.title, "Tuesday Morning")

    def test_morning_upper_boundary(self):
        album = self.make_album(utc(2022, 1, 5, 11, 0))
        album._generate_title()
        self.assertEqual(album.title, "Wednesday Morning")

    def test_afternoon_boundaries(self):
        album = self.make_album(utc(2022, 1, 6, 12, 0))
        album._generate_title()
        self.assertEqual(album.title, "Thursday Afternoon")

        album2 = self.make_album(utc(2022, 1, 7, 17, 59))
        album2._generate_title()
        self.assertEqual(album2.title, "Friday Afternoon")

    def test_evening(self):
        album = self.make_album(utc(2022, 1, 8, 18, 0))
        album._generate_title()
        self.assertEqual(album.title, "Saturday Evening")

        album2 = self.make_album(utc(2022, 1, 9, 23, 59))
        album2._generate_title()
        self.assertEqual(album2.title, "Sunday Evening")

    def test_early_morning_upper_boundary_hour_four(self):
        album = self.make_album(utc(2022, 1, 10, 4, 59))
        album._generate_title()
        self.assertEqual(album.title, "Monday Early Morning")

    def test_title_is_persisted_to_the_database(self):
        album = self.make_album(utc(2022, 1, 3, 3, 0))
        album._generate_title()
        album.refresh_from_db()
        self.assertEqual(album.title, "Monday Early Morning")

    # ------------------------------------------------------------------
    # places branch
    # ------------------------------------------------------------------

    def test_places_add_location_suffix(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 8, 0),
            geolocation_json={"places": ["Berlin", "Berlin", "Germany"]},
        )
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning  in Berlin and Germany")

    def test_double_space_when_places_but_no_people(self):
        """QUIRK: the empty people slot leaves a double space in the title."""
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 8, 0),
            geolocation_json={"places": ["Berlin"]},
        )
        album._generate_title()
        self.assertIn("  ", album.title)

    def test_only_two_most_common_places_are_used(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 8, 0),
            geolocation_json={"places": ["A", "A", "B", "B", "C"]},
        )
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning  in A and B")

    def test_places_from_last_photo_win(self):
        """QUIRK: ``places`` is overwritten (``=``) per photo, not accumulated.

        The last photo in the iteration order that has non-empty places
        determines the location entirely.
        """
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        p1 = self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 8, 0),
            geolocation_json={"places": ["First"]},
        )
        p2 = self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 9, 0),
            geolocation_json={"places": ["Second"]},
        )
        ordered = list(album.photos.all())
        last_with_places = ordered[-1]
        album._generate_title()
        expected = "First" if last_with_places.pk == p1.pk else "Second"
        self.assertEqual(album.title, f"Monday Morning  in {expected}")
        self.assertIn(last_with_places.pk, {p1.pk, p2.pk})

    def test_empty_places_list_is_ignored(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(
            album, exif_timestamp=utc(2022, 1, 3, 8, 0), geolocation_json={"places": []}
        )
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

    def test_geolocation_json_without_places_key_is_ignored(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 8, 0),
            geolocation_json={"features": [{"text": "x"}]},
        )
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

    def test_null_geolocation_json_is_ignored(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

    # ------------------------------------------------------------------
    # people branch
    # ------------------------------------------------------------------

    def test_people_add_with_suffix(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        alice = create_test_person(name="Alice")
        create_test_face(photo=photo, person=alice)
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning with Alice")

    def test_two_most_common_people_are_used(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        alice = create_test_person(name="Alice")
        bob = create_test_person(name="Bob")
        carol = create_test_person(name="Carol")
        create_test_face(photo=photo, person=alice)
        create_test_face(photo=photo, person=alice)
        create_test_face(photo=photo, person=bob)
        create_test_face(photo=photo, person=bob)
        create_test_face(photo=photo, person=carol)
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning with Alice and Bob")

    def test_literal_unknown_name_is_filtered_out(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        unknown = create_test_person(name="unknown")
        alice = create_test_person(name="Alice")
        create_test_face(photo=photo, person=unknown)
        create_test_face(photo=photo, person=unknown)
        create_test_face(photo=photo, person=alice)
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning with Alice")

    def test_unknown_is_case_insensitive(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        create_test_face(photo=photo, person=create_test_person(name="UNKNOWN"))
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

    def test_only_unknown_people_yields_no_people_suffix(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        create_test_face(photo=photo, person=create_test_person(name="Unknown"))
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

    def test_unknown_other_placeholder_is_not_filtered_bug(self):
        """BUG (pinned): ``Person.UNKNOWN_PERSON_NAME`` is never filtered.

        The guard compares ``k.lower()`` against ``Person.UNKNOWN_PERSON_NAME``
        ("Unknown - Other"), which contains capitals, so a lowercased name can
        never equal it. The placeholder therefore leaks into titles.
        """
        self.assertNotEqual(
            Person.UNKNOWN_PERSON_NAME, Person.UNKNOWN_PERSON_NAME.lower()
        )
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        placeholder = create_test_person(name=Person.UNKNOWN_PERSON_NAME)
        create_test_face(photo=photo, person=placeholder)
        album._generate_title()
        self.assertEqual(
            album.title, f"Monday Morning with {Person.UNKNOWN_PERSON_NAME}"
        )

    def test_face_without_person_falls_back_to_exception_title(self):
        """A face with ``person=None`` raises inside the loop -> fallback title."""
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        create_test_face(photo=photo, person=None)
        album._generate_title()
        self.assertEqual(album.title, "Album from 2022-01-03")

    # ------------------------------------------------------------------
    # timestamp-span branches
    # ------------------------------------------------------------------

    def test_span_of_three_days_replaces_when(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 6, 8, 0))
        album._generate_title()
        self.assertEqual(album.title, "3 days")

    def test_span_of_two_days_keeps_weekday_when(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 5, 8, 0))
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

    def test_weekend_span_overrides_days_label(self):
        """Sat + Sun photos -> "Weekend" (checked after, so it wins over N days)."""
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 8, 8, 0))  # Saturday
        self.add_photo(album, exif_timestamp=utc(2022, 1, 9, 8, 0))  # Sunday
        album._generate_title()
        self.assertEqual(album.title, "Weekend")

    def test_same_weekend_day_is_not_a_weekend(self):
        """Both endpoints on the same weekday -> the Weekend rule is skipped."""
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 8, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 8, 20, 0))
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

    def test_long_weekend_span_still_reported_as_weekend(self):
        """A Sat->Sun span 8 days apart is >= 3 days but still labelled Weekend."""
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 1, 8, 0))  # Saturday
        self.add_photo(album, exif_timestamp=utc(2022, 1, 9, 8, 0))  # Sunday
        album._generate_title()
        self.assertEqual(album.title, "Weekend")

    def test_weekend_span_combined_with_people_and_places(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        photo = self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 8, 8, 0),
            geolocation_json={"places": ["Paris"]},
        )
        self.add_photo(album, exif_timestamp=utc(2022, 1, 9, 8, 0))
        create_test_face(photo=photo, person=create_test_person(name="Alice"))
        album._generate_title()
        self.assertEqual(album.title, "Weekend with Alice in Paris")

    # ------------------------------------------------------------------
    # error / fallback branch
    # ------------------------------------------------------------------

    def test_photo_without_exif_timestamp_falls_back(self):
        """QUIRK/BUG (pinned): a NULL ``exif_timestamp`` makes ``max - min``
        raise TypeError, so the whole title computation is discarded and the
        generic fallback is used."""
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=None)
        with patch("api.util.logger") as mock_logger:
            album._generate_title()
        self.assertEqual(album.title, "Album from 2022-01-03")
        self.assertTrue(mock_logger.exception.called)

    def test_mixed_null_exif_timestamp_falls_back(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=utc(2022, 1, 3, 8, 0))
        self.add_photo(album, exif_timestamp=None)
        album._generate_title()
        self.assertEqual(album.title, "Album from 2022-01-03")

    def test_unexpected_exception_is_logged_and_fallback_saved(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        with (
            patch(
                "api.models.album_auto.Counter", side_effect=RuntimeError("boom")
            ) as mock_counter,
            patch("api.util.logger") as mock_logger,
        ):
            self.add_photo(
                album,
                exif_timestamp=utc(2022, 1, 3, 8, 0),
                geolocation_json={"places": ["Berlin"]},
            )
            album._generate_title()
            self.assertTrue(mock_counter.called)
        self.assertEqual(album.title, "Album from 2022-01-03")
        self.assertTrue(mock_logger.exception.called)
        album.refresh_from_db()
        self.assertEqual(album.title, "Album from 2022-01-03")

    def test_fallback_title_uses_album_timestamp_date(self):
        album = self.make_album(utc(2023, 12, 25, 8, 0))
        self.add_photo(album, exif_timestamp=None)
        album._generate_title()
        self.assertEqual(album.title, "Album from 2023-12-25")

    # ------------------------------------------------------------------
    # composition / ordering
    # ------------------------------------------------------------------

    def test_full_title_ordering_when_people_then_places(self):
        album = self.make_album(utc(2022, 1, 3, 14, 0))
        photo = self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 14, 0),
            geolocation_json={"places": ["Rome"]},
        )
        create_test_face(photo=photo, person=create_test_person(name="Alice"))
        album._generate_title()
        self.assertEqual(album.title, "Monday Afternoon with Alice in Rome")

    def test_title_has_no_leading_or_trailing_whitespace(self):
        album = self.make_album(utc(2022, 1, 2, 0, 0))
        album._generate_title()
        self.assertEqual(album.title, album.title.strip())

    def test_no_photos_yields_when_only(self):
        album = self.make_album(utc(2022, 1, 3, 20, 0))
        album._generate_title()
        self.assertEqual(album.title, "Monday Evening")

    def test_regenerating_is_idempotent(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        self.add_photo(
            album,
            exif_timestamp=utc(2022, 1, 3, 8, 0),
            geolocation_json={"places": ["Berlin"]},
        )
        album._generate_title()
        first = album.title
        album._generate_title()
        self.assertEqual(album.title, first)

    def test_span_uses_extremes_not_photo_count(self):
        album = self.make_album(utc(2022, 1, 3, 8, 0))
        base = utc(2022, 1, 3, 8, 0)
        for offset in range(5):
            self.add_photo(album, exif_timestamp=base + timedelta(hours=offset))
        album._generate_title()
        self.assertEqual(album.title, "Monday Morning")

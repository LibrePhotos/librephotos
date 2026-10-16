"""``AlbumAuto.title_parts``: the parts an event title is worded from (#2235).

The English ``title`` is built from hardcoded words, so a user running the web
app in German saw English event names. The title is now two steps: the pure
``_title_parts`` reads the photos, and ``_english_title`` words the parts as
the ``title`` the search, the mobile app and old clients keep reading (pinned
byte for byte by ``test_album_auto_title_generation``). The parts are stored
next to it and sent by both event endpoints, so the web app words them in the
UI language.
"""

import uuid
from datetime import datetime, timedelta

import pytz
from django.test import TestCase
from rest_framework.test import APIClient

from api.albums.auto_albums import generate_event_albums, regenerate_event_titles
from api.models import AlbumAuto
from api.models.album_auto import (
    TitleParts,
    _english_title,
    _fallback_parts,
    _title_parts,
)
from api.tests.utils import (
    create_test_album_auto,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def utc(*args):
    return datetime(*args).replace(tzinfo=pytz.utc)


def parts(**overrides) -> TitleParts:
    base = _fallback_parts(utc(2022, 1, 3, 8, 0))
    base.update(overrides)
    return base


class TitlePartsTest(TestCase):
    """``_title_parts`` reads what a title says off the photos."""

    def setUp(self):
        self.user = create_test_user()
        # A Monday; the album key is 11h59 before the first photo, as the event job sets it.
        self.key = utc(2022, 1, 2, 20, 1)
        self.album = create_test_album_auto(owner=self.user, timestamp=self.key)

    def add_photo(self, exif_timestamp, places=None):
        photo = create_test_photo(
            owner=self.user,
            exif_timestamp=exif_timestamp,
            geolocation_json={"places": places} if places else None,
        )
        self.album.photos.add(photo)
        return photo

    def compute(self) -> TitleParts:
        return _title_parts(self.album.photos.all(), self.album.timestamp)

    def test_weekday_and_time_of_day_come_from_the_first_photo(self):
        self.add_photo(utc(2022, 1, 3, 14, 30))
        self.add_photo(utc(2022, 1, 3, 8, 0))

        result = self.compute()

        self.assertEqual(1, result["weekday"])
        self.assertEqual("morning", result["time_of_day"])
        self.assertEqual(0, result["span_days"])
        self.assertFalse(result["weekend"])

    def test_every_time_of_day_has_a_key(self):
        cases = {
            0: None,
            3: "early_morning",
            5: "morning",
            12: "afternoon",
            18: "evening",
            23: "evening",
        }
        for hour, expected in cases.items():
            with self.subTest(hour=hour):
                album = create_test_album_auto(
                    owner=self.user, timestamp=utc(2022, 1, 3, hour, 0)
                )
                result = _title_parts(album.photos.all(), album.timestamp)
                self.assertEqual(expected, result["time_of_day"])

    def test_multi_day_span_counts_whole_days(self):
        self.add_photo(utc(2022, 1, 3, 8, 0))
        self.add_photo(utc(2022, 1, 7, 7, 0))

        result = self.compute()

        self.assertEqual(3, result["span_days"])
        self.assertFalse(result["weekend"])

    def test_saturday_to_sunday_is_a_weekend(self):
        self.add_photo(utc(2022, 1, 8, 9, 0))
        self.add_photo(utc(2022, 1, 9, 18, 0))

        result = self.compute()

        self.assertTrue(result["weekend"])
        self.assertEqual(6, result["weekday"])

    def test_top_two_people_and_places(self):
        """The two most frequent towns of the photos (#2302)."""
        photo = self.add_photo(utc(2022, 1, 3, 8, 0), places=["Rome", "Italy"])
        for minute, town in enumerate(["Rome", "Milan", "Naples", "Rome", "Milan"]):
            self.add_photo(utc(2022, 1, 3, 9, minute), places=[town, "Italy"])
        anna = create_test_person(name="Anna")
        ben = create_test_person(name="Ben")
        carl = create_test_person(name="Carl")
        for person in (anna, anna, anna, ben, ben, carl):
            create_test_face(photo=photo, person=person)

        result = self.compute()

        self.assertEqual(["Anna", "Ben"], result["people"])
        self.assertEqual(["Rome", "Milan"], result["places"])

    def test_an_empty_album_reads_its_key(self):
        result = self.compute()

        self.assertEqual(7, result["weekday"])
        self.assertEqual("evening", result["time_of_day"])
        self.assertEqual([], result["people"])
        self.assertEqual([], result["places"])
        self.assertEqual("2022-01-02", result["date"])

    def test_a_photo_without_a_time_raises(self):
        self.add_photo(None)

        with self.assertRaises(AssertionError):
            self.compute()


class EnglishTitleTest(TestCase):
    """``_english_title`` words the parts exactly as ``title`` always read."""

    def test_table(self):
        cases = [
            (parts(weekday=1, time_of_day="morning"), "Monday Morning"),
            (parts(weekday=7), "Sunday"),
            (parts(weekday=1, time_of_day="early_morning"), "Monday Early Morning"),
            (parts(weekday=1, span_days=3), "3 days"),
            (parts(weekday=1, span_days=2, time_of_day="evening"), "Monday Evening"),
            (parts(weekday=6, span_days=8, weekend=True), "Weekend"),
            (
                parts(
                    weekday=3,
                    time_of_day="afternoon",
                    people=["Anna"],
                    places=["Berlin"],
                ),
                "Wednesday Afternoon with Anna in Berlin",
            ),
            (
                parts(weekday=1, span_days=4, people=["A", "B"], places=["C", "D"]),
                "4 days with A and B in C and D",
            ),
            (parts(weekday=1, places=["Paris"]), "Monday in Paris"),
            (parts(), "Album from 2022-01-03"),
        ]
        for value, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(expected, _english_title(value))


class TitlePartsStoredTest(TestCase):
    """Both ways a title is made store the parts, and both endpoints send them."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_generate_title_stores_the_parts(self):
        album = create_test_album_auto(owner=self.user, timestamp=utc(2022, 1, 3, 8, 0))

        album._generate_title()
        album.refresh_from_db()

        self.assertEqual("Monday Morning", album.title)
        self.assertEqual(1, album.title_parts["weekday"])
        self.assertEqual("morning", album.title_parts["time_of_day"])

    def test_a_failed_title_stores_the_fallback_parts(self):
        album = create_test_album_auto(owner=self.user, timestamp=utc(2023, 12, 25, 8))
        album.photos.add(create_test_photo(owner=self.user, exif_timestamp=None))

        album._generate_title()
        album.refresh_from_db()

        self.assertEqual("Album from 2023-12-25", album.title)
        self.assertEqual(_fallback_parts(utc(2023, 12, 25, 8)), album.title_parts)

    def test_the_event_job_fills_the_parts(self):
        # An event needs at least two photos.
        create_test_photo(owner=self.user, exif_timestamp=utc(2022, 1, 3, 14, 0))
        create_test_photo(owner=self.user, exif_timestamp=utc(2022, 1, 3, 15, 0))

        generate_event_albums(self.user, uuid.uuid4())

        album = AlbumAuto.objects.get(owner=self.user)
        self.assertEqual("Monday Afternoon", album.title)
        self.assertEqual("afternoon", album.title_parts["time_of_day"])

    def test_regenerating_titles_fills_parts_of_older_albums(self):
        photo = create_test_photo(
            owner=self.user, exif_timestamp=utc(2022, 1, 3, 14, 0)
        )
        album = create_test_album_auto(
            owner=self.user,
            timestamp=utc(2022, 1, 3, 14, 0) - timedelta(hours=11, minutes=59),
            title="Monday Afternoon",
        )
        album.photos.add(photo)
        self.assertIsNone(album.title_parts)

        regenerate_event_titles(self.user, uuid.uuid4())

        album.refresh_from_db()
        self.assertEqual("Monday Afternoon", album.title)
        self.assertEqual(1, album.title_parts["weekday"])

    def test_both_event_endpoints_send_the_parts(self):
        album = create_test_album_auto(owner=self.user, timestamp=utc(2022, 1, 3, 8, 0))
        album.photos.add(
            create_test_photo(owner=self.user, exif_timestamp=utc(2022, 1, 3, 20, 0))
        )
        album._generate_title()

        rows = self.client.get("/api/albums/auto/list/").json()["results"]
        detail = self.client.get(f"/api/albums/auto/{album.id}/").json()

        expected = {
            "weekday": 1,
            "time_of_day": "evening",
            "span_days": 0,
            "weekend": False,
            "people": [],
            "places": [],
            "date": "2022-01-03",
        }
        self.assertEqual(expected, rows[0]["title_parts"])
        self.assertEqual(expected, detail["title_parts"])

    def test_an_album_without_parts_sends_null(self):
        album = create_test_album_auto(owner=self.user, title="Monday")
        album.photos.add(create_test_photo(owner=self.user))

        rows = self.client.get("/api/albums/auto/list/").json()["results"]
        detail = self.client.get(f"/api/albums/auto/{album.id}/").json()

        self.assertIsNone(rows[0]["title_parts"])
        self.assertIsNone(detail["title_parts"])

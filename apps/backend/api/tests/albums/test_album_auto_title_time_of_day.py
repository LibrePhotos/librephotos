"""Auto album titles describe the first photo, not the album's grouping key.

``generate_event_albums`` anchors every ``AlbumAuto`` on::

    key = group[0].exif_timestamp - timedelta(hours=11, minutes=59)

and stores that key as ``AlbumAuto.timestamp`` (it is what lets a later run
recognise the album, see #462). ``_generate_title`` used to read the weekday
and the time of day off that key, so every title was shifted back by nearly
half a day: a Saturday 11:20 beach series became "Friday Evening", a Sunday
19:15 evening in Tokyo became "Sunday Morning". Reproduced on 2026-09-16 with
a fresh SQLite library, UTC settings and EXIF DateTimeOriginal only.

The title now comes from the earliest photo in the album. The key stays the
album's ``timestamp`` so existing albums keep matching, and existing titles
only change when the user regenerates them (``regenerate_event_titles``).
"""

from datetime import datetime, timedelta

import pytz
from django.test import TestCase

from api.autoalbum import generate_event_albums
from api.models import AlbumAuto
from api.tests.utils import create_test_photo, create_test_user

GROUPING_KEY_OFFSET = timedelta(hours=11, minutes=59)


def utc(*args):
    return datetime(*args).replace(tzinfo=pytz.utc)


class AutoAlbumTitleTimeOfDayTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _generate(self, timestamps, geolocation_json=None):
        for timestamp in timestamps:
            create_test_photo(
                owner=self.user,
                exif_timestamp=timestamp,
                geolocation_json=geolocation_json,
            )
        generate_event_albums(self.user, "job-title-time-of-day")
        albums = list(AlbumAuto.objects.filter(owner=self.user))
        self.assertEqual(len(albums), 1)
        return albums[0]

    def test_saturday_morning_beach_series_is_not_friday_evening(self):
        # 2026-09-12 is a Saturday.
        first = utc(2026, 9, 12, 11, 20)
        album = self._generate(
            [first, first + timedelta(minutes=15), first + timedelta(hours=1)],
            geolocation_json={"places": ["Bondi Beach"]},
        )

        self.assertEqual(album.title, "Saturday Morning  in Bondi Beach")
        # The grouping key is untouched: it is what a later run matches on.
        self.assertEqual(album.timestamp, first - GROUPING_KEY_OFFSET)

    def test_sunday_evening_tokyo_series_is_not_sunday_morning(self):
        # 2026-09-13 is a Sunday.
        first = utc(2026, 9, 13, 19, 15)
        album = self._generate(
            [first, first + timedelta(minutes=30)],
            geolocation_json={"places": ["Tokyo"]},
        )

        self.assertEqual(album.title, "Sunday Evening  in Tokyo")
        self.assertEqual(album.timestamp, first - GROUPING_KEY_OFFSET)

    def test_title_follows_the_earliest_photo_not_the_stored_key(self):
        """An album whose key predates its photos (a later anchor move, or a
        legacy album) still describes the earliest photo it holds."""
        photo_time = utc(2026, 9, 12, 11, 20)  # Saturday
        album = AlbumAuto.objects.create(
            owner=self.user,
            timestamp=utc(2026, 9, 10, 0, 0),  # Thursday
            created_on=photo_time,
        )
        album.photos.add(
            create_test_photo(owner=self.user, exif_timestamp=photo_time),
            create_test_photo(
                owner=self.user, exif_timestamp=photo_time + timedelta(hours=2)
            ),
        )

        album._generate_title()

        self.assertEqual(album.title, "Saturday Morning")
        self.assertEqual(album.timestamp, utc(2026, 9, 10, 0, 0))

    def test_regenerating_titles_corrects_an_existing_album(self):
        """Titles written by the old code are only replaced on regeneration."""
        first = utc(2026, 9, 12, 11, 20)
        album = self._generate([first, first + timedelta(minutes=15)])
        AlbumAuto.objects.filter(pk=album.pk).update(title="Friday Evening")

        album.refresh_from_db()
        self.assertEqual(album.title, "Friday Evening")
        album._generate_title()
        self.assertEqual(album.title, "Saturday Morning")

    def test_empty_album_still_titles_from_its_timestamp(self):
        album = AlbumAuto.objects.create(
            owner=self.user,
            timestamp=utc(2026, 9, 13, 19, 15),
            created_on=utc(2026, 9, 13, 19, 15),
        )
        album._generate_title()
        self.assertEqual(album.title, "Sunday Evening")

"""Date-based memories (issue #844).

The endpoint answers "what did I photograph on this day in earlier years", so
every test pins the day it asks about with ``?date=`` instead of relying on the
clock -- otherwise the suite would behave differently on 29 February, and around
midnight in whichever timezone the machine happens to be in.
"""

import datetime
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.models.album_date import get_or_create_album_date
from api.tests.utils import create_test_photo, create_test_user
from api.views.memories import (
    album_date_place,
    anniversary,
    clamp_int,
    day_windows,
    month_windows,
    parse_date,
    pick_cover,
    today_for_user,
)

UTC = datetime.timezone.utc


def add_photo_on(user, day, **kwargs):
    """A photo taken on ``day``, grouped under that day like a scan would."""
    kwargs.setdefault(
        "exif_timestamp",
        datetime.datetime(day.year, day.month, day.day, 12, tzinfo=UTC),
    )
    photo = create_test_photo(owner=user, **kwargs)
    get_or_create_album_date(date=day, owner=user).photos.add(photo)
    return photo


class MemoryHelperTest(SimpleTestCase):
    """The pure helpers, which carry the date arithmetic."""

    def test_parse_date_reads_iso_dates(self):
        self.assertEqual(parse_date("2019-08-24"), datetime.date(2019, 8, 24))

    def test_parse_date_rejects_anything_else(self):
        for value in (None, "", "24-08-2019", "yesterday", "2019-13-01"):
            self.assertIsNone(parse_date(value), value)

    def test_clamp_int_keeps_values_in_range(self):
        self.assertEqual(clamp_int("7", 3, 0, 30), 7)
        self.assertEqual(clamp_int("99", 3, 0, 30), 30)
        self.assertEqual(clamp_int("-5", 3, 0, 30), 0)

    def test_clamp_int_falls_back_on_nonsense(self):
        for value in (None, "", "three"):
            self.assertEqual(clamp_int(value, 3, 0, 30), 3)

    def test_anniversary_of_a_leap_day_in_a_common_year(self):
        self.assertEqual(anniversary(2019, 2, 29), datetime.date(2019, 2, 28))
        self.assertEqual(anniversary(2020, 2, 29), datetime.date(2020, 2, 29))

    def test_day_windows_run_from_the_nearest_year_backwards(self):
        windows = day_windows(datetime.date(2026, 8, 24), 2023, 3)
        self.assertEqual([years_ago for years_ago, *_ in windows], [1, 2, 3])
        self.assertEqual(
            windows[0],
            (
                1,
                datetime.date(2025, 8, 24),
                datetime.date(2025, 8, 21),
                datetime.date(2025, 8, 27),
            ),
        )

    def test_day_windows_leave_out_the_current_year(self):
        windows = day_windows(datetime.date(2026, 8, 24), 2026, 3)
        self.assertEqual(windows, [])

    def test_day_windows_cross_month_boundaries(self):
        _, _, start, end = day_windows(datetime.date(2026, 8, 31), 2025, 3)[0]
        self.assertEqual(start, datetime.date(2025, 8, 28))
        self.assertEqual(end, datetime.date(2025, 9, 3))

    def test_month_windows_cover_whole_months(self):
        windows = month_windows(datetime.date(2026, 8, 24), 2025)
        self.assertEqual(
            windows[0],
            (
                1,
                datetime.date(2025, 8, 1),
                datetime.date(2025, 8, 1),
                datetime.date(2025, 8, 31),
            ),
        )

    def test_month_windows_handle_december_and_february(self):
        _, _, _, december = month_windows(datetime.date(2026, 12, 5), 2025)[0]
        self.assertEqual(december, datetime.date(2025, 12, 31))
        # Oldest year last: 2024 is a leap year, so its February runs to the 29th.
        _, _, _, february = month_windows(datetime.date(2026, 2, 5), 2024)[-1]
        self.assertEqual(february, datetime.date(2024, 2, 29))

    def test_album_date_place_reads_the_first_place(self):
        self.assertEqual(album_date_place({"places": ["Rome", "Italy"]}), "Rome")

    def test_album_date_place_degrades_to_no_place(self):
        for location in (None, {}, {"places": []}, {"places": [{"name": "Rome"}]}, []):
            self.assertEqual(album_date_place(location), "")

    def test_pick_cover_prefers_a_favourite_still(self):
        first = SimpleNamespace(video=False, rating=0)
        favourite = SimpleNamespace(video=False, rating=5)
        video = SimpleNamespace(video=True, rating=5)
        self.assertIs(pick_cover([video, first, favourite]), favourite)

    def test_pick_cover_falls_back_to_the_first_still(self):
        video = SimpleNamespace(video=True, rating=0)
        still = SimpleNamespace(video=False, rating=0)
        later = SimpleNamespace(video=False, rating=0)
        self.assertIs(pick_cover([video, still, later]), still)

    def test_pick_cover_settles_for_a_video(self):
        video = SimpleNamespace(video=True, rating=0)
        self.assertIs(pick_cover([video]), video)

    def test_pick_cover_tolerates_a_missing_rating(self):
        unrated = SimpleNamespace(video=False, rating=None)
        rated = SimpleNamespace(video=False, rating=2)
        self.assertIs(pick_cover([unrated, rated]), rated)


class TodayForUserTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _today(self, tz_name, now):
        self.user.default_timezone = tz_name
        with patch("api.views.memories.timezone.now", return_value=now):
            return today_for_user(self.user)

    def test_uses_the_users_own_calendar(self):
        # 23:30 UTC is already tomorrow in Kiritimati (UTC+14) and still
        # yesterday in Honolulu (UTC-10).
        now = datetime.datetime(2026, 8, 24, 23, 30, tzinfo=UTC)
        self.assertEqual(
            self._today("Pacific/Kiritimati", now), datetime.date(2026, 8, 25)
        )
        self.assertEqual(
            self._today("Pacific/Honolulu", now), datetime.date(2026, 8, 24)
        )

    def test_unknown_timezone_falls_back_to_utc(self):
        now = datetime.datetime(2026, 8, 24, 23, 30, tzinfo=UTC)
        self.assertEqual(
            self._today("Mars/Olympus_Mons", now), datetime.date(2026, 8, 24)
        )


class MemoriesViewTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def memories(self, **params):
        params.setdefault("date", "2026-08-24")
        response = self.client.get("/api/memories", params)
        self.assertEqual(response.status_code, 200)
        return response.json()

    @staticmethod
    def hashes(memory):
        return {item["image_hash"] for item in memory["items"]}

    def test_requires_authentication(self):
        client = APIClient()
        self.assertEqual(client.get("/api/memories").status_code, 401)

    def test_empty_library_has_no_memories(self):
        body = self.memories()
        self.assertEqual(body["results"], [])
        self.assertEqual(body["date"], "2026-08-24")
        self.assertEqual(body["window_days"], 3)

    def test_a_photo_from_a_year_ago_becomes_a_memory(self):
        photo = add_photo_on(self.user, datetime.date(2025, 8, 24))
        (memory,) = self.memories()["results"]
        self.assertEqual(memory["type"], "years_ago")
        self.assertEqual(memory["years_ago"], 1)
        self.assertEqual(memory["year"], 2025)
        self.assertEqual(memory["date"], "2025-08-24")
        self.assertEqual(memory["numberOfItems"], 1)
        self.assertEqual(self.hashes(memory), {photo.image_hash})
        self.assertEqual(memory["cover"]["image_hash"], photo.image_hash)

    def test_nearby_days_join_the_memory_and_distant_ones_do_not(self):
        near = add_photo_on(self.user, datetime.date(2025, 8, 22))
        add_photo_on(self.user, datetime.date(2025, 8, 15))
        (memory,) = self.memories()["results"]
        self.assertEqual(self.hashes(memory), {near.image_hash})
        self.assertEqual(memory["start_date"], "2025-08-22")
        self.assertEqual(memory["end_date"], "2025-08-22")

    def test_the_window_is_configurable(self):
        far = add_photo_on(self.user, datetime.date(2025, 8, 15))
        (memory,) = self.memories(window=10)["results"]
        self.assertEqual(self.hashes(memory), {far.image_hash})
        # A window of zero is the anniversary alone, which has nothing -- so the
        # month fallback answers instead of an empty page.
        (memory,) = self.memories(window=0)["results"]
        self.assertEqual(memory["type"], "month_years_ago")

    def test_the_fallback_can_be_turned_off(self):
        add_photo_on(self.user, datetime.date(2025, 8, 15))
        self.assertEqual(self.memories(fallback="false")["results"], [])
        self.assertEqual(len(self.memories(fallback="true")["results"]), 1)

    def test_this_years_photos_are_not_memories_yet(self):
        add_photo_on(self.user, datetime.date(2026, 8, 24))
        self.assertEqual(self.memories()["results"], [])

    def test_years_are_ordered_from_the_nearest_backwards(self):
        add_photo_on(self.user, datetime.date(2021, 8, 24))
        add_photo_on(self.user, datetime.date(2025, 8, 24))
        add_photo_on(self.user, datetime.date(2023, 8, 24))
        results = self.memories()["results"]
        self.assertEqual([memory["years_ago"] for memory in results], [1, 3, 5])

    def test_each_year_is_its_own_memory(self):
        first = add_photo_on(self.user, datetime.date(2025, 8, 24))
        second = add_photo_on(self.user, datetime.date(2024, 8, 26))
        results = self.memories()["results"]
        self.assertEqual(self.hashes(results[0]), {first.image_hash})
        self.assertEqual(self.hashes(results[1]), {second.image_hash})
        self.assertEqual(results[1]["date"], "2024-08-26")

    def test_items_are_chronological_within_a_memory(self):
        later = add_photo_on(
            self.user,
            datetime.date(2025, 8, 24),
            exif_timestamp=datetime.datetime(2025, 8, 24, 18, tzinfo=UTC),
        )
        earlier = add_photo_on(
            self.user,
            datetime.date(2025, 8, 24),
            exif_timestamp=datetime.datetime(2025, 8, 24, 7, tzinfo=UTC),
        )
        (memory,) = self.memories()["results"]
        self.assertEqual(
            [item["image_hash"] for item in memory["items"]],
            [earlier.image_hash, later.image_hash],
        )

    def test_size_caps_the_items_but_not_the_count(self):
        for hour in range(5):
            add_photo_on(
                self.user,
                datetime.date(2025, 8, 24),
                exif_timestamp=datetime.datetime(2025, 8, 24, 8 + hour, tzinfo=UTC),
            )
        (memory,) = self.memories(size=2)["results"]
        self.assertEqual(len(memory["items"]), 2)
        self.assertEqual(memory["numberOfItems"], 5)

    def test_another_users_photos_are_not_my_memories(self):
        other = create_test_user()
        add_photo_on(other, datetime.date(2025, 8, 24))
        self.assertEqual(self.memories()["results"], [])

    def test_photos_the_timeline_hides_are_left_out(self):
        add_photo_on(self.user, datetime.date(2025, 8, 24), hidden=True)
        add_photo_on(self.user, datetime.date(2025, 8, 24), in_trashcan=True)
        add_photo_on(self.user, datetime.date(2025, 8, 24), removed=True)
        self.assertEqual(self.memories()["results"], [])

    def test_screenshots_and_documents_are_not_memories(self):
        add_photo_on(self.user, datetime.date(2025, 8, 24), is_screenshot=True)
        add_photo_on(self.user, datetime.date(2025, 8, 24), is_document=True)
        self.assertEqual(self.memories()["results"], [])

    def test_videos_are_memories_too(self):
        video = add_photo_on(self.user, datetime.date(2025, 8, 24), video=True)
        (memory,) = self.memories()["results"]
        self.assertEqual(self.hashes(memory), {video.image_hash})

    def test_the_month_is_the_fallback_when_the_day_is_empty(self):
        photo = add_photo_on(self.user, datetime.date(2025, 8, 3))
        (memory,) = self.memories()["results"]
        self.assertEqual(memory["type"], "month_years_ago")
        self.assertEqual(memory["years_ago"], 1)
        self.assertEqual(memory["date"], "2025-08-03")
        self.assertEqual(self.hashes(memory), {photo.image_hash})

    def test_the_day_wins_over_the_month_when_it_has_anything(self):
        on_the_day = add_photo_on(self.user, datetime.date(2025, 8, 24))
        add_photo_on(self.user, datetime.date(2024, 8, 3))
        results = self.memories()["results"]
        self.assertEqual([memory["type"] for memory in results], ["years_ago"])
        self.assertEqual(self.hashes(results[0]), {on_the_day.image_hash})

    def test_a_place_is_reported_when_the_day_has_one(self):
        add_photo_on(self.user, datetime.date(2025, 8, 24))
        album_date = get_or_create_album_date(
            date=datetime.date(2025, 8, 24), owner=self.user
        )
        album_date.location = {"places": ["Rome, Italy"]}
        album_date.save()
        (memory,) = self.memories()["results"]
        self.assertEqual(memory["location"], "Rome, Italy")

    def test_days_without_a_place_report_none(self):
        add_photo_on(self.user, datetime.date(2025, 8, 24))
        (memory,) = self.memories()["results"]
        self.assertEqual(memory["location"], "")

    def test_the_users_today_is_used_when_no_date_is_given(self):
        add_photo_on(self.user, datetime.date(2025, 8, 24))
        now = datetime.datetime(2026, 8, 24, 12, tzinfo=UTC)
        with patch("api.views.memories.timezone.now", return_value=now):
            response = self.client.get("/api/memories")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["date"], "2026-08-24")
        self.assertEqual(len(body["results"]), 1)

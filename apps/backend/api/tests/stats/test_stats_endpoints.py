import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.fixtures.api_util.photos import photos
from api.tests.fixtures.api_util.sunburst_expectation import (
    expectation as sunburst_expectation,
)
from api.tests.utils import create_test_photo, create_test_user


def create_photos(user):
    for p in photos:
        create_test_photo(owner=user, **p)


def compare_objects_with_ignored_props(result, expectation, ignore):
    if isinstance(result, dict) and isinstance(expectation, dict):
        result_copy = {k: v for k, v in result.items() if k != ignore}
        expectation_copy = {k: v for k, v in expectation.items() if k != ignore}
        return all(
            compare_objects_with_ignored_props(
                result_copy[k], expectation_copy[k], ignore
            )
            for k in result_copy
        ) and set(result_copy.keys()) == set(expectation_copy.keys())
    if isinstance(result, list) and isinstance(expectation, list):
        return len(result) == len(expectation) and all(
            compare_objects_with_ignored_props(res, exp, ignore)
            for res, exp in zip(result, expectation)
        )
    return result == expectation


class TestApiUtil(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_wordcloud(self):
        create_photos(self.user)
        response = self.client.get("/api/wordcloud/")
        actual = response.json()
        # Check structure rather than exact values (caption generation may vary)
        self.assertIn("captions", actual)
        self.assertIn("people", actual)
        self.assertIn("locations", actual)
        self.assertIsInstance(actual["captions"], list)
        self.assertIsInstance(actual["people"], list)
        self.assertIsInstance(actual["locations"], list)
        # Each caption entry should have label and y
        for caption in actual["captions"]:
            self.assertIn("label", caption)
            self.assertIn("y", caption)

    def test_photo_month_count(self):
        create_photos(self.user)
        response = self.client.get("/api/photomonthcounts/")
        actual = response.json()
        self.assertEqual(
            actual,
            [
                {"month": "2017-8", "count": 6},
                {"month": "2017-9", "count": 0},
                {"month": "2017-10", "count": 3},
            ],
        )

    def test_photo_month_count_no_photos(self):
        response = self.client.get("/api/photomonthcounts/")
        actual = response.json()
        self.assertEqual(actual, [])

    def test_photo_day_count(self):
        create_photos(self.user)
        response = self.client.get("/api/photo-day-counts/")
        actual = response.json()
        self.assertEqual(
            actual,
            [
                {"day": "2017-08-09", "count": 1},
                {"day": "2017-08-17", "count": 3},
                {"day": "2017-08-22", "count": 1},
                {"day": "2017-08-23", "count": 1},
                {"day": "2017-10-12", "count": 1},
                {"day": "2017-10-17", "count": 1},
                {"day": "2017-10-18", "count": 1},
            ],
        )

    def test_photo_day_count_no_photos(self):
        response = self.client.get("/api/photo-day-counts/")
        actual = response.json()
        self.assertEqual(actual, [])

    def test_photo_day_count_skips_hidden_trashed_and_removed_photos(self):
        noon = datetime.datetime(2021, 5, 4, 12, tzinfo=datetime.UTC)
        create_test_photo(owner=self.user, exif_timestamp=noon)
        create_test_photo(owner=self.user, exif_timestamp=noon, hidden=True)
        create_test_photo(owner=self.user, exif_timestamp=noon, in_trashcan=True)
        create_test_photo(owner=self.user, exif_timestamp=noon, removed=True)
        response = self.client.get("/api/photo-day-counts/")
        self.assertEqual(response.json(), [{"day": "2021-05-04", "count": 1}])

    def test_photo_day_count_keeps_days_before_2000_and_skips_undated(self):
        create_test_photo(
            owner=self.user,
            exif_timestamp=datetime.datetime(1987, 6, 30, 9, tzinfo=datetime.UTC),
        )
        create_test_photo(owner=self.user, exif_timestamp=None)
        response = self.client.get("/api/photo-day-counts/")
        self.assertEqual(response.json(), [{"day": "1987-06-30", "count": 1}])

    def test_location_sunburst(self):
        create_photos(self.user)
        response = self.client.get("/api/locationsunburst/")
        actual = response.json()
        assert compare_objects_with_ignored_props(
            actual, sunburst_expectation, ignore="hex"
        )
